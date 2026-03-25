// @vitest-environment node
import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { loadAccountCourses, type LoadAccountDeps } from "./load-account"
import type { CanvasCourse } from "./student-courses"
import { arbCanvasTerm, arbCanvasCourse, arbCanvasCourseSet } from "../test-utils"

// --- Helpers ---

function makeDeps(overrides: Partial<{
  account: Record<string, unknown>
  courses: CanvasCourse[]
  getRecordError: Error
  canvasFetchError: Error
  staleAfter: number  // go stale after N calls
}>): LoadAccountDeps {
  let callCount = 0
  const staleAfter = overrides.staleAfter ?? Infinity

  return {
    getRecord: async <T>(_type: string, _id: string): Promise<T> => {
      callCount++
      if (overrides.getRecordError) throw overrides.getRecordError
      return (overrides.account ?? { Name: "Test Student" }) as T
    },
    canvasFetch: async <T>(_path: string): Promise<T> => {
      callCount++
      if (overrides.canvasFetchError) throw overrides.canvasFetchError
      return (overrides.courses ?? []) as T
    },
    isStale: () => callCount > staleAfter,
  }
}

// --- Property: Account with Canvas ID resolves ---

describe("prop: account with canvas ID resolves", () => {
  it("returns termGroups when Account has Canvas_User_ID__pc and Canvas returns courses", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),  // canvasUserId
        arbCanvasCourseSet,
        async (canvasUserId, courses) => {
          const deps = makeDeps({
            account: { Canvas_User_ID__pc: canvasUserId, Name: "Student" },
            courses,
          })
          const result = await loadAccountCourses("001abc", deps)

          expect(result.error).toBeNull()
          expect(result.canvasUserId).toBe(canvasUserId)
          expect(result.accountName).toBe("Student")
          // All courses accounted for
          const totalCourses = result.termGroups.reduce((sum, g) => sum + g.courses.length, 0)
          expect(totalCourses).toBe(courses.length)
        },
      ),
      { numRuns: 50 },
    )
  })
})

// --- Property: Account without Canvas ID → graceful empty ---

describe("prop: account without canvas ID is graceful", () => {
  it("returns no-canvas-id error without throwing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),  // account name
        async (name) => {
          const deps = makeDeps({
            account: { Name: name },  // no Canvas_User_ID__pc
          })
          const result = await loadAccountCourses("001abc", deps)

          expect(result.error).toBe("no-canvas-id")
          expect(result.canvasUserId).toBeNull()
          expect(result.accountName).toBe(name)
          expect(result.termGroups).toEqual([])
        },
      ),
    )
  })
})

// --- Property: courses always grouped by term ---

describe("prop: courses always grouped by term", () => {
  it("every course appears in exactly one term group", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCanvasCourseSet,
        async (courses) => {
          const deps = makeDeps({
            account: { Canvas_User_ID__pc: "123", Name: "S" },
            courses,
          })
          const result = await loadAccountCourses("001abc", deps)

          // Collect all courseIds from groups
          const groupedIds = result.termGroups.flatMap(g => g.courses.map(c => c.courseId))
          const inputIds = courses.map(c => c.id)

          // Same count (no loss)
          expect(groupedIds.length).toBe(inputIds.length)
          // Every input course appears
          for (const id of inputIds) {
            expect(groupedIds).toContain(id)
          }
        },
      ),
      { numRuns: 50 },
    )
  })

  it("term groups are sorted most recent first", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbCanvasCourseSet,
        async (courses) => {
          const deps = makeDeps({
            account: { Canvas_User_ID__pc: "123", Name: "S" },
            courses,
          })
          const result = await loadAccountCourses("001abc", deps)

          for (let i = 1; i < result.termGroups.length; i++) {
            const prev = result.termGroups[i - 1].startAt
            const curr = result.termGroups[i].startAt
            if (prev && curr) {
              expect(prev >= curr).toBe(true)
            }
          }
        },
      ),
      { numRuns: 50 },
    )
  })
})

// --- Property: stale token cancels ---

describe("prop: stale token cancels", () => {
  it("returns empty result when stale before Canvas fetch", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (canvasId) => {
          const deps = makeDeps({
            account: { Canvas_User_ID__pc: canvasId, Name: "S" },
            courses: [{ id: 1, name: "C", course_code: "C", enrollment_term_id: 1 }],
            staleAfter: 1,  // stale after getRecord (before canvasFetch)
          })
          const result = await loadAccountCourses("001abc", deps)

          // Should have bailed — no courses loaded
          expect(result.termGroups).toEqual([])
        },
      ),
    )
  })

  it("returns empty result when stale before Account fetch", async () => {
    const deps = makeDeps({
      staleAfter: 0,  // stale immediately
    })
    const result = await loadAccountCourses("001abc", deps)
    expect(result.termGroups).toEqual([])
  })
})

// --- Property: no mutation on stale ---

describe("prop: no mutation on stale", () => {
  it("result contains no course data when stale mid-flight", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 2 }),  // stale after 0, 1, or 2 async calls
        arbCanvasCourseSet,
        async (staleAfter, courses) => {
          const deps = makeDeps({
            account: { Canvas_User_ID__pc: "123", Name: "S" },
            courses,
            staleAfter,
          })
          const result = await loadAccountCourses("001abc", deps)

          // If stale kicked in before Canvas returned, no courses
          if (staleAfter < 2) {
            expect(result.termGroups).toEqual([])
          }
        },
      ),
    )
  })
})

// --- Property: Canvas auth error → session-required ---

describe("prop: canvas auth error yields session-required", () => {
  it("401 from Canvas produces canvas-session-required error", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("Canvas API 401: /api/v1/users/123/courses", "401: Unauthorized"),
        async (errorMsg) => {
          const deps = makeDeps({
            account: { Canvas_User_ID__pc: "123", Name: "S" },
            canvasFetchError: new Error(errorMsg),
          })
          const result = await loadAccountCourses("001abc", deps)

          expect(result.error).toBe("canvas-session-required")
          expect(result.canvasUserId).toBe("123")
          expect(result.termGroups).toEqual([])
        },
      ),
    )
  })

  it("non-401 errors surface as Canvas error", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter(s => !s.includes("401")),
        async (errorMsg) => {
          const deps = makeDeps({
            account: { Canvas_User_ID__pc: "123", Name: "S" },
            canvasFetchError: new Error(errorMsg),
          })
          const result = await loadAccountCourses("001abc", deps)

          expect(result.error).toContain("Canvas error")
          expect(result.error).not.toBe("canvas-session-required")
        },
      ),
    )
  })
})

// --- Property: SF Account fetch error ---

describe("prop: SF Account error is graceful", () => {
  it("never throws, returns error message", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        async (errorMsg) => {
          const deps = makeDeps({
            getRecordError: new Error(errorMsg),
          })
          const result = await loadAccountCourses("001abc", deps)

          expect(result.error).toContain("Could not load Account")
          expect(result.termGroups).toEqual([])
          expect(result.canvasUserId).toBeNull()
        },
      ),
    )
  })
})
