/**
 * Usage specification for @decohere types in src/types/records.ts.
 *
 * This file is NOT part of the application build — it lives in scripts/
 * so it doesn't go through tsconfig.app.json. Its purpose is to give
 * decohere concrete property-access patterns to infer type shapes from.
 *
 * Write code here the way you'd want to use the type once it's real.
 * The TS compiler API extractor finds these patterns and feeds them to
 * the model as inferred constraints.
 *
 * Delete this file once src/generated/ types are accepted and the real
 * types replace the stubs.
 */

// @ts-nocheck — types are unknown stubs until decohere generates them

import type { CaseRecord, DishonestyCaseRecord, ParsePage } from "../src/types/records"

// --- CaseRecord usage ---

function displayCase(c: CaseRecord): string {
  return `[${c.caseNumber ?? c.id}] ${c.studentName} — ${c.status} (opened ${c.createdAt})`
}

function isCaseOpen(c: CaseRecord): boolean {
  return c.status === "open"
}

function sortByCaseDate(cases: CaseRecord[]): CaseRecord[] {
  return cases.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

// --- DishonestyCaseRecord usage ---

function formatDishonesty(d: DishonestyCaseRecord): string {
  const assignment = d.assignmentName ? ` on "${d.assignmentName}"` : ""
  return `${d.studentName}: ${d.incidentType}${assignment} in course ${d.courseId} — policy ${d.policyReference} (${d.status})`
}

function isCourseMatch(d: DishonestyCaseRecord, courseId: string): boolean {
  return d.courseId === courseId
}

function isPlagiarism(d: DishonestyCaseRecord): boolean {
  return d.incidentType === "plagiarism"
}

// --- ParsePage usage ---

function tryParse(parsePage: ParsePage, rawText: string): DishonestyCaseRecord | null {
  const result = parsePage(rawText)
  if (result === undefined) return null   // not a case page
  return result                           // null = case but not dishonesty, or the record
}
