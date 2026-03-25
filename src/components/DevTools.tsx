/**
 * DevTools — diagnostic panel for the dean extension overlay.
 *
 * Shows raw state, field agreement, diagnostics, page capture,
 * and support message sending.
 */

import { Show } from "solid-js"
import { state } from "../content/core"
import { saveSettings } from "../content/permissions"
import { hash, safeDetail, safeText } from "./safe-text"
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
  return (
    <details class="ueu-dev">
      <summary>Dev</summary>
      <button onClick={props.onCopyState} class={props.copied() ? "ueu-btn-copied" : ""}>
        {props.copied() ? "Copied!" : "Copy state"}
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
