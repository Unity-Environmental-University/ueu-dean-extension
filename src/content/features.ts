/**
 * Features — reactive state driven by the SF REST API.
 *
 * Watches the URL for record page navigation, fetches data via API,
 * and populates the shared state that the overlay UI reads.
 */

import browser from "webextension-polyfill"
import { getRecord, parseRecordUrl, describeObject } from "./sfapi"
import { getPermissions } from "./permissions"

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
    type: string
    subType: string
    subject: string
  } | null,

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
  diagnostics: [] as Array<{ type: string; detail: string }>,

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

/** Try multiple field name variants — SF custom fields are unpredictable */
function pick(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = record[k]
    if (v != null && v !== "") return String(v)
  }
  // Log miss so diagnostics can show which variants were tried
  state.diagnostics.push({ type: "pick-miss", detail: `tried: ${keys.join(", ")}` })
  return null
}

function diag(type: string, detail: string) {
  state.diagnostics.push({ type, detail })
}

/**
 * Build a field accessor for a described SObject record.
 * Looks up by human label first (exact, from describe), falls back to pick() variants.
 * Logs what it found and how.
 */
function makeFieldAccessor(record: Record<string, unknown>, fieldMap: Map<string, { name: string }> | null) {
  return function get(label: string, ...fallbackKeys: string[]): string | null {
    // Try describe-based lookup first
    if (fieldMap) {
      const info = fieldMap.get(label.toLowerCase())
      if (info) {
        const v = record[info.name]
        if (v != null && v !== "") {
          diag("field-hit", `"${label}" → ${info.name}`)
          return String(v)
        }
        diag("field-miss", `"${label}" → ${info.name} (present but empty)`)
      } else {
        diag("field-unknown", `"${label}" not in describe`)
      }
    }
    // Fall back to pick() with explicit variants
    return pick(record, ...fallbackKeys)
  }
}

/** Follow Course Offering Participant → return coId and student info (no side effects) */
async function resolveCopToCoId(copId: string): Promise<{
  coId: string | null
  enrollmentId: string | null
  contactId: string | null
  accountId: string | null
  preferredName: string | null
  unityId: string | null
}> {
  try {
    const cop = await getRecord<Record<string, unknown>>("CourseOfferingParticipant", copId)
    state.copRaw = cop
    const result = {
      coId: pick(cop, "CourseOfferingId", "Course_Offering__c", "CourseOfferingId__c", "hed__Course_Offering__c", "Course_Offering_ID__c", "CourseOffering__c"),
      enrollmentId: pick(cop, "Canvas_Enrollment_ID__c", "CanvasEnrollmentId__c"),
      contactId: pick(cop, "ParticipantContactId", "hed__Contact__c", "ContactId", "Contact__c"),
      accountId: pick(cop, "ParticipantAccountId", "AccountId"),
      preferredName: pick(cop, "Preferred_Student_Name__c", "PreferredName__c"),
      unityId: pick(cop, "Unity_ID__c", "UnityId__c"),
    }
    diag("cop-resolved", `coId=${result.coId ?? "null"} preferredName=${result.preferredName ?? "null"} unityId=${result.unityId ?? "null"} accountId=${result.accountId ?? "null"}`)
    return result
  } catch (e) {
    diag("cop-error", String(e))
    return { coId: null, enrollmentId: null, contactId: null, accountId: null, preferredName: null, unityId: null }
  }
}

