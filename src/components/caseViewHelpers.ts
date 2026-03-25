/**
 * caseViewHelpers.ts — shared constants and formatting for case view components.
 */

const SKIP = new Set(["a", "an", "the", "of", "from", "and", "or", "in", "at", "to"])

const ABBREV: Record<string, string> = {
  "distance education": "DE",
}

export const INCIDENT_LABELS: Record<string, string> = {
  plagiarism: "Plagiarism",
  cheating: "Cheating",
  fabrication: "Fabrication",
  other: "Other",
}

export function acronym(phrase: string): string {
  const known = ABBREV[phrase.toLowerCase()]
  if (known) return known
  return phrase
    .split(/\s+/)
    .filter(w => !SKIP.has(w.toLowerCase()))
    .map(w => w[0].toUpperCase() + w.slice(1, 3).toLowerCase())
    .join(" ")
}
