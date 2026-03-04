/**
 * Salesforce Lightning page DOM utilities.
 *
 * Reads data from the current SF Lightning record page.
 * Called lazily — only when the dean opens the modal, never continuously.
 */

export interface SalesforcePageContext {
  recordId: string | null
  courseId: string | null
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
 *
 * Lightning renders fields as:
 *   <lightning-output-field> or <records-record-layout-item>
 *     containing a label and a value element.
 *
 * We find the label by text content, then grab the nearest value.
 */
function getFieldByLabel(label: string): string | null {
  // Try lightning-formatted-text siblings of matching label spans
  const spans = document.querySelectorAll(
    "records-record-layout-item span.test-id__field-label, " +
    "lightning-output-field span, " +
    ".slds-form-element__label"
  )

  for (const span of spans) {
    if (span.textContent?.trim().toLowerCase() === label.toLowerCase()) {
      // Walk up to the field container then find the value
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
 * Read the current page context. Call this once when the modal opens.
 */
export function readPageContext(): SalesforcePageContext {
  return {
    recordId: getRecordIdFromUrl(),
    courseId: getFieldByLabel("Course ID"),
  }
}
