/**
 * Core — the heart of the dean's tool.
 *
 * Watches the URL for record page navigation, fetches data via SF/Canvas APIs,
 * and populates the shared state that the overlay UI reads.
 */

import browser from "webextension-polyfill"
import { getRecord, parseRecordUrl, describeObject, sfQuery } from "./sfapi"
import { getPermissions } from "./permissions"
import { pick, diag, makeFieldAccessor, type DiagLog, type DiagEntry } from "./resolve"
import { observeFields, observeCaseComplete } from "./observer"
import { loadAccountCourses, type AccountResult } from "./load-account"
import type { TermGroup } from "./student-courses"

const CANVAS_HOST = "unity.instructure.com"

async function canvasFetch<T>(path: string): Promise<T> {
  const result = await browser.runtime.sendMessage({
    type: "canvas-api",
    path,
  })
  if (result?.error) throw new Error(result.error)
  return result as T
}

/** Shared reactive state that the overlay UI reads from */
export const state = {
  /** Fires whenever any feature updates */
  listeners: new Set<() => void>(),

  /** Current SF page context */
  page: null as { objectType: string; recordId: string } | null,

  /** Case record data (when on a Case page) */
  caseData: null as {
    caseNumber: string
    status: string
    contactName: string
    contactEmail: string
    accountName: string
    accountId: string | null
    contactId: string | null
    type: string
    subType: string
    subject: string
  } | null,

  /** Prior cases for this student — loaded via SOQL after caseData is set */
  priorCases: null as Array<{
    id: string
    caseNumber: string
    type: string
    subType: string | null
    status: string
    createdDate: string
    courseName: string | null
    courseCode: string | null
    courseOfferingId: string | null
    termName: string | null
  }> | null,
  loadingPriorCases: false,

  /** Academic dishonesty fields from the case */
  dishonesty: null as {
    courseOfferingId: string | null
    courseOfferingName: string | null
    incidentType: string
    assignmentName: string | null
    severity: string | null
    instructor: string | null
    instructorEmail: string | null
  } | null,

  /** Grade appeal fields from the case */
  gradeAppeal: null as {
    courseOfferingId: string | null
    courseOfferingName: string | null
    courseOfferingParticipantId: string | null
    currentGrade: string | null
    changedGrade: string | null
    appealReason: string | null
    decisionStatus: string | null
    instructor: string | null
    instructorEmail: string | null
  } | null,

  /** Canvas course info (resolved from Course Offering record) */
  canvas: null as {
    courseId: string
    url: string
    enrollmentUrl: string | null
    studentId: string | null
    studentName: string | null
    studentPronouns: string | null
  } | null,

  /** Instructor info (resolved from case, looked up in Canvas) */
  instructor: null as {
    name: string | null
    email: string | null
    canvasId: string | null
  } | null,

  /** Account page data — courses grouped by term */
  accountData: null as {
    canvasUserId: string | null
    accountName: string | null
    termGroups: TermGroup[]
    error: string | null
  } | null,

  /** Raw Contact record for debugging */
  contactRaw: null as Record<string, unknown> | null,

  /** Granular loading / error state */
  loading: false,
  loadingCourseOffering: false,
  loadingStudent: false,
  error: null as string | null,
  courseOfferingError: null as string | null,
  studentError: null as string | null,

  /** Raw COP record for debugging */
  copRaw: null as Record<string, unknown> | null,

  /** Diagnostic log — field misses and resolution path for this page load */
  diagnostics: [] as DiagEntry[],

  notify() {
    this.listeners.forEach(fn => fn())
  },
}


function classifyIncident(raw: string | null): string {
  if (!raw) return "other"
  const lower = raw.toLowerCase()
  if (lower.includes("plagiari")) return "plagiarism"
  if (lower.includes("cheat")) return "cheating"
  if (lower.includes("fabricat")) return "fabrication"
  return "other"
}

/**
 * Navigation token — incremented on every navigation event.
 * Async operations capture the token at start and bail if it changes,
 * preventing stale results from a superseded navigation from writing to state.
 */
let navToken = 0

function stale(token: number): boolean {
  return token !== navToken
}


