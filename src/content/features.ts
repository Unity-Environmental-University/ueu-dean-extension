/**
 * Features — reactive state driven by the SF REST API.
 *
 * Watches the URL for record page navigation, fetches data via API,
 * and populates the shared state that the overlay UI reads.
 */

import browser from "webextension-polyfill"
import { getRecord, parseRecordUrl } from "./sfapi"
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
    studentId: string | null
    studentName: string | null
  } | null,

  /** Granular loading / error state */
  loading: false,
  loadingCourseOffering: false,
  loadingStudent: false,
  error: null as string | null,
  courseOfferingError: null as string | null,
  studentError: null as string | null,

  /** Diagnostic log — field misses and resolution path for this page load */
  diagnostics: [] as Array<{ type: string; detail: string }>,

  notify() {
    this.listeners.forEach(fn => fn())
  },
}

/** SF API field names — we'll discover the exact names from the API response */
// Case fields we care about
const CASE_FIELDS = {
  caseNumber: "CaseNumber",
  status: "Status",
  contactName: "Contact_Name__c",    // might be ContactId lookup
  accountName: "Account_Name__c",    // might be AccountId lookup
  type: "Type",
  subType: "SubType__c",
  subject: "Subject",
  // Dishonesty fields (on the Case record)
  courseOffering: "Course_Offering__c",       // lookup ID
  incidentType: "Incident_Type__c",
  assignmentName: "Assignment__c",
  severity: "Severity__c",
  instructor: "Instructor__c",
  instructorEmail: "Instructor_Email__c",
}

