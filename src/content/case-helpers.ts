/**
 * case-helpers.ts — pure utility functions for case loading.
 *
 * No dependencies, no side effects. Easy to test in isolation.
 */

import { cleanTermName } from "./field-utils"
import type { PriorCase } from "./case-types"

// ── SOQL case query builder ──────────────────────────────────────────────────

/** Fields selected in every case list query */
const CASE_LIST_FIELDS = [
  "Id", "CaseNumber", "Subject", "Type", "SubType__c", "Status", "CreatedDate",
  "Course_Offering__c",
  "Course_Offering__r.Name",
  "Course_Offering__r.Academic_Term_Display_Name__c",
].join(", ")

export interface CaseQueryOpts {
  where: string
  limit?: number
}

/** Build a SOQL query for case lists. Caller supplies the WHERE clause. */
export function buildCaseListQuery(opts: CaseQueryOpts): string {
  const limit = opts.limit ?? 100
  return `SELECT ${CASE_LIST_FIELDS} FROM Case WHERE ${opts.where} ORDER BY CreatedDate DESC LIMIT ${limit}`
}

/** Raw shape returned by SF for a case list query */
export interface CaseListRecord {
  Id: string
  CaseNumber: string
  Subject: string | null
  Type: string | null
  SubType__c: string | null
  Status: string | null
  CreatedDate: string
  Course_Offering__c: string | null
  Course_Offering__r?: { Name?: string; Academic_Term_Display_Name__c?: string }
}

/** Map a raw SF case record to a PriorCase */
export function mapCaseRecord(r: CaseListRecord): PriorCase {
  return {
    id: r.Id,
    caseNumber: r.CaseNumber,
    subject: r.Subject ?? null,
    type: r.Type ?? "Unknown",
    subType: r.SubType__c,
    status: r.Status ?? "Unknown",
    createdDate: r.CreatedDate,
    courseName: r.Course_Offering__r?.Name ?? null,
    courseCode: extractCourseCode(r.Course_Offering__r?.Name ?? null),
    courseOfferingId: r.Course_Offering__c ?? null,
    termName: cleanTermName(r.Course_Offering__r?.Academic_Term_Display_Name__c ?? null),
  }
}

/** Classify a raw incident type string into a normalized category */
export function classifyIncident(raw: string | null): string {
  if (!raw) return "other"
  const lower = raw.toLowerCase()
  if (lower.includes("plagiari")) return "plagiarism"
  if (lower.includes("cheat")) return "cheating"
  if (lower.includes("fabricat")) return "fabrication"
  return "other"
}

/** Find an exact email match in a Canvas user search result */
export function findExactEmailMatch(
  users: Array<{ id: number; name: string; email?: string; login_id?: string }>,
  email: string,
): { id: number; name: string } | null {
  const lower = email.toLowerCase()
  const exact = users.find(u =>
    u.email?.toLowerCase() === lower || u.login_id?.toLowerCase() === lower
  )
  if (exact) return exact
  if (users.length === 1) return users[0]
  return null
}

/** Extract a course code like "BIO101 - 01" from a course offering name */
export function extractCourseCode(name: string | null): string | null {
  if (!name) return null
  const match = name.match(/([A-Z]{3,4}\d{3,4}).*\s-\s(\d+)/i)
  return match ? `${match[1]} - ${match[2]}` : null
}