/** Follow Course Offering Participant → return coId and student info (no side effects) */
async function resolveCopToCoId(copId: string): Promise<{
  coId: string | null
  enrollmentId: string | null
  contactId: string | null
  accountId: string | null
  preferredName: string | null
}> {
  const log: DiagLog = []
  try {
    const cop = await getRecord<Record<string, unknown>>("CourseOfferingParticipant", copId)
    state.copRaw = cop
    const result = {
      coId: pick(log, cop, "CourseOfferingId", "Course_Offering__c", "CourseOfferingId__c", "hed__Course_Offering__c", "Course_Offering_ID__c", "CourseOffering__c"),
      enrollmentId: pick(log, cop, "Canvas_Enrollment_ID__c", "CanvasEnrollmentId__c"),
      contactId: pick(log, cop, "ParticipantContactId", "hed__Contact__c", "ContactId", "Contact__c"),
      accountId: pick(log, cop, "ParticipantAccountId", "AccountId"),
      preferredName: pick(log, cop, "Preferred_Student_Name__c", "PreferredName__c"),
    }
    diag(log, "cop-resolved", `coId=${result.coId ?? "null"} preferredName=${result.preferredName ?? "null"} accountId=${result.accountId ?? "null"}`)
    state.diagnostics.push(...log)
    observeFields("CourseOfferingParticipant", log)
    return result
  } catch (e) {
    diag(log, "cop-error", String(e))
    state.diagnostics.push(...log)
    return { coId: null, enrollmentId: null, contactId: null, accountId: null, preferredName: null }
  }
}

/** Fetch Person Account to get Canvas user ID and gender identity */
async function resolveFromAccount(accountId: string) {
  const log: DiagLog = []
  try {
    const account = await getRecord<Record<string, unknown>>("Account", accountId)
    state.contactRaw = account  // reuse slot for display in Dev
    const canvasUserId = pick(log, account, "Canvas_User_ID__pc", "Canvas_User_ID__c", "CanvasUserId__c", "Canvas_ID__c", "Canvas_User__c")
    const genderIdentity = pick(log, account, "Gender_Identity__c", "GenderIdentity__c", "Gender__c", "Pronouns__c", "Preferred_Pronouns__c")
    diag(log, "account-resolved", `canvasUserId=${canvasUserId ?? "null"} genderIdentity=${genderIdentity ?? "null"}`)
    state.diagnostics.push(...log)
    observeFields("Account", log)
    if (state.canvas) {
      if (canvasUserId && !state.canvas.studentId) {
        state.canvas.studentId = canvasUserId
      }
      if (genderIdentity) {
        state.canvas.studentPronouns = genderIdentity
      }
      state.notify()
    }
  } catch (e) {
    diag(log, "account-error", String(e))
    state.diagnostics.push(...log)
  }
}

/** Use Canvas Enrollment ID to get the Canvas user_id — courseId must already be set in state */
async function resolveStudentFromEnrollment(enrollmentId: string, fallbackEmail: string | null) {
  const courseId = state.canvas?.courseId
  if (!courseId) {
    state.loadingStudent = false
    state.studentError = "Canvas course not resolved — cannot look up enrollment"
    state.notify()
    return
  }

  try {
    const enrollmentUrl = `https://unity.instructure.com/courses/${courseId}/enrollments/${enrollmentId}`
    if (state.canvas) state.canvas.enrollmentUrl = enrollmentUrl
    state.diagnostics.push({ type: "enrollment-url", detail: enrollmentUrl })
    const enrollments = await canvasFetch<Array<{ id: number; user_id: number; user: { name: string } }>>(
      `/api/v1/courses/${courseId}/enrollments?enrollment_id[]=${enrollmentId}&type[]=StudentEnrollment&state[]=active&state[]=inactive&state[]=completed`
    )
    state.diagnostics.push({ type: "enrollment-lookup", detail: `found ${enrollments.length} result(s) for enrollment ${enrollmentId} in course ${courseId}` })
    const enrollment = enrollments[0]
    if (enrollment && state.canvas) {
      state.canvas.studentId = String(enrollment.user_id)
      state.canvas.studentName = enrollment.user?.name ?? null
      state.loadingStudent = false
      state.notify()
      return
    }
    state.diagnostics.push({ type: "enrollment-lookup", detail: "enrollment found but empty — falling back" })
  } catch (e) {
    state.diagnostics.push({ type: "enrollment-lookup", detail: `failed: ${e}` })
    if (isAuthError(e)) {
      state.loadingStudent = false
      state.studentError = "canvas-session-required"
      state.notify()
      return
    }
    console.warn("[UEU] Canvas enrollment lookup failed, falling back to email search:", e)
    if (fallbackEmail) {
      await lookupCanvasStudentByEmail(fallbackEmail)
    } else {
      state.loadingStudent = false
      state.studentError = "Could not resolve student from Canvas enrollment"
      state.notify()
    }
  }
}

