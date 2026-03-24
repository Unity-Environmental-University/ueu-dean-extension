/**
 * state.ts — shared reactive state for the dean's tool.
 *
 * Plain object with a listeners Set. Components subscribe via a version signal
 * bumped on state.notify(). No framework store — intentionally simple.
 */

import type { DiagEntry } from "./resolve"
import type { CourseOfferingResult } from "./load-course-offering"
import type { AccountCasesResult } from "./load-account-cases"
import type { CanvasConversation } from "./load-canvas-messages"
import type { TermGroup } from "./student-courses"
import type {
  CasePatch, CaseData, CanvasState, DishonestyState,
  GradeAppealState, InstructorState, PriorCase,
} from "./case-types"

/** Shared reactive state that the overlay UI reads from */
export const state = {
  /** Fires whenever any feature updates */
  listeners: new Set<() => void>(),

  /** Current SF page context */
  page: null as { objectType: string; recordId: string } | null,

  /** Case record data (when on a Case page) */
  caseData: null as CaseData | null,

  /** Prior cases for this student — loaded via SOQL after caseData is set */
  priorCases: null as PriorCase[] | null,
  loadingPriorCases: false,

  /** Academic dishonesty fields from the case */
  dishonesty: null as DishonestyState | null,

  /** Grade appeal fields from the case */
  gradeAppeal: null as GradeAppealState | null,

  /** Canvas course info (resolved from Course Offering record) */
  canvas: null as CanvasState | null,

  /** Instructor info (resolved from case, looked up in Canvas) */
  instructor: null as InstructorState | null,

  /** Account page data — courses grouped by term */
  accountData: null as {
    canvasUserId: string | null
    accountName: string | null
    termGroups: TermGroup[]
    lastActivityAt: string | null
    error: string | null
  } | null,

  /** Account page case awareness — open/recent cases for this student */
  accountCases: null as AccountCasesResult | null,

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

// ── State helpers ────────────────────────────────────────────────────────────

/** Reset all case-specific state fields. Called on new case load and on page exit. */
export function clearCaseState() {
  state.caseData = null
  state.dishonesty = null
  state.gradeAppeal = null
  state.instructor = null
  state.canvas = null
  state.copRaw = null
  state.contactRaw = null
  state.priorCases = null
  state.loadingPriorCases = false
  state.loadingCourseOffering = false
  state.loadingStudent = false
  state.courseOfferingError = null
  state.studentError = null
}

/** Reset all conversation/Canvas permission state. Called on new load and page exit. */
export function clearConversationState() {
  state.canMasquerade = null
  state.conversations = null
  state.loadingConversations = false
  state.conversationError = null
}

/**
 * Navigation token — incremented on every navigation event.
 * Async operations capture the token at start and bail if it changes,
 * preventing stale results from a superseded navigation from writing to state.
 */
export let navToken = 0
export function bumpNavToken(): number { return ++navToken }
export function currentNavToken(): number { return navToken }
export function stale(token: number): boolean { return token !== navToken }

/** Apply a CasePatch to state. Diagnostics are appended, everything else overwrites. */
export function applyPatch(patch: CasePatch): void {
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
