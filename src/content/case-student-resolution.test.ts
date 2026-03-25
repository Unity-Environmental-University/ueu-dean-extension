// @vitest-environment node
import { describe, it, expect } from "vitest"
import fc from "fast-check"
import {
  resolveFromAccount,
  resolveStudentFromEnrollment,
  resolveStudentFromContact,
  lookupCanvasStudentByEmail,
  resolveStudent,
} from "./case-student-resolution"
import { makeTestCaseDeps } from "../test-utils"
import type { CanvasState } from "./case-types"

function baseCanvas(courseId = "100"): CanvasState {
  return {
    courseId,
    url: `https://unity.instructure.com/courses/${courseId}`,
    enrollmentUrl: null,
    studentId: null,
    studentName: null,
  }
}

// ── resolveFromAccount ───────────────────────────────────────────────────────

describe("resolveFromAccount", () => {
  it("prop: account with Canvas_User_ID__pc sets studentId", async () => {
    await fc.assert(fc.asyncProperty(
      fc.stringMatching(/^[0-9]{1,10}$/),
      async (canvasId) => {
        const { deps, patches } = makeTestCaseDeps({
          records: { Account: { Canvas_User_ID__pc: canvasId, Name: "Test" } },
        })
        const canvas = baseCanvas()

        const result = await resolveFromAccount("001TEST", canvas, deps)

        expect(result?.studentId).toBe(canvasId)
      }
    ), { numRuns: 20 })
  })

  it("prop: account with Gender_Identity__c sets studentPronouns", async () => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom("she/her", "he/him", "they/them"),
      async (pronouns) => {
        const { deps } = makeTestCaseDeps({
          records: { Account: { Canvas_User_ID__pc: "123", Gender_Identity__c: pronouns } },
        })
        const canvas = baseCanvas()

        const result = await resolveFromAccount("001TEST", canvas, deps)

        expect(result?.studentPronouns).toBe(pronouns)
      }
    ), { numRuns: 5 })
  })

  it("account without Canvas ID returns canvas unchanged", async () => {
    const { deps } = makeTestCaseDeps({
      records: { Account: { Name: "No Canvas" } },
    })
    const canvas = baseCanvas()

    const result = await resolveFromAccount("001TEST", canvas, deps)

    expect(result?.studentId).toBeNull()
  })

  it("account fetch error returns canvas unchanged", async () => {
    const { deps } = makeTestCaseDeps()
    deps.getRecord = async () => { throw new Error("network error") }
    const canvas = baseCanvas()

    const result = await resolveFromAccount("001TEST", canvas, deps)

    // Should return canvas, not throw
    expect(result).toBeDefined()
  })
})

// ── resolveStudentFromEnrollment ─────────────────────────────────────────────

describe("resolveStudentFromEnrollment", () => {
  it("enrollment found → resolved true with student data", async () => {
    const { deps, patches } = makeTestCaseDeps({
      canvasResults: [
        [{ id: 1, user_id: 42, user: { name: "Student A" } }],
      ],
    })
    const canvas = baseCanvas()

    const done = await resolveStudentFromEnrollment("ENR001", null, canvas, deps)

    expect(done).toBe(true)
    const canvasPatch = patches.find(p => "canvas" in p && p.canvas?.studentId)
    expect(canvasPatch?.canvas?.studentId).toBe("42")
    expect(canvasPatch?.canvas?.studentName).toBe("Student A")
  })

  it("empty enrollment result → returns false (falls through)", async () => {
    const { deps } = makeTestCaseDeps({
      canvasResults: [[]],  // empty enrollment result
    })
    const canvas = baseCanvas()

    const done = await resolveStudentFromEnrollment("ENR001", null, canvas, deps)

    expect(done).toBe(false)
  })

  it("Canvas 401 → sets canvas-session-required error", async () => {
    const { deps, patches } = makeTestCaseDeps()
    deps.canvasFetch = async () => { throw new Error("Canvas API 401: Unauthorized") }
    const canvas = baseCanvas()

    const done = await resolveStudentFromEnrollment("ENR001", null, canvas, deps)

    expect(done).toBe(true)
    const errorPatch = patches.find(p => p.studentError === "canvas-session-required")
    expect(errorPatch).toBeDefined()
  })

  it("non-401 error with fallback email → tries email lookup", async () => {
    const { deps, patches } = makeTestCaseDeps({
      // First canvasFetch (enrollment) throws, second (email search) returns match
      canvasResults: [
        new Error("Canvas API 500: Server Error"),
        [{ id: 99, name: "Found By Email", email: "test@unity.edu", login_id: "test@unity.edu" }],
      ],
    })
    const canvas = baseCanvas()

    const done = await resolveStudentFromEnrollment("ENR001", "test@unity.edu", canvas, deps)

    expect(done).toBe(true)
    const canvasPatch = patches.find(p => "canvas" in p && p.canvas?.studentId === "99")
    expect(canvasPatch).toBeDefined()
  })
})