/** Fetch the SF Contact record and use it to find the Canvas student */
async function resolveStudentFromContact(contactId: string, fallbackEmail: string | null) {
  const log: DiagLog = []
  try {
    const contact = await getRecord<Record<string, unknown>>("Contact", contactId)

    const canvasUserId = pick(log, contact, "Canvas_User_ID__c", "CanvasUserId__c", "Canvas_ID__c")
    if (canvasUserId && state.canvas) {
      state.canvas.studentId = canvasUserId
      state.canvas.studentName = pick(log, contact, "Name") ?? null
      state.diagnostics.push(...log)
      observeFields("Contact", log)
      state.loadingStudent = false
      state.notify()
      return
    }

    const email = pick(log, contact, "Email") ?? fallbackEmail
    if (email) {
      await lookupCanvasStudentByEmail(email)
    } else {
      state.loadingStudent = false
      state.studentError = "No email on contact record"
      state.notify()
    }
    state.diagnostics.push(...log)
    observeFields("Contact", log)
  } catch (e) {
    console.warn("[UEU] Failed to fetch Contact:", e)
    if (fallbackEmail) {
      await lookupCanvasStudentByEmail(fallbackEmail)
    } else {
      state.loadingStudent = false
      state.studentError = "Could not look up student"
      state.notify()
    }
  }
}

function isAuthError(e: unknown): boolean {
  return e instanceof Error && e.message.includes(" 401:")
}

/** Find the exact email match from a set of Canvas user results */
function findExactEmailMatch(
  users: Array<{ id: number; name: string; email?: string; login_id?: string }>,
  email: string,
): { id: number; name: string } | null {
  const lower = email.toLowerCase()
  // Exact match on email or login_id
  const exact = users.find(u =>
    u.email?.toLowerCase() === lower || u.login_id?.toLowerCase() === lower
  )
  if (exact) return exact
  // If only one result, trust it (Canvas may not return email field for non-admins)
  if (users.length === 1) return users[0]
  return null
}

/** Search Canvas for student by email — course-scoped first, global fallback */
async function lookupCanvasStudentByEmail(email: string) {
  // 1. Course-scoped search (works without admin scope)
  const courseId = state.canvas?.courseId
  if (courseId) {
    try {
      const users = await canvasFetch<Array<{ id: number; name: string; email?: string; login_id?: string }>>(
        `/api/v1/courses/${courseId}/search_users?search_term=${encodeURIComponent(email)}&include[]=email&include[]=login_id&per_page=5`
      )
      const match = findExactEmailMatch(users, email)
      if (match && state.canvas) {
        state.canvas.studentId = String(match.id)
        state.canvas.studentName = match.name
        diag(state.diagnostics, "student-email-lookup", `course-scoped: exact match ${match.id} (of ${users.length} results)`)
        state.loadingStudent = false
        state.notify()
        return
      }
      diag(state.diagnostics, "student-email-lookup", `course-scoped: ${users.length} result(s), no exact match in course ${courseId}`)
    } catch (e) {
      if (isAuthError(e)) {
        state.loadingStudent = false
        state.studentError = "canvas-session-required"
        state.notify()
        return
      }
      diag(state.diagnostics, "student-email-lookup", `course-scoped failed: ${e}`)
    }
  }

  // 2. Global search fallback (needs admin scope — may 404)
  try {
    const users = await canvasFetch<Array<{ id: number; name: string; email?: string; login_id?: string }>>(
      `/api/v1/users?search_term=${encodeURIComponent(email)}&include[]=email&include[]=login_id&per_page=5`
    )
    const match = findExactEmailMatch(users, email)
    if (match && state.canvas) {
      state.canvas.studentId = String(match.id)
      state.canvas.studentName = match.name
      diag(state.diagnostics, "student-email-lookup", `global: exact match ${match.id} (of ${users.length} results)`)
      state.loadingStudent = false
      state.notify()
      return
    }
  } catch (e) {
    if (isAuthError(e)) {
      state.loadingStudent = false
      state.studentError = "canvas-session-required"
      state.notify()
      return
    }
    diag(state.diagnostics, "student-email-lookup", `global failed: ${e}`)
  }

  state.studentError = "Student not found in Canvas"
  state.loadingStudent = false
  state.notify()
}

