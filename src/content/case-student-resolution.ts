/**
 * case-student-resolution.ts — all paths to resolve a Canvas student ID.
 *
 * Pipeline: account → enrollment → contact → email search.
 * Each function takes injected deps and returns whether resolution is complete.
 */

import { CANVAS_URL, isCanvasAuthError } from "../constants"
import { createDiagLog, type DiagLog } from "./resolve"
import { findExactEmailMatch } from "./case-helpers"
import type { LoadCaseDeps, CanvasState } from "./case-types"

export async function resolveFromAccount(
  accountId: string,
  canvas: CanvasState | null,
  deps: LoadCaseDeps,
): Promise<CanvasState | null> {
  const log = createDiagLog()
  try {
    const account = await deps.getRecord<Record<string, unknown>>("Account", accountId)
    deps.onUpdate({ contactRaw: account })
    const canvasUserId = log.pick(account, "Canvas_User_ID__pc", "Canvas_User_ID__c", "CanvasUserId__c", "Canvas_ID__c", "Canvas_User__c")
    const genderIdentity = log.pick(account, "PersonGenderIdentity", "PersonPronouns", "Person_Gender_Identity__c", "Gender_Identity__c", "GenderIdentity__c", "Gender__c", "Pronouns__c", "Preferred_Pronouns__c")
    log.add("account-resolved", `canvasUserId=${canvasUserId ?? "null"} genderIdentity=${genderIdentity ?? "null"}`)
    deps.onUpdate({ diagnostics: log })
    deps.observeFields("Account", log)
    if (canvas) {
      const updated = { ...canvas }
      if (canvasUserId && !updated.studentId) updated.studentId = canvasUserId
      if (genderIdentity) updated.studentPronouns = genderIdentity
      deps.onUpdate({ canvas: updated })
      return updated
    }
  } catch (e) {
    const log2 = createDiagLog()
    log2.add("account-error", String(e))
    deps.onUpdate({ diagnostics: log2 })
  }
  return canvas
}

export async function resolveStudentFromEnrollment(
  enrollmentId: string,
  fallbackEmail: string | null,
  canvas: CanvasState,
  deps: LoadCaseDeps,
): Promise<boolean> {
  const courseId = canvas.courseId
  try {
    const enrollmentUrl = `${CANVAS_URL}/courses/${courseId}/enrollments/${enrollmentId}`
    deps.onUpdate({ canvas: { ...canvas, enrollmentUrl }, diagnostics: [{ type: "enrollment-url", detail: enrollmentUrl }] })
    const enrollments = await deps.canvasFetch<Array<{ id: number; user_id: number; user: { name: string } }>>(
      `/api/v1/courses/${courseId}/enrollments?enrollment_id[]=${enrollmentId}&type[]=StudentEnrollment&state[]=active&state[]=inactive&state[]=completed`
    )
    deps.onUpdate({ diagnostics: [{ type: "enrollment-lookup", detail: `found ${enrollments.length} result(s) for enrollment ${enrollmentId} in course ${courseId}` }] })
    const enrollment = enrollments[0]
    if (enrollment) {
      deps.onUpdate({
        canvas: { ...canvas, studentId: String(enrollment.user_id), studentName: enrollment.user?.name ?? null },
        loadingStudent: false,
      })
      return true
    }
    deps.onUpdate({ diagnostics: [{ type: "enrollment-lookup", detail: "enrollment found but empty — falling back" }] })
  } catch (e) {
    deps.onUpdate({ diagnostics: [{ type: "enrollment-lookup", detail: `failed: ${e}` }] })
    if (isCanvasAuthError(e)) {
      deps.onUpdate({ loadingStudent: false, studentError: "canvas-session-required" })
      return true
    }
    if (fallbackEmail) {
      return lookupCanvasStudentByEmail(fallbackEmail, canvas, deps)
    }
    deps.onUpdate({ loadingStudent: false, studentError: "Could not resolve student from Canvas enrollment" })
    return true
  }
  return false
}

export async function resolveStudentFromContact(
  contactId: string,
  fallbackEmail: string | null,
  canvas: CanvasState,
  deps: LoadCaseDeps,
): Promise<boolean> {
  const log = createDiagLog()
  try {
    const contact = await deps.getRecord<Record<string, unknown>>("Contact", contactId)
    const canvasUserId = log.pick(contact, "Canvas_User_ID__c", "CanvasUserId__c", "Canvas_ID__c")
    if (canvasUserId) {
      deps.onUpdate({
        canvas: { ...canvas, studentId: canvasUserId, studentName: log.pick(contact, "Name") ?? null },
        diagnostics: log,
        loadingStudent: false,
      })
      deps.observeFields("Contact", log)
      return true
    }
    const email = log.pick(contact, "Email") ?? fallbackEmail
    deps.onUpdate({ diagnostics: log })
    deps.observeFields("Contact", log)
    if (email) return lookupCanvasStudentByEmail(email, canvas, deps)
    deps.onUpdate({ loadingStudent: false, studentError: "No email on contact record" })
    return true
  } catch (e) {
    if (fallbackEmail) return lookupCanvasStudentByEmail(fallbackEmail, canvas, deps)
    deps.onUpdate({ loadingStudent: false, studentError: "Could not look up student" })
    return true
  }
}

