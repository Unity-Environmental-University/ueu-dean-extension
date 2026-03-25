// @vitest-environment node
import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { loadCase, loadPriorCases } from "./load-case"
import { mapCaseRecord } from "./case-helpers"
import { makeTestCaseDeps, arbCaseListRecord } from "../test-utils"

describe("loadPriorCases", async () => {
  it("prop: maps all returned records to PriorCase via shared mapper", async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(arbCaseListRecord, { minLength: 0, maxLength: 25 }),
      async (records) => {
        const { deps, patches } = makeTestCaseDeps({
          queryResults: [{ records }],
        })

        await loadPriorCases("003TESTCONTACT", "500TESTCASE", deps)

        const priorCasesPatch = patches.find(p => "priorCases" in p && p.priorCases !== undefined)
        if (records.length === 0) {
          // Should still get an empty array patch
          expect(priorCasesPatch?.priorCases).toEqual([])
        } else {
          expect(priorCasesPatch?.priorCases).toEqual(records.map(mapCaseRecord))
        }
      }
    ), { numRuns: 50 })
  })

  it("prop: sets loadingPriorCases true then false", async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(arbCaseListRecord, { minLength: 0, maxLength: 5 }),
      async (records) => {
        const { deps, patches } = makeTestCaseDeps({
          queryResults: [{ records }],
        })

        await loadPriorCases("003TESTCONTACT", "500TESTCASE", deps)

        const loadingPatches = patches.filter(p => "loadingPriorCases" in p)
        expect(loadingPatches[0]?.loadingPriorCases).toBe(true)
        expect(loadingPatches[loadingPatches.length - 1]?.loadingPriorCases).toBe(false)
      }
    ), { numRuns: 20 })
  })

  it("prop: emits diagnostic with count", async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(arbCaseListRecord, { minLength: 0, maxLength: 10 }),
      async (records) => {
        const { deps, diagnostics } = makeTestCaseDeps({
          queryResults: [{ records }],
        })

        await loadPriorCases("003TESTCONTACT", "500TESTCASE", deps)

        const countDiag = diagnostics.find(d => d.type === "prior-cases")
        expect(countDiag?.detail).toContain(`${records.length} prior case(s)`)
      }
    ), { numRuns: 20 })
  })

  it("prop: bails on stale without writing priorCases", async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(arbCaseListRecord, { minLength: 1, maxLength: 5 }),
      async (records) => {
        const { deps, patches } = makeTestCaseDeps({
          queryResults: [{ records }],
          staleAfter: 0, // stale immediately
        })

        await loadPriorCases("003TESTCONTACT", "500TESTCASE", deps)

        const priorCasesPatch = patches.find(p => "priorCases" in p)
        expect(priorCasesPatch).toBeUndefined()
      }
    ), { numRuns: 20 })
  })

  it("prop: handles query errors gracefully", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1 }),
      async (errorMsg) => {
        const { deps, patches, diagnostics } = makeTestCaseDeps()
        // Override sfQuery to throw
        deps.sfQuery = async () => { throw new Error(errorMsg) }

        await loadPriorCases("003TESTCONTACT", "500TESTCASE", deps)

        // Should not have priorCases patch
        const priorCasesPatch = patches.find(p => "priorCases" in p)
        expect(priorCasesPatch).toBeUndefined()

        // Should have error diagnostic
        const errorDiag = diagnostics.find(d => d.type === "prior-cases-error")
        expect(errorDiag).toBeDefined()

        // Should still set loading false
        const lastLoading = patches.filter(p => "loadingPriorCases" in p).pop()
        expect(lastLoading?.loadingPriorCases).toBe(false)
      }
    ), { numRuns: 10 })
  })
})

// ── loadCase ────────────────────────────────────────────────────────────────

/** Minimal SF Case record shape */
function makeCaseRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    CaseNumber: "00200",
    Status: "Open",
    Type: "Academic Dishonesty",
    SubType__c: "Plagiarism",
    Subject: "Test case subject",
    ContactId: "003CONTACT",
    Contact_Name__c: "Jane Doe",
    Contact_Email__c: "jane@test.edu",
    Account_Name__c: "Jane Account",
    ...overrides,
  }
}

