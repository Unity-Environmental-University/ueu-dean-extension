/**
 * load-course-offering.ts — data layer for the CourseOffering page.
 *
 * Fetches SF offering metadata, enrolled students via SOQL, and Canvas
 * roster with grades. Returns a CourseOfferingResult — never throws.
 *
 * Pure async function with injected dependencies for testability.
 */

import { CANVAS_URL, isCanvasAuthError } from "../constants"
import { createDiagLog, type DiagLog } from "./resolve"
import type { SoqlResult } from "./sfapi"
import { cleanTermName } from "./field-utils"

export interface LoadCourseOfferingDeps {
  getRecord: <T>(objectType: string, id: string) => Promise<T>
  sfQuery: <T>(soql: string) => Promise<SoqlResult<T>>
  canvasFetch: <T>(path: string) => Promise<T>
  isStale: () => boolean
}

export interface EnrolledStudent {
  contactId: string | null
  accountId: string | null
  name: string
  email: string | null
  canvasUserId: string | null
  /** From Canvas roster */
  currentScore: number | null
  currentGrade: string | null
  lastActivityAt: string | null
  enrollmentState: string | null
}

export interface CourseOfferingResult {
  offeringName: string | null
  canvasCourseId: string | null
  canvasCourseUrl: string | null
  termName: string | null
  instructorName: string | null
  instructorCanvasId: string | null
  students: EnrolledStudent[]
  error: string | null
  diagnostics: DiagLog
  /** Raw CO record for field name dump */
  coRaw: Record<string, unknown> | null
}

interface CanvasEnrollmentEntry {
  user_id: number
  user: { name: string; login_id?: string }
  grades?: {
    current_score: number | null
    current_grade: string | null
  }
  last_activity_at: string | null
  enrollment_state: string
}


