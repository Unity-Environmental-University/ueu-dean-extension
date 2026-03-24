/**
 * Load open/recent cases for a student Account.
 *
 * Uses the shared case query builder from case-helpers.ts.
 * Person Accounts in SF have both an Account ID and an implicit Contact ID.
 * Cases link via AccountId directly — no extra query needed.
 */

import { buildCaseListQuery, mapCaseRecord, type CaseListRecord } from "./case-helpers"
import type { PriorCase } from "./case-types"

export interface AccountCasesResult {
  cases: PriorCase[]
  openCount: number
  error: string | null
}

export interface LoadAccountCasesDeps {
  sfQuery: <T>(soql: string) => Promise<{ records: T[] }>
  isStale: () => boolean
}

/**
 * Fetch recent cases for a student account.
 * Returns up to 15 cases, sorted newest-first.
 */
export async function loadAccountCases(
  accountId: string,
  deps: LoadAccountCasesDeps,
): Promise<AccountCasesResult> {
  const empty: AccountCasesResult = { cases: [], openCount: 0, error: null }

  try {
    const soql = buildCaseListQuery({ where: `AccountId = '${accountId}'`, limit: 15 })
    const result = await deps.sfQuery<CaseListRecord>(soql)

    if (deps.isStale()) return empty

    const cases = result.records.map(mapCaseRecord)
    const openCount = cases.filter(c =>
      c.status !== "Closed" && c.status !== "Resolved"
    ).length

    return { cases, openCount, error: null }
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) }
  }
}