/** Resolve instructor — try SF Account (Canvas_User_ID__pc), then course-scoped Canvas search */
async function resolveInstructor(name: string | null, email: string | null, instructorFieldValue: string | null) {
  state.instructor = { name, email, canvasId: null }
  state.notify()

  // 1. If the Instructor__c field is a lookup (SF ID), fetch that Account for Canvas_User_ID__pc
  if (instructorFieldValue && /^[a-zA-Z0-9]{15,18}$/.test(instructorFieldValue)) {
    const log: DiagLog = []
    try {
      const account = await getRecord<Record<string, unknown>>("Account", instructorFieldValue)
      const canvasUserId = pick(log, account, "Canvas_User_ID__pc", "Canvas_User_ID__c")
      const accountName = pick(log, account, "Name")
      state.diagnostics.push(...log)
      if (canvasUserId) {
        state.instructor.canvasId = canvasUserId
        if (accountName) state.instructor.name = accountName
        diag(state.diagnostics, "instructor-lookup", `account Canvas_User_ID__pc=${canvasUserId} name=${accountName ?? "null"}`)
        state.notify()
        return
      }
      // Account exists but no Canvas ID — use name if we got it
      if (accountName && !name) state.instructor.name = accountName
      diag(state.diagnostics, "instructor-lookup", `account found but no Canvas user ID`)
    } catch (e) {
      diag(state.diagnostics, "instructor-lookup", `account fetch failed: ${e}`)
      // May not be an Account — could be a Contact. Try that.
      try {
        const contact = await getRecord<Record<string, unknown>>("Contact", instructorFieldValue)
        const canvasUserId = pick(log, contact, "Canvas_User_ID__c")
        const contactName = pick(log, contact, "Name")
        state.diagnostics.push(...log)
        if (canvasUserId) {
          state.instructor.canvasId = canvasUserId
          if (contactName) state.instructor.name = contactName
          diag(state.diagnostics, "instructor-lookup", `contact Canvas_User_ID__c=${canvasUserId}`)
          state.notify()
          return
        }
        if (contactName && !name) state.instructor.name = contactName
      } catch {
        diag(state.diagnostics, "instructor-lookup", `contact fetch also failed`)
      }
    }
  }

  if (!email) { state.notify(); return }

  // 2. Course-scoped Canvas search by email
  const courseId = state.canvas?.courseId
  if (courseId) {
    try {
      const users = await canvasFetch<Array<{ id: number; name: string }>>(
        `/api/v1/courses/${courseId}/search_users?search_term=${encodeURIComponent(email)}&enrollment_type[]=teacher&enrollment_type[]=ta&per_page=5`
      )
      if (users.length > 0) {
        state.instructor.canvasId = String(users[0].id)
        if (!state.instructor.name || state.instructor.name === name) state.instructor.name = users[0].name
        diag(state.diagnostics, "instructor-lookup", `course-scoped email=${email} canvasId=${state.instructor.canvasId}`)
        state.notify()
        return
      }
      diag(state.diagnostics, "instructor-lookup", `course-scoped: no match for ${email}`)
    } catch (e) {
      diag(state.diagnostics, "instructor-lookup", `course-scoped failed: ${e}`)
    }
  }

  state.notify()
}

/**
 * Resolve Canvas course from a CO, then resolve the student.
 * Centralises the identical dishonesty / grade-appeal sequence.
 */
async function resolveCanvasAndStudent(opts: {
  coId: string
  preferredName: string | null
  accountId: string | null
  contactId: string | null
  enrollmentId: string | null
  email: string | null
  onName: (name: string) => void
  token: number
}) {
  const canvasId = await resolveCanvasFromCo(opts.coId, opts.onName)
  if (canvasId && !stale(opts.token)) {
    await resolveStudent({
      preferredName: opts.preferredName,
      accountId: opts.accountId,
      contactId: opts.contactId,
      enrollmentId: opts.enrollmentId,
      email: opts.email,
    })
  }
}

/** Fetch Course Offering and set Canvas course state. Returns canvasId if resolved, null otherwise. */
async function resolveCanvasFromCo(coId: string, onName: (name: string) => void): Promise<string | null> {
  state.loadingCourseOffering = true
  state.courseOfferingError = null
  state.notify()

  const log: DiagLog = []
  try {
    const co = await getRecord<Record<string, unknown>>("CourseOffering", coId)
    const name = pick(log, co, "Name")
    if (name) onName(name)

    const canvasId = pick(log, co, "Canvas_Course_ID__c", "CanvasCourseId__c", "Canvas_Course__c")
    state.loadingCourseOffering = false

    if (!canvasId) {
      diag(log, "canvas-id-missing", `CourseOffering ${coId} has no Canvas Course ID`)
      state.diagnostics.push(...log)
      state.courseOfferingError = "No Canvas Course ID on this Course Offering"
      state.notify()
      return null
    }

    // Discover term-related fields on CourseOffering
    const coFieldMap = await describeObject("CourseOffering").catch(() => null)
    if (coFieldMap) {
      const termFields: string[] = []
      for (const [label, info] of coFieldMap) {
        if (label.includes("term") || info.name.toLowerCase().includes("term")) {
          termFields.push(`${info.name} (label: "${label}", type: ${info.type})`)
        }
      }
      diag(log, "co-term-fields", termFields.length > 0 ? termFields.join("; ") : "none found")
    }

    diag(log, "canvas-id-resolved", canvasId)
    state.diagnostics.push(...log)
    observeFields("CourseOffering", log)
    state.canvas = { courseId: canvasId, url: `https://unity.instructure.com/courses/${canvasId}`, enrollmentUrl: null, studentId: null, studentName: null }
    state.notify()
    return canvasId
  } catch (e) {
    state.loadingCourseOffering = false
    state.courseOfferingError = "Could not load Course Offering"
    state.notify()
    console.warn("[UEU] Failed to fetch Course Offering:", e)
    return null
  }
}

