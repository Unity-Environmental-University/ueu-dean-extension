// @vitest-environment node
import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { resolveCanvasFromCo, resolveInstructor } from "./case-course-and-instructor"
import { makeTestCaseDeps } from "../test-utils"

// ── resolveCanvasFromCo ──────────────────────────────────────────────────────

describe("resolveCanvasFromCo", () => {
  it("prop: CO with Canvas_Course_ID__c returns the ID", async () => {
    await fc.assert(fc.asyncProperty(
      fc.stringMatching(/^[0-9]{1,10}$/),
      async (canvasCourseId) => {
        const { deps } = makeTestCaseDeps({
          records: { CourseOffering: { Name: "BIO 101", Canvas_Course_ID__c: canvasCourseId } },
        })
        let calledName: string | null = null
        const onName = (n: string) => { calledName = n }

        const result = await resolveCanvasFromCo("CO001", onName, deps)

        expect(result).toBe(canvasCourseId)
        expect(calledName).toBe("BIO 101")
      }
    ), { numRuns: 20 })
  })

  it("CO without Canvas Course ID returns null and sets error", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: { CourseOffering: { Name: "No Canvas" } },
    })

    const result = await resolveCanvasFromCo("CO001", () => {}, deps)

    expect(result).toBeNull()
    const errorPatch = patches.find(p => p.courseOfferingError != null)
    expect(errorPatch?.courseOfferingError).toContain("No Canvas Course ID")
  })

  it("CO fetch error returns null gracefully", async () => {
    const { deps, patches } = makeTestCaseDeps()
    deps.getRecord = async () => { throw new Error("Not found") }

    const result = await resolveCanvasFromCo("CO001", () => {}, deps)

    expect(result).toBeNull()
    const errorPatch = patches.find(p => p.courseOfferingError != null)
    expect(errorPatch).toBeDefined()
  })

  it("prop: sets loadingCourseOffering true then false", async () => {
    await fc.assert(fc.asyncProperty(
      fc.boolean(),
      async (hasCanvasId) => {
        const records: Record<string, unknown> = { Name: "Test" }
        if (hasCanvasId) records.Canvas_Course_ID__c = "123"
        const { deps, patches } = makeTestCaseDeps({
          records: { CourseOffering: records },
        })

        await resolveCanvasFromCo("CO001", () => {}, deps)

        const loadingPatches = patches.filter(p => "loadingCourseOffering" in p)
        expect(loadingPatches[0]?.loadingCourseOffering).toBe(true)
        expect(loadingPatches[loadingPatches.length - 1]?.loadingCourseOffering).toBe(false)
      }
    ), { numRuns: 10 })
  })
})

// ── resolveInstructor ────────────────────────────────────────────────────────

describe("resolveInstructor", () => {
  it("SF ID resolves as Account with Canvas user ID", async () => {
    const sfId = "001ABCDEFGHIJKLM"  // 18 char alphanumeric
    const { deps, patches } = makeTestCaseDeps({
      records: { Account: { Canvas_User_ID__pc: "999", Name: "Prof Smith" } },
    })

    await resolveInstructor("Prof Smith", "smith@unity.edu", sfId, "100", deps)

    const instructorPatch = patches.find(p => "instructor" in p && p.instructor?.canvasId === "999")
    expect(instructorPatch).toBeDefined()
    expect(instructorPatch?.instructor?.name).toBe("Prof Smith")
  })

  it("SF ID fails as Account, succeeds as Contact", async () => {
    const sfId = "003ABCDEFGHIJKLM"
    let callCount = 0
    const { deps, patches } = makeTestCaseDeps()
    deps.getRecord = async <T>(_type: string, _id: string): Promise<T> => {
      callCount++
      if (callCount === 1) throw new Error("Not an Account")  // Account fails
      return { Canvas_User_ID__c: "888", Name: "Contact Prof" } as T  // Contact succeeds
    }

    await resolveInstructor(null, "prof@unity.edu", sfId, "100", deps)

    const instructorPatch = patches.find(p => "instructor" in p && p.instructor?.canvasId === "888")
    expect(instructorPatch).toBeDefined()
  })

  it("no SF ID, has email → course-scoped Canvas search", async () => {
    const { deps, patches } = makeTestCaseDeps({
      canvasResults: [
        [{ id: 777, name: "Canvas Prof" }],
      ],
    })

    await resolveInstructor("Prof", "prof@unity.edu", null, "100", deps)

    const instructorPatch = patches.find(p => "instructor" in p && p.instructor?.canvasId === "777")
    expect(instructorPatch).toBeDefined()
  })

  it("no email, no SF ID → emits instructor with name only", async () => {
    const { deps, patches } = makeTestCaseDeps()

    await resolveInstructor("Just A Name", null, null, "100", deps)

    const instructorPatch = patches.find(p => "instructor" in p && p.instructor?.name === "Just A Name")
    expect(instructorPatch).toBeDefined()
    expect(instructorPatch?.instructor?.canvasId).toBeNull()
  })

  it("prop: always emits at least one instructor patch", async () => {
    await fc.assert(fc.asyncProperty(
      fc.option(fc.string({ minLength: 1 }), { nil: null }),
      fc.option(fc.emailAddress(), { nil: null }),
      async (name, email) => {
        const { deps, patches } = makeTestCaseDeps()

        await resolveInstructor(name, email, null, null, deps)

        const instructorPatches = patches.filter(p => "instructor" in p)
        expect(instructorPatches.length).toBeGreaterThanOrEqual(1)
      }
    ), { numRuns: 15 })
  })
})
