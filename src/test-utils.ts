/**
 * test-utils.ts — shared test infrastructure for the dean extension.
 *
 * Provides:
 * - makeTestCaseDeps(): factory for LoadCaseDeps with sensible defaults
 * - makeTestAccountCasesDeps(): factory for LoadAccountCasesDeps
 * - Common fast-check arbitraries for case records
 */

import { vi } from "vitest"
import type { LoadCaseDeps, CasePatch } from "./content/case-types"
import type { LoadAccountCasesDeps } from "./content/load-account-cases"
import type { CaseListRecord } from "./content/case-helpers"
import type { DiagEntry } from "./content/resolve"
import fc from "fast-check"

// ── Polyfill mock setup ──────────────────────────────────────────────────────

/**
 * Call this at the top of any test file that imports components or modules
 * that transitively import webextension-polyfill. Must be called before
 * vi.mock() hoisting — use as:
 *
 *   vi.mock("webextension-polyfill", () => mockWebExtPolyfill())
 */
export function mockWebExtPolyfill() {
  return {
    default: {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ hasSession: true }),
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    },
  }
}

// ── LoadCaseDeps factory ─────────────────────────────────────────────────────

export interface TestCaseDepsOptions {
  /** Return value for getRecord calls, keyed by object type */
  records?: Record<string, Record<string, unknown>>
  /** Return value for sfQuery calls */
  queryResults?: Array<{ records: unknown[] }>
  /** Return value for canvasFetch calls */
  canvasResults?: unknown[]
  /** Whether Canvas session check returns true */
  hasSession?: boolean
  /** Go stale after N async calls (default: never) */
  staleAfter?: number
}

export function makeTestCaseDeps(opts: TestCaseDepsOptions = {}): {
  deps: LoadCaseDeps
  patches: CasePatch[]
  diagnostics: DiagEntry[]
} {
  let callCount = 0
  const staleAfter = opts.staleAfter ?? Infinity
  const queryQueue = [...(opts.queryResults ?? [{ records: [] }])]
  const canvasQueue = [...(opts.canvasResults ?? [])]
  const patches: CasePatch[] = []
  const diagnostics: DiagEntry[] = []

  const deps: LoadCaseDeps = {
    getRecord: async <T>(objectType: string, _id: string): Promise<T> => {
      callCount++
      return (opts.records?.[objectType] ?? {}) as T
    },
    sfQuery: async <T>(_soql: string) => {
      callCount++
      const result = queryQueue.shift() ?? { records: [] }
      return result as { records: T[]; totalSize: number; done: boolean }
    },
    describeObject: async () => new Map(),
    canvasFetch: async <T>(_path: string): Promise<T> => {
      callCount++
      const result = canvasQueue.shift()
      if (result instanceof Error) throw result
      return (result ?? []) as T
    },
    checkSession: async () => opts.hasSession ?? true,
    isStale: () => callCount > staleAfter,
    onUpdate: (patch: CasePatch) => {
      patches.push(patch)
      if (patch.diagnostics) diagnostics.push(...patch.diagnostics)
    },
    observeFields: () => {},
    observeCaseComplete: () => {},
  }

  return { deps, patches, diagnostics }
}

// ── LoadAccountCasesDeps factory ─────────────────────────────────────────────

export function makeTestAccountCasesDeps(opts: {
  queryResults?: Array<{ records: unknown[] }>
  staleAfter?: number
} = {}): LoadAccountCasesDeps {
  let callCount = 0
  const staleAfter = opts.staleAfter ?? Infinity
  const queryQueue = [...(opts.queryResults ?? [{ records: [] }])]

  return {
    sfQuery: async <T>(_soql: string) => {
      callCount++
      const result = queryQueue.shift() ?? { records: [] }
      return result as { records: T[] }
    },
    isStale: () => callCount > staleAfter,
  }
}

// ── Fast-check arbitraries ───────────────────────────────────────────────────

export const CASE_STATUSES = ["Open", "In Progress", "Closed", "Resolved"] as const
export const CASE_TYPES = ["Academic Dishonesty", "Grade Appeal", "General Inquiry", "Withdrawal"] as const

/** Arbitrary for a raw SF case record (CaseListRecord shape) */
// ── Canvas course arbitraries ────────────────────────────────────────────────

import type { CanvasTerm, CanvasEnrollment, CanvasCourse } from "./content/student-courses"

export const arbCanvasTerm: fc.Arbitrary<CanvasTerm> = fc.record({
  id: fc.nat(),
  name: fc.string({ minLength: 1 }),
  start_at: fc.oneof(
    fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01"), noInvalidDate: true }).map(d => d.toISOString()),
    fc.constant(null),
  ),
  end_at: fc.oneof(
    fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01"), noInvalidDate: true }).map(d => d.toISOString()),
    fc.constant(null),
  ),
})

export const arbCanvasEnrollment: fc.Arbitrary<CanvasEnrollment> = fc.record({
  type: fc.constantFrom("StudentEnrollment", "TeacherEnrollment", "ObserverEnrollment"),
  enrollment_state: fc.constantFrom("active", "completed", "inactive"),
  computed_current_score: fc.oneof(fc.double({ min: 0, max: 100, noNaN: true }), fc.constant(null)),
  computed_final_score: fc.oneof(fc.double({ min: 0, max: 100, noNaN: true }), fc.constant(null)),
  computed_current_grade: fc.oneof(fc.constantFrom("A", "B", "C", "D", "F"), fc.constant(null)),
  computed_final_grade: fc.oneof(fc.constantFrom("A", "B", "C", "D", "F"), fc.constant(null)),
  last_activity_at: fc.oneof(
    fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01"), noInvalidDate: true }).map(d => d.toISOString()),
    fc.constant(null),
  ),
})

export const arbCanvasCourse = (term: CanvasTerm): fc.Arbitrary<CanvasCourse> =>
  fc.record({
    id: fc.nat(),
    name: fc.string({ minLength: 1 }),
    course_code: fc.string({ minLength: 1 }),
    enrollment_term_id: fc.constant(term.id),
    term: fc.constant(term),
    enrollments: fc.array(arbCanvasEnrollment, { minLength: 1, maxLength: 3 }),
  })

/** Generate a set of courses across 1-4 terms */
export const arbCanvasCourseSet: fc.Arbitrary<CanvasCourse[]> = fc
  .array(arbCanvasTerm, { minLength: 1, maxLength: 4 })
  .chain(terms =>
    fc.tuple(
      ...terms.map(t => fc.array(arbCanvasCourse(t), { minLength: 1, maxLength: 4 }))
    ).map(arrays => arrays.flat())
  )

// ── Case record arbitraries ─────────────────────────────────────────────────

export const arbCaseListRecord: fc.Arbitrary<CaseListRecord> = fc.record({
  Id: fc.string({ minLength: 15, maxLength: 18 }),
  CaseNumber: fc.stringMatching(/^[0-9]{5,8}$/),
  Type: fc.constantFrom(...CASE_TYPES),
  SubType__c: fc.option(fc.string({ minLength: 1 }), { nil: null }),
  Status: fc.constantFrom(...CASE_STATUSES),
  CreatedDate: fc.date({ min: new Date("2020-01-01T00:00:00Z"), max: new Date("2026-12-31T00:00:00Z"), noInvalidDate: true }).map(d => d.toISOString()),
  Course_Offering__c: fc.option(fc.string({ minLength: 15, maxLength: 18 }), { nil: null }),
  Course_Offering__r: fc.option(
    fc.record({
      Name: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
      Academic_Term_Display_Name__c: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
    }),
    { nil: undefined },
  ),
})
