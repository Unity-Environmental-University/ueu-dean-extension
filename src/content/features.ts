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

  /** Canvas course info (resolved from Course Offering record) */
  canvas: null as {
    courseId: string
    url: string
    studentId: string | null
    studentName: string | null
  } | null,

  /** Loading / error state */
  loading: false,
  error: null as string | null,

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

/** Try multiple field name variants — SF custom fields are unpredictable */
function pick(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = record[k]
    if (v != null && v !== "") return String(v)
  }
  return null
}

async function loadCase(recordId: string) {
  state.loading = true
  state.error = null
  state.caseData = null
  state.dishonesty = null
  state.canvas = null
  state.notify()

  try {
    const rec = await getRecord<Record<string, unknown>>("Case", recordId)

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

      // Follow the Course Offering lookup to get Canvas Course ID
      if (courseOfferingId) {
        try {
          const co = await getRecord<Record<string, unknown>>("CourseOffering", courseOfferingId)
          if (state.dishonesty) {
            state.dishonesty.courseOfferingName = pick(co, "Name") ?? null
          }
          const canvasId = pick(co, "Canvas_Course_ID__c", "CanvasCourseId__c", "Canvas_Course__c")
          if (canvasId) {
            const canvasUrl = `https://unity.instructure.com/courses/${canvasId}`
            state.canvas = {
              courseId: canvasId,
              url: canvasUrl,
              studentId: null,
              studentName: null,
            }
            state.notify()

            // Look up student in Canvas by email
            const email = state.caseData?.contactEmail
            if (email) {
              try {
                const users = await canvasFetch<Array<{ id: number; name: string }>>(
                  `/api/v1/courses/${canvasId}/search_users?search_term=${encodeURIComponent(email)}&per_page=1`
                )
                if (users.length > 0 && state.canvas) {
                  state.canvas.studentId = String(users[0].id)
                  state.canvas.studentName = users[0].name
                }
              } catch (e) {
                console.warn("[UEU] Failed to find student in Canvas:", e)
              }
            }
          }
        } catch (e) {
          console.warn("[UEU] Failed to fetch Course Offering:", e)
        }
      }
    }

    state.loading = false
    state.notify()
  } catch (e) {
    state.loading = false
    state.error = e instanceof Error ? e.message : String(e)
    state.notify()
    console.error("[UEU] Failed to load case:", e)
  }
}

async function loadCourseOffering(recordId: string) {
  state.loading = true
  state.error = null
  state.canvas = null
  state.notify()

  try {
    const co = await getRecord<Record<string, unknown>>("CourseOffering", recordId)
    const canvasId = pick(co, "Canvas_Course_ID__c", "CanvasCourseId__c", "Canvas_Course__c")
    if (canvasId) {
      state.canvas = {
        courseId: canvasId,
        url: `https://unity.instructure.com/courses/${canvasId}`,
      }
    }
    state.loading = false
    state.notify()
  } catch (e) {
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

  // Gate behind explicit user consent
  const perms = await getPermissions()
  if (!perms.sfApi) {
    state.loading = false
    state.error = null
    state.notify()
    return
  }

  if (parsed.objectType === "Case") {
    await loadCase(parsed.recordId)
  } else if (parsed.objectType === "CourseOffering") {
    await loadCourseOffering(parsed.recordId)
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
