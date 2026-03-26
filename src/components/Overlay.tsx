/**
 * Overlay — the root component injected into Salesforce/Canvas pages.
 *
 * Composes: CaseView, AccountView, CourseOfferingView, DevTools, FeedbackFooter.
 * Everything renders inside the Shadow DOM so our styles apply.
 */

import { createSignal, createEffect, createResource, Show } from "solid-js"
import browser from "webextension-polyfill"
import { CaseView } from "./CaseView"
import { createHistoryState, HistoryPanel } from "./HistoryDrawer"
import { AccountView } from "./AccountView"
import { CourseOfferingView } from "./CourseOfferingView"
import { DevTools } from "./DevTools"
import { FeedbackFooter } from "./FeedbackFooter"
import { hash, safeText } from "./safe-text"
import { getPermissions, setPermissions, revokeAll, getSettings } from "../content/permissions"
import { refresh, state } from "../content/core"
import { useStore } from "./useStore"

const UPDATE_CHECK_URL = "https://raw.githubusercontent.com/Unity-Environmental-University/ueu-dean-extension/main/manifest.json"

export function Overlay() {
  const [open, setOpen] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  const [sendStatus, setSendStatus] = createSignal<"idle" | "sending" | "sent" | "error">("idle")
  const [drawerOpen, setDrawerOpen] = createSignal(false)
  const [updateAvailable, setUpdateAvailable] = createSignal<string | null>(null)
  const historyState = createHistoryState()

  const [perms, { refetch: refetchPerms }] = createResource(getPermissions)
  const [supportId, setSupportId] = createSignal("")
  getSettings().then(s => setSupportId(s.supportCanvasId))

  // Check for updates once on load
  const installedVersion = browser.runtime.getManifest().version
  fetch(UPDATE_CHECK_URL, { cache: "no-store" })
    .then(r => r.json())
    .then(m => { if (m.version && m.version !== installedVersion) setUpdateAvailable(m.version) })
    .catch(() => { /* silent — update check is best-effort */ })

  const get = useStore()
  const diagnostics = get("diagnostics")
  const page = get("page")

  // Reset history filters + close drawer when navigating to a new page
  createEffect(() => {
    page()  // track page changes
    historyState.setSubTypeFilter("")
    historyState.setStatusFilter("")
    setDrawerOpen(false)
    historyState.setDrawerOpen(false)
  })

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

    // Field names (FERPA-safe — keys only, no values)
    const rawSources: Array<[string, Record<string, unknown> | null]> = [
      ["Case", s.caseRaw],
      ["CourseOffering", s.coRaw],
      ["COP", s.copRaw],
      ["Contact/Account", s.contactRaw],
    ]
    for (const [label, raw] of rawSources) {
      if (!raw) continue
      const keys = Object.keys(raw).sort()
      lines.push(`\n[${label} fields (${keys.length})]`)
      lines.push(keys.join(", "))
    }

    return lines.join("\n")
  }

  async function handleCopyState() {
    await navigator.clipboard.writeText(buildDiagnosticText())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
      const settings = await getSettings()
      const recipient = recipientId ?? settings.supportCanvasId
      if (!recipient) throw new Error("No support Canvas ID configured")
      await browser.runtime.sendMessage({ type: "canvas-message", recipientId: recipient, subject: `Dean Tools diagnostic${caseTag()}`, body: buildDiagnosticText() })
      setSendStatus("sent")
      setTimeout(() => setSendStatus("idle"), 3000)
    } catch {
      setSendStatus("error")
      setTimeout(() => setSendStatus("idle"), 3000)
    }
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
          <div class="ueu-dialog-wrap" onClick={e => e.stopPropagation()}>
            <div class="ueu-dialog-main" classList={{"ueu-dialog-drawer-open": drawerOpen()}}>
            <header>
              <h2>Dean Tools</h2>
            </header>

            <Show when={updateAvailable()}>
              <div class="ueu-update-banner">
                v{updateAvailable()} available (you have v{installedVersion}).{" "}
                <a href="https://unity-environmental-university.github.io/ueu-dean-extension/update.html" target="_blank" rel="noopener noreferrer">How to update</a>
              </div>
            </Show>

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
                <Show when={page()?.objectType === "Account"} fallback={
                  <Show when={page()?.objectType === "CourseOffering"} fallback={
                    <CaseView historyState={historyState} onDrawerToggle={setDrawerOpen} />
                  }>
                    <CourseOfferingView />
                  </Show>
                }>
                  <AccountView />
                </Show>
              </section>
            </Show>

            <DevTools
              diagnostics={diagnostics}
              copied={copied}
              setCopied={setCopied}
              sendStatus={sendStatus}
              supportId={supportId}
              setSupportId={setSupportId}
              hasConsent={hasConsent}
              onCopyState={handleCopyState}
              onSendDiagnostic={handleSendDiagnostic}
              onCapture={handleCapture}
              onRevoke={revokeSfApi}
            />

            <FeedbackFooter
              onClose={() => setOpen(false)}
              buildDiagnosticText={buildDiagnosticText}
              caseTag={caseTag}
            />
            </div>{/* end ueu-dialog-main */}
            <Show when={drawerOpen()}>
              <HistoryPanel
                get={get}
                state={historyState}
                onClose={() => { historyState.setDrawerOpen(false); setDrawerOpen(false) }}
              />
            </Show>
          </div>{/* end ueu-dialog-wrap */}
        </div>
      </Show>
    </>
  )
}
