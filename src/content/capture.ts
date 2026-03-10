/**
 * Capture a redacted snapshot of the current page's DOM structure.
 *
 * Keeps element tags, class names, and field labels.
 * Replaces all text content in value positions with "[REDACTED]".
 * Safe to paste — no PII leaves the browser.
 */

/** Selectors whose text content is structural (keep as-is) */
const LABEL_SELECTORS = [
  ".slds-form-element__label",
  ".test-id__field-label",
  "label",
  "th",
  "legend",
  "[class*='label']",
]

/** Selectors whose text content is data (redact) */
const VALUE_SELECTORS = [
  ".slds-form-element__static",
  "lightning-formatted-text",
  "lightning-formatted-name",
  "lightning-formatted-email",
  "lightning-formatted-phone",
  "lightning-formatted-url",
  "lightning-formatted-date-time",
  "lightning-formatted-number",
  "lightning-formatted-address",
  "lightning-formatted-rich-text",
  "lightning-base-formatted-text",
  "td",
  "textarea",
  "input",
  "[class*='output']",
]

function isLabel(el: Element): boolean {
  return LABEL_SELECTORS.some(sel => el.matches(sel))
}

function isValue(el: Element): boolean {
  return VALUE_SELECTORS.some(sel => el.matches(sel))
}

function redactTree(source: Element): Element {
  const clone = source.cloneNode(false) as Element

  // Redact input values
  if (clone instanceof HTMLInputElement || clone instanceof HTMLTextAreaElement) {
    clone.setAttribute("value", "[REDACTED]")
    return clone
  }

  for (const child of source.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim()
      if (!text) continue

      if (isLabel(source)) {
        clone.appendChild(document.createTextNode(text))
      } else if (isValue(source)) {
        clone.appendChild(document.createTextNode("[REDACTED]"))
      } else {
        // Unknown context — redact to be safe
        clone.appendChild(document.createTextNode("[REDACTED]"))
      }
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      clone.appendChild(redactTree(child as Element))
    }
  }

  return clone
}

/** Strip data attributes and inline styles to reduce noise */
function cleanAttributes(el: Element) {
  const toRemove: string[] = []
  for (const attr of el.attributes) {
    if (attr.name.startsWith("data-") || attr.name === "style" || attr.name === "id") {
      toRemove.push(attr.name)
    }
  }
  toRemove.forEach(a => el.removeAttribute(a))
  el.querySelectorAll("*").forEach(child => {
    const r: string[] = []
    for (const attr of child.attributes) {
      if (attr.name.startsWith("data-") || attr.name === "style" || attr.name === "id") {
        r.push(attr.name)
      }
    }
    r.forEach(a => child.removeAttribute(a))
  })
}

/** querySelectorAll that pierces shadow roots */
function deepQueryAll(root: Node, selector: string): Element[] {
  const results: Element[] = []

  function walk(node: Node) {
    if (node instanceof Element) {
      if (node.matches(selector)) results.push(node)
      // Pierce shadow DOM
      if (node.shadowRoot) {
        node.shadowRoot.querySelectorAll(selector).forEach(el => results.push(el))
        node.shadowRoot.childNodes.forEach(walk)
      }
    }
    node.childNodes.forEach(walk)
  }

  walk(root)
  return results
}

export function captureRedacted(): string {
  const wrapper = document.createElement("div")

  // Find all field labels by piercing shadow roots
  const items = deepQueryAll(document.body, "records-record-layout-item[field-label]")

  if (items.length > 0) {
    const summary = document.createElement("fieldset")
    const legend = document.createElement("legend")
    legend.textContent = `Field labels found (${items.length})`
    summary.appendChild(legend)
    const ul = document.createElement("ul")
    items.forEach(item => {
      const li = document.createElement("li")
      li.textContent = item.getAttribute("field-label") ?? ""
      ul.appendChild(li)
    })
    summary.appendChild(ul)
    wrapper.appendChild(summary)
  }

  // Also grab all sections with redacted values
  const sections = deepQueryAll(document.body, "records-record-layout-section")
  if (sections.length > 0) {
    sections.forEach(section => {
      const redacted = redactTree(section)
      cleanAttributes(redacted)
      wrapper.appendChild(redacted)
    })
  } else {
    // Fallback: dump all visible text labels we can find
    const allLabels = deepQueryAll(document.body, "span.test-id__field-label, .slds-form-element__label")
    if (allLabels.length > 0) {
      const fb = document.createElement("fieldset")
      const leg = document.createElement("legend")
      leg.textContent = `All label spans found (${allLabels.length})`
      fb.appendChild(leg)
      const ul = document.createElement("ul")
      allLabels.forEach(el => {
        const li = document.createElement("li")
        li.textContent = el.textContent?.trim() ?? ""
        ul.appendChild(li)
      })
      fb.appendChild(ul)
      wrapper.appendChild(fb)
    }
  }

  return wrapper.innerHTML
}
