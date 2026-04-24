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
  const instructorName = diagnostics.pick(co, "Instructor_Name__c", "Instructor__c", "User_Primary_Faculty__c")
  const instructorEmail = diagnostics.pick(co, "Faculty_Email__c")
  const supervisingDean = diagnostics.pick(co, "Supervising_Dean__c")

  const canvasCourseUrl = canvasCourseId
    ? `${CANVAS_URL}/courses/${canvasCourseId}`
    : null

  if (deps.isStale()) return empty

  // 2. SOQL: enrolled students via CourseOfferingParticipant.
  //    Pull Contact.Canvas_User_ID__c — this is the identity key we join on.
  //    Email and name are carried only for display/diagnostics, never for joining.
  let sfStudents: Array<{
    Id: string
    ParticipantContactId: string | null
    Canvas_Enrollment_ID__c: string | null
    Contact?: { Name?: string; Email?: string; Canvas_User_ID__c?: string | null }
  }> = []

  const soql = `SELECT Id, ParticipantContactId, Canvas_Enrollment_ID__c,
    Contact.Name, Contact.Email, Contact.Canvas_User_ID__c
    FROM CourseOfferingParticipant
    WHERE CourseOfferingId = '${recordId}'
    ORDER BY Contact.Name
    LIMIT 200`
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

  // 4. Build student list — Canvas roster is primary, SF enriches.
  //
  // Join strategy: Canvas User ID is the sole identity key. SF Contacts carry
  // Canvas_User_ID__c, Canvas enrollments carry user_id — an id↔id comparison
  // with no ambiguity. Name/email joins collapse identity to a proxy and have
  // historically produced the wrong-student bug, so they are not used as
  // fallbacks. If a Canvas enrollment has no matching SF Contact by Canvas ID,
  // we emit a loud per-student diagnostic and surface a roster-mismatch error.
  const sfByCanvasId = new Map<string, typeof sfStudents[0]>()
  let sfWithoutCanvasId = 0
  for (const r of sfStudents) {
    const id = r.Contact?.Canvas_User_ID__c
    if (id) sfByCanvasId.set(String(id), r)
    else sfWithoutCanvasId++
  }
  if (sfWithoutCanvasId > 0) {
    diagnostics.push({ type: "co-enrichment", detail: `${sfWithoutCanvasId} SF student(s) in this offering have no Canvas_User_ID__c — cannot be joined to Canvas roster` })
  }

  let students: EnrolledStudent[]
  let rosterError: string | null = null

  if (canvasRoster.size > 0) {
    // Canvas is primary — has grades, activity, enrollment state.
    // Join strictly on Canvas user_id. No email/name fallback.
    let enriched = 0
    let unmatched = 0
    students = [...canvasRoster.values()].map(ce => {
      const canvasIdStr = String(ce.user_id)
      const sfMatch = sfByCanvasId.get(canvasIdStr)
      if (sfMatch) {
        enriched++
      } else {
        unmatched++
        diagnostics.push({
          type: "student-id-mismatch",
          detail: `Canvas user_id=${canvasIdStr} (${ce.user?.name ?? "unknown"}) has no SF Contact with matching Canvas_User_ID__c in this offering`,
        })
      }
      return {
        contactId: sfMatch?.ParticipantContactId ?? null,
        accountId: null,
        name: ce.user?.name ?? "Unknown",
        email: ce.user?.login_id ?? sfMatch?.Contact?.Email ?? null,
        canvasUserId: canvasIdStr,
        currentScore: ce.grades?.current_score ?? null,
        currentGrade: ce.grades?.current_grade ?? null,
        lastActivityAt: ce.last_activity_at ?? null,
        enrollmentState: ce.enrollment_state ?? null,
      }
    })
    diagnostics.push({ type: "student-source", detail: `canvas-primary (${students.length} students; ${enriched} enriched by Canvas ID, ${unmatched} unmatched)` })
    if (unmatched > 0) {
      rosterError = `Roster mismatch: ${unmatched} Canvas student(s) could not be matched to a Salesforce Contact by Canvas User ID. Clicking a student will not open their SF record.`
    }
  } else if (sfStudents.length > 0) {
    // SF fallback — no grades but has names
    students = sfStudents.map(r => ({
      contactId: r.ParticipantContactId ?? null,
      accountId: null,
      name: r.Contact?.Name ?? "Unknown",
      email: r.Contact?.Email ?? null,
      canvasUserId: null,
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
    error: rosterError,
    diagnostics,
    coRaw: co,
  }
}
