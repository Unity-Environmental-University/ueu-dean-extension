/**
 * Load Account — integration layer for the student/instructor Account page.
 *
 * Fetches Account from SF, extracts Canvas_User_ID__pc, fetches courses
 * from Canvas with term and score data, returns grouped view.
 *
 * Pure async function with injected dependencies for testability.
 */

import { isCanvasAuthError } from "../constants"
import { groupByTerm, overallLda, type CanvasCourse, type TermGroup } from "./student-courses"
import { createDiagLog, type DiagLog } from "./resolve"

export interface AccountResult {
  canvasUserId: string | null
  accountName: string | null
  termGroups: TermGroup[]
  lastActivityAt: string | null
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
  const diagnostics = createDiagLog()
  const empty: AccountResult = { canvasUserId: null, accountName: null, termGroups: [], lastActivityAt: null, error: null, diagnostics }

  // 1. Fetch SF Account
  let account: Record<string, unknown>
  try {
    account = await deps.getRecord<Record<string, unknown>>("Account", accountId)
  } catch (e) {
    return { ...empty, error: `Could not load Account: ${e}` }
  }

  if (deps.isStale()) return empty

  // 2. Extract Canvas User ID
  const canvasUserId = diagnostics.pick(account, "Canvas_User_ID__pc", "Canvas_User_ID__c", "CanvasUserId__c", "Canvas_ID__c")
  const accountName = diagnostics.pick(account, "Name")

  if (!canvasUserId) {
    return { ...empty, accountName, error: "no-canvas-id" }
  }

  if (deps.isStale()) return empty

  // 3. Fetch Canvas courses with term + score data
  let courses: CanvasCourse[]
  try {
    courses = await deps.canvasFetch<CanvasCourse[]>(
      `/api/v1/users/${canvasUserId}/courses?include[]=term&include[]=total_scores&include[]=computed_current_score&include[]=enrollments&per_page=100&state[]=available&state[]=completed`
    )
  } catch (e) {
    if (isCanvasAuthError(e)) {
      return { ...empty, canvasUserId, accountName, error: "canvas-session-required" }
    }
    const msg = e instanceof Error ? e.message : String(e)
    return { ...empty, canvasUserId, accountName, error: `Canvas error: ${msg}` }
  }

  if (deps.isStale()) return empty

  // 4. Fetch enrollments for LDA — the courses endpoint doesn't include last_activity_at
  try {
    const enrollments = await deps.canvasFetch<Array<{
      course_id: number
      last_activity_at: string | null
      type: string
    }>>(
      `/api/v1/users/${canvasUserId}/enrollments?type[]=StudentEnrollment&state[]=active&state[]=completed&include[]=last_activity&per_page=100`
    )
    // Build a map of course_id → last_activity_at (string keys for safe comparison)
    const ldaMap = new Map<string, string>()
    for (const e of enrollments) {
      if (e.last_activity_at) ldaMap.set(String(e.course_id), e.last_activity_at)
    }
    diagnostics.add("lda-fetch", `${enrollments.length} enrollment(s), ${ldaMap.size} with LDA`)
    // Inject LDA into course enrollment data
    let injected = 0
    for (const course of courses) {
      const lda = ldaMap.get(String(course.id))
      if (lda) {
        if (course.enrollments && course.enrollments.length > 0) {
          for (const enrollment of course.enrollments) {
            if (!enrollment.last_activity_at) {
              enrollment.last_activity_at = lda
              injected++
            }
          }
        } else {
          // No embedded enrollments — create a synthetic one with just LDA
          course.enrollments = [{
            type: "StudentEnrollment",
            enrollment_state: "active",
            computed_current_score: null,
            computed_final_score: null,
            computed_current_grade: null,
            computed_final_grade: null,
            last_activity_at: lda,
          }]
          injected++
        }
      }
    }
    diagnostics.add("lda-inject", `${injected} course(s) updated`)
  } catch (e) {
    diagnostics.add("lda-error", `Enrollment LDA fetch failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (deps.isStale()) return empty

  // 5. Group by term
  const termGroups = groupByTerm(courses)
  const lastActivityAt = overallLda(termGroups)
  return { canvasUserId, accountName, termGroups, lastActivityAt, error: null, diagnostics }
}
