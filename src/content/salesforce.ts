/**
 * Salesforce Lightning page DOM utilities.
 *
 * Reads data from the current SF Lightning record page.
 * PII is hashed at the parse boundary — nothing downstream ever sees real names.
 */

import type { DishonestyCaseRecord } from "../types/records"

export interface SalesforcePageContext {
  recordId: string | null
  courseId: string | null
  caseRecord: DishonestyCaseRecord | null | undefined
}

/**
 * Extract the SF record ID from the Lightning URL.
 * URL pattern: /lightning/r/ObjectName/recordId/view
 */
function getRecordIdFromUrl(): string | null {
  const match = window.location.pathname.match(/\/lightning\/r\/[^/]+\/([a-zA-Z0-9]+)\/view/)
  return match?.[1] ?? null
}

/**
 * Find a field value on a Lightning record page by its label text.
 */
function getFieldByLabel(label: string): string | null {
  const spans = document.querySelectorAll(
    "records-record-layout-item span.test-id__field-label, " +
    "lightning-output-field span, " +
    ".slds-form-element__label"
  )

  for (const span of spans) {
    if (span.textContent?.trim().toLowerCase() === label.toLowerCase()) {
      const container = span.closest(
        "records-record-layout-item, lightning-output-field, .slds-form-element"
      )
      if (!container) continue

      const value =
        container.querySelector("lightning-formatted-text")?.textContent?.trim() ??
        container.querySelector(".slds-form-element__static")?.textContent?.trim() ??
        null

      if (value) return value
    }
  }

  return null
}

/**
 * One-way hash for PII. Same input always produces the same token,
 * so we can correlate cases for the same student without storing names.
 */
async function anonymize(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw.toLowerCase().trim())
  const hash = await crypto.subtle.digest("SHA-256", data)
  const bytes = new Uint8Array(hash)
  return Array.from(bytes.slice(0, 8), b => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Classify the incident type from Salesforce field text.
 */
function classifyIncident(raw: string | null): DishonestyCaseRecord["incidentType"] {
  if (!raw) return "other"
  const lower = raw.toLowerCase()
  if (lower.includes("plagiari")) return "plagiarism"
  if (lower.includes("cheat")) return "cheating"
  if (lower.includes("fabricat")) return "fabrication"
  return "other"
}

/**
 * Normalize status text from Salesforce into our union.
 */
function normalizeStatus(raw: string | null): DishonestyCaseRecord["status"] {
  if (!raw) return "open"
  const lower = raw.toLowerCase()
  if (lower.includes("resolved") || lower.includes("closed")) return "resolved"
  if (lower.includes("pending") || lower.includes("review")) return "pending"
  return "open"
}

/**
 * Parse the current Salesforce page into an anonymized DishonestyCaseRecord.
 *
 * Returns:
 *   DishonestyCaseRecord — if this is a dishonesty case page
 *   null — if it's a case page but not a dishonesty case
 *   undefined — if the page can't be parsed as a case at all
 *
 * PII (student name) is hashed here and never leaves this function.
 */
export async function parsePage(): Promise<DishonestyCaseRecord | null | undefined> {
  const recordId = getRecordIdFromUrl()
  if (!recordId) return undefined

  const caseNumber = getFieldByLabel("Case Number")
  const studentName = getFieldByLabel("Student Name") ?? getFieldByLabel("Contact Name")
  const statusRaw = getFieldByLabel("Status")
  const createdAt = getFieldByLabel("Date/Time Opened") ?? getFieldByLabel("Created Date") ?? ""
  const courseId = getFieldByLabel("Course ID") ?? getFieldByLabel("Course")
  const incidentRaw = getFieldByLabel("Incident Type") ?? getFieldByLabel("Type") ?? getFieldByLabel("Category")
  const assignmentName = getFieldByLabel("Assignment Name") ?? getFieldByLabel("Assignment")
  const policyReference = getFieldByLabel("Policy Reference") ?? getFieldByLabel("Policy") ?? getFieldByLabel("Violation Code")

  // If there's no course ID or incident info, this probably isn't a dishonesty case
  if (!courseId && !incidentRaw) {
    return studentName ? null : undefined
  }

  const studentToken = studentName ? await anonymize(studentName) : "unknown"

  return {
    id: recordId,
    studentToken,
    status: normalizeStatus(statusRaw),
    createdAt,
    caseNumber: caseNumber ?? undefined,
    courseId: courseId ?? "",
    incidentType: classifyIncident(incidentRaw),
    assignmentName: assignmentName ?? undefined,
    policyReference: policyReference ?? undefined,
  }
}

/**
 * Read the current page context. Call this once when the modal opens.
 */
export async function readPageContext(): Promise<SalesforcePageContext> {
  const recordId = getRecordIdFromUrl()
  const caseRecord = await parsePage()

  return {
    recordId,
    courseId: caseRecord?.courseId ?? getFieldByLabel("Course ID"),
    caseRecord,
  }
}