/** Resolve student — cascading fallback: enrollment → contact → email */
async function resolveStudent(opts: {
  preferredName?: string | null
  accountId?: string | null
  contactId?: string | null
  enrollmentId?: string | null
  email?: string | null
}) {
  state.loadingStudent = true
  state.studentError = null
  state.notify()

  // Set name from COP directly — no Canvas API needed
  if (opts.preferredName && state.canvas) {
    state.canvas.studentName = opts.preferredName
    diag(state.diagnostics, "student-lookup-path", `cop-name:${opts.preferredName}`)
  }

  // 1. Person Account — Canvas_User_ID__pc is the authoritative source
  if (opts.accountId) {
    await resolveFromAccount(opts.accountId)
    if (state.canvas?.studentId) {
      state.loadingStudent = false
      state.notify()
      return
    }
  }

  // 2. Try Canvas enrollment ID (if we have courseId)
  if (!state.canvas?.studentId && opts.enrollmentId) {
    diag(state.diagnostics, "student-lookup-path", `enrollment:${opts.enrollmentId}`)
    await resolveStudentFromEnrollment(opts.enrollmentId, opts.email ?? null)
    if (state.canvas?.studentId) return
  }

  // 3. Try SF Contact → Canvas user ID or email lookup
  if (!state.canvas?.studentId && opts.contactId) {
    diag(state.diagnostics, "student-lookup-path", `contact:${opts.contactId}`)
    await resolveStudentFromContact(opts.contactId, opts.email ?? null)
    if (state.canvas?.studentId) return
  }

  // 4. Try email search directly
  if (!state.canvas?.studentId && opts.email) {
    diag(state.diagnostics, "student-lookup-path", `email:${opts.email}`)
    await lookupCanvasStudentByEmail(opts.email)
    return
  }

  // Nothing worked
  if (!state.canvas?.studentId && !opts.preferredName) {
    state.studentError = "No student identifier available"
    diag(state.diagnostics, "student-lookup-path", "no identifier available")
  }

  state.loadingStudent = false
  state.notify()
}

/** Query SF for all prior cases linked to the same ContactId */
async function loadPriorCases(contactId: string, _currentCaseId: string, token: number) {
  state.loadingPriorCases = true
  state.notify()
  try {
    const soql = `SELECT Id, CaseNumber, Type, SubType__c, Status, CreatedDate, Course_Offering__c, Course_Offering__r.Name, Course_Offering__r.Academic_Term_Display_Name__c FROM Case WHERE ContactId = '${contactId}' ORDER BY CreatedDate DESC LIMIT 25`
    const result = await sfQuery<{
      Id: string; CaseNumber: string; Type: string
      SubType__c: string | null; Status: string; CreatedDate: string
      Course_Offering__c: string | null
      Course_Offering__r?: { Name?: string; Academic_Term_Display_Name__c?: string }
    }>(soql)
    if (stale(token)) return
    state.priorCases = result.records.map(r => ({
      id: r.Id,
      caseNumber: r.CaseNumber,
      type: r.Type,
      subType: r.SubType__c,
      status: r.Status,
      createdDate: r.CreatedDate,
      courseName: r.Course_Offering__r?.Name ?? null,
      courseCode: extractCourseCode(r.Course_Offering__r?.Name ?? null),
      courseOfferingId: r.Course_Offering__c ?? null,
      termName: cleanTermName(r.Course_Offering__r?.Academic_Term_Display_Name__c ?? null),
    }))
    diag(state.diagnostics, "prior-cases", `found ${state.priorCases.length} prior case(s)`)
  } catch (e) {
    if (stale(token)) return
    diag(state.diagnostics, "prior-cases-error", String(e))
  }
  state.loadingPriorCases = false
  state.notify()
}

/** Strip the human-readable date suffix from a term display name, keeping the internal code.
 *  "DE5W04.07.25- April 7, 2025" → "DE5W04.07.25" */