export async function loadCourseOffering(
  recordId: string,
  deps: LoadCourseOfferingDeps,
): Promise<CourseOfferingResult> {
  const diagnostics = createDiagLog()
  const empty: CourseOfferingResult = {
    offeringName: null,
    canvasCourseId: null,
    canvasCourseUrl: null,
    termName: null,
    instructorName: null,
    instructorCanvasId: null,
    students: [],
    error: null,
    diagnostics,
    coRaw: null,
  }

  // 1. Fetch the CourseOffering record
  let co: Record<string, unknown>
  try {
    co = await deps.getRecord<Record<string, unknown>>("CourseOffering", recordId)
  } catch (e) {
    return { ...empty, error: `Could not load Course Offering: ${e}` }
  }

  if (deps.isStale()) return empty

  const offeringName = diagnostics.pick(co, "Name")
  const canvasCourseId = diagnostics.pick(co, "Canvas_Course_ID__c", "CanvasCourseId__c", "Canvas_Course__c")
  const termName = cleanTermName(
    diagnostics.pick(co, "Academic_Term_Display_Name__c", "hed__Term__r.Name", "Term_Name__c")
  )
  const instructorName = diagnostics.pick(co, "Instructor_Name__c", "Instructor__c")

  const canvasCourseUrl = canvasCourseId
    ? `${CANVAS_URL}/courses/${canvasCourseId}`
    : null

  if (deps.isStale()) return empty

  // 2. SOQL: enrolled students via CourseOfferingParticipant
  let sfStudents: Array<{
    Id: string
    hed__Contact__c: string | null
    Canvas_Enrollment_ID__c: string | null
    hed__Contact__r?: { Name?: string; Email?: string; Canvas_User_ID__c?: string }
  }> = []

  const soql = `SELECT Id, hed__Contact__c, Canvas_Enrollment_ID__c,
    hed__Contact__r.Name, hed__Contact__r.Email, hed__Contact__r.Canvas_User_ID__c
    FROM hed__Course_Enrollment__c
    WHERE hed__Course_Offering__c = '${recordId}'
    AND hed__Status__c = 'Active'
    ORDER BY hed__Contact__r.Name
    LIMIT 100`
  try {
    const result = await deps.sfQuery<typeof sfStudents[0]>(soql)
    if (deps.isStale()) return empty
    sfStudents = result.records
    diagnostics.push({ type: "co-enrollment-soql", detail: `found ${sfStudents.length} enrolled student(s)` })
  } catch (e) {
    diagnostics.push({ type: "co-enrollment-error", detail: `SOQL failed: ${e}` })
  }

  if (deps.isStale()) return empty

  // 3. Canvas roster — grades + last activity
  const canvasRoster = new Map<number, CanvasEnrollmentEntry>()
  if (canvasCourseId) {
    try {
      const enrollments = await deps.canvasFetch<CanvasEnrollmentEntry[]>(
        `/api/v1/courses/${canvasCourseId}/enrollments?type[]=StudentEnrollment&state[]=active&state[]=completed&include[]=grades&include[]=last_activity&per_page=100`
      )
      for (const e of enrollments) canvasRoster.set(e.user_id, e)
      diagnostics.push({ type: "canvas-roster", detail: `${enrollments.length} Canvas enrollment(s)` })
    } catch (e) {
      if (isCanvasAuthError(e)) {
        return { ...empty, offeringName, canvasCourseId, canvasCourseUrl, termName, instructorName, instructorCanvasId: null, students: [], error: "canvas-session-required", diagnostics }
      }
      diagnostics.push({ type: "canvas-roster-error", detail: String(e) })
    }
  }

  if (deps.isStale()) return empty

  // 4. Build student list — Canvas roster is primary, SF enriches
  // Index SF students by Canvas user ID for enrichment
  const sfByCanvasId = new Map<string, typeof sfStudents[0]>()
  for (const r of sfStudents) {
    const cid = r.hed__Contact__r?.Canvas_User_ID__c
    if (cid) sfByCanvasId.set(cid, r)
  }

  let students: EnrolledStudent[]

  if (canvasRoster.size > 0) {
    // Canvas is primary — has grades, activity, enrollment state
    students = [...canvasRoster.values()].map(ce => {
      const sfMatch = sfByCanvasId.get(String(ce.user_id))
      return {
        contactId: sfMatch?.hed__Contact__c ?? null,
        accountId: null,
        name: ce.user?.name ?? "Unknown",
        email: ce.user?.login_id ?? sfMatch?.hed__Contact__r?.Email ?? null,
        canvasUserId: String(ce.user_id),
        currentScore: ce.grades?.current_score ?? null,
        currentGrade: ce.grades?.current_grade ?? null,
        lastActivityAt: ce.last_activity_at ?? null,
        enrollmentState: ce.enrollment_state ?? null,
      }
    })
    diagnostics.push({ type: "student-source", detail: `canvas-primary (${students.length} students, ${sfStudents.length} SF matches)` })
  } else if (sfStudents.length > 0) {
    // SF fallback — no grades but has names
    students = sfStudents.map(r => ({
      contactId: r.hed__Contact__c ?? null,
      accountId: null,
      name: r.hed__Contact__r?.Name ?? "Unknown",
      email: r.hed__Contact__r?.Email ?? null,
      canvasUserId: r.hed__Contact__r?.Canvas_User_ID__c ?? null,
      currentScore: null,
      currentGrade: null,
      lastActivityAt: null,
      enrollmentState: null,
    }))
    diagnostics.push({ type: "student-source", detail: `sf-only (${students.length} students, no Canvas roster)` })
  } else {
    students = []
    diagnostics.push({ type: "student-source", detail: "no students from either source" })
  }

  return {
    offeringName,
    canvasCourseId,
    canvasCourseUrl,
    termName,
    instructorName,
    instructorCanvasId: null, // resolved separately if needed
    students,
    error: null,
    diagnostics,
    coRaw: co,
  }
}
