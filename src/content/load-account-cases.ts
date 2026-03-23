/**
 * Load open/recent cases for a student Account.
 *
 * PLAY — sketching whether an advisor on an Account page can see case activity.
 *
 * Two possible SOQL paths:
 *   1. WHERE AccountId = :accountId  (direct — Account is on the Case)
 *   2. WHERE ContactId = :contactId  (indirect — need to resolve Contact from Account first)
 *
 * Person Accounts in SF have both an Account ID and an implicit Contact ID.
 * Cases link to Contacts via ContactId and to Accounts via AccountId.
 * For Person Accounts, AccountId on the Case should work directly.
 *
 * Let's try path 1 first — it's simpler and avoids an extra query.
 */

import { cleanTermName } from "./field-utils"

export interface AccountCase {
  id: string
  caseNumber: string
  type: string
  subType: string | null
  status: string
  createdDate: string
  courseName: string | null
  courseCode: string | null
  termName: string | null
}

export interface AccountCasesResult {
  cases: AccountCase[]
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
    // Path 1: query by AccountId directly
    // This works for Person Accounts where the Case.AccountId = the student's Account
    const soql = [
      "SELECT Id, CaseNumber, Type, SubType__c, Status, CreatedDate,",
      "  Course_Offering__r.Name,",
      "  Course_Offering__r.Academic_Term_Display_Name__c",
      "FROM Case",
      `WHERE AccountId = '${accountId}'`,
      "ORDER BY CreatedDate DESC",
      "LIMIT 15",
    ].join(" ")

    const result = await deps.sfQuery<Record<string, unknown>>(soql)

    if (deps.isStale()) return empty

    const cases: AccountCase[] = result.records.map(rec => {
      const offering = rec["Course_Offering__r"] as Record<string, unknown> | null
      const rawTerm = offering?.["Academic_Term_Display_Name__c"] as string | null
      return {
        id: rec["Id"] as string,
        caseNumber: rec["CaseNumber"] as string,
        type: rec["Type"] as string ?? "",
        subType: rec["SubType__c"] as string | null ?? null,
        status: rec["Status"] as string,
        createdDate: rec["CreatedDate"] as string,
        courseName: offering?.["Name"] as string | null ?? null,
        courseCode: null, // could extract from name if needed
        termName: rawTerm ? cleanTermName(rawTerm) : null,
      }
    })

    const openCount = cases.filter(c =>
      c.status !== "Closed" && c.status !== "Resolved"
    ).length

    return { cases, openCount, error: null }
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) }
  }
}