// ── resolveStudentFromContact ────────────────────────────────────────────────

describe("resolveStudentFromContact", () => {
  it("contact with Canvas_User_ID__c → resolved", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: { Contact: { Canvas_User_ID__c: "555", Name: "Contact Student" } },
    })
    const canvas = baseCanvas()

    const done = await resolveStudentFromContact("003TEST", null, canvas, deps)

    expect(done).toBe(true)
    const canvasPatch = patches.find(p => "canvas" in p && p.canvas?.studentId === "555")
    expect(canvasPatch).toBeDefined()
  })

  it("contact without Canvas ID but with email → tries email lookup", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: { Contact: { Email: "student@unity.edu", Name: "No Canvas" } },
      canvasResults: [
        [{ id: 77, name: "Email Match", email: "student@unity.edu", login_id: "student@unity.edu" }],
      ],
    })
    const canvas = baseCanvas()

    const done = await resolveStudentFromContact("003TEST", null, canvas, deps)

    expect(done).toBe(true)
    const canvasPatch = patches.find(p => "canvas" in p && p.canvas?.studentId === "77")
    expect(canvasPatch).toBeDefined()
  })

  it("contact fetch error with fallback email → tries email lookup", async () => {
    const { deps, patches } = makeTestCaseDeps({
      canvasResults: [
        [{ id: 88, name: "Fallback", email: "fallback@unity.edu", login_id: "fallback@unity.edu" }],
      ],
    })
    deps.getRecord = async () => { throw new Error("Contact not found") }
    const canvas = baseCanvas()

    const done = await resolveStudentFromContact("003TEST", "fallback@unity.edu", canvas, deps)

    expect(done).toBe(true)
    const canvasPatch = patches.find(p => "canvas" in p && p.canvas?.studentId === "88")
    expect(canvasPatch).toBeDefined()
  })
})

// ── lookupCanvasStudentByEmail ───────────────────────────────────────────────

describe("lookupCanvasStudentByEmail", () => {
  it("prop: exact email match in course-scoped search → resolved", async () => {
    await fc.assert(fc.asyncProperty(
      fc.emailAddress(),
      fc.nat({ max: 99999 }),
      async (email, userId) => {
        const { deps, patches } = makeTestCaseDeps({
          canvasResults: [
            [{ id: userId, name: "Found", email, login_id: email }],
          ],
        })
        const canvas = baseCanvas()

        const done = await lookupCanvasStudentByEmail(email, canvas, deps)

        expect(done).toBe(true)
        const canvasPatch = patches.find(p => "canvas" in p && p.canvas?.studentId === String(userId))
        expect(canvasPatch).toBeDefined()
      }
    ), { numRuns: 20 })
  })

  it("course-scoped miss, global match → resolved", async () => {
    const { deps, patches } = makeTestCaseDeps({
      canvasResults: [
        [],   // course-scoped: no results
        [{ id: 33, name: "Global Match", email: "test@unity.edu", login_id: "test@unity.edu" }],  // global
      ],
    })
    const canvas = baseCanvas()

    const done = await lookupCanvasStudentByEmail("test@unity.edu", canvas, deps)

    expect(done).toBe(true)
    const canvasPatch = patches.find(p => "canvas" in p && p.canvas?.studentId === "33")
    expect(canvasPatch).toBeDefined()
  })

  it("both searches fail → sets student not found error", async () => {
    const { deps, patches } = makeTestCaseDeps({
      canvasResults: [[], []],  // both empty
    })
    const canvas = baseCanvas()

    const done = await lookupCanvasStudentByEmail("nobody@unity.edu", canvas, deps)

    expect(done).toBe(true)
    const errorPatch = patches.find(p => p.studentError === "Student not found in Canvas")
    expect(errorPatch).toBeDefined()
  })

  it("Canvas 401 on course-scoped → sets canvas-session-required", async () => {
    const { deps, patches } = makeTestCaseDeps({
      canvasResults: [
        new Error("Canvas API 401: Unauthorized"),
      ],
    })
    const canvas = baseCanvas()

    const done = await lookupCanvasStudentByEmail("test@unity.edu", canvas, deps)

    expect(done).toBe(true)
    const errorPatch = patches.find(p => p.studentError === "canvas-session-required")
    expect(errorPatch).toBeDefined()
  })
})

