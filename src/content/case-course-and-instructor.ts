/**
 * case-course-and-instructor.ts — resolve Canvas course and instructor from SF data.
 *
 * Maps a CourseOffering record to a Canvas course ID, then resolves the instructor.
 */

import { CANVAS_URL } from "../constants"
import { createDiagLog } from "./resolve"
import { resolveStudent } from "./case-student-resolution"
import type { LoadCaseDeps, CanvasState, InstructorState } from "./case-types"

export async function resolveCanvasFromCo(
  coId: string,
  onName: (name: string) => void,
  deps: LoadCaseDeps,
): Promise<string | null> {
  deps.onUpdate({ loadingCourseOffering: true, courseOfferingError: null })

  const log = createDiagLog()
  try {
    const co = await deps.getRecord<Record<string, unknown>>("CourseOffering", coId)
    const name = log.pick(co, "Name")
    if (name) onName(name)

    const canvasId = log.pick(co, "Canvas_Course_ID__c", "CanvasCourseId__c", "Canvas_Course__c")
    deps.onUpdate({ loadingCourseOffering: false })

    if (!canvasId) {
      log.add("canvas-id-missing", `CourseOffering ${coId} has no Canvas Course ID`)
      deps.onUpdate({ diagnostics: log, courseOfferingError: "No Canvas Course ID on this Course Offering" })
      return null
    }

    log.add("canvas-id-resolved", canvasId)
    deps.onUpdate({
      diagnostics: log,
      canvas: { courseId: canvasId, url: `${CANVAS_URL}/courses/${canvasId}`, enrollmentUrl: null, studentId: null, studentName: null },
    })
    deps.observeFields("CourseOffering", log)
    return canvasId
  } catch (e) {
    deps.onUpdate({ loadingCourseOffering: false, courseOfferingError: "Could not load Course Offering", diagnostics: log })
    console.warn("[UEU] Failed to fetch Course Offering:", e)
    return null
  }
}

export async function resolveCanvasAndStudent(opts: {
  coId: string
  preferredName: string | null
  accountId: string | null
  contactId: string | null
  enrollmentId: string | null
  email: string | null
  onName: (name: string) => void
  canvas: CanvasState | null
}, deps: LoadCaseDeps): Promise<CanvasState | null> {
  const canvasId = await resolveCanvasFromCo(opts.coId, opts.onName, deps)
  if (!canvasId || deps.isStale()) return opts.canvas

  const canvas: CanvasState = {
    courseId: canvasId,
    url: `${CANVAS_URL}/courses/${canvasId}`,
    enrollmentUrl: null,
    studentId: null,
    studentName: null,
  }

  await resolveStudent({
    preferredName: opts.preferredName,
    accountId: opts.accountId,
    contactId: opts.contactId,
    enrollmentId: opts.enrollmentId,
    email: opts.email,
    canvas,
  }, deps)

  return canvas
}

export async function resolveInstructor(
  name: string | null,
  email: string | null,
  instructorFieldValue: string | null,
  courseId: string | null,
  deps: LoadCaseDeps,
): Promise<void> {
  const instructor: InstructorState = { name, email, canvasId: null }
  deps.onUpdate({ instructor })

  if (instructorFieldValue && /^[a-zA-Z0-9]{15,18}$/.test(instructorFieldValue)) {
    const log = createDiagLog()
    // SF ID prefixes: 001 = Account, 003 = Contact. Route directly when possible.
    const isContact = instructorFieldValue.startsWith("003")
    const isAccount = instructorFieldValue.startsWith("001")
    const tryOrder: Array<"Account" | "Contact"> = isContact ? ["Contact"] : isAccount ? ["Account"] : ["Account", "Contact"]

    for (const objectType of tryOrder) {
      try {
        const record = await deps.getRecord<Record<string, unknown>>(objectType, instructorFieldValue)
        const canvasUserId = objectType === "Account"
          ? log.pick(record, "Canvas_User_ID__pc", "Canvas_User_ID__c")
          : log.pick(record, "Canvas_User_ID__c")
        const recordName = log.pick(record, "Name")
        deps.onUpdate({ diagnostics: log })
        if (canvasUserId) {
          instructor.canvasId = canvasUserId
          if (recordName) instructor.name = recordName
          log.add("instructor-lookup", `${objectType.toLowerCase()} Canvas_User_ID=${canvasUserId} name=${recordName ?? "null"}`)
          deps.onUpdate({ instructor: { ...instructor } })
          return
        }
        if (recordName && !name) instructor.name = recordName
        log.add("instructor-lookup", `${objectType.toLowerCase()} found but no Canvas user ID`)
        break // found the record, just no Canvas ID — don't try next type
      } catch (e) {
        log.add("instructor-lookup", `${objectType.toLowerCase()} fetch failed: ${e}`)
      }
    }
  }

  if (!email) { deps.onUpdate({ instructor: { ...instructor } }); return }

  if (courseId) {
    try {
      const users = await deps.canvasFetch<Array<{ id: number; name: string }>>(
        `/api/v1/courses/${courseId}/search_users?search_term=${encodeURIComponent(email)}&enrollment_type[]=teacher&enrollment_type[]=ta&per_page=5`
      )
      if (users.length > 0) {
        instructor.canvasId = String(users[0].id)
        if (!instructor.name || instructor.name === name) instructor.name = users[0].name
        deps.onUpdate({ instructor: { ...instructor }, diagnostics: [{ type: "instructor-lookup", detail: `course-scoped email=${email} canvasId=${instructor.canvasId}` }] })
        return
      }
      deps.onUpdate({ diagnostics: [{ type: "instructor-lookup", detail: `course-scoped: no match for ${email}` }] })
    } catch (e) {
      deps.onUpdate({ diagnostics: [{ type: "instructor-lookup", detail: `course-scoped failed: ${e}` }] })
    }
  }

  deps.onUpdate({ instructor: { ...instructor } })
}
