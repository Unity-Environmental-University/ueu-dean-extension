/**
 * load-case.ts — orchestrator for case page loading.
 *
 * Ties together the resolution pipeline: COP → course → student → instructor.
 * Types in case-types.ts, helpers in case-helpers.ts,
 * resolution in case-student-resolution.ts and case-course-and-instructor.ts.
 */

import { makeFieldAccessor, createDiagLog, type DiagLog } from "./resolve"
import { probeCanvasMasquerade } from "./load-canvas-messages"
import { classifyIncident, buildCaseListQuery, mapCaseRecord, type CaseListRecord } from "./case-helpers"
import { resolveCanvasAndStudent, resolveInstructor } from "./case-course-and-instructor"
import type {
  LoadCaseDeps, CasePatch, CaseData, CanvasState,
  DishonestyState, GradeAppealState,
} from "./case-types"

// Re-export types for consumers
export type { LoadCaseDeps, CasePatch } from "./case-types"

// ── COP resolution ───────────────────────────────────────────────────────────

async function resolveCopToCoId(copId: string, deps: LoadCaseDeps): Promise<{
  coId: string | null
  enrollmentId: string | null
  contactId: string | null
  accountId: string | null
  preferredName: string | null
}> {
  const log = createDiagLog()
  try {
    const cop = await deps.getRecord<Record<string, unknown>>("CourseOfferingParticipant", copId)
    deps.onUpdate({ copRaw: cop })
    const result = {
      coId: log.pick(cop, "CourseOfferingId", "Course_Offering__c", "CourseOfferingId__c", "hed__Course_Offering__c", "Course_Offering_ID__c", "CourseOffering__c"),
      enrollmentId: log.pick(cop, "Canvas_Enrollment_ID__c", "CanvasEnrollmentId__c"),
      contactId: log.pick(cop, "ParticipantContactId", "hed__Contact__c", "ContactId", "Contact__c"),
      accountId: log.pick(cop, "ParticipantAccountId", "AccountId"),
      preferredName: log.pick(cop, "Preferred_Student_Name__c", "PreferredName__c"),
    }
    log.add("cop-resolved", `coId=${result.coId ?? "null"} preferredName=${result.preferredName ?? "null"} accountId=${result.accountId ?? "null"}`)
    deps.onUpdate({ diagnostics: log })
    deps.observeFields("CourseOfferingParticipant", log)
    return result
  } catch (e) {
    const log2 = createDiagLog()
    log2.add("cop-error", String(e))
    deps.onUpdate({ diagnostics: log2 })
    return { coId: null, enrollmentId: null, contactId: null, accountId: null, preferredName: null }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function loadPriorCases(
  contactId: string,
  _currentCaseId: string,
  deps: LoadCaseDeps,
): Promise<void> {
  deps.onUpdate({ loadingPriorCases: true })
  try {
    const soql = buildCaseListQuery({ where: `ContactId = '${contactId}'`, limit: 25 })
    const result = await deps.sfQuery<CaseListRecord>(soql)
    if (deps.isStale()) return
    deps.onUpdate({
      priorCases: result.records.map(mapCaseRecord),
      diagnostics: [{ type: "prior-cases", detail: `found ${result.records.length} prior case(s)` }],
    })
  } catch (e) {
    if (deps.isStale()) return
    deps.onUpdate({ diagnostics: [{ type: "prior-cases-error", detail: String(e) }] })
  }
  deps.onUpdate({ loadingPriorCases: false })
}

export async function loadCase(recordId: string, deps: LoadCaseDeps): Promise<void> {
  try {
    const rec = await deps.getRecord<Record<string, unknown>>("Case", recordId)
    deps.onUpdate({ caseRaw: rec })
    if (deps.isStale()) return

    const fieldMap = await deps.describeObject("Case").catch(() => null)
    if (deps.isStale()) return

    const diagnostics = createDiagLog()
    if (fieldMap) diagnostics.add("describe", `Case: ${fieldMap.size} fields`)
    const f = makeFieldAccessor(diagnostics, rec, fieldMap)

    const rawContactId = diagnostics.pick(rec, "ContactId")
    const caseData: CaseData = {
      caseNumber: f("Case Number", "CaseNumber") ?? "",
      status: f("Status", "Status") ?? "unknown",
      contactName: f("Contact Name", "Contact_Name__c") ?? "",
      contactEmail: f("Contact Email", "Contact_Email__c", "ContactEmail", "SuppliedEmail") ?? "",
      accountName: f("Account Name", "Contact_Name__c", "Contact_Preferred_Name__c") ?? "",
      accountId: diagnostics.pick(rec, "AccountId") ?? null,
      contactId: rawContactId,
      type: f("Type", "Type") ?? "",
      subType: f("Sub Type", "SubType__c", "Sub_Type__c") ?? "",
      subject: f("Subject", "Subject") ?? "",
    }
    deps.onUpdate({ caseData, diagnostics })

    const copId = f("Course Offering Participant", "Course_Offering_Participant__c", "CourseOfferingParticipant__c")
    let copCoId: string | null = null
    let copContactId: string | null = null
    let copAccountId: string | null = null
    let copEnrollmentId: string | null = null
    let copPreferredName: string | null = null

    if (copId) {
      const cop = await resolveCopToCoId(copId, deps)
      if (deps.isStale()) return
      copCoId = cop.coId
      copContactId = cop.contactId
      copAccountId = cop.accountId
      copEnrollmentId = cop.enrollmentId
      copPreferredName = cop.preferredName
    }

    const caseCoId = f("Course Offering", "Course_Offering__c", "CourseOffering__c")
    const resolvedCoId = copCoId ?? caseCoId
    const contactEmail = caseData.contactEmail

    const incidentRaw = f("Incident Type", "Incident_Type__c", "Type_of_Incident__c", "Category__c")
    const assignmentName = f("Assignment", "Assignment__c", "Assignment_Name__c")

    let canvas: CanvasState | null = null

    if (resolvedCoId || incidentRaw) {
      const dishonesty: DishonestyState = {
        courseOfferingId: resolvedCoId,
        courseOfferingName: null,
        incidentType: classifyIncident(incidentRaw),
        assignmentName,
        severity: f("Severity", "Severity__c"),
        instructor: f("Instructor", "Instructor_Name__c", "Instructor__c"),
        instructorEmail: f("Instructor Email", "Instructor_Email__c"),
      }
      deps.onUpdate({ dishonesty })

      if (resolvedCoId) {
        canvas = await resolveCanvasAndStudent({
          coId: resolvedCoId,
          preferredName: copPreferredName,
          accountId: copAccountId,
          contactId: copContactId,
          enrollmentId: copEnrollmentId,
          email: contactEmail,
          onName: (name) => { if (!deps.isStale()) deps.onUpdate({ dishonesty: { ...dishonesty, courseOfferingName: name } }) },
          canvas,
        }, deps)
      }
    }

    if (deps.isStale()) return

    const appealReason = f("Grade Appeal Reason", "Grade_Appeal_Reason__c", "GradeAppealReason__c")
    const currentGrade = f("Current Grade", "Current_Grade__c", "CurrentGrade__c")
    const changedGrade = f("Changed Grade", "Changed_Grade__c", "ChangedGrade__c")
    const decisionStatus = f("Decision Status", "Decision_Status__c", "DecisionStatus__c")

    if (appealReason || currentGrade || (copId && !canvas)) {
      const gradeAppeal: GradeAppealState = {
        courseOfferingId: resolvedCoId,
        courseOfferingName: null,
        courseOfferingParticipantId: copId,
        currentGrade,
        changedGrade,
        appealReason,
        decisionStatus,
        instructor: f("Instructor", "Instructor_Name__c", "Instructor__c"),
        instructorEmail: f("Instructor Email", "Instructor_Email__c"),
      }
      deps.onUpdate({ gradeAppeal })

      if (resolvedCoId && !canvas) {
        canvas = await resolveCanvasAndStudent({
          coId: resolvedCoId,
          preferredName: copPreferredName,
          accountId: copAccountId,
          contactId: copContactId,
          enrollmentId: copEnrollmentId,
          email: contactEmail,
          onName: (name) => { if (!deps.isStale()) deps.onUpdate({ gradeAppeal: { ...gradeAppeal, courseOfferingName: name } }) },
          canvas,
        }, deps)
      }
    }

    if (deps.isStale()) return

    if (resolvedCoId && !canvas) {
      canvas = await resolveCanvasAndStudent({
        coId: resolvedCoId,
        preferredName: copPreferredName,
        accountId: copAccountId,
        contactId: copContactId,
        enrollmentId: copEnrollmentId,
        email: contactEmail,
        onName: () => {},
        canvas,
      }, deps)
    }

    if (deps.isStale()) return

    const instructorName = f("Instructor", "Instructor_Name__c", "Instructor__c")
    const instructorEmail = f("Instructor Email", "Instructor_Email__c")
    const instructorRaw = diagnostics.pick(rec, "Instructor__c", "Instructor_Name__c")
    if (instructorName || instructorEmail || instructorRaw) {
      resolveInstructor(instructorName, instructorEmail, instructorRaw, canvas?.courseId ?? null, deps)
    }

    deps.onUpdate({ loading: false })

    if (canvas?.studentId) {
      const canMasquerade = await probeCanvasMasquerade(canvas.studentId, deps)
      if (!deps.isStale()) deps.onUpdate({ canMasquerade })
    }

    const resolvedContactId = rawContactId ?? copContactId
    diagnostics.add("prior-cases-contact", `rawContactId=${rawContactId ?? "null"} copContactId=${copContactId ?? "null"} resolved=${resolvedContactId ?? "null"}`)
    if (resolvedContactId) {
      loadPriorCases(resolvedContactId, recordId, deps)
    } else {
      deps.onUpdate({ diagnostics: [{ type: "prior-cases-skip", detail: "no contactId available — skipping SOQL query" }] })
    }

    deps.observeFields("Case", [])
    deps.observeCaseComplete({
      caseType: caseData.type,
      caseSubType: caseData.subType,
      diagnostics: [],
    })
  } catch (e) {
    if (deps.isStale()) return
    deps.onUpdate({ loading: false, error: e instanceof Error ? e.message : String(e) })
    console.error("[UEU] Failed to load case:", e)
  }
}