// ── resolveStudent (full waterfall) ──────────────────────────────────────────

describe("resolveStudent", () => {
  it("account has Canvas ID → resolves immediately, no further lookups", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: { Account: { Canvas_User_ID__pc: "42", Name: "Quick Resolve" } },
    })
    const canvas = baseCanvas()

    await resolveStudent({
      accountId: "001TEST",
      contactId: "003TEST",
      enrollmentId: "ENR001",
      email: "test@unity.edu",
      canvas,
    }, deps)

    // Should have resolved via account — loadingStudent should be false
    const lastLoading = patches.filter(p => "loadingStudent" in p).pop()
    expect(lastLoading?.loadingStudent).toBe(false)
    // canvas should have studentId = "42"
    const canvasPatch = patches.find(p => "canvas" in p && p.canvas?.studentId === "42")
    expect(canvasPatch).toBeDefined()
  })

  it("account miss → enrollment resolves", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: { Account: { Name: "No Canvas" } },  // no Canvas ID
      canvasResults: [
        [{ id: 1, user_id: 55, user: { name: "Enrollment Student" } }],
      ],
    })
    const canvas = baseCanvas()

    await resolveStudent({
      accountId: "001TEST",
      enrollmentId: "ENR001",
      canvas,
    }, deps)

    const canvasPatch = patches.find(p => "canvas" in p && p.canvas?.studentId === "55")
    expect(canvasPatch).toBeDefined()
  })

  it("no account, no enrollment, contact has Canvas ID → resolves via contact", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: { Contact: { Canvas_User_ID__c: "77", Name: "Contact Student" } },
    })
    const canvas = baseCanvas()

    await resolveStudent({
      contactId: "003TEST",
      canvas,
    }, deps)

    const canvasPatch = patches.find(p => "canvas" in p && p.canvas?.studentId === "77")
    expect(canvasPatch).toBeDefined()
  })

  it("no account, no enrollment, no contact → email search", async () => {
    const { deps, patches } = makeTestCaseDeps({
      canvasResults: [
        [{ id: 99, name: "Email Found", email: "test@unity.edu", login_id: "test@unity.edu" }],
      ],
    })
    const canvas = baseCanvas()

    await resolveStudent({
      email: "test@unity.edu",
      canvas,
    }, deps)

    const canvasPatch = patches.find(p => "canvas" in p && p.canvas?.studentId === "99")
    expect(canvasPatch).toBeDefined()
  })

  it("no identifiers at all → sets error, no throw", async () => {
    const { deps, patches } = makeTestCaseDeps()
    const canvas = baseCanvas()

    await resolveStudent({ canvas }, deps)

    const errorPatch = patches.find(p => p.studentError === "No student identifier available")
    expect(errorPatch).toBeDefined()
    const lastLoading = patches.filter(p => "loadingStudent" in p).pop()
    expect(lastLoading?.loadingStudent).toBe(false)
  })

  it("preferredName from COP is used as studentName", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: { Account: { Canvas_User_ID__pc: "42" } },
    })
    const canvas = baseCanvas()

    await resolveStudent({
      preferredName: "Preferred Name",
      accountId: "001TEST",
      canvas,
    }, deps)

    // The first canvas patch should have the preferred name
    const namePatch = patches.find(p => "canvas" in p && p.canvas?.studentName === "Preferred Name")
    expect(namePatch).toBeDefined()
  })

  it("prop: loadingStudent is always set true then false", async () => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom("account", "enrollment", "contact", "email", "none"),
      async (path) => {
        const opts: Record<string, unknown> = {}
        if (path === "account") {
          opts.records = { Account: { Canvas_User_ID__pc: "1" } }
        }
        const { deps, patches } = makeTestCaseDeps(opts as any)
        const canvas = baseCanvas()

        const studentOpts: Record<string, unknown> = { canvas }
        if (path === "account") studentOpts.accountId = "001T"
        if (path === "enrollment") { studentOpts.enrollmentId = "ENR"; deps.canvasFetch = async () => [] }
        if (path === "contact") { studentOpts.contactId = "003T"; deps.getRecord = async () => ({}) }
        if (path === "email") { studentOpts.email = "a@b.c"; deps.canvasFetch = async () => [] }

        await resolveStudent(studentOpts as any, deps)

        const loadingPatches = patches.filter(p => "loadingStudent" in p)
        expect(loadingPatches.length).toBeGreaterThanOrEqual(2)
        expect(loadingPatches[0].loadingStudent).toBe(true)
        expect(loadingPatches[loadingPatches.length - 1].loadingStudent).toBe(false)
      }
    ), { numRuns: 10 })
  })
})
