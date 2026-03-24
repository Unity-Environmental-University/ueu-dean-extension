// @vitest-environment node
import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { loadPriorCases } from "./load-case"
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
