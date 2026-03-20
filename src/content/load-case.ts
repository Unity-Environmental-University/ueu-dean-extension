/**
 * load-case.ts — case loading logic extracted from core.ts.
 *
 * Pure async functions with injected dependencies. No direct imports of state.
 * Communicates back to core via onUpdate() callback — same pattern as load-account.ts.
 */

import { pick, diag, makeFieldAccessor, type DiagLog, type DiagEntry } from "./resolve"
import type { SoqlResult } from "./sfapi"

// ── Dep injection interface ───────────────────────────────────────────────────

export interface LoadCaseDeps {
  getRecord: <T>(objectType: string, id: string) => Promise<T>
  sfQuery: <T>(soql: string) => Promise<SoqlResult<T>>
  describeObject: (objectType: string) => Promise<Map<string, { name: string; label: string; type: string }>>
  canvasFetch: <T>(path: string) => Promise<T>
  isStale: () => boolean
  onUpdate: (patch: CasePatch) => void
  observeFields: (objectType: string, log: DiagEntry[]) => void
  observeCaseComplete: (opts: { caseType: string; caseSubType: string | null; diagnostics: DiagEntry[] }) => void
}

/** Partial state patch — only the fields load-case.ts ever touches */
export interface CasePatch {
  loading?: boolean
  loadingCourseOffering?: boolean
  loadingStudent?: boolean
  loadingPriorCases?: boolean
  error?: string | null
  courseOfferingError?: string | null
  studentError?: string | null
  caseData?: CaseData | null
  canvas?: CanvasState | null
  dishonesty?: DishonestyState | null
  gradeAppeal?: GradeAppealState | null
  instructor?: InstructorState | null
  priorCases?: PriorCase[] | null
  copRaw?: Record<string, unknown> | null
  contactRaw?: Record<string, unknown> | null
  diagnostics?: DiagEntry[]
}

// ── Local state types (mirror core.ts state shape) ───────────────────────────

interface CaseData {
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
}

interface CanvasState {
  courseId: string
  url: string
  enrollmentUrl: string | null
  studentId: string | null
  studentName: string | null
  studentPronouns?: string | null
}

interface DishonestyState {
  courseOfferingId: string | null
  courseOfferingName: string | null
  incidentType: string
  assignmentName: string | null
  severity: string | null
  instructor: string | null
  instructorEmail: string | null
}

interface GradeAppealState {
  courseOfferingId: string | null
  courseOfferingName: string | null
  courseOfferingParticipantId: string | null
  currentGrade: string | null
  changedGrade: string | null
  appealReason: string | null
  decisionStatus: string | null
  instructor: string | null
  instructorEmail: string | null
}

interface InstructorState {
  name: string | null
  email: string | null
  canvasId: string | null
}

