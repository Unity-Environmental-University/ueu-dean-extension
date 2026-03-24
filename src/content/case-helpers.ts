/**
 * case-helpers.ts — pure utility functions for case loading.
 *
 * No dependencies, no side effects. Easy to test in isolation.
 */

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