function cleanTermName(name: string | null): string | null {
  if (!name) return null
  return name.replace(/\s*-\s*[A-Za-z].*$/, "").trim()
}

/** Extract a short course code like "ENGL101" from a full offering name */
function extractCourseCode(name: string | null): string | null {
  if (!name) return null
  const match = name.match(/([A-Z]{3,4}\d{3,4}).*\s-\s(\d+)/i)
  return match ? `${match[1]} - ${match[2]}` : null
}

async function loadCase(recordId: string, token: number) {
  state.loading = true
  state.loadingCourseOffering = false
  state.loadingStudent = false
  state.error = null
  state.courseOfferingError = null
  state.studentError = null
  state.caseData = null
  state.priorCases = null
  state.loadingPriorCases = false
  state.dishonesty = null
  state.gradeAppeal = null
  state.instructor = null
  state.canvas = null  // clears studentId/studentName immediately so stale data never shows
  state.copRaw = null
  state.contactRaw = null
  state.diagnostics = []
  state.notify()  // fire immediately so UI wipes before any async work starts

  try {
    // Fetch the record first — fast, stale check before anything else
    const rec = await getRecord<Record<string, unknown>>("Case", recordId)
    if (stale(token)) return

    // Describe is slower (large payload) — do it after stale check, use cache on repeat visits
    const fieldMap = await describeObject("Case").catch(() => null)
    if (stale(token)) return

    if (fieldMap) diag(state.diagnostics, "describe", `Case: ${fieldMap.size} fields`)
    const f = makeFieldAccessor(state.diagnostics, rec, fieldMap)

    // Basic case info
    const rawContactId = pick(state.diagnostics, rec, "ContactId")
    state.caseData = {
      caseNumber: f("Case Number", "CaseNumber") ?? "",
      status: f("Status", "Status") ?? "unknown",
      contactName: f("Contact Name", "Contact_Name__c", "ContactId") ?? "",
      contactEmail: f("Contact Email", "Contact_Email__c", "ContactEmail", "SuppliedEmail") ?? "",
      accountName: f("Account Name", "Account_Name__c", "AccountId") ?? "",
      accountId: null,  // will fill from COP
      contactId: rawContactId,
      type: f("Type", "Type") ?? "",
      subType: f("Sub Type", "SubType__c", "Sub_Type__c") ?? "",
      subject: f("Subject", "Subject") ?? "",
    }

    // COP is the clearinghouse record — fetch it first if present.
    // It gives us coId, enrollmentId, and contactId in one shot, for any case type.
    const copId = f("Course Offering Participant", "Course_Offering_Participant__c", "CourseOfferingParticipant__c")
    let copCoId: string | null = null
    let copContactId: string | null = null
    let copAccountId: string | null = null
    let copEnrollmentId: string | null = null
    let copPreferredName: string | null = null

    if (copId) {
      const cop = await resolveCopToCoId(copId)
      if (stale(token)) return
      copCoId = cop.coId
      copContactId = cop.contactId
      copAccountId = cop.accountId
      copEnrollmentId = cop.enrollmentId
      copPreferredName = cop.preferredName
    }

    // Resolve the course offering ID — prefer COP's link, fall back to direct case field
    const caseCoId = f("Course Offering", "Course_Offering__c", "CourseOffering__c")
    const resolvedCoId = copCoId ?? caseCoId

    // Dishonesty fields (may or may not be on this case)
    const incidentRaw = f("Incident Type", "Incident_Type__c", "Type_of_Incident__c", "Category__c")
    const assignmentName = f("Assignment", "Assignment__c", "Assignment_Name__c")

    if (resolvedCoId || incidentRaw) {
      state.dishonesty = {
        courseOfferingId: resolvedCoId,
        courseOfferingName: null, // will fill from CO record
        incidentType: classifyIncident(incidentRaw),
        assignmentName,
        severity: f("Severity", "Severity__c"),
        instructor: f("Instructor", "Instructor_Name__c", "Instructor__c"),
        instructorEmail: f("Instructor Email", "Instructor_Email__c"),
      }

      if (resolvedCoId) {
        await resolveCanvasAndStudent({
          coId: resolvedCoId,
          preferredName: copPreferredName,

          accountId: copAccountId,
          contactId: copContactId,
          enrollmentId: copEnrollmentId,
          email: state.caseData?.contactEmail ?? null,
          onName: (name) => { if (!stale(token) && state.dishonesty) state.dishonesty.courseOfferingName = name },
          token,
        })
      }
    }

    if (stale(token)) return

    // Grade appeal fields
    const appealReason = f("Grade Appeal Reason", "Grade_Appeal_Reason__c", "GradeAppealReason__c")
    const currentGrade = f("Current Grade", "Current_Grade__c", "CurrentGrade__c")
    const changedGrade = f("Changed Grade", "Changed_Grade__c", "ChangedGrade__c")
    const decisionStatus = f("Decision Status", "Decision_Status__c", "DecisionStatus__c")

    if (appealReason || currentGrade || (copId && !state.dishonesty)) {
      state.gradeAppeal = {
        courseOfferingId: resolvedCoId,
        courseOfferingName: null,
        courseOfferingParticipantId: copId,
        currentGrade,
        changedGrade,
        appealReason,
        decisionStatus,
        instructor: f("Instructor", "Instructor_Name__c", "Instructor__c"),
        instructorEmail: f("Instructor Email", "Instructor_Email__c"),
      }

      // Only resolve Canvas here if dishonesty didn't already do it
      if (resolvedCoId && !state.canvas) {
        await resolveCanvasAndStudent({
          coId: resolvedCoId,
          preferredName: copPreferredName,

          accountId: copAccountId,
          contactId: copContactId,
          enrollmentId: copEnrollmentId,
          email: state.caseData?.contactEmail ?? null,
          onName: (name) => { if (!stale(token) && state.gradeAppeal) state.gradeAppeal.courseOfferingName = name },
          token,
        })
      }
    }

    if (stale(token)) return

    // Generic case: has a course offering but didn't match dishonesty or grade appeal
    // Still resolve Canvas + student so links work for any case type
    if (resolvedCoId && !state.canvas) {
      await resolveCanvasAndStudent({
        coId: resolvedCoId,
        preferredName: copPreferredName,
        accountId: copAccountId,
        contactId: copContactId,
        enrollmentId: copEnrollmentId,
        email: state.caseData?.contactEmail ?? null,
        onName: () => {},
        token,
      })
    }

    if (stale(token)) return

    // Resolve instructor — try SF Account lookup first, then Canvas search
    const instructorName = state.dishonesty?.instructor ?? state.gradeAppeal?.instructor ?? null
    const instructorEmail = state.dishonesty?.instructorEmail ?? state.gradeAppeal?.instructorEmail ?? null
    const instructorRaw = pick(state.diagnostics, rec, "Instructor__c", "Instructor_Name__c")
    if (instructorName || instructorEmail || instructorRaw) {
      resolveInstructor(instructorName, instructorEmail, instructorRaw)
    }

    state.loading = false
    state.notify()

    // D1: load prior cases for this student via SOQL — SF is authoritative
    // ContactId may be null on the Case directly (Unity links via COP); fall back to COP's contactId
    const resolvedContactId = rawContactId ?? copContactId
    console.log("[UEU] prior-cases-contact", { rawContactId, copContactId, resolvedContactId })
    diag(state.diagnostics, "prior-cases-contact", `rawContactId=${rawContactId ?? "null"} copContactId=${copContactId ?? "null"} resolved=${resolvedContactId ?? "null"}`)
    if (resolvedContactId) {
      loadPriorCases(resolvedContactId, recordId, token)
    } else {
      diag(state.diagnostics, "prior-cases-skip", "no contactId available — skipping SOQL query")
    }

    // Observe — feed the graph
    observeFields("Case", state.diagnostics)
    if (state.caseData) {
      observeCaseComplete({
        caseType: state.caseData.type,
        caseSubType: state.caseData.subType,
        diagnostics: state.diagnostics,
      })
    }
  } catch (e) {
    if (stale(token)) return
    state.loading = false
    state.error = e instanceof Error ? e.message : String(e)
    state.notify()
    console.error("[UEU] Failed to load case:", e)
  }
}