interface PriorCase {
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function classifyIncident(raw: string | null): string {
  if (!raw) return "other"
  const lower = raw.toLowerCase()
  if (lower.includes("plagiari")) return "plagiarism"
  if (lower.includes("cheat")) return "cheating"
  if (lower.includes("fabricat")) return "fabrication"
  return "other"
}

function isAuthError(e: unknown): boolean {
  return e instanceof Error && e.message.includes(" 401:")
}

function findExactEmailMatch(
  users: Array<{ id: number; name: string; email?: string; login_id?: string }>,
  email: string,
): { id: number; name: string } | null {
  const lower = email.toLowerCase()
  const exact = users.find(u =>
    u.email?.toLowerCase() === lower || u.login_id?.toLowerCase() === lower
  )
  if (exact) return exact
  if (users.length === 1) return users[0]
  return null
}

function cleanTermName(name: string | null): string | null {
  if (!name) return null
  return name.replace(/\s*-\s*[A-Za-z].*$/, "").trim()
}

function extractCourseCode(name: string | null): string | null {
  if (!name) return null
  const match = name.match(/([A-Z]{3,4}\d{3,4}).*\s-\s(\d+)/i)
  return match ? `${match[1]} - ${match[2]}` : null
}

// ── Resolution helpers ────────────────────────────────────────────────────────

async function resolveCopToCoId(copId: string, deps: LoadCaseDeps): Promise<{
  coId: string | null
  enrollmentId: string | null
  contactId: string | null
  accountId: string | null
  preferredName: string | null
}> {
  const log: DiagLog = []
  try {
    const cop = await deps.getRecord<Record<string, unknown>>("CourseOfferingParticipant", copId)
    deps.onUpdate({ copRaw: cop })
    const result = {
      coId: pick(log, cop, "CourseOfferingId", "Course_Offering__c", "CourseOfferingId__c", "hed__Course_Offering__c", "Course_Offering_ID__c", "CourseOffering__c"),
      enrollmentId: pick(log, cop, "Canvas_Enrollment_ID__c", "CanvasEnrollmentId__c"),
      contactId: pick(log, cop, "ParticipantContactId", "hed__Contact__c", "ContactId", "Contact__c"),
      accountId: pick(log, cop, "ParticipantAccountId", "AccountId"),
      preferredName: pick(log, cop, "Preferred_Student_Name__c", "PreferredName__c"),
    }
    diag(log, "cop-resolved", `coId=${result.coId ?? "null"} preferredName=${result.preferredName ?? "null"} accountId=${result.accountId ?? "null"}`)
    deps.onUpdate({ diagnostics: log })
    deps.observeFields("CourseOfferingParticipant", log)
    return result
  } catch (e) {
    const log2: DiagLog = []
    diag(log2, "cop-error", String(e))
    deps.onUpdate({ diagnostics: log2 })
    return { coId: null, enrollmentId: null, contactId: null, accountId: null, preferredName: null }
  }
}

async function resolveFromAccount(accountId: string, canvas: CanvasState | null, deps: LoadCaseDeps): Promise<CanvasState | null> {
  const log: DiagLog = []
  try {
    const account = await deps.getRecord<Record<string, unknown>>("Account", accountId)
    deps.onUpdate({ contactRaw: account })
    const canvasUserId = pick(log, account, "Canvas_User_ID__pc", "Canvas_User_ID__c", "CanvasUserId__c", "Canvas_ID__c", "Canvas_User__c")
    const genderIdentity = pick(log, account, "Gender_Identity__c", "GenderIdentity__c", "Gender__c", "Pronouns__c", "Preferred_Pronouns__c")
    diag(log, "account-resolved", `canvasUserId=${canvasUserId ?? "null"} genderIdentity=${genderIdentity ?? "null"}`)
    deps.onUpdate({ diagnostics: log })
    deps.observeFields("Account", log)
    if (canvas) {
      const updated = { ...canvas }
      if (canvasUserId && !updated.studentId) updated.studentId = canvasUserId
      if (genderIdentity) updated.studentPronouns = genderIdentity
      deps.onUpdate({ canvas: updated })
      return updated
    }
  } catch (e) {
    const log2: DiagLog = []
    diag(log2, "account-error", String(e))
    deps.onUpdate({ diagnostics: log2 })
  }
  return canvas
}

async function resolveStudentFromEnrollment(
  enrollmentId: string,
  fallbackEmail: string | null,
  canvas: CanvasState,
  deps: LoadCaseDeps,
): Promise<boolean> {
  const courseId = canvas.courseId
  try {
    const enrollmentUrl = `https://unity.instructure.com/courses/${courseId}/enrollments/${enrollmentId}`
    deps.onUpdate({ canvas: { ...canvas, enrollmentUrl }, diagnostics: [{ type: "enrollment-url", detail: enrollmentUrl }] })
    const enrollments = await deps.canvasFetch<Array<{ id: number; user_id: number; user: { name: string } }>>(
      `/api/v1/courses/${courseId}/enrollments?enrollment_id[]=${enrollmentId}&type[]=StudentEnrollment&state[]=active&state[]=inactive&state[]=completed`
    )
    deps.onUpdate({ diagnostics: [{ type: "enrollment-lookup", detail: `found ${enrollments.length} result(s) for enrollment ${enrollmentId} in course ${courseId}` }] })
    const enrollment = enrollments[0]
    if (enrollment) {
      deps.onUpdate({
        canvas: { ...canvas, studentId: String(enrollment.user_id), studentName: enrollment.user?.name ?? null },
        loadingStudent: false,
      })
      return true
    }
    deps.onUpdate({ diagnostics: [{ type: "enrollment-lookup", detail: "enrollment found but empty — falling back" }] })
  } catch (e) {
    deps.onUpdate({ diagnostics: [{ type: "enrollment-lookup", detail: `failed: ${e}` }] })
    if (isAuthError(e)) {
      deps.onUpdate({ loadingStudent: false, studentError: "canvas-session-required" })
      return true // handled
    }
    if (fallbackEmail) {
      return lookupCanvasStudentByEmail(fallbackEmail, canvas, deps)
    }
    deps.onUpdate({ loadingStudent: false, studentError: "Could not resolve student from Canvas enrollment" })
    return true
  }
  return false
}

async function resolveStudentFromContact(
  contactId: string,
  fallbackEmail: string | null,
  canvas: CanvasState,
  deps: LoadCaseDeps,
): Promise<boolean> {
  const log: DiagLog = []
  try {
    const contact = await deps.getRecord<Record<string, unknown>>("Contact", contactId)
    const canvasUserId = pick(log, contact, "Canvas_User_ID__c", "CanvasUserId__c", "Canvas_ID__c")
    if (canvasUserId) {
      deps.onUpdate({
        canvas: { ...canvas, studentId: canvasUserId, studentName: pick(log, contact, "Name") ?? null },
        diagnostics: log,
        loadingStudent: false,
      })
      deps.observeFields("Contact", log)
      return true
    }
    const email = pick(log, contact, "Email") ?? fallbackEmail
    deps.onUpdate({ diagnostics: log })
    deps.observeFields("Contact", log)
    if (email) return lookupCanvasStudentByEmail(email, canvas, deps)
    deps.onUpdate({ loadingStudent: false, studentError: "No email on contact record" })
    return true
  } catch (e) {
    if (fallbackEmail) return lookupCanvasStudentByEmail(fallbackEmail, canvas, deps)
    deps.onUpdate({ loadingStudent: false, studentError: "Could not look up student" })
    return true
  }
}

async function lookupCanvasStudentByEmail(email: string, canvas: CanvasState, deps: LoadCaseDeps): Promise<boolean> {
  const courseId = canvas.courseId
  if (courseId) {
    try {
      const users = await deps.canvasFetch<Array<{ id: number; name: string; email?: string; login_id?: string }>>(
        `/api/v1/courses/${courseId}/search_users?search_term=${encodeURIComponent(email)}&include[]=email&include[]=login_id&per_page=5`
      )
      const match = findExactEmailMatch(users, email)
      if (match) {
        deps.onUpdate({
          canvas: { ...canvas, studentId: String(match.id), studentName: match.name },
          loadingStudent: false,
          diagnostics: [{ type: "student-email-lookup", detail: `course-scoped: exact match ${match.id} (of ${users.length} results)` }],
        })
        return true
      }
      deps.onUpdate({ diagnostics: [{ type: "student-email-lookup", detail: `course-scoped: ${users.length} result(s), no exact match` }] })
    } catch (e) {
      if (isAuthError(e)) {
        deps.onUpdate({ loadingStudent: false, studentError: "canvas-session-required" })
        return true
      }
      deps.onUpdate({ diagnostics: [{ type: "student-email-lookup", detail: `course-scoped failed: ${e}` }] })
    }
  }

  try {
    const users = await deps.canvasFetch<Array<{ id: number; name: string; email?: string; login_id?: string }>>(
      `/api/v1/users?search_term=${encodeURIComponent(email)}&include[]=email&include[]=login_id&per_page=5`
    )
    const match = findExactEmailMatch(users, email)
    if (match) {
      deps.onUpdate({
        canvas: { ...canvas, studentId: String(match.id), studentName: match.name },
        loadingStudent: false,
        diagnostics: [{ type: "student-email-lookup", detail: `global: exact match ${match.id} (of ${users.length} results)` }],
      })
      return true
    }
  } catch (e) {
    if (isAuthError(e)) {
      deps.onUpdate({ loadingStudent: false, studentError: "canvas-session-required" })
      return true
    }
    deps.onUpdate({ diagnostics: [{ type: "student-email-lookup", detail: `global failed: ${e}` }] })
  }

  deps.onUpdate({ loadingStudent: false, studentError: "Student not found in Canvas" })
  return true
}

async function resolveStudent(opts: {
  preferredName?: string | null
  accountId?: string | null
  contactId?: string | null
  enrollmentId?: string | null
  email?: string | null
  canvas: CanvasState
}, deps: LoadCaseDeps): Promise<void> {
  let canvas = opts.canvas
  deps.onUpdate({ loadingStudent: true, studentError: null })

  if (opts.preferredName) {
    canvas = { ...canvas, studentName: opts.preferredName }
    deps.onUpdate({ canvas, diagnostics: [{ type: "student-lookup-path", detail: `cop-name:${opts.preferredName}` }] })
  }

  if (opts.accountId) {
    canvas = (await resolveFromAccount(opts.accountId, canvas, deps)) ?? canvas
    if (canvas.studentId) { deps.onUpdate({ loadingStudent: false }); return }
  }

  if (!canvas.studentId && opts.enrollmentId) {
    deps.onUpdate({ diagnostics: [{ type: "student-lookup-path", detail: `enrollment:${opts.enrollmentId}` }] })
    const done = await resolveStudentFromEnrollment(opts.enrollmentId, opts.email ?? null, canvas, deps)
    if (done) return
  }

  if (!canvas.studentId && opts.contactId) {
    deps.onUpdate({ diagnostics: [{ type: "student-lookup-path", detail: `contact:${opts.contactId}` }] })
    const done = await resolveStudentFromContact(opts.contactId, opts.email ?? null, canvas, deps)
    if (done) return
  }

  if (!canvas.studentId && opts.email) {
    deps.onUpdate({ diagnostics: [{ type: "student-lookup-path", detail: `email:${opts.email}` }] })
    await lookupCanvasStudentByEmail(opts.email, canvas, deps)
    return
  }

  if (!canvas.studentId && !opts.preferredName) {
    deps.onUpdate({ studentError: "No student identifier available", diagnostics: [{ type: "student-lookup-path", detail: "no identifier available" }] })
  }
  deps.onUpdate({ loadingStudent: false })
}

async function resolveCanvasFromCo(coId: string, onName: (name: string) => void, deps: LoadCaseDeps): Promise<string | null> {
  deps.onUpdate({ loadingCourseOffering: true, courseOfferingError: null })

  const log: DiagLog = []
  try {
    const co = await deps.getRecord<Record<string, unknown>>("CourseOffering", coId)
    const name = pick(log, co, "Name")
    if (name) onName(name)

    const canvasId = pick(log, co, "Canvas_Course_ID__c", "CanvasCourseId__c", "Canvas_Course__c")
    deps.onUpdate({ loadingCourseOffering: false })

    if (!canvasId) {
      diag(log, "canvas-id-missing", `CourseOffering ${coId} has no Canvas Course ID`)
      deps.onUpdate({ diagnostics: log, courseOfferingError: "No Canvas Course ID on this Course Offering" })
      return null
    }

    diag(log, "canvas-id-resolved", canvasId)
    deps.onUpdate({
      diagnostics: log,
      canvas: { courseId: canvasId, url: `https://unity.instructure.com/courses/${canvasId}`, enrollmentUrl: null, studentId: null, studentName: null },
    })
    deps.observeFields("CourseOffering", log)
    return canvasId
  } catch (e) {
    deps.onUpdate({ loadingCourseOffering: false, courseOfferingError: "Could not load Course Offering", diagnostics: log })
    console.warn("[UEU] Failed to fetch Course Offering:", e)
    return null
  }
}

async function resolveCanvasAndStudent(opts: {
  coId: string
  preferredName: string | null
  accountId: string | null
  contactId: string | null
  enrollmentId: string | null
  email: string | null
  onName: (name: string) => void
  canvas: CanvasState | null
}, deps: LoadCaseDeps): Promise<CanvasState | null> {
  const canvasId = await resolveCanvasFromCo(opts.coId, opts.onName, deps)
  if (!canvasId || deps.isStale()) return opts.canvas

  // canvas was set via onUpdate inside resolveCanvasFromCo — rebuild local ref
  const canvas: CanvasState = {
    courseId: canvasId,
    url: `https://unity.instructure.com/courses/${canvasId}`,
    enrollmentUrl: null,
    studentId: null,
    studentName: null,
  }

  await resolveStudent({
    preferredName: opts.preferredName,
    accountId: opts.accountId,
    contactId: opts.contactId,
    enrollmentId: opts.enrollmentId,
    email: opts.email,
    canvas,
  }, deps)

  return canvas
}

async function resolveInstructor(
  name: string | null,
  email: string | null,
  instructorFieldValue: string | null,
  courseId: string | null,
  deps: LoadCaseDeps,
): Promise<void> {
  const instructor: InstructorState = { name, email, canvasId: null }
  deps.onUpdate({ instructor })

  if (instructorFieldValue && /^[a-zA-Z0-9]{15,18}$/.test(instructorFieldValue)) {
    const log: DiagLog = []
    try {
      const account = await deps.getRecord<Record<string, unknown>>("Account", instructorFieldValue)
      const canvasUserId = pick(log, account, "Canvas_User_ID__pc", "Canvas_User_ID__c")
      const accountName = pick(log, account, "Name")
      deps.onUpdate({ diagnostics: log })
      if (canvasUserId) {
        instructor.canvasId = canvasUserId
        if (accountName) instructor.name = accountName
        diag(log, "instructor-lookup", `account Canvas_User_ID__pc=${canvasUserId} name=${accountName ?? "null"}`)
        deps.onUpdate({ instructor: { ...instructor } })
        return
      }
      if (accountName && !name) instructor.name = accountName
      diag(log, "instructor-lookup", `account found but no Canvas user ID`)
    } catch (e) {
      diag(log, "instructor-lookup", `account fetch failed: ${e}`)
      try {
        const contact = await deps.getRecord<Record<string, unknown>>("Contact", instructorFieldValue)
        const canvasUserId = pick(log, contact, "Canvas_User_ID__c")
        const contactName = pick(log, contact, "Name")
        deps.onUpdate({ diagnostics: log })
        if (canvasUserId) {
          instructor.canvasId = canvasUserId
          if (contactName) instructor.name = contactName
          diag(log, "instructor-lookup", `contact Canvas_User_ID__c=${canvasUserId}`)
          deps.onUpdate({ instructor: { ...instructor } })
          return
        }
        if (contactName && !name) instructor.name = contactName
      } catch {
        diag(log, "instructor-lookup", `contact fetch also failed`)
      }
    }
  }

  if (!email) { deps.onUpdate({ instructor: { ...instructor } }); return }

  if (courseId) {
    try {
      const users = await deps.canvasFetch<Array<{ id: number; name: string }>>(
        `/api/v1/courses/${courseId}/search_users?search_term=${encodeURIComponent(email)}&enrollment_type[]=teacher&enrollment_type[]=ta&per_page=5`
      )
      if (users.length > 0) {
        instructor.canvasId = String(users[0].id)
        if (!instructor.name || instructor.name === name) instructor.name = users[0].name
        deps.onUpdate({ instructor: { ...instructor }, diagnostics: [{ type: "instructor-lookup", detail: `course-scoped email=${email} canvasId=${instructor.canvasId}` }] })
        return
      }
      deps.onUpdate({ diagnostics: [{ type: "instructor-lookup", detail: `course-scoped: no match for ${email}` }] })
    } catch (e) {
      deps.onUpdate({ diagnostics: [{ type: "instructor-lookup", detail: `course-scoped failed: ${e}` }] })
    }
  }

  deps.onUpdate({ instructor: { ...instructor } })
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function loadPriorCases(
  contactId: string,
  _currentCaseId: string,
  deps: LoadCaseDeps,
): Promise<void> {
  deps.onUpdate({ loadingPriorCases: true })
  try {
    const soql = `SELECT Id, CaseNumber, Type, SubType__c, Status, CreatedDate, Course_Offering__c, Course_Offering__r.Name, Course_Offering__r.Academic_Term_Display_Name__c FROM Case WHERE ContactId = '${contactId}' ORDER BY CreatedDate DESC LIMIT 25`
    const result = await deps.sfQuery<{
      Id: string; CaseNumber: string; Type: string
      SubType__c: string | null; Status: string; CreatedDate: string
      Course_Offering__c: string | null
      Course_Offering__r?: { Name?: string; Academic_Term_Display_Name__c?: string }
    }>(soql)
    if (deps.isStale()) return
    deps.onUpdate({
      priorCases: result.records.map(r => ({
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
      })),
      diagnostics: [{ type: "prior-cases", detail: `found ${result.records.length} prior case(s)` }],
    })
  } catch (e) {
    if (deps.isStale()) return
    deps.onUpdate({ diagnostics: [{ type: "prior-cases-error", detail: String(e) }] })
  }
  deps.onUpdate({ loadingPriorCases: false })
}

export async function loadCase(recordId: string, deps: LoadCaseDeps): Promise<void> {
  try {
    const rec = await deps.getRecord<Record<string, unknown>>("Case", recordId)
    if (deps.isStale()) return

    const fieldMap = await deps.describeObject("Case").catch(() => null)
    if (deps.isStale()) return

    const diagnostics: DiagEntry[] = []
    if (fieldMap) diag(diagnostics, "describe", `Case: ${fieldMap.size} fields`)
    const f = makeFieldAccessor(diagnostics, rec, fieldMap)

    const rawContactId = pick(diagnostics, rec, "ContactId")
    const caseData: CaseData = {
      caseNumber: f("Case Number", "CaseNumber") ?? "",
      status: f("Status", "Status") ?? "unknown",
      contactName: f("Contact Name", "Contact_Name__c", "ContactId") ?? "",
      contactEmail: f("Contact Email", "Contact_Email__c", "ContactEmail", "SuppliedEmail") ?? "",
      accountName: f("Account Name", "Account_Name__c", "AccountId") ?? "",
      accountId: null,
      contactId: rawContactId,
      type: f("Type", "Type") ?? "",
      subType: f("Sub Type", "SubType__c", "Sub_Type__c") ?? "",
      subject: f("Subject", "Subject") ?? "",
    }
    deps.onUpdate({ caseData, diagnostics })

    const copId = f("Course Offering Participant", "Course_Offering_Participant__c", "CourseOfferingParticipant__c")
    let copCoId: string | null = null
    let copContactId: string | null = null
    let copAccountId: string | null = null
    let copEnrollmentId: string | null = null
    let copPreferredName: string | null = null

    if (copId) {
      const cop = await resolveCopToCoId(copId, deps)
      if (deps.isStale()) return
      copCoId = cop.coId
      copContactId = cop.contactId
      copAccountId = cop.accountId
      copEnrollmentId = cop.enrollmentId
      copPreferredName = cop.preferredName
    }

    const caseCoId = f("Course Offering", "Course_Offering__c", "CourseOffering__c")
    const resolvedCoId = copCoId ?? caseCoId
    const contactEmail = caseData.contactEmail

    const incidentRaw = f("Incident Type", "Incident_Type__c", "Type_of_Incident__c", "Category__c")
    const assignmentName = f("Assignment", "Assignment__c", "Assignment_Name__c")

    let canvas: CanvasState | null = null

    if (resolvedCoId || incidentRaw) {
      const dishonesty: DishonestyState = {
        courseOfferingId: resolvedCoId,
        courseOfferingName: null,
        incidentType: classifyIncident(incidentRaw),
        assignmentName,
        severity: f("Severity", "Severity__c"),
        instructor: f("Instructor", "Instructor_Name__c", "Instructor__c"),
        instructorEmail: f("Instructor Email", "Instructor_Email__c"),
      }
      deps.onUpdate({ dishonesty })

      if (resolvedCoId) {
        canvas = await resolveCanvasAndStudent({
          coId: resolvedCoId,
          preferredName: copPreferredName,
          accountId: copAccountId,
          contactId: copContactId,
          enrollmentId: copEnrollmentId,
          email: contactEmail,
          onName: (name) => { if (!deps.isStale()) deps.onUpdate({ dishonesty: { ...dishonesty, courseOfferingName: name } }) },
          canvas,
        }, deps)
      }
    }

    if (deps.isStale()) return

    const appealReason = f("Grade Appeal Reason", "Grade_Appeal_Reason__c", "GradeAppealReason__c")
    const currentGrade = f("Current Grade", "Current_Grade__c", "CurrentGrade__c")
    const changedGrade = f("Changed Grade", "Changed_Grade__c", "ChangedGrade__c")
    const decisionStatus = f("Decision Status", "Decision_Status__c", "DecisionStatus__c")

    if (appealReason || currentGrade || (copId && !canvas)) {
      const gradeAppeal: GradeAppealState = {
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
      deps.onUpdate({ gradeAppeal })

      if (resolvedCoId && !canvas) {
        canvas = await resolveCanvasAndStudent({
          coId: resolvedCoId,
          preferredName: copPreferredName,
          accountId: copAccountId,
          contactId: copContactId,
          enrollmentId: copEnrollmentId,
          email: contactEmail,
          onName: (name) => { if (!deps.isStale()) deps.onUpdate({ gradeAppeal: { ...gradeAppeal, courseOfferingName: name } }) },
          canvas,
        }, deps)
      }
    }

    if (deps.isStale()) return

    if (resolvedCoId && !canvas) {
      canvas = await resolveCanvasAndStudent({
        coId: resolvedCoId,
        preferredName: copPreferredName,
        accountId: copAccountId,
        contactId: copContactId,
        enrollmentId: copEnrollmentId,
        email: contactEmail,
        onName: () => {},
        canvas,
      }, deps)
    }

    if (deps.isStale()) return

    const instructorName = f("Instructor", "Instructor_Name__c", "Instructor__c")
    const instructorEmail = f("Instructor Email", "Instructor_Email__c")
    const instructorRaw = pick([], rec, "Instructor__c", "Instructor_Name__c")
    if (instructorName || instructorEmail || instructorRaw) {
      resolveInstructor(instructorName, instructorEmail, instructorRaw, canvas?.courseId ?? null, deps)
    }

    deps.onUpdate({ loading: false })

    const resolvedContactId = rawContactId ?? copContactId
    diag([], "prior-cases-contact", `rawContactId=${rawContactId ?? "null"} copContactId=${copContactId ?? "null"} resolved=${resolvedContactId ?? "null"}`)
    console.log("[UEU] prior-cases-contact", { rawContactId, copContactId, resolvedContactId })
    if (resolvedContactId) {
      loadPriorCases(resolvedContactId, recordId, deps)
    } else {
      deps.onUpdate({ diagnostics: [{ type: "prior-cases-skip", detail: "no contactId available — skipping SOQL query" }] })
    }

    deps.observeFields("Case", [])
    deps.observeCaseComplete({
      caseType: caseData.type,
      caseSubType: caseData.subType,
      diagnostics: [],
    })
  } catch (e) {
    if (deps.isStale()) return
    deps.onUpdate({ loading: false, error: e instanceof Error ? e.message : String(e) })
    console.error("[UEU] Failed to load case:", e)
  }
}
