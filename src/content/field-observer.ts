/**
 * Field observer — watches for Salesforce Lightning fields to appear in the DOM.
 *
 * Features register triggers (field labels they care about). When those fields
 * appear (via lazy load, navigation, etc.), the feature activates with the values.
 *
 * No scrolling. No parsing the whole page. Just react to what shows up.
 */

export interface FieldTrigger {
  /** Unique name for this feature */
  name: string
  /** Field labels that activate this feature (any one is enough) */
  activateOn: string[]
  /** Additional fields to read when activated */
  alsoRead?: string[]
  /** Called when the trigger fires. Values are raw strings — PII handling is the feature's job. */
  onActivate: (fields: Record<string, string>) => void
  /** Called if the trigger fields disappear (SPA navigation) */
  onDeactivate?: () => void
}

const triggers: FieldTrigger[] = []
const activeFeatures = new Set<string>()

/** Read a field value by its label, from the current DOM */
function readField(label: string): string | null {
  const lower = label.toLowerCase()

  // Attribute selector
  const items = document.querySelectorAll("records-record-layout-item[field-label]")
  for (const item of items) {
    if (item.getAttribute("field-label")?.toLowerCase() === lower) {
      const val = extractValue(item)
      if (val) return val
    }
  }

  // Span scan
  const spans = document.querySelectorAll("span.test-id__field-label")
  for (const span of spans) {
    if (span.textContent?.trim().toLowerCase() !== lower) continue
    const container = span.closest("records-record-layout-item, .slds-form-element")
    if (!container) continue
    const val = extractValue(container)
    if (val) return val
  }

  return null
}

function extractValue(container: Element): string | null {
  const selectors = [
    "lightning-formatted-text",
    "lightning-formatted-name",
    "lightning-formatted-date-time",
    "lightning-formatted-url",
    "lightning-formatted-number",
    ".slds-form-element__static",
  ]
  for (const sel of selectors) {
    const el = container.querySelector(sel)
    const text = el?.textContent?.trim()
    if (text) return text
  }
  return null
}

/** Check if a section header exists */
function hasSection(name: string): boolean {
  const h3s = document.querySelectorAll("h3")
  for (const h3 of h3s) {
    if (h3.textContent?.trim().includes(name)) return true
  }
  return false
}

/** Scan the DOM and fire/defire triggers */
function scan() {
  // Collect all visible field labels
  const visibleLabels = new Set<string>()
  document.querySelectorAll("span.test-id__field-label").forEach(el => {
    const text = el.textContent?.trim().toLowerCase()
    if (text) visibleLabels.add(text)
  })
  document.querySelectorAll("records-record-layout-item[field-label]").forEach(el => {
    const text = el.getAttribute("field-label")?.toLowerCase()
    if (text) visibleLabels.add(text)
  })
  // Also count section headers as "labels"
  document.querySelectorAll("h3").forEach(el => {
    const text = el.textContent?.trim()
    if (text) visibleLabels.add(`section:${text.toLowerCase()}`)
  })

  for (const trigger of triggers) {
    const shouldBeActive = trigger.activateOn.some(label => {
      const lower = label.toLowerCase()
      return visibleLabels.has(lower) || visibleLabels.has(`section:${lower}`)
    })

    if (shouldBeActive && !activeFeatures.has(trigger.name)) {
      // Activate: read all requested fields
      const allLabels = [...trigger.activateOn, ...(trigger.alsoRead ?? [])]
      const fields: Record<string, string> = {}
      for (const label of allLabels) {
        const value = readField(label)
        if (value) fields[label] = value
      }
      activeFeatures.add(trigger.name)
      trigger.onActivate(fields)
    } else if (!shouldBeActive && activeFeatures.has(trigger.name)) {
      activeFeatures.delete(trigger.name)
      trigger.onDeactivate?.()
    }
  }
}

let observer: MutationObserver | null = null

export function registerTrigger(trigger: FieldTrigger) {
  triggers.push(trigger)
  // Run an immediate scan in case fields are already present
  scan()
}

export function startObserving() {
  // Initial scan
  scan()

  // Watch for DOM changes (lazy loads, SPA navigation)
  observer = new MutationObserver(() => scan())
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
}

export function stopObserving() {
  observer?.disconnect()
  observer = null
}

/** Utility: read a field right now (for use outside triggers) */
export { readField }
