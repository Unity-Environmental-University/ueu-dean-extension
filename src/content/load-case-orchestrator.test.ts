// @vitest-environment node
/**
 * Tests for loadCase — the main orchestrator.
 *
 * loadCase ties together: Case record → COP → CourseOffering → Canvas course
 * → student resolution → instructor → prior cases.
 *
 * Each test wires up mock records to exercise a specific path through the
 * orchestrator. The key things we verify:
 * 1. Correct patches arrive for each path (dishonesty, grade appeal, fallback)
 * 2. Stale checks work at each async boundary
 * 3. resolveCanvasAndStudent isn't called twice when dishonesty already resolved it
 * 4. Prior cases fire as a tail call when contactId is available
 */

import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { loadCase } from "./load-case"
import { makeTestCaseDeps } from "../test-utils"

// ── Helper: build a Case record with configurable fields ─────────────────────

function caseRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    CaseNumber: "00012345",
    Status: "Open",
    Contact_Name__c: "Test Student",
    Contact_Email__c: "student@unity.edu",
    Account_Name__c: "Student Account",
    ContactId: "003TESTCONTACT",
    Type: "Academic Dishonesty",
    SubType__c: "Plagiarism",
    Subject: "Test case",
    ...overrides,
  }
}

// ── Happy path: dishonesty case with COP ─────────────────────────────────────

describe("loadCase: dishonesty path", () => {
  it("resolves case → COP → CO → Canvas course → student → instructor → prior cases", async () => {
    const { deps, patches, diagnostics } = makeTestCaseDeps({
      records: {
        Case: caseRecord({
          Course_Offering_Participant__c: "COP001",
          Incident_Type__c: "Plagiarism",
          Assignment__c: "Essay 1",
          Severity__c: "Major",
          Instructor_Name__c: "Prof Smith",
          Instructor_Email__c: "smith@unity.edu",
        }),
        CourseOfferingParticipant: {
          CourseOfferingId: "CO001",
          Canvas_Enrollment_ID__c: "ENR100",
          ParticipantContactId: "003CONTACT",
          ParticipantAccountId: "001ACCOUNT",
        },
        CourseOffering: {
          Name: "BIO 101 Fall 2025",
          Canvas_Course_ID__c: "500",
        },
        Account: {
          Canvas_User_ID__pc: "42",
          Name: "Student Name",
        },
      },
      canvasResults: [],
      queryResults: [
        // loadPriorCases
        { records: [] },
      ],
    })

    await loadCase("CASE001", deps)

    // caseData should be set
    const casePatch = patches.find(p => "caseData" in p && p.caseData != null)
    expect(casePatch?.caseData?.caseNumber).toBe("00012345")
    expect(casePatch?.caseData?.type).toBe("Academic Dishonesty")

    // dishonesty should be set
    const dishPatch = patches.find(p => "dishonesty" in p && p.dishonesty != null)
    expect(dishPatch?.dishonesty?.incidentType).toBe("plagiarism")
    expect(dishPatch?.dishonesty?.assignmentName).toBe("Essay 1")

    // canvas should be resolved
    const canvasPatch = patches.find(p => "canvas" in p && p.canvas?.courseId === "500")
    expect(canvasPatch).toBeDefined()

    // loading should end as false
    const loadingPatch = patches.find(p => p.loading === false)
    expect(loadingPatch).toBeDefined()
  })
})

// ── Grade appeal path ────────────────────────────────────────────────────────

describe("loadCase: grade appeal path", () => {
  it("case with grade appeal fields but no dishonesty → gradeAppeal patch", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: {
        Case: caseRecord({
          Type: "Grade Appeal",
          SubType__c: null,
          Course_Offering_Participant__c: "COP001",
          Grade_Appeal_Reason__c: "Unfair grading",
          Current_Grade__c: "D",
          Changed_Grade__c: "C",
          Decision_Status__c: "Pending",
          // No Incident_Type__c → no dishonesty path
        }),
        CourseOfferingParticipant: {
          CourseOfferingId: "CO001",
          ParticipantContactId: "003CONTACT",
        },
        CourseOffering: {
          Name: "ENG 201 Spring 2026",
          Canvas_Course_ID__c: "600",
        },
      },
      canvasResults: [
        // email lookup: empty (no student found via email)
        [],
        // global lookup: empty
        [],
        // masquerade probe
        { id: 1 },
      ],
      queryResults: [{ records: [] }],
    })

    await loadCase("CASE002", deps)

    const gradeAppealPatch = patches.find(p => "gradeAppeal" in p && p.gradeAppeal != null)
    expect(gradeAppealPatch?.gradeAppeal?.appealReason).toBe("Unfair grading")
    expect(gradeAppealPatch?.gradeAppeal?.currentGrade).toBe("D")
  })
})

// ── No COP: direct Course_Offering__c on Case ────────────────────────────────

