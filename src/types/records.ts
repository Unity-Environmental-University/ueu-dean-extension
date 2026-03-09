/**
 * Domain types for Salesforce case records.
 *
 * Salt types precipitate once and become concrete TypeScript.
 * Volatile types re-precipitate every decohere run.
 */

import type { Salt, Volatile } from "alkahest-ts"

// Domain types — we know the shape, let decohere confirm and freeze it
export interface CaseRecord extends Salt {
  id: string
  studentToken: string
  status: "open" | "pending" | "resolved"
  createdAt: string
  caseNumber?: string
}

export interface DishonestyCaseRecord extends Salt {
  id: string
  studentToken: string
  status: "open" | "pending" | "resolved"
  createdAt: string
  caseNumber?: string
  courseId: string
  incidentType: "plagiarism" | "cheating" | "fabrication" | "other"
  assignmentName?: string
  policyReference?: string
}

// Parse surface — Salesforce DOM shifts constantly, always re-observe
export type ParsePage = Volatile
