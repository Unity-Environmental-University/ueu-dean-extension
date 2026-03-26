/**
 * DevTools — diagnostic panel for the dean extension overlay.
 *
 * Shows raw state, field agreement, diagnostics, page capture,
 * and support message sending.
 */

import { Show } from "solid-js"
import { saveSettings } from "../content/permissions"
import { hash, safeDetail, safeText } from "./safe-text"
import { useStore } from "./useStore"
import type { DiagEntry } from "../content/resolve"

export function DevTools(props: {
  diagnostics: () => DiagEntry[]
  copied: () => boolean
  setCopied: (v: boolean) => void
  sendStatus: () => "idle" | "sending" | "sent" | "error"
  supportId: () => string
  setSupportId: (v: string) => void
  hasConsent: () => boolean
  onCopyState: () => void
  onSendDiagnostic: () => void
  onCapture: () => void
  onRevoke: () => void
}) {
  const get = useStore()
  const caseRaw = get("caseRaw")
  const coRaw = get("coRaw")
  const copRaw = get("copRaw")
  const contactRaw = get("contactRaw")

  return (
    <details class="ueu-dev">
      <summary>Dev <span style={{"font-size": "0.6rem", "color": "#999"}}>({__BUILD_HASH__})</span></summary>
      <button onClick={props.onCopyState} class={props.copied() ? "ueu-btn-copied" : ""}>
        {props.copied() ? "Copied!" : "Copy state"}
      </button>
      <small>Copies extension state — paste to Claude to debug field mapping</small>

      <button onClick={async () => {
        const sections: string[] = []
        const cr = caseRaw(), cor = coRaw(), copr = copRaw(), conr = contactRaw()
        if (cr) sections.push(`## Case fields (${Object.keys(cr).length})\n${Object.keys(cr).sort().join("\n")}`)
        if (cor) sections.push(`## CourseOffering fields (${Object.keys(cor).length})\n${Object.keys(cor).sort().join("\n")}`)
        if (copr) sections.push(`## COP fields (${Object.keys(copr).length})\n${Object.keys(copr).sort().join("\n")}`)
        if (conr) sections.push(`## Contact/Account fields (${Object.keys(conr).length})\n${Object.keys(conr).sort().join("\n")}`)
        if (sections.length === 0) sections.push("No raw records available — navigate to a Case page first")
        await navigator.clipboard.writeText(sections.join("\n\n"))
        props.setCopied(true)
        setTimeout(() => props.setCopied(false), 2000)
      }} class={props.copied() ? "ueu-btn-copied" : ""}>
        {props.copied() ? "Copied!" : "Copy field names"}
      </button>
      <small>FERPA-safe — copies API field names only, no values</small>

      <Show when={caseRaw()}>
        {raw => (
          <details class="ueu-dev-raw">
            <summary>Case fields ({Object.keys(raw()).length})</summary>
            <pre class="ueu-dev-raw-pre">{Object.keys(raw()).sort().join("\n")}</pre>
          </details>
        )}
      </Show>
      <Show when={coRaw()}>
        {raw => (
          <details class="ueu-dev-raw">
            <summary>CO fields ({Object.keys(raw()).length})</summary>
            <pre class="ueu-dev-raw-pre">{Object.keys(raw()).sort().join("\n")}</pre>
          </details>
        )}
      </Show>
      <Show when={copRaw()}>
        {raw => (
          <details class="ueu-dev-raw">
            <summary>COP fields ({Object.keys(raw()).length})</summary>
            <pre class="ueu-dev-raw-pre">{Object.keys(raw()).sort().join("\n")}</pre>
          </details>
        )}
      </Show>
      <Show when={contactRaw()}>
        {raw => (
          <details class="ueu-dev-raw">
            <summary>Contact/Account fields ({Object.keys(raw()).length})</summary>
            <pre class="ueu-dev-raw-pre">{Object.keys(raw()).sort().join("\n")}</pre>
          </details>
        )}
      </Show>
      <Show when={props.diagnostics().length > 0}>
        <details class="ueu-dev-raw">
          <summary>
            Diagnostics ({props.diagnostics().length})
            {" "}<button
              style={{"font-size": "0.65rem", "padding": "0.1rem 0.4rem", "margin-left": "0.5rem"}}
              onClick={async (e) => {
                e.stopPropagation()
                await navigator.clipboard.writeText(props.diagnostics().map(d => `${d.type}: ${d.detail}`).join("\n"))
                props.setCopied(true)
                setTimeout(() => props.setCopied(false), 2000)
              }}
            >{props.copied() ? "Copied!" : "Copy"}</button>
          </summary>
          <pre class="ueu-dev-raw-pre">{props.diagnostics().map(d => `${d.type}: ${safeDetail(d.detail)}`).join("\n")}</pre>
        </details>
      </Show>

      <Show when={props.diagnostics().length > 0}>
        {(() => {
          const diags = props.diagnostics()
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
          value={props.supportId()}
          onInput={e => props.setSupportId(e.currentTarget.value)}
          onBlur={() => saveSettings({ supportCanvasId: props.supportId().trim() })}
        />
        <button
          onClick={props.onSendDiagnostic}
          disabled={!props.supportId().trim() || props.sendStatus() === "sending"}
          class={props.sendStatus() === "sent" ? "ueu-btn-copied" : props.sendStatus() === "error" ? "ueu-btn-revoke" : ""}
        >
          {props.sendStatus() === "sending" ? "Sending…" : props.sendStatus() === "sent" ? "Sent!" : props.sendStatus() === "error" ? "Failed" : "Send diagnostic"}
        </button>
      </div>

      <button onClick={props.onCapture} class={props.copied() ? "ueu-btn-copied" : ""}>
        {props.copied() ? "Copied!" : "Capture page"}
      </button>
      <small>Scrolls the full page to load all sections, then captures</small>

      <Show when={props.hasConsent()}>
        <button onClick={props.onRevoke} class="ueu-btn-revoke">
          Revoke Salesforce access
        </button>
      </Show>
    </details>
  )
}