describe("loadCase", () => {
  it("emits caseData with basic fields", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: { Case: makeCaseRecord() },
    })

    await loadCase("500CASE", deps)

    const dataPatch = patches.find(p => p.caseData != null)
    expect(dataPatch).toBeDefined()
    expect(dataPatch!.caseData!.caseNumber).toBe("00200")
    expect(dataPatch!.caseData!.status).toBe("Open")
    expect(dataPatch!.caseData!.contactId).toBe("003CONTACT")
    expect(dataPatch!.caseData!.subject).toBe("Test case subject")
  })

  it("emits dishonesty state when incident type present", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: {
        Case: makeCaseRecord({
          Incident_Type__c: "Plagiarism",
          Course_Offering__c: "CO001",
        }),
        CourseOffering: { Name: "BIO 101", Canvas_Course_ID__c: "999" },
      },
      canvasResults: [
        [], // search_users for student (empty = no match)
      ],
    })

    await loadCase("500CASE", deps)

    const dishPatch = patches.find(p => p.dishonesty != null)
    expect(dishPatch).toBeDefined()
    expect(dishPatch!.dishonesty!.incidentType).toBe("plagiarism")
    expect(dishPatch!.dishonesty!.courseOfferingId).toBe("CO001")
  })

  it("emits grade appeal state when appeal fields present", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: {
        Case: makeCaseRecord({
          Grade_Appeal_Reason__c: "Unfair grading",
          Current_Grade__c: "D",
          Changed_Grade__c: "B",
          Course_Offering__c: "CO001",
          Type: "Grade Appeal",
          // No incident type — pure grade appeal
          Incident_Type__c: undefined,
        }),
        CourseOffering: { Name: "ENG 201", Canvas_Course_ID__c: "888" },
      },
      canvasResults: [
        [], // search_users for student
      ],
    })

    await loadCase("500CASE", deps)

    const appealPatch = patches.find(p => p.gradeAppeal != null)
    expect(appealPatch).toBeDefined()
    expect(appealPatch!.gradeAppeal!.currentGrade).toBe("D")
    expect(appealPatch!.gradeAppeal!.appealReason).toBe("Unfair grading")
  })

  it("resolves COP → CourseOffering chain", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: {
        Case: makeCaseRecord({
          Course_Offering_Participant__c: "0P0COP001",
          Incident_Type__c: "Cheating",
        }),
        CourseOfferingParticipant: {
          CourseOfferingId: "CO002",
          ParticipantContactId: "003STUDENT",
          Canvas_Enrollment_ID__c: "ENR123",
        },
        CourseOffering: { Name: "MATH 301", Canvas_Course_ID__c: "777" },
      },
      canvasResults: [
        [], // search_users for student
      ],
    })

    await loadCase("500CASE", deps)

    const copPatch = patches.find(p => p.copRaw != null)
    expect(copPatch).toBeDefined()

    const dishPatch = patches.find(p => p.dishonesty != null)
    expect(dishPatch!.dishonesty!.courseOfferingId).toBe("CO002")
  })

  it("handles case fetch error gracefully", async () => {
    const { deps, patches } = makeTestCaseDeps()
    deps.getRecord = async () => { throw new Error("404 Not Found") }

    await loadCase("500CASE", deps)

    const errorPatch = patches.find(p => p.error != null)
    expect(errorPatch).toBeDefined()
    expect(errorPatch!.error).toContain("404 Not Found")
    expect(patches.some(p => p.loading === false)).toBe(true)
  })

  it("loads prior cases when contactId available", async () => {
    const priorRecords = [
      { Id: "500P", CaseNumber: "00050", Type: "General", SubType__c: null, Status: "Closed", CreatedDate: "2024-01-01T00:00:00.000Z", Course_Offering__c: null },
    ]
    const { deps, patches } = makeTestCaseDeps({
      records: { Case: makeCaseRecord({ ContactId: "003STUDENT" }) },
      queryResults: [{ records: priorRecords }],
    })

    await loadCase("500CASE", deps)

    const casesPatch = patches.find(p => p.priorCases != null)
    expect(casesPatch).toBeDefined()
    expect(casesPatch!.priorCases).toHaveLength(1)
  })

  it("skips prior cases when no contactId", async () => {
    const { deps, patches } = makeTestCaseDeps({
      records: { Case: makeCaseRecord({ ContactId: undefined }) },
    })

    await loadCase("500CASE", deps)

    const skipDiag = patches.find(p =>
      p.diagnostics?.some(d => d.type === "prior-cases-skip")
    )
    expect(skipDiag).toBeDefined()
  })

  it("prop: always terminates with loading:false or error", async () => {
    await fc.assert(fc.asyncProperty(
      fc.boolean(),
      async (succeeds) => {
        const { deps, patches } = makeTestCaseDeps({
          records: succeeds ? { Case: makeCaseRecord() } : {},
        })
        if (!succeeds) {
          deps.getRecord = async () => { throw new Error("fail") }
        }

        await loadCase("500CASE", deps)

        const hasLoadingFalse = patches.some(p => p.loading === false)
        const hasError = patches.some(p => p.error != null)
        expect(hasLoadingFalse || hasError).toBe(true)
      },
    ), { numRuns: 20 })
  })

  it("prop: caseData fields are always strings (never null)", async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        CaseNumber: fc.option(fc.stringMatching(/^\d{5,8}$/), { nil: undefined }),
        Status: fc.option(fc.constantFrom("Open", "Closed"), { nil: undefined }),
        Type: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        Subject: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
      }),
      async (fields) => {
        const record = makeCaseRecord(fields)
        const { deps, patches } = makeTestCaseDeps({
          records: { Case: record },
        })

        await loadCase("500CASE", deps)

        const dataPatch = patches.find(p => p.caseData != null)
        if (dataPatch?.caseData) {
          const d = dataPatch.caseData
          expect(typeof d.caseNumber).toBe("string")
          expect(typeof d.status).toBe("string")
          expect(typeof d.type).toBe("string")
          expect(typeof d.subject).toBe("string")
        }
      },
    ), { numRuns: 30 })
  })
})
