/** Shared field formatting utilities */

/** Strip human-readable date suffix from internal term codes.
 *  e.g. "DE5W04.07.25- April 7, 2025" → "DE5W04.07.25" */
export function cleanTermName(name: string | null): string | null {
  if (!name) return null
  return name.replace(/\s*-\s*[A-Za-z].*$/, "").trim()
}
