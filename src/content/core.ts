/**
 * Core — the heart of the dean's tool.
 *
 * Watches the URL for record page navigation, fetches data via SF/Canvas APIs,
 * and populates the shared state that the overlay UI reads.
 */

import browser from "webextension-polyfill"
import { getRecord, parseRecordUrl, describeObject, sfQuery } from "./sfapi"
import { getPermissions, getCanvasCapabilities, saveCanvasCapabilities } from "./permissions"
import { pick, diag, makeFieldAccessor, type DiagLog, type DiagEntry } from "./resolve"
import { observeFields, observeCaseComplete } from "./observer"
import { loadAccountCourses, type AccountResult } from "./load-account"
import { loadCase as loadCaseImpl, type CasePatch } from "./load-case"
import { loadCourseOffering as loadCourseOfferingImpl, type CourseOfferingResult } from "./load-course-offering"
import { probeCanvasMasquerade, loadCanvasConversations, type CanvasConversation } from "./load-canvas-messages"
import type { TermGroup } from "./student-courses"

const CANVAS_HOST = "unity.instructure.com"

async function checkCanvasSession(): Promise<boolean> {
  const result = await browser.runtime.sendMessage({ type: "canvas-session-check" }) as { hasSession: boolean }
  return !!result?.hasSession
}

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
    lastActivityAt: string | null
    error: string | null
  } | null,

  /** CourseOffering page data — roster + grades */
  offeringData: null as CourseOfferingResult | null,

  /** Whether the logged-in Canvas user has "Become other users" permission */
  canMasquerade: null as boolean | null,

  /** Cached masquerade permission from last session — used to ghost features while re-verifying */
  canMasqueradeCache: null as boolean | null,

  /** Canvas conversations — loaded on demand via loadConversations() */
  conversations: null as CanvasConversation[] | null,
  loadingConversations: false,
  conversationError: null as string | null,

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


/**
 * Navigation token — incremented on every navigation event.
 * Async operations capture the token at start and bail if it changes,
 * preventing stale results from a superseded navigation from writing to state.
 */
let navToken = 0

function stale(token: number): boolean {
  return token !== navToken
}

/** Apply a CasePatch to state. Diagnostics are appended, everything else overwrites. */
function applyPatch(patch: CasePatch): void {
  if (patch.diagnostics) state.diagnostics.push(...patch.diagnostics)
  if ("loading" in patch) state.loading = patch.loading!
  if ("loadingCourseOffering" in patch) state.loadingCourseOffering = patch.loadingCourseOffering!
  if ("loadingStudent" in patch) state.loadingStudent = patch.loadingStudent!
  if ("loadingPriorCases" in patch) state.loadingPriorCases = patch.loadingPriorCases!
  if ("error" in patch) state.error = patch.error!
  if ("courseOfferingError" in patch) state.courseOfferingError = patch.courseOfferingError!
  if ("studentError" in patch) state.studentError = patch.studentError!
  if ("caseData" in patch) state.caseData = patch.caseData!
  if ("canvas" in patch) state.canvas = patch.canvas!
  if ("dishonesty" in patch) state.dishonesty = patch.dishonesty!
  if ("gradeAppeal" in patch) state.gradeAppeal = patch.gradeAppeal!
  if ("instructor" in patch) state.instructor = patch.instructor!
  if ("priorCases" in patch) state.priorCases = patch.priorCases!
  if ("copRaw" in patch) state.copRaw = patch.copRaw!
  if ("contactRaw" in patch) state.contactRaw = patch.contactRaw!
  if ("canMasquerade" in patch) state.canMasquerade = patch.canMasquerade!
  if ("canMasqueradeCache" in patch) state.canMasqueradeCache = patch.canMasqueradeCache!
  state.notify()
}


function makeCaseDeps(token: number) {
  return {
    getRecord,
    sfQuery,
    describeObject,
    canvasFetch,
    checkSession: checkCanvasSession,
    isStale: () => stale(token),
    onUpdate: applyPatch,
    observeFields,
    observeCaseComplete,
  }
}

async function loadCaseWrapper(recordId: string, token: number) {
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
  state.canvas = null
  state.copRaw = null
  state.contactRaw = null
  state.canMasquerade = null
  state.conversations = null
  state.loadingConversations = false
  state.conversationError = null
  state.diagnostics = []
  state.notify()

  await loadCaseImpl(recordId, makeCaseDeps(token))
}


async function loadCourseOffering(recordId: string, token: number) {
  state.loading = true
  state.error = null
  state.canvas = null
  state.offeringData = null
  state.diagnostics = []
  state.notify()

  const result = await loadCourseOfferingImpl(recordId, {
    getRecord,
    sfQuery,
    canvasFetch,
    isStale: () => stale(token),
  })

  if (stale(token)) return

  state.offeringData = result
  state.diagnostics.push(...result.diagnostics)

  if (result.canvasCourseId) {
    state.canvas = {
      courseId: result.canvasCourseId,
      url: result.canvasCourseUrl!,
      enrollmentUrl: null,
      studentId: null,
      studentName: null,
      studentPronouns: null,
    }
  }

  if (result.error && result.error !== "canvas-session-required") {
    state.error = result.error
  }

  state.loading = false
  state.notify()
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
  state.canMasquerade = null
  state.conversations = null
  state.loadingConversations = false
  state.conversationError = null
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
      // Probe masquerade with confirmed Canvas ID
      if (state.canMasquerade === null) {
        await setCanMasquerade(await probeCanvasMasquerade(retry.canvasUserId, { canvasFetch, checkSession: checkCanvasSession, isStale: () => stale(token) }))
        if (!stale(token)) state.notify()
      }
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

  // Probe masquerade permission if we have a Canvas ID and haven't probed yet
  if (result.canvasUserId && state.canMasquerade === null && !result.error) {
    await setCanMasquerade(await probeCanvasMasquerade(result.canvasUserId, { canvasFetch, checkSession: checkCanvasSession, isStale: () => stale(token) }))
    if (!stale(token)) state.notify()
  }
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
      state.conversations = null
      state.loadingConversations = false
      state.conversationError = null
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
    await loadCaseWrapper(parsed.recordId, token)
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
/** Set canMasquerade in state and persist to storage if it resolved to a definite value. */
async function setCanMasquerade(value: boolean | null): Promise<void> {
  state.canMasquerade = value
  if (value !== null) {
    await saveCanvasCapabilities({ canMasquerade: value })
  }
}

export function startWatching() {
  // Load cached masquerade capability so features can ghost while re-verifying
  getCanvasCapabilities().then(caps => {
    if (state.canMasqueradeCache !== caps.canMasquerade) {
      state.canMasqueradeCache = caps.canMasquerade
      state.notify()
    }
  })

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

/**
 * Load Canvas conversations on demand.
 * Called from UI components when the user clicks a "Messages" or "Inbox" button.
 * studentCanvasId: the student to masquerade as.
 * instructorCanvasId: if provided, filters to conversations with that instructor only.
 */
export async function loadConversations(
  studentCanvasId: string,
  instructorCanvasId: string | null,
): Promise<void> {
  const token = navToken
  state.loadingConversations = true
  state.conversations = null
  state.conversationError = null
  state.notify()

  const result = await loadCanvasConversations(studentCanvasId, instructorCanvasId, {
    canvasFetch,
    checkSession: checkCanvasSession,
    isStale: () => stale(token),
  })

  if (stale(token)) return

  state.conversations = result.conversations
  state.conversationError = result.error
  state.loadingConversations = false
  state.notify()
}
