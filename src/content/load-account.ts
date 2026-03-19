/**
 * Load Account — integration layer for the student/instructor Account page.
 *
 * Fetches Account from SF, extracts Canvas_User_ID__pc, fetches courses
 * from Canvas with term and score data, returns grouped view.
 *
 * Pure async function with injected dependencies for testability.
 */

import { groupByTerm, type CanvasCourse, type TermGroup } from "./student-courses"
import { pick, type DiagLog } from "./resolve"

export interface AccountResult {
  canvasUserId: string | null
  accountName: string | null
  termGroups: TermGroup[]
  error: string | null
  diagnostics: DiagLog
}

export interface LoadAccountDeps {
  getRecord: <T>(objectType: string, id: string) => Promise<T>
  canvasFetch: <T>(path: string) => Promise<T>
  isStale: () => boolean
}

/**
 * Load a Person Account's Canvas courses grouped by term.
 *
 * Returns AccountResult — never throws.
 */
export async function loadAccountCourses(
  accountId: string,
  deps: LoadAccountDeps,
): Promise<AccountResult> {
  const diagnostics: DiagLog = []
  const empty: AccountResult = { canvasUserId: null, accountName: null, termGroups: [], error: null, diagnostics }

  // 1. Fetch SF Account
  let account: Record<string, unknown>
  try {
    account = await deps.getRecord<Record<string, unknown>>("Account", accountId)
  } catch (e) {
    return { ...empty, error: `Could not load Account: ${e}` }
  }

  if (deps.isStale()) return empty

  // 2. Extract Canvas User ID
  const canvasUserId = pick(diagnostics, account, "Canvas_User_ID__pc", "Canvas_User_ID__c", "CanvasUserId__c", "Canvas_ID__c")
  const accountName = pick(diagnostics, account, "Name")

  if (!canvasUserId) {
    return { ...empty, accountName, error: "no-canvas-id" }
  }

  if (deps.isStale()) return empty

  // 3. Fetch Canvas courses with term + score data
  let courses: CanvasCourse[]
  try {
    courses = await deps.canvasFetch<CanvasCourse[]>(
      `/api/v1/users/${canvasUserId}/courses?include[]=term&include[]=total_scores&include[]=computed_current_score&per_page=100&state[]=available&state[]=completed`
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes("401:") || msg.includes("401 ")) {
      return { ...empty, canvasUserId, accountName, error: "canvas-session-required" }
    }
    return { ...empty, canvasUserId, accountName, error: `Canvas error: ${msg}` }
  }

  if (deps.isStale()) return empty

  // 4. Group by term
  const termGroups = groupByTerm(courses)

  return { canvasUserId, accountName, termGroups, error: null, diagnostics }
}
