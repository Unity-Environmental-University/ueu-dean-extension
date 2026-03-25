// @vitest-environment node
import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { loadAccountCases } from "./load-account-cases"
import { makeTestAccountCasesDeps, arbCaseListRecord } from "../test-utils"

describe("loadAccountCases", () => {
  it("prop: maps all returned records and counts open cases correctly", async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(arbCaseListRecord, { minLength: 0, maxLength: 15 }),
      async (records) => {
        const deps = makeTestAccountCasesDeps({
          queryResults: [{ records }],
        })

        const result = await loadAccountCases("001TESTACCOUNT", deps)

        expect(result.cases).toHaveLength(records.length)
        expect(result.error).toBeNull()

        // openCount should match non-Closed/non-Resolved
        const expectedOpen = records.filter(r =>
          r.Status !== "Closed" && r.Status !== "Resolved"
        ).length
        expect(result.openCount).toBe(expectedOpen)
      }
    ), { numRuns: 50 })
  })

  it("prop: cases preserve identity through mapping", async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(arbCaseListRecord, { minLength: 1, maxLength: 10 }),
      async (records) => {
        const deps = makeTestAccountCasesDeps({
          queryResults: [{ records }],
        })

        const result = await loadAccountCases("001TESTACCOUNT", deps)

        for (let i = 0; i < records.length; i++) {
          expect(result.cases[i].id).toBe(records[i].Id)
          expect(result.cases[i].caseNumber).toBe(records[i].CaseNumber)
          expect(result.cases[i].status).toBe(records[i].Status)
          expect(result.cases[i].type).toBe(records[i].Type)
        }
      }
    ), { numRuns: 30 })
  })

  it("prop: query error yields graceful empty result", async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 1 }),
      async (errorMsg) => {
        const deps = makeTestAccountCasesDeps()
        deps.sfQuery = async () => { throw new Error(errorMsg) }

        const result = await loadAccountCases("001TESTACCOUNT", deps)

        expect(result.cases).toEqual([])
        expect(result.openCount).toBe(0)
        expect(result.error).toContain(errorMsg)
      }
    ), { numRuns: 10 })
  })

  it("prop: stale token yields graceful empty result", async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(arbCaseListRecord, { minLength: 1, maxLength: 5 }),
      async (records) => {
        const deps = makeTestAccountCasesDeps({
          queryResults: [{ records }],
          staleAfter: 0, // stale immediately after sfQuery
        })

        const result = await loadAccountCases("001TESTACCOUNT", deps)

        // Should bail — no cases
        expect(result.cases).toEqual([])
        expect(result.openCount).toBe(0)
      }
    ), { numRuns: 10 })
  })

  it("returns empty for no records", async () => {
    const deps = makeTestAccountCasesDeps({
      queryResults: [{ records: [] }],
    })

    const result = await loadAccountCases("001TESTACCOUNT", deps)

    expect(result.cases).toEqual([])
    expect(result.openCount).toBe(0)
    expect(result.error).toBeNull()
  })
})
