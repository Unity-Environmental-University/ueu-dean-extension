/**
 * Observer — the mycelium of the extension.
 *
 * Watches field resolution and emits structured edges to the rhizome graph.
 * Does not touch UI state. Does not render anything.
 * Feeds the institution's memory of which SF fields are live.
 */

import browser from "webextension-polyfill"
import type { DiagEntry } from "./resolve"

function rhizomeObserve(obs: {
  subject: string; predicate: string; object: string
  confidence?: number; phase?: "volatile" | "fluid" | "salt"; note?: string
}) {
  browser.runtime.sendMessage({ type: "rhizome-observe", ...obs }).catch(() => {})
}

/** Emit field-resolution edges from structured DiagEntry hits */
export function observeFields(objectType: string, log: DiagEntry[]) {
  for (const d of log) {
    if (d.type === "field-hit" && d.field) {
      rhizomeObserve({
        subject: `sf-schema:unity/${objectType}`,
        predicate: "field-resolved",
        object: d.field,
        confidence: 1.0,
        phase: "fluid",
        note: d.label ? `label="${d.label}"` : undefined,
      })
    }
    if (d.type === "pick-hit" && d.field) {
      rhizomeObserve({
        subject: `sf-schema:unity/${objectType}`,
        predicate: "field-resolved",
        object: d.field,
        confidence: 0.7,
        phase: "fluid",
        note: "pick-fallback",
      })
    }
  }
}

/** Emit case-level observations after a case is fully loaded */
export function observeCaseComplete(opts: {
  caseType: string
  caseSubType: string | null
  diagnostics: DiagEntry[]
}) {
  // sis_user_id success signal
  if (opts.diagnostics.some(d => d.type === "student-lookup-path" && d.detail.startsWith("sis_user_id resolved:"))) {
    rhizomeObserve({ subject: "sf-schema:unity/COP", predicate: "sis-lookup-succeeded", object: "canvas", confidence: 1.0, phase: "fluid" })
  }

  // Case type pattern (no student identity — just the shape)
  rhizomeObserve({
    subject: `sf-case-type:${opts.caseType}`,
    predicate: "observed-in",
    object: `sf-org:unity`,
    confidence: 0.8,
    phase: "fluid",
    note: opts.caseSubType ?? undefined,
  })
}
