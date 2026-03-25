// @vitest-environment node
import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { loadCourseOffering, type LoadCourseOfferingDeps } from "./load-course-offering"

function makeDeps(overrides: Partial<{
  co: Record<string, unknown>
  sfStudents: unknown[]
  canvasEnrollments: unknown[]
  getRecordError: Error
  sfQueryError: Error
  canvasFetchError: Error
  staleAfter: number
}>): LoadCourseOfferingDeps {
  let callCount = 0
  const staleAfter = overrides.staleAfter ?? Infinity

  return {
    getRecord: async <T>(_type: string, _id: string): Promise<T> => {
      callCount++
      if (overrides.getRecordError) throw overrides.getRecordError
      return (overrides.co ?? { Name: "Test Course" }) as T
    },
    sfQuery: async <T>(_soql: string) => {
      callCount++
      if (overrides.sfQueryError) throw overrides.sfQueryError
      return { records: (overrides.sfStudents ?? []) as T[], totalSize: 0, done: true }
    },
    canvasFetch: async <T>(_path: string): Promise<T> => {
      callCount++
      if (overrides.canvasFetchError) throw overrides.canvasFetchError
      return (overrides.canvasEnrollments ?? []) as T
    },
    isStale: () => callCount > staleAfter,
  }
}

describe("loadCourseOffering", () => {
  it("happy path: CO with Canvas ID + SF students + Canvas roster", async () => {
    const deps = makeDeps({
      co: { Name: "BIO 101 Fall 2025", Canvas_Course_ID__c: "500", Academic_Term_Display_Name__c: "F25" },
      sfStudents: [
        { Id: "COP1", hed__Contact__c: "003A", hed__Contact__r: { Name: "Alice", Email: "alice@unity.edu", Canvas_User_ID__c: "42" } },
      ],
      canvasEnrollments: [
        { user_id: 42, user: { name: "Alice" }, grades: { current_score: 92.5, current_grade: "A" }, last_activity_at: "2025-11-01T00:00:00Z", enrollment_state: "active" },
      ],
    })

    const result = await loadCourseOffering("CO001", deps)

    expect(result.offeringName).toBe("BIO 101 Fall 2025")
    expect(result.canvasCourseId).toBe("500")
    expect(result.error).toBeNull()
    expect(result.students).toHaveLength(1)
    expect(result.students[0].name).toBe("Alice")
    expect(result.students[0].currentScore).toBe(92.5)
    expect(result.students[0].lastActivityAt).toBe("2025-11-01T00:00:00Z")
  })

  it("CO without Canvas ID → no Canvas roster, no error", async () => {
    const deps = makeDeps({
      co: { Name: "No Canvas Course" },
      sfStudents: [
        { Id: "COP1", hed__Contact__c: "003A", hed__Contact__r: { Name: "Bob" } },
      ],
    })

    const result = await loadCourseOffering("CO002", deps)

    expect(result.canvasCourseId).toBeNull()
    expect(result.students).toHaveLength(1)
    expect(result.students[0].currentScore).toBeNull()
  })

  it("SOQL error surfaces in diagnostics, Canvas roster still works", async () => {
    const deps = makeDeps({
      co: { Name: "Error Course", Canvas_Course_ID__c: "600" },
      sfQueryError: new Error("hed__Course_Enrollment__c not found"),
      canvasEnrollments: [
        { user_id: 55, user: { name: "Canvas Student" }, grades: { current_score: 88, current_grade: "B+" }, last_activity_at: null, enrollment_state: "active" },
      ],
    })

    const result = await loadCourseOffering("CO003", deps)

    // SOQL error should be in diagnostics
    const errorDiag = result.diagnostics.find(d => d.type === "co-enrollment-error")
    expect(errorDiag).toBeDefined()
    // Canvas students should still load
    expect(result.students).toHaveLength(1)
    expect(result.students[0].name).toBe("Canvas Student")
    expect(result.students[0].currentScore).toBe(88)
  })

  it("Canvas 401 → canvas-session-required error", async () => {
    const deps = makeDeps({
      co: { Name: "Auth Fail", Canvas_Course_ID__c: "700" },
      sfStudents: [],
      canvasFetchError: new Error("Canvas API 401: Unauthorized"),
    })

    const result = await loadCourseOffering("CO004", deps)

    expect(result.error).toBe("canvas-session-required")
  })

  it("CO fetch error → graceful error result", async () => {
    const deps = makeDeps({
      getRecordError: new Error("Not found"),
    })

    const result = await loadCourseOffering("CO_ERR", deps)

    expect(result.error).toContain("Could not load Course Offering")
    expect(result.students).toEqual([])
  })

  it("prop: stale before Canvas fetch → empty students", async () => {
    await fc.assert(fc.asyncProperty(
      fc.nat({ max: 1 }),
      async (staleAfter) => {
        const deps = makeDeps({
          co: { Name: "Stale", Canvas_Course_ID__c: "800" },
          sfStudents: [{ Id: "COP1", hed__Contact__r: { Name: "Stale Student" } }],
          canvasEnrollments: [{ user_id: 1, user: { name: "S" }, enrollment_state: "active" }],
          staleAfter,
        })

        const result = await loadCourseOffering("CO_STALE", deps)

        expect(result.students).toEqual([])
      }
    ), { numRuns: 5 })
  })

  it("prop: never throws", async () => {
    await fc.assert(fc.asyncProperty(
      fc.boolean(),
      fc.boolean(),
      async (getRecordFails, canvasFails) => {
        const deps = makeDeps({
          ...(getRecordFails ? { getRecordError: new Error("fail") } : { co: { Name: "X" } }),
          ...(canvasFails ? { canvasFetchError: new Error("fail") } : {}),
        })

        // Should not throw
        const result = await loadCourseOffering("CO_ANY", deps)
        expect(result).toBeDefined()
        expect(result.diagnostics).toBeDefined()
      }
    ), { numRuns: 10 })
  })
})
