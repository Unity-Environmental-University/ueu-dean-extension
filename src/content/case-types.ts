/**
 * case-types.ts — shared type definitions for the case loading pipeline.
 *
 * Pure data shapes. No runtime code, no dependencies.
 */

import type { DiagEntry } from "./resolve"
import type { SoqlResult } from "./sfapi"

// ── Dep injection interface ───────────────────────────────────────────────────

export interface LoadCaseDeps {
  getRecord: <T>(objectType: string, id: string) => Promise<T>
  sfQuery: <T>(soql: string) => Promise<SoqlResult<T>>
  describeObject: (objectType: string) => Promise<Map<string, { name: string; label: string; type: string }>>
  canvasFetch: <T>(path: string) => Promise<T>
  checkSession: () => Promise<boolean>
  isStale: () => boolean
  onUpdate: (patch: CasePatch) => void
  observeFields: (objectType: string, log: DiagEntry[]) => void
  observeCaseComplete: (opts: { caseType: string; caseSubType: string | null; diagnostics: DiagEntry[] }) => void
}

/** Partial state patch — only the fields the case loader ever touches */
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
  caseRaw?: Record<string, unknown> | null
  contactRaw?: Record<string, unknown> | null
  canMasquerade?: boolean | null
  diagnostics?: DiagEntry[]
}

// ── Domain types ─────────────────────────────────────────────────────────────

export interface CaseData {
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

export interface CanvasState {
  courseId: string
  url: string
  enrollmentUrl: string | null
  studentId: string | null
  studentName: string | null
  studentPronouns?: string | null
  lastActivityAt?: string | null
}

export interface DishonestyState {
  courseOfferingId: string | null
  courseOfferingName: string | null
  incidentType: string
  assignmentName: string | null
  severity: string | null
  instructor: string | null
  instructorEmail: string | null
}

export interface GradeAppealState {
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

export interface InstructorState {
  name: string | null
  email: string | null
  canvasId: string | null
}

export interface PriorCase {
  id: string
  caseNumber: string
  subject: string | null
  type: string
  subType: string | null
  status: string
  createdDate: string
  courseName: string | null
  courseCode: string | null
  courseOfferingId: string | null
  termName: string | null
}
