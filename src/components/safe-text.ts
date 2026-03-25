/**
 * safe-text.ts — FERPA-safe text hashing for diagnostics and page capture.
 *
 * Hashes SF IDs, student names, and field values so diagnostic output
 * can be shared without exposing PII.
 */

/** Hash a string to a short hex token — same input = same output, no PII leaks */
export function hash(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

/** Hash SF IDs and names in diagnostic detail strings — keep field names and types readable */
export function safeDetail(detail: string): string {
  return detail.replace(/\b0[a-zA-Z0-9]{14,17}\b/g, id => `[${hash(id)}]`)
               .replace(/cop-name:(.+)/, (_, n) => `cop-name:[${hash(n)}]`)
               .replace(/preferredName=(?!null)(\S+)/, (_, n) => `preferredName=[${hash(n)}]`)
}

/** Returns true if this element is a label (keep as-is), false if it's a value (hash it) */
export function isLabel(el: Element | null): boolean {
  if (!el) return false
  return el.matches(
    "span.test-id__field-label, .slds-form-element__label, dt, label, h1, h2, h3, h4, " +
    "summary, legend, th, .slds-text-title, .slds-section__title, .slds-truncate, " +
    ".slds-assistive-text, button, a[class*='tab']"
  )
}

/** Redact text: if parent is a value element, hash it. Labels pass through. */
export function safeText(text: string, parent: Element | null): string {
  if (!text.trim()) return ""
  if (parent && isLabel(parent)) return text.trim()
  return `[${hash(text.trim())}]`
}