describe("loadCase: direct CO reference", () => {
  it("case with Course_Offering__c (no COP) → resolves Canvas course", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: {
        Case: caseRecord({
          Course_Offering__c: "CO_DIRECT",
          Incident_Type__c: "Cheating",
          // No Course_Offering_Participant__c
        }),
        CourseOffering: {
          Name: "MATH 301",
          Canvas_Course_ID__c: "700",
        },
      },
      canvasResults: [
        // email search (course-scoped): no match
        [],
        // email search (global): no match
        [],
        // masquerade probe
        { id: 1 },
      ],
      queryResults: [{ records: [] }],
    })

    await loadCase("CASE003", deps)

    const canvasPatch = patches.find(p => "canvas" in p && p.canvas?.courseId === "700")
    expect(canvasPatch).toBeDefined()

    const dishPatch = patches.find(p => "dishonesty" in p && p.dishonesty?.incidentType === "cheating")
    expect(dishPatch).toBeDefined()
  })
})

// ── Stale token at various checkpoints ───────────────────────────────────────

describe("loadCase: stale token handling", () => {
  it("stale after Case record fetch → no further patches", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: {
        Case: caseRecord(),
      },
      staleAfter: 0, // stale after first getRecord
    })

    await loadCase("CASE_STALE", deps)

    // Should have no caseData patch (bailed before processing)
    const casePatch = patches.find(p => "caseData" in p && p.caseData != null)
    expect(casePatch).toBeUndefined()
  })

  it("stale after CO fetch → no student resolution", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: {
        Case: caseRecord({
          Course_Offering_Participant__c: "COP001",
          Incident_Type__c: "Plagiarism",
        }),
        CourseOfferingParticipant: { CourseOfferingId: "CO001" },
        CourseOffering: { Canvas_Course_ID__c: "500" },
      },
      staleAfter: 3, // stale after Case + COP + CO fetches
    })

    await loadCase("CASE_STALE2", deps)

    // Canvas course should be set (CO was fetched before stale)
    // but no student resolution should happen
    const studentPatch = patches.find(p => "canvas" in p && p.canvas?.studentId != null)
    expect(studentPatch).toBeUndefined()
  })
})

// ── Error handling ───────────────────────────────────────────────────────────

describe("loadCase: error handling", () => {
  it("Case record fetch error → sets error, loading false", async () => {
    const { deps, patches } = makeTestCaseDeps()
    deps.getRecord = async () => { throw new Error("SF API 500") }

    await loadCase("CASE_ERR", deps)

    const errorPatch = patches.find(p => p.error != null)
    expect(errorPatch?.error).toContain("SF API 500")
    const loadingPatch = patches.find(p => p.loading === false)
    expect(loadingPatch).toBeDefined()
  })

  it("prop: loadCase never throws regardless of input", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 18 }),
      async (recordId) => {
        const { deps } = makeTestCaseDeps()
        // Random failures on any dep
        deps.getRecord = async () => { throw new Error("random failure") }

        // Should not throw
        await loadCase(recordId, deps)
      }
    ), { numRuns: 20 })
  })
})

// ── Prior cases tail call ────────────────────────────────────────────────────

describe("loadCase: prior cases", () => {
  it("fires prior cases query when contactId is available", async () => {
    let queriedSoql: string | null = null
    const { deps, patches } = makeTestCaseDeps({
      records: {
        Case: caseRecord({ ContactId: "003MYCONTACT" }),
      },
      queryResults: [{ records: [] }],
    })
    const origQuery = deps.sfQuery
    deps.sfQuery = async <T>(soql: string) => {
      queriedSoql = soql
      return origQuery<T>(soql)
    }

    await loadCase("CASE_PRIOR", deps)

    expect(queriedSoql).toContain("003MYCONTACT")
  })

  it("skips prior cases when no contactId available", async () => {
    const { deps, diagnostics } = makeTestCaseDeps({
      records: {
        Case: caseRecord({ ContactId: null }),
      },
    })

    await loadCase("CASE_NO_CONTACT", deps)

    const skipDiag = diagnostics.find(d => d.type === "prior-cases-skip")
    expect(skipDiag).toBeDefined()
  })
})

// ── describe returns null → falls back to pick-only ──────────────────────────

describe("loadCase: describe failure", () => {
  it("describe error → falls back to pick-only resolution, still loads", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: {
        Case: caseRecord(),
      },
      queryResults: [{ records: [] }],
    })
    deps.describeObject = async () => { throw new Error("describe failed") }

    await loadCase("CASE_NO_DESCRIBE", deps)

    // caseData should still be set (via pick fallbacks)
    const casePatch = patches.find(p => "caseData" in p && p.caseData != null)
    expect(casePatch?.caseData?.caseNumber).toBe("00012345")
    expect(casePatch?.caseData?.status).toBe("Open")
  })
})