/** Fetch Person Account to get Canvas user ID and gender identity */
async function resolveFromAccount(accountId: string) {
  try {
    const account = await getRecord<Record<string, unknown>>("Account", accountId)
    state.contactRaw = account  // reuse slot for display in Dev
    const canvasUserId = pick(account, "Canvas_User_ID__c", "CanvasUserId__c", "Canvas_ID__c", "Canvas_User__c")
    const genderIdentity = pick(account, "Gender_Identity__c", "GenderIdentity__c", "Gender__c", "Pronouns__c", "Preferred_Pronouns__c")
    diag("account-resolved", `canvasUserId=${canvasUserId ?? "null"} genderIdentity=${genderIdentity ?? "null"}`)
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
    diag("account-error", String(e))
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
    diag("enrollment-url", enrollmentUrl)
    const enrollments = await canvasFetch<Array<{ id: number; user_id: number; user: { name: string } }>>(
      `/api/v1/courses/${courseId}/enrollments?enrollment_id[]=${enrollmentId}&type[]=StudentEnrollment&state[]=active&state[]=inactive&state[]=completed`
    )
    diag("enrollment-lookup", `found ${enrollments.length} result(s) for enrollment ${enrollmentId} in course ${courseId}`)
    const enrollment = enrollments[0]
    if (enrollment && state.canvas) {
      state.canvas.studentId = String(enrollment.user_id)
      state.canvas.studentName = enrollment.user?.name ?? null
      state.loadingStudent = false
      state.notify()
      return
    }
    diag("enrollment-lookup", "enrollment found but empty — falling back")
  } catch (e) {
    diag("enrollment-lookup", `failed: ${e}`)
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
  try {
    const contact = await getRecord<Record<string, unknown>>("Contact", contactId)

    // SF Contact may have a Canvas User ID field directly
    const canvasUserId = pick(contact, "Canvas_User_ID__c", "CanvasUserId__c", "Canvas_ID__c")
    if (canvasUserId && state.canvas) {
      state.canvas.studentId = canvasUserId
      state.canvas.studentName = pick(contact, "Name") ?? null
      state.loadingStudent = false
      state.notify()
      return
    }

    // Fall back to global Canvas search by email
    const email = pick(contact, "Email") ?? fallbackEmail
    if (email) {
      await lookupCanvasStudentByEmail(email)
    } else {
      state.loadingStudent = false
      state.studentError = "No email on contact record"
      state.notify()
    }
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

/** Search Canvas globally by email — not course-scoped */
async function lookupCanvasStudentByEmail(email: string) {
  try {
    // Try global user search first (requires admin scope but worth trying)
    const users = await canvasFetch<Array<{ id: number; name: string }>>(
      `/api/v1/users?search_term=${encodeURIComponent(email)}&per_page=1`
    )
    if (users.length > 0 && state.canvas) {
      state.canvas.studentId = String(users[0].id)
      state.canvas.studentName = users[0].name
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
    // Global search may not be permitted — fall through to course-scoped
  }

  // Fall back to course-scoped search
  const courseId = state.canvas?.courseId
  if (courseId) {
    try {
      const users = await canvasFetch<Array<{ id: number; name: string }>>(
        `/api/v1/courses/${courseId}/search_users?search_term=${encodeURIComponent(email)}&per_page=1`
      )
      if (users.length > 0 && state.canvas) {
        state.canvas.studentId = String(users[0].id)
        state.canvas.studentName = users[0].name
      } else {
        state.studentError = "Student not found in Canvas"
      }
    } catch (e) {
      state.studentError = isAuthError(e) ? "canvas-session-required" : "Could not look up student in Canvas"
    }
  }

  state.loadingStudent = false
  state.notify()
}

/**
 * Resolve Canvas course from a CO, then resolve the student.
 * Centralises the identical dishonesty / grade-appeal sequence.
 */
async function resolveCanvasAndStudent(opts: {
  coId: string
  preferredName: string | null
  unityId: string | null
  accountId: string | null
  email: string | null
  onName: (name: string) => void
  token: number
}) {
  const canvasId = await resolveCanvasFromCo(opts.coId, opts.onName)
  if (canvasId && !stale(opts.token)) {
    await resolveStudent({
      preferredName: opts.preferredName,
      unityId: opts.unityId,
      accountId: opts.accountId,
      email: opts.email,
    })
  }
}

/** Fetch Course Offering and set Canvas course state. Returns canvasId if resolved, null otherwise. */
async function resolveCanvasFromCo(coId: string, onName: (name: string) => void): Promise<string | null> {
  state.loadingCourseOffering = true
  state.courseOfferingError = null
  state.notify()

  try {
    const co = await getRecord<Record<string, unknown>>("CourseOffering", coId)
    const name = pick(co, "Name")
    if (name) onName(name)

    const canvasId = pick(co, "Canvas_Course_ID__c", "CanvasCourseId__c", "Canvas_Course__c")
    state.loadingCourseOffering = false

    if (!canvasId) {
      diag("canvas-id-missing", `CourseOffering ${coId} has no Canvas Course ID`)
      state.courseOfferingError = "No Canvas Course ID on this Course Offering"
      state.notify()
      return null
    }

    diag("canvas-id-resolved", canvasId)
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

/** Resolve student — prefers COP data (name + unityId) over Canvas API lookups */
async function resolveStudent(opts: {
  preferredName?: string | null
  unityId?: string | null
  accountId?: string | null
  enrollmentId?: string | null
  email?: string | null
}) {
  state.loadingStudent = true
  state.studentError = null
  state.notify()

  // Set name from COP directly — no Canvas API needed
  if (opts.preferredName && state.canvas) {
    state.canvas.studentName = opts.preferredName
    diag("student-lookup-path", `cop-name:${opts.preferredName}`)
  }

  // Fetch Canvas user ID and gender identity from Person Account in background
  if (opts.accountId) {
    resolveFromAccount(opts.accountId)
  }

  // Get Canvas user ID via sis_user_id (Unity ID) for grade/profile/masquerade links
  if (opts.unityId) {
    diag("student-lookup-path", `sis_user_id:${opts.unityId}`)
    try {
      const user = await canvasFetch<{ id: number; name: string }>(
        `/api/v1/users/sis_user_id:${opts.unityId}`
      )
      if (user?.id && state.canvas) {
        state.canvas.studentId = String(user.id)
        if (!opts.preferredName) state.canvas.studentName = user.name
        diag("student-lookup-path", `sis_user_id resolved: ${user.id}`)
      }
    } catch (e) {
      diag("sis-lookup", `failed: ${e}`)
      if (isAuthError(e)) {
        state.studentError = "canvas-session-required"
        state.loadingStudent = false
        state.notify()
        return
      }
    }
  } else if (opts.email) {
    diag("student-lookup-path", `email:${opts.email}`)
    await lookupCanvasStudentByEmail(opts.email)
    return
  } else if (!opts.preferredName) {
    state.studentError = "No student identifier available"
    diag("student-lookup-path", "no identifier available")
  }

  state.loadingStudent = false
  state.notify()
}

async function loadCase(recordId: string, token: number) {
  state.loading = true
  state.loadingCourseOffering = false
  state.loadingStudent = false
  state.error = null
  state.courseOfferingError = null
  state.studentError = null
  state.caseData = null
  state.dishonesty = null
  state.gradeAppeal = null
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

    if (fieldMap) diag("describe", `Case: ${fieldMap.size} fields`)
    const f = makeFieldAccessor(rec, fieldMap)

    // Basic case info
    state.caseData = {
      caseNumber: f("Case Number", "CaseNumber") ?? "",
      status: f("Status", "Status") ?? "unknown",
      contactName: f("Contact Name", "Contact_Name__c", "ContactId") ?? "",
      contactEmail: f("Contact Email", "Contact_Email__c", "ContactEmail", "SuppliedEmail") ?? "",
      accountName: f("Account Name", "Account_Name__c", "AccountId") ?? "",
      type: f("Type", "Type") ?? "",
      subType: f("Sub Type", "SubType__c", "Sub_Type__c") ?? "",
      subject: f("Subject", "Subject") ?? "",
    }

    // COP is the clearinghouse record — fetch it first if present.
    // It gives us coId, enrollmentId, and contactId in one shot, for any case type.
    const copId = f("Course Offering Participant", "Course_Offering_Participant__c", "CourseOfferingParticipant__c")
    let copCoId: string | null = null
    let copAccountId: string | null = null
    let copPreferredName: string | null = null
    let copUnityId: string | null = null

    if (copId) {
      const cop = await resolveCopToCoId(copId)
      if (stale(token)) return
      copCoId = cop.coId
      copAccountId = cop.accountId
      copPreferredName = cop.preferredName
      copUnityId = cop.unityId
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
          unityId: copUnityId,
          accountId: copAccountId,
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
          unityId: copUnityId,
          accountId: copAccountId,
          email: state.caseData?.contactEmail ?? null,
          onName: (name) => { if (!stale(token) && state.gradeAppeal) state.gradeAppeal.courseOfferingName = name },
          token,
        })
      }
    }

    if (stale(token)) return
    state.loading = false
    state.notify()
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
  state.notify()

  try {
    const co = await getRecord<Record<string, unknown>>("CourseOffering", recordId)
    if (stale(token)) return
    const canvasId = pick(co, "Canvas_Course_ID__c", "CanvasCourseId__c", "Canvas_Course__c")
    if (canvasId) {
      state.canvas = {
        courseId: canvasId,
        url: `https://unity.instructure.com/courses/${canvasId}`,
        enrollmentUrl: null,
        studentId: null,
        studentName: null,
      }
    }
    state.loading = false
    state.notify()
  } catch (e) {
    if (stale(token)) return
    state.loading = false
    state.error = e instanceof Error ? e.message : String(e)
    state.notify()
    console.error("[UEU] Failed to load course offering:", e)
  }
}

let navigateTimer: ReturnType<typeof setTimeout> | null = null

/** Handle a URL change — debounced to let SF's SPA routing settle */
function onNavigate() {
  if (navigateTimer) clearTimeout(navigateTimer)
  navigateTimer = setTimeout(doNavigate, 80)
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
      state.canvas = null
      state.loading = false
      state.error = null
      state.notify()
    }
    return
  }

  // Skip if we're already on this record
  if (state.page?.recordId === parsed.recordId) return

  state.page = parsed
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
