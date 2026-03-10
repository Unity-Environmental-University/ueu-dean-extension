/**
 * Overlay — the root component injected into Salesforce/Canvas pages.
 *
 * Everything renders inside the Shadow DOM so our styles apply.
 */

import { createSignal, createResource, Show } from "solid-js"
import { CanvasLink } from "./CanvasLink"
import { getPermissions, setPermissions, revokeAll } from "../content/permissions"
import { refresh } from "../content/features"

export function Overlay() {
  const [open, setOpen] = createSignal(false)
  const [copied, setCopied] = createSignal(false)

  // Load permissions reactively
  const [perms, { refetch: refetchPerms }] = createResource(getPermissions)

  const hasConsent = () => perms()?.sfApi ?? false

  async function grantSfApi() {
    await setPermissions({ sfApi: true })
    await refetchPerms()
    refresh()
  }

  async function revokeSfApi() {
    await revokeAll()
    await refetchPerms()
  }

  /** Hash a string to a short hex token — same input = same output, no PII leaks */
  function hash(text: string): string {
    let h = 0
    for (let i = 0; i < text.length; i++) {
      h = ((h << 5) - h + text.charCodeAt(i)) | 0
    }
    return (h >>> 0).toString(16).padStart(8, "0")
  }

  /** Returns true if this element is a label (keep as-is), false if it's a value (hash it) */
  function isLabel(el: Element | null): boolean {
    if (!el) return false
    return el.matches(
      "span.test-id__field-label, .slds-form-element__label, dt, label, h1, h2, h3, h4, " +
      "summary, legend, th, .slds-text-title, .slds-section__title, .slds-truncate, " +
      ".slds-assistive-text, button, a[class*='tab']"
    )
  }

  /** Redact text: if parent is a value element, hash it. Labels pass through. */
  function safeText(text: string, parent: Element | null): string {
    if (!text.trim()) return ""
    if (parent && isLabel(parent)) return text.trim()
    return `[${hash(text.trim())}]`
  }

  async function handleCapture() {
    const lines: string[] = []
    lines.push(`[url] ${window.location.pathname}`)

    const h3s = document.querySelectorAll("h3")
    lines.push(`\n## Sections (${h3s.length}):`)
    h3s.forEach(h => lines.push(`  - "${safeText(h.textContent ?? "", h)}" parent: <${h.parentElement?.tagName.toLowerCase()} class="${h.parentElement?.className?.slice(0, 80)}">`))

    const allLabels = new Map<string, string>()

    document.querySelectorAll("span.test-id__field-label").forEach(el => {
      const label = el.textContent?.trim() ?? ""
      if (!label || allLabels.has(label)) return
      const item = el.closest("records-record-layout-item, .slds-form-element")
      const valEl = item?.querySelector("lightning-formatted-text, .slds-form-element__static")
      const raw = valEl?.textContent?.trim()
      allLabels.set(label, raw ? hash(raw) : "[NO VALUE]")
    })

    document.querySelectorAll("dt").forEach(dt => {
      const label = dt.textContent?.trim()?.replace(/:$/, "") ?? ""
      if (!label || allLabels.has(label)) return
      const dd = dt.nextElementSibling
      const raw = dd?.tagName === "DD" ? dd.textContent?.trim() : null
      allLabels.set(label, raw ? hash(raw) : "[NO DD]")
    })

    lines.push(`\n## All fields (${allLabels.size}):`)
    allLabels.forEach((v, k) => lines.push(`  - ${k}: ${v}`))

    for (const h3 of h3s) {
      if (!h3.textContent?.includes("Academic Dishonesty")) continue
      const section = h3.closest(".slds-section")
      if (!section) continue
      lines.push(`\n## Academic Dishonesty section inner tags:`)
      const tags = new Map<string, number>()
      section.querySelectorAll("*").forEach(el => {
        const t = el.tagName.toLowerCase()
        tags.set(t, (tags.get(t) ?? 0) + 1)
      })
      tags.forEach((count, tag) => lines.push(`  - <${tag}> x${count}`))

      lines.push(`\n## Academic Dishonesty section text:`)
      const sw = document.createTreeWalker(section, NodeFilter.SHOW_TEXT)
      let sn: Node | null
      while (sn = sw.nextNode()) {
        const t = sn.textContent?.trim()
        if (!t) continue
        const p = sn.parentElement
        lines.push(`  - "${safeText(t, p)}" in <${p?.tagName.toLowerCase()} class="${p?.className?.toString().slice(0, 60)}">`)
      }
    }

    await navigator.clipboard.writeText(lines.join("\n"))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        class="ueu-fab"
        title="UEU Dean Tools"
      >
        U
      </button>

      <Show when={open()}>
        <div class="ueu-backdrop" onClick={() => setOpen(false)}>
          <dialog class="ueu-dialog" open onClick={e => e.stopPropagation()}>
            <header>
              <h2>Dean Tools</h2>
            </header>

            <Show when={hasConsent()} fallback={
              <section class="ueu-consent">
                <h3>Permissions Required</h3>
                <p>
                  This extension reads your Salesforce case records using your
                  active session to show case details and link to Canvas courses.
                </p>
                <ul>
                  <li>Reads case and course offering records via the Salesforce API</li>
                  <li>Uses your existing Salesforce session cookie for authentication</li>
                  <li>All data stays in your browser — nothing is sent to external servers</li>
                  <li>Student names are never stored or logged</li>
                </ul>
                <button class="ueu-btn-consent" onClick={grantSfApi}>
                  I understand — enable Salesforce access
                </button>
              </section>
            }>
              <section>
                <CanvasLink />
              </section>
            </Show>

            <details class="ueu-dev">
              <summary>Dev</summary>
              <button onClick={async () => {
                const step = window.innerHeight
                const max = document.body.scrollHeight
                for (let y = 0; y <= max; y += step) {
                  window.scrollTo(0, y)
                  await new Promise(r => setTimeout(r, 400))
                }
                window.scrollTo(0, 0)
                await new Promise(r => setTimeout(r, 500))
                handleCapture()
              }} class={copied() ? "ueu-btn-copied" : ""}>
                {copied() ? "Copied!" : "Capture page"}
              </button>
              <small>Scrolls the full page to load all sections, then captures</small>

              <Show when={hasConsent()}>
                <button onClick={revokeSfApi} class="ueu-btn-revoke">
                  Revoke Salesforce access
                </button>
              </Show>
            </details>

            <footer>
              <button onClick={() => setOpen(false)}>Close</button>
            </footer>
          </dialog>
        </div>
      </Show>
    </>
  )
}