async function loadCourseOffering(recordId: string, token: number) {
  state.loading = true
  state.error = null
  state.canvas = null
  state.diagnostics = []
  state.notify()

  try {
    const co = await getRecord<Record<string, unknown>>("CourseOffering", recordId)
    if (stale(token)) return
    const coLog: DiagLog = []
    const canvasId = pick(coLog, co, "Canvas_Course_ID__c", "CanvasCourseId__c", "Canvas_Course__c")
    if (canvasId) {
      state.canvas = {
        courseId: canvasId,
        url: `https://unity.instructure.com/courses/${canvasId}`,
        enrollmentUrl: null,
        studentId: null,
        studentName: null,
      }
    }
    state.diagnostics.push(...coLog)
    state.loading = false
    state.notify()
    observeFields("CourseOffering", coLog)
  } catch (e) {
    if (stale(token)) return
    state.loading = false
    state.error = e instanceof Error ? e.message : String(e)
    state.notify()
    console.error("[UEU] Failed to load course offering:", e)
  }
}

async function loadTerm(recordId: string, token: number) {
  state.loading = true
  state.error = null
  state.diagnostics = []
  state.notify()

  try {
    const term = await getRecord<Record<string, unknown>>("Term", recordId)
    if (stale(token)) return
    const termLog: DiagLog = []
    pick(termLog, term, "Name")
    pick(termLog, term, "StartDate", "Start_Date__c", "hed__Start_Date__c")
    pick(termLog, term, "EndDate", "End_Date__c", "hed__End_Date__c")
    pick(termLog, term, "Status__c", "Status", "hed__Status__c")
    state.diagnostics.push(...termLog)
    state.loading = false
    state.notify()
    observeFields("Term", termLog)
  } catch (e) {
    if (stale(token)) return
    state.loading = false
    state.error = e instanceof Error ? e.message : String(e)
    state.notify()
    console.error("[UEU] Failed to load term:", e)
  }
}