// Course Offering fields
const CO_FIELDS = {
  canvasCourseId: "Canvas_Course_ID__c",
  name: "Name",
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

/** Follow Course Offering Participant → return coId and student lookup hints (no side effects) */
async function resolveCopToCoId(copId: string): Promise<{ coId: string | null; enrollmentId: string | null; contactId: string | null }> {
  try {
    const cop = await getRecord<Record<string, unknown>>("CourseOfferingParticipant", copId)
    const result = {
      coId: pick(cop, "Course_Offering__c", "CourseOfferingId__c", "hed__Course_Offering__c"),
      enrollmentId: pick(cop, "Canvas_Enrollment_ID__c", "CanvasEnrollmentId__c"),
      contactId: pick(cop, "hed__Contact__c", "ContactId", "Contact__c"),
    }
    diag("cop-resolved", `coId=${result.coId ?? "null"} enrollmentId=${result.enrollmentId ?? "null"} contactId=${result.contactId ?? "null"}`)
    return result
  } catch (e) {
    diag("cop-error", String(e))
    return { coId: null, enrollmentId: null, contactId: null }
  }
}

/** Use Canvas Enrollment ID to get the Canvas user_id — courseId must already be set in state */
async function resolveStudentFromEnrollment(enrollmentId: string) {
  const courseId = state.canvas?.courseId
  if (!courseId) {
    state.loadingStudent = false
    state.studentError = "Canvas course not resolved — cannot look up enrollment"
    state.notify()
    return
  }

  try {
    const enrollment = await canvasFetch<{ id: number; user_id: number; user: { name: string } }>(
      `/api/v1/courses/${courseId}/enrollments/${enrollmentId}`
    )
    if (state.canvas) {
      state.canvas.studentId = String(enrollment.user_id)
      state.canvas.studentName = enrollment.user?.name ?? null
    }
    state.loadingStudent = false
    state.notify()
  } catch (e) {
    if (isAuthError(e)) {
      state.loadingStudent = false
      state.studentError = "canvas-session-required"
      state.notify()
      return
    }
    console.warn("[UEU] Canvas enrollment lookup failed, falling back to email search:", e)
    const email = state.caseData?.contactEmail
    if (email) {
      await lookupCanvasStudentByEmail(email)
    } else {
      state.loadingStudent = false
      state.studentError = "Could not resolve student from Canvas enrollment"
      state.notify()
    }
  }
}

/** Fetch the SF Contact record and use it to find the Canvas student */
async function resolveStudentFromContact(contactId: string) {
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
    const email = pick(contact, "Email") ?? state.caseData?.contactEmail
    if (email) {
      await lookupCanvasStudentByEmail(email)
    } else {
      state.loadingStudent = false
      state.studentError = "No email on contact record"
      state.notify()
    }
  } catch (e) {
    console.warn("[UEU] Failed to fetch Contact:", e)
    // Fall back to whatever email we have on the case
    const email = state.caseData?.contactEmail
    if (email) {
      await lookupCanvasStudentByEmail(email)
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
    state.canvas = { courseId: canvasId, url: `https://unity.instructure.com/courses/${canvasId}`, studentId: null, studentName: null }
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

/** Resolve student after canvas is set — tries enrollment → contact → email in order */
async function resolveStudent(opts: { enrollmentId?: string | null; contactId?: string | null; email?: string | null }) {
  state.loadingStudent = true
  state.studentError = null
  state.notify()

  if (opts.enrollmentId) {
    diag("student-lookup-path", `enrollment:${opts.enrollmentId}`)
    await resolveStudentFromEnrollment(opts.enrollmentId)
    return
  }
  if (opts.contactId) {
    diag("student-lookup-path", `contact:${opts.contactId}`)
    await resolveStudentFromContact(opts.contactId)
    return
  }
  if (opts.email) {
    diag("student-lookup-path", `email:${opts.email}`)
    await lookupCanvasStudentByEmail(opts.email)
    return
  }
  state.loadingStudent = false
  state.studentError = "No student identifier available"
  diag("student-lookup-path", "no identifier available")
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
  state.canvas = null
  state.diagnostics = []
  state.notify()

  try {
    const rec = await getRecord<Record<string, unknown>>("Case", recordId)
    if (stale(token)) return

    // Basic case info
    state.caseData = {
      caseNumber: pick(rec, "CaseNumber") ?? "",
      status: pick(rec, "Status") ?? "unknown",
      contactName: pick(rec, "Contact_Name__c", "ContactId") ?? "",
      contactEmail: pick(rec, "Contact_Email__c", "ContactEmail", "SuppliedEmail") ?? "",
      accountName: pick(rec, "Account_Name__c", "AccountId") ?? "",
      type: pick(rec, "Type") ?? "",
      subType: pick(rec, "SubType__c", "Sub_Type__c") ?? "",
      subject: pick(rec, "Subject") ?? "",
    }

    // Dishonesty fields (may or may not be on this case)
    const courseOfferingId = pick(rec, "Course_Offering__c", "CourseOffering__c")
    const incidentRaw = pick(rec, "Incident_Type__c", "Type_of_Incident__c", "Category__c")
    const assignmentName = pick(rec, "Assignment__c", "Assignment_Name__c")

    if (courseOfferingId || incidentRaw) {
      state.dishonesty = {
        courseOfferingId,
        courseOfferingName: null, // will fill from CO record
        incidentType: classifyIncident(incidentRaw),
        assignmentName,
        severity: pick(rec, "Severity__c"),
        instructor: pick(rec, "Instructor_Name__c", "Instructor__c"),
        instructorEmail: pick(rec, "Instructor_Email__c"),
      }

      if (courseOfferingId) {
        const canvasId = await resolveCanvasFromCo(courseOfferingId, (name) => {
          if (!stale(token) && state.dishonesty) state.dishonesty.courseOfferingName = name
        })
        if (canvasId && !stale(token)) {
          await resolveStudent({ email: state.caseData?.contactEmail })
        }
      }
    }

    if (stale(token)) return

    // Grade appeal fields
    const appealReason = pick(rec, "Grade_Appeal_Reason__c", "GradeAppealReason__c")
    const currentGrade = pick(rec, "Current_Grade__c", "CurrentGrade__c")
    const changedGrade = pick(rec, "Changed_Grade__c", "ChangedGrade__c")
    const decisionStatus = pick(rec, "Decision_Status__c", "DecisionStatus__c")
    const copId = pick(rec, "Course_Offering_Participant__c", "CourseOfferingParticipant__c")

    if (appealReason || currentGrade || copId) {
      let coId = pick(rec, "Course_Offering__c", "CourseOffering__c")
      let enrollmentId: string | null = null
      let contactId: string | null = null

      if (!coId && copId) {
        const cop = await resolveCopToCoId(copId)
        if (stale(token)) return
        coId = cop.coId
        enrollmentId = cop.enrollmentId
        contactId = cop.contactId
      }

      state.gradeAppeal = {
        courseOfferingId: coId,
        courseOfferingName: null,
        courseOfferingParticipantId: copId,
        currentGrade,
        changedGrade,
        appealReason,
        decisionStatus,
        instructor: pick(rec, "Instructor_Name__c", "Instructor__c"),
        instructorEmail: pick(rec, "Instructor_Email__c"),
      }

      if (coId) {
        const canvasId = await resolveCanvasFromCo(coId, (name) => {
          if (!stale(token) && state.gradeAppeal) state.gradeAppeal.courseOfferingName = name
        })
        if (canvasId && !stale(token)) {
          await resolveStudent({ enrollmentId, contactId, email: state.caseData?.contactEmail })
        }
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

/** Handle a URL change — detect record page and fetch data */
async function onNavigate() {
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