export async function lookupCanvasStudentByEmail(
  email: string,
  canvas: CanvasState,
  deps: LoadCaseDeps,
): Promise<boolean> {
  const courseId = canvas.courseId
  if (courseId) {
    try {
      const users = await deps.canvasFetch<Array<{ id: number; name: string; email?: string; login_id?: string }>>(
        `/api/v1/courses/${courseId}/search_users?search_term=${encodeURIComponent(email)}&include[]=email&include[]=login_id&per_page=5`
      )
      const match = findExactEmailMatch(users, email)
      if (match) {
        deps.onUpdate({
          canvas: { ...canvas, studentId: String(match.id), studentName: match.name },
          loadingStudent: false,
          diagnostics: [{ type: "student-email-lookup", detail: `course-scoped: exact match ${match.id} (of ${users.length} results)` }],
        })
        return true
      }
      deps.onUpdate({ diagnostics: [{ type: "student-email-lookup", detail: `course-scoped: ${users.length} result(s), no exact match` }] })
    } catch (e) {
      if (isCanvasAuthError(e)) {
        deps.onUpdate({ loadingStudent: false, studentError: "canvas-session-required" })
        return true
      }
      deps.onUpdate({ diagnostics: [{ type: "student-email-lookup", detail: `course-scoped failed: ${e}` }] })
    }
  }

  try {
    const users = await deps.canvasFetch<Array<{ id: number; name: string; email?: string; login_id?: string }>>(
      `/api/v1/users?search_term=${encodeURIComponent(email)}&include[]=email&include[]=login_id&per_page=5`
    )
    const match = findExactEmailMatch(users, email)
    if (match) {
      deps.onUpdate({
        canvas: { ...canvas, studentId: String(match.id), studentName: match.name },
        loadingStudent: false,
        diagnostics: [{ type: "student-email-lookup", detail: `global: exact match ${match.id} (of ${users.length} results)` }],
      })
      return true
    }
  } catch (e) {
    if (isCanvasAuthError(e)) {
      deps.onUpdate({ loadingStudent: false, studentError: "canvas-session-required" })
      return true
    }
    deps.onUpdate({ diagnostics: [{ type: "student-email-lookup", detail: `global failed: ${e}` }] })
  }

  deps.onUpdate({ loadingStudent: false, studentError: "Student not found in Canvas" })
  return true
}

export async function resolveStudent(opts: {
  preferredName?: string | null
  accountId?: string | null
  contactId?: string | null
  enrollmentId?: string | null
  email?: string | null
  canvas: CanvasState
}, deps: LoadCaseDeps): Promise<void> {
  let canvas = opts.canvas
  deps.onUpdate({ loadingStudent: true, studentError: null })

  if (opts.preferredName) {
    canvas = { ...canvas, studentName: opts.preferredName }
    deps.onUpdate({ canvas, diagnostics: [{ type: "student-lookup-path", detail: `cop-name:${opts.preferredName}` }] })
  }

  if (opts.accountId) {
    canvas = (await resolveFromAccount(opts.accountId, canvas, deps)) ?? canvas
    if (canvas.studentId) { deps.onUpdate({ loadingStudent: false }); return }
  }

  if (!canvas.studentId && opts.enrollmentId) {
    deps.onUpdate({ diagnostics: [{ type: "student-lookup-path", detail: `enrollment:${opts.enrollmentId}` }] })
    const done = await resolveStudentFromEnrollment(opts.enrollmentId, opts.email ?? null, canvas, deps)
    if (done) return
  }

  if (!canvas.studentId && opts.contactId) {
    deps.onUpdate({ diagnostics: [{ type: "student-lookup-path", detail: `contact:${opts.contactId}` }] })
    const done = await resolveStudentFromContact(opts.contactId, opts.email ?? null, canvas, deps)
    if (done) return
  }

  if (!canvas.studentId && opts.email) {
    deps.onUpdate({ diagnostics: [{ type: "student-lookup-path", detail: `email:${opts.email}` }] })
    await lookupCanvasStudentByEmail(opts.email, canvas, deps)
    return
  }

  if (!canvas.studentId && !opts.preferredName) {
    deps.onUpdate({ studentError: "No student identifier available", diagnostics: [{ type: "student-lookup-path", detail: "no identifier available" }] })
  }
  deps.onUpdate({ loadingStudent: false })
}
