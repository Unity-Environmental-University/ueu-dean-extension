/**
 * Overlay — the root component injected into Salesforce/Canvas pages.
 *
 * Everything renders inside the Shadow DOM so our styles apply.
 */

import { createSignal, createResource, Show } from "solid-js"
import browser from "webextension-polyfill"
import { CaseView } from "./CaseView"
import { AccountView } from "./AccountView"
import { CourseOfferingView } from "./CourseOfferingView"
import { getPermissions, setPermissions, revokeAll, getSettings, saveSettings } from "../content/permissions"
import { refresh, state } from "../content/core"
import { useStore } from "./useStore"

export function Overlay() {
  const [open, setOpen] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  const [sendStatus, setSendStatus] = createSignal<"idle" | "sending" | "sent" | "error">("idle")
  const [feedbackOpen, setFeedbackOpen] = createSignal(false)
  const [feedbackText, setFeedbackText] = createSignal("")
  const [feedbackStatus, setFeedbackStatus] = createSignal<"idle" | "sending" | "sent" | "error">("idle")
  const [drawerOpen, setDrawerOpen] = createSignal(false)

  // Load permissions and settings reactively
  const [perms, { refetch: refetchPerms }] = createResource(getPermissions)
  const [supportId, setSupportId] = createSignal("")
  getSettings().then(s => setSupportId(s.supportCanvasId))

  const get = useStore()
  const diagnostics = get("diagnostics")

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

  /** Hash SF IDs and names in diagnostic detail strings — keep field names and types readable */
  function safeDetail(detail: string): string {
    // Hash anything that looks like an SF ID (15 or 18 char alphanumeric starting with 0)
    return detail.replace(/\b0[a-zA-Z0-9]{14,17}\b/g, id => `[${hash(id)}]`)
                 .replace(/cop-name:(.+)/, (_, n) => `cop-name:[${hash(n)}]`)
                 .replace(/preferredName=(?!null)(\S+)/, (_, n) => `preferredName=[${hash(n)}]`)
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

  function buildDiagnosticText(): string {
    const s = state
    const lines: string[] = []
    lines.push(`[ueu-dean-tools diagnostic]`)
    lines.push(`[url] ${window.location.pathname}`)
    lines.push(`[page] ${JSON.stringify(s.page)}`)
    lines.push(``)

    lines.push(`[loading]`)
    lines.push(`  loading=${s.loading} loadingCO=${s.loadingCourseOffering} loadingStudent=${s.loadingStudent}`)
    lines.push(`  error=${s.error ?? "null"}`)
    lines.push(`  courseOfferingError=${s.courseOfferingError ?? "null"}`)
    lines.push(`  studentError=${s.studentError ?? "null"}`)
    lines.push(``)

    if (s.caseData) {
      lines.push(`[caseData]`)
      lines.push(`  caseNumber=${s.caseData.caseNumber}`)
      lines.push(`  status=${s.caseData.status}`)
      lines.push(`  type=${s.caseData.type} subType=${s.caseData.subType}`)
      lines.push(`  contactName=[${hash(s.caseData.contactName)}] contactEmail=[${hash(s.caseData.contactEmail)}]`)
      lines.push(`  accountName=[${hash(s.caseData.accountName)}]`)
      lines.push(``)
    }

    if (s.dishonesty) {
      lines.push(`[dishonesty]`)
      lines.push(`  incidentType=${s.dishonesty.incidentType}`)
      lines.push(`  courseOfferingId=${s.dishonesty.courseOfferingId ?? "null"}`)
      lines.push(`  courseOfferingName=${s.dishonesty.courseOfferingName ?? "null"}`)
      lines.push(`  assignmentName=${s.dishonesty.assignmentName ?? "null"}`)
      lines.push(`  severity=${s.dishonesty.severity ?? "null"}`)
      lines.push(``)
    }

    if (s.gradeAppeal) {
      lines.push(`[gradeAppeal]`)
      lines.push(`  courseOfferingId=${s.gradeAppeal.courseOfferingId ?? "null"}`)
      lines.push(`  courseOfferingName=${s.gradeAppeal.courseOfferingName ?? "null"}`)
      lines.push(`  copId=${s.gradeAppeal.courseOfferingParticipantId ?? "null"}`)
      lines.push(`  currentGrade=${s.gradeAppeal.currentGrade ?? "null"} changedGrade=${s.gradeAppeal.changedGrade ?? "null"}`)
      lines.push(`  decisionStatus=${s.gradeAppeal.decisionStatus ?? "null"}`)
      lines.push(``)
    }

    if (s.canvas) {
      lines.push(`[canvas]`)
      lines.push(`  courseId=${s.canvas.courseId}`)
      lines.push(`  studentId=${s.canvas.studentId ?? "null"}`)
      lines.push(`  studentName=${s.canvas.studentName ? `[${hash(s.canvas.studentName)}]` : "null"}`)
      lines.push(``)
    }

    if (s.diagnostics.length > 0) {
      lines.push(`[diagnostics]`)
      s.diagnostics.forEach(d => lines.push(`  ${d.type}: ${d.detail}`))
    }

    return lines.join("\n")
  }

  async function handleCopyState() {
    await navigator.clipboard.writeText(buildDiagnosticText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function sendCanvasMessage(subject: string, body: string, recipientId?: string) {
    const settings = await getSettings()
    const recipient = recipientId ?? settings.supportCanvasId
    if (!recipient) throw new Error("No support Canvas ID configured")
    await browser.runtime.sendMessage({ type: "canvas-message", recipientId: recipient, subject, body })
  }

  function caseTag() {
    const n = state.caseData?.caseNumber ?? state.page?.recordId ?? ""
    return n ? ` — case ${n}` : ""
  }

  async function handleSendDiagnostic() {
    const recipientId = supportId().trim()
    if (!recipientId) return
    setSendStatus("sending")
    try {
      await sendCanvasMessage(`Dean Tools diagnostic${caseTag()}`, buildDiagnosticText(), recipientId)
      setSendStatus("sent")
      setTimeout(() => setSendStatus("idle"), 3000)
    } catch {
      setSendStatus("error")
      setTimeout(() => setSendStatus("idle"), 3000)
    }
  }

  function handleSendFeedback() {
    const text = feedbackText().trim()
    if (!text) return

    const email = (typeof __FEEDBACK_EMAIL__ !== "undefined" ? __FEEDBACK_EMAIL__ : "") as string
    if (!email) return

    const subject = `Dean Tools feedback${caseTag()}`
    const telemetry = buildDiagnosticText()
    const body = [
      text,
      "",
      "---",
      "If you have a screenshot, please attach it to this email.",
      "",
      telemetry,
    ].join("\n")

    window.open(
      `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      "_blank"
    )

    setFeedbackText("")
    setFeedbackOpen(false)
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
          <dialog class="ueu-dialog" classList={{"ueu-dialog-drawer-open": drawerOpen()}} open onClick={e => e.stopPropagation()}>
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
                <Show when={state.page?.objectType === "Account"} fallback={
                  <Show when={state.page?.objectType === "CourseOffering"} fallback={
                    <CaseView onDrawerToggle={setDrawerOpen} />
                  }>
                    <CourseOfferingView />
                  </Show>
                }>
                  <AccountView />
                </Show>
              </section>
            </Show>

            <details class="ueu-dev">
              <summary>Dev</summary>
              <button onClick={handleCopyState} class={copied() ? "ueu-btn-copied" : ""}>
                {copied() ? "Copied!" : "Copy state"}
              </button>
              <small>Copies extension state — paste to Claude to debug field mapping</small>

              <Show when={state.copRaw}>
                <details class="ueu-dev-raw">
                  <summary>COP raw fields</summary>
                  <pre class="ueu-dev-raw-pre">{JSON.stringify(state.copRaw, null, 2)}</pre>
                </details>
              </Show>
              <Show when={state.contactRaw}>
                <details class="ueu-dev-raw">
                  <summary>Contact raw fields</summary>
                  <pre class="ueu-dev-raw-pre">{JSON.stringify(state.contactRaw, null, 2)}</pre>
                </details>
              </Show>
              <Show when={diagnostics().length > 0}>
                <details class="ueu-dev-raw">
                  <summary>
                    Diagnostics ({diagnostics().length})
                    {" "}<button
                      style={{"font-size": "0.65rem", "padding": "0.1rem 0.4rem", "margin-left": "0.5rem"}}
                      onClick={async (e) => {
                        e.stopPropagation()
                        await navigator.clipboard.writeText(diagnostics().map(d => `${d.type}: ${d.detail}`).join("\n"))
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      }}
                    >{copied() ? "Copied!" : "Copy"}</button>
                  </summary>
                  <pre class="ueu-dev-raw-pre">{diagnostics().map(d => `${d.type}: ${safeDetail(d.detail)}`).join("\n")}</pre>
                </details>
              </Show>

              <Show when={diagnostics().length > 0}>
                {(() => {
                  const diags = diagnostics()
                  const misses = diags.filter(d => d.type === "pick-miss" || d.type === "field-miss" || d.type === "field-unknown")
                  const hits = diags.filter(d => d.type === "pick-hit" || d.type === "field-hit")
                  const errors = diags.filter(d => d.type.endsWith("-error"))
                  const hasMismatches = misses.length > 0 || errors.length > 0
                  return (
                    <details class="ueu-dev-raw" open={hasMismatches}>
                      <summary style={{"color": hasMismatches ? "#f59e0b" : "#16a34a"}}>
                        Field Agreement ({hits.length} hit{hits.length !== 1 ? "s" : ""}, {misses.length} miss{misses.length !== 1 ? "es" : ""}, {errors.length} error{errors.length !== 1 ? "s" : ""})
                      </summary>
                      <div class="ueu-dev-raw-pre" style={{"font-size": "0.7rem", "line-height": "1.5"}}>
                        <Show when={misses.length > 0}>
                          <div style={{"color": "#f59e0b", "margin-bottom": "0.4rem"}}>
                            <strong>Mismatches</strong>
                            {misses.map(d => (
                              <div style={{"padding-left": "0.5rem"}}>
                                {d.type === "field-unknown" ? "⚠ unknown label" : d.type === "field-miss" ? "⚠ empty field" : "⚠ pick miss"}: {safeDetail(d.detail)}
                              </div>
                            ))}
                          </div>
                        </Show>
                        <Show when={errors.length > 0}>
                          <div style={{"color": "#dc2626", "margin-bottom": "0.4rem"}}>
                            <strong>Errors</strong>
                            {errors.map(d => (
                              <div style={{"padding-left": "0.5rem"}}>✗ {d.type}: {safeDetail(d.detail)}</div>
                            ))}
                          </div>
                        </Show>
                        <Show when={hits.length > 0}>
                          <div style={{"color": "#16a34a"}}>
                            <strong>Resolved ({hits.length})</strong>
                            {hits.map(d => (
                              <div style={{"padding-left": "0.5rem"}}>✓ {d.field ?? "?"}: {safeDetail(d.detail)}</div>
                            ))}
                          </div>
                        </Show>
                      </div>
                    </details>
                  )
                })()}
              </Show>

              <div class="ueu-dev-support">
                <label class="ueu-dev-label">Support Canvas ID</label>
                <input
                  class="ueu-dev-input"
                  type="text"
                  placeholder="Canvas user ID"
                  value={supportId()}
                  onInput={e => setSupportId(e.currentTarget.value)}
                  onBlur={() => saveSettings({ supportCanvasId: supportId().trim() })}
                />
                <button
                  onClick={handleSendDiagnostic}
                  disabled={!supportId().trim() || sendStatus() === "sending"}
                  class={sendStatus() === "sent" ? "ueu-btn-copied" : sendStatus() === "error" ? "ueu-btn-revoke" : ""}
                >
                  {sendStatus() === "sending" ? "Sending…" : sendStatus() === "sent" ? "Sent!" : sendStatus() === "error" ? "Failed" : "Send diagnostic"}
                </button>
              </div>

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
              <Show when={feedbackOpen()} fallback={
                <div class="ueu-footer-row">
                  <button onClick={() => setOpen(false)}>Close</button>
                  <a
                    class="ueu-btn-feedback"
                    href={browser.runtime.getURL("docs/index.html")}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Docs →
                  </a>
                  <Show when={typeof __FEEDBACK_EMAIL__ !== "undefined" && __FEEDBACK_EMAIL__}>
                    <button class="ueu-btn-feedback" onClick={() => setFeedbackOpen(true)}>
                      Feedback / request
                    </button>
                  </Show>
                </div>
              }>
                <div class="ueu-feedback">
                  <textarea
                    class="ueu-feedback-input"
                    placeholder="What's working, what's not, what would help…"
                    rows={3}
                    value={feedbackText()}
                    onInput={e => setFeedbackText(e.currentTarget.value)}
                  />
                  <div class="ueu-footer-row">
                    <button onClick={() => { setFeedbackOpen(false); setFeedbackText("") }}>Cancel</button>
                    <button
                      class="ueu-btn-consent"
                      disabled={!feedbackText().trim()}
                      onClick={handleSendFeedback}
                    >
                      Open in Mail →
                    </button>
                  </div>
                </div>
              </Show>
            </footer>
          </dialog>
        </div>
      </Show>
    </>
  )
}