async function loadAccount(recordId: string, token: number) {
  state.loading = true
  state.error = null
  state.accountData = null
  state.diagnostics = []
  state.notify()

  const result = await loadAccountCourses(recordId, {
    getRecord,
    canvasFetch,
    isStale: () => stale(token),
  })

  if (stale(token)) return

  // If Canvas ID missing on first try, retry once after 2s — SF SPA pages sometimes
  // settle the record data after initial render
  if (result.error === "no-canvas-id" && !stale(token)) {
    await new Promise(r => setTimeout(r, 2000))
    if (stale(token)) return
    const retry = await loadAccountCourses(recordId, {
      getRecord,
      canvasFetch,
      isStale: () => stale(token),
    })
    if (!stale(token) && retry.canvasUserId) {
      state.accountData = {
        canvasUserId: retry.canvasUserId,
        accountName: retry.accountName,
        termGroups: retry.termGroups,
        lastActivityAt: retry.lastActivityAt,
        error: retry.error,
      }
      state.diagnostics.push(...retry.diagnostics)
      state.loading = false
      state.notify()
      return
    }
  }

  state.accountData = {
    canvasUserId: result.canvasUserId,
    accountName: result.accountName,
    termGroups: result.termGroups,
    lastActivityAt: result.lastActivityAt,
    error: result.error,
  }
  state.diagnostics.push(...result.diagnostics)
  state.loading = false

  if (result.error === "canvas-session-required") {
    state.studentError = "canvas-session-required"
  }

  state.notify()
}

let navigateTimer: ReturnType<typeof setTimeout> | null = null

/** Handle a URL change — debounced to let SF's SPA routing settle */
function onNavigate() {
  if (navigateTimer) clearTimeout(navigateTimer)
  navigateTimer = setTimeout(doNavigate, 300)
}

async function doNavigate() {
  const parsed = parseRecordUrl(window.location.pathname)

  // Clear state if we left a record page
  if (!parsed) {
    if (state.page) {
      state.page = null
      state.caseData = null
      state.dishonesty = null
      state.gradeAppeal = null
      state.instructor = null
      state.canvas = null
      state.accountData = null
      state.loading = false
      state.error = null
      state.notify()
    }
    return
  }

  // Skip if we're already on this record and have data or are actively loading
  if (state.page?.recordId === parsed.recordId && (state.loading || state.caseData || state.canvas || state.accountData)) return

  state.page = parsed
  state.loading = true
  state.notify()
  const token = ++navToken

  // Gate behind explicit user consent
  const perms = await getPermissions()
  if (stale(token)) return
  if (!perms.sfApi) {
    state.loading = false
    state.error = null
    state.notify()
    return
  }

  if (parsed.objectType === "Case") {
    await loadCase(parsed.recordId, token)
  } else if (parsed.objectType === "CourseOffering") {
    await loadCourseOffering(parsed.recordId, token)
  } else if (parsed.objectType === "Term") {
    await loadTerm(parsed.recordId, token)
  } else if (parsed.objectType === "Account") {
    await loadAccount(parsed.recordId, token)
  }
}

/** Re-run navigation check (call after granting permissions) */
export function refresh() {
  // Reset so onNavigate doesn't skip it
  const saved = state.page
  state.page = null
  onNavigate()
}

/** Start watching for navigation changes */
export function startWatching() {
  // Initial check
  onNavigate()

  // Salesforce is a SPA — intercept pushState/replaceState
  const origPush = history.pushState.bind(history)
  const origReplace = history.replaceState.bind(history)

  history.pushState = function (...args) {
    origPush(...args)
    onNavigate()
  }

  history.replaceState = function (...args) {
    origReplace(...args)
    onNavigate()
  }

  window.addEventListener("popstate", () => onNavigate())
}
