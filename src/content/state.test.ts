import { describe, it, expect, beforeEach } from "vitest"
import fc from "fast-check"
import { state, clearCaseState, clearConversationState, applyPatch, stale, bumpNavToken, currentNavToken } from "./state"

beforeEach(() => {
  // Reset state to defaults before each test
  state.caseData = null
  state.dishonesty = null
  state.gradeAppeal = null
  state.instructor = null
  state.canvas = null
  state.copRaw = null
  state.caseRaw = null
  state.contactRaw = null
  state.priorCases = null
  state.loadingPriorCases = false
  state.loadingCourseOffering = false
  state.loadingStudent = false
  state.courseOfferingError = null
  state.studentError = null
  state.conversations = null
  state.loadingConversations = false
  state.conversationError = null
  state.loading = false
  state.error = null
  state.diagnostics = []
})

describe("clearCaseState", () => {
  it("prop: all case fields are null/false after clear regardless of prior state", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.boolean(),
        (str, bool) => {
          // Set arbitrary state
          state.caseData = { caseNumber: str, status: str, contactName: str, contactEmail: str, accountName: str, accountId: str, contactId: str, type: str, subType: str, subject: str }
          state.dishonesty = { courseOfferingId: str, courseOfferingName: str, incidentType: str, assignmentName: str, severity: str, instructor: str, instructorEmail: str }
          state.canvas = { courseId: str, url: str, enrollmentUrl: str, studentId: str, studentName: str, studentPronouns: str }
          state.loadingPriorCases = bool
          state.loadingCourseOffering = bool
          state.loadingStudent = bool
          state.courseOfferingError = str
          state.studentError = str

          clearCaseState()

          expect(state.caseData).toBeNull()
          expect(state.dishonesty).toBeNull()
          expect(state.gradeAppeal).toBeNull()
          expect(state.instructor).toBeNull()
          expect(state.canvas).toBeNull()
          expect(state.copRaw).toBeNull()
          expect(state.contactRaw).toBeNull()
          expect(state.priorCases).toBeNull()
          expect(state.loadingPriorCases).toBe(false)
          expect(state.loadingCourseOffering).toBe(false)
          expect(state.loadingStudent).toBe(false)
          expect(state.courseOfferingError).toBeNull()
          expect(state.studentError).toBeNull()
        },
      ),
      { numRuns: 20 },
    )
  })

  it("does not touch non-case fields", () => {
    state.loading = true
    state.error = "some error"
    state.accountData = { canvasUserId: "123", accountName: "Test", termGroups: [], lastActivityAt: null, error: null }

    clearCaseState()

    expect(state.loading).toBe(true)
    expect(state.error).toBe("some error")
    expect(state.accountData).not.toBeNull()
  })
})

describe("clearConversationState", () => {
  it("prop: all conversation fields are null/false after clear", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.string(), (_bool, str) => {
        state.loadingConversations = true
        state.conversationError = str

        clearConversationState()

        expect(state.conversations).toBeNull()
        expect(state.loadingConversations).toBe(false)
        expect(state.conversationError).toBeNull()
      }),
      { numRuns: 20 },
    )
  })
})

describe("applyPatch", () => {
  it("prop: diagnostics are appended, not replaced", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ type: fc.string(), detail: fc.string() }), { minLength: 1, maxLength: 5 }),
        fc.array(fc.record({ type: fc.string(), detail: fc.string() }), { minLength: 1, maxLength: 5 }),
        (initial, patch) => {
          state.diagnostics = [...initial]
          applyPatch({ diagnostics: patch })
          expect(state.diagnostics.length).toBe(initial.length + patch.length)
          expect(state.diagnostics.slice(0, initial.length)).toEqual(initial)
          expect(state.diagnostics.slice(initial.length)).toEqual(patch)
        },
      ),
      { numRuns: 30 },
    )
  })

  it("prop: loading field is set when present in patch", () => {
    fc.assert(
      fc.property(fc.boolean(), (loading) => {
        applyPatch({ loading })
        expect(state.loading).toBe(loading)
      }),
    )
  })

  it("prop: error field is set when present in patch", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.constant(null)),
        (error) => {
          applyPatch({ error })
          expect(state.error).toBe(error)
        },
      ),
      { numRuns: 20 },
    )
  })

  it("calls notify on every patch", () => {
    let notified = false
    const listener = () => { notified = true }
    state.listeners.add(listener)
    try {
      applyPatch({ loading: true })
      expect(notified).toBe(true)
    } finally {
      state.listeners.delete(listener)
    }
  })
})

describe("navToken / stale", () => {
  it("prop: stale returns false for current token", () => {
    const token = bumpNavToken()
    expect(stale(token)).toBe(false)
  })

  it("prop: stale returns true for old token after bump", () => {
    const old = bumpNavToken()
    bumpNavToken()
    expect(stale(old)).toBe(true)
  })

  it("prop: bumpNavToken always increases", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const a = bumpNavToken()
        const b = bumpNavToken()
        expect(b).toBeGreaterThan(a)
      }),
      { numRuns: 10 },
    )
  })

  it("currentNavToken reads without bumping", () => {
    const before = currentNavToken()
    const read = currentNavToken()
    expect(read).toBe(before)
  })
})
