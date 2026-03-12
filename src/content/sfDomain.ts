/**
 * Salesforce field resolution domain for the Otter loop.
 *
 * Resolves ambiguous SF field names to values with confidence and provenance.
 * Replace makeFieldAccessor() / pick() call sites with resolveFields().
 *
 * Confidence levels:
 *   1.0 — describe hit: label matched exactly in SF describe metadata
 *   0.8 — describe hit, value present but we fell back (field known, empty)
 *   0.7 — pick fallback: explicit API name variant matched
 *   0.0 — not resolved
 */

import { makeEdge, otterStep } from "alkahest"
import type { Edge, OtterDomain, OtterState } from "alkahest"

export interface FieldResolution {
  value: string
  confidence: number
  via: string  // how we found it: "describe", "pick", etc.
}

/** Desired field: subject=objectType, predicate=normalised label, object="?" */
function wantedEdge(objectType: string, label: string): Edge {
  return makeEdge(objectType, normalise(label), "?", 0, [])
}

/** Candidate edge: a known label→value mapping with confidence */
function candidateEdge(objectType: string, label: string, value: string, confidence: number, via: string): Edge {
  return makeEdge(objectType, normalise(label), value, confidence, [via])
}

function normalise(label: string): string {
  return label.toLowerCase().trim()
}

/**
 * Build the usable set from a describe field map and a raw record.
 * Only looks up the labels we actually want — not the full describe map.
 */
function buildUsable(
  objectType: string,
  record: Record<string, unknown>,
  fieldMap: Map<string, { name: string; label: string }> | null,
  wants: Array<{ label: string; keys: string[] }>,
): Edge[] {
  const candidates: Edge[] = []

  for (const { label, keys } of wants) {
    // Describe-based candidate (confidence 1.0)
    if (fieldMap) {
      const info = fieldMap.get(normalise(label))
      if (info) {
        const v = record[info.name]
        if (v != null && v !== "") {
          candidates.push(candidateEdge(objectType, label, String(v), 1.0, `describe:${info.name}`))
          continue  // describe hit — no need to try pick fallbacks
        }
      }
    }

    // Pick fallbacks (confidence 0.7) — tried only if describe missed or absent
    for (const key of keys) {
      const v = record[key]
      if (v != null && v !== "") {
        candidates.push(candidateEdge(objectType, label, String(v), 0.7, `pick:${key}`))
        break
      }
    }
  }

  return candidates
}

/** The domain: combine a wanted edge with a candidate → produce a resolved edge */
const sfFieldDomain: OtterDomain<Edge> = {
  initialState: (): OtterState<Edge> => ({
    setOfSupport: [],
    usable: [],
    history: [],
    step: 0,
    halted: false,
    haltReason: "",
  }),

  combineFn: (focus: Edge, candidate: Edge): Edge[] => {
    // Only match wanted (object="?") edges against candidates with real values
    if (focus.object !== "?" || candidate.object === "?") return []
    if (focus.subject !== candidate.subject) return []
    if (focus.predicate !== candidate.predicate) return []

    return [makeEdge(
      focus.subject,
      focus.predicate,
      candidate.object,
      candidate.confidence,
      [...focus.source, ...candidate.source],
    )]
  },

  // Higher confidence subsumes lower for same subject+predicate+value
  subsumeFn: (a: Edge, b: Edge): boolean => {
    return a.subject === b.subject &&
      a.predicate === b.predicate &&
      a.object !== "?" &&
      b.object !== "?" &&
      a.confidence >= b.confidence
  },
  // No stopFn — let the loop exhaust naturally. For 8–15 fields it's trivial.
}

/**
 * Resolve a set of field labels against a raw SF record.
 *
 * @param objectType  SF object type (e.g. "Case")
 * @param record      Raw API response
 * @param fieldMap    From describeObject() — label → FieldInfo
 * @param wants       Labels to resolve, each with optional pick fallbacks
 * @returns           Map from normalised label → FieldResolution
 */
export function resolveFields(
  objectType: string,
  record: Record<string, unknown>,
  fieldMap: Map<string, { name: string; label: string }> | null,
  wants: Array<{ label: string; fallbacks?: string[] }>,
): Map<string, FieldResolution> {
  const usable = buildUsable(
    objectType,
    record,
    fieldMap,
    wants.map(w => ({ label: w.label, keys: w.fallbacks ?? [] })),
  )

  let state: OtterState<Edge> = {
    ...sfFieldDomain.initialState(),
    setOfSupport: wants.map(w => wantedEdge(objectType, w.label)),
    usable,
  }

  // Run until all wanted edges resolved or loop exhausts
  let steps = 0
  while (!state.halted && state.setOfSupport.length > 0 && steps < 200) {
    state = otterStep(state, sfFieldDomain)
    steps++
  }

  // Collect resolved edges from usable (where the loop deposits them after combination)
  // Pick highest confidence per label in case multiple sources resolved the same field
  const results = new Map<string, FieldResolution>()
  const resolved = [...state.usable, ...state.setOfSupport].filter(e => e.object !== "?")
  for (const item of resolved) {
    const key = normalise(item.predicate)
    const existing = results.get(key)
    if (!existing || item.confidence > existing.confidence) {
      results.set(key, {
        value: item.object,
        confidence: item.confidence,
        via: item.source.join(" → "),
      })
    }
  }

  return results
}

/**
 * Convenience: build a field getter from resolved results.
 * Returns null if unresolved or below confidence threshold.
 */
export function makeResolver(
  results: Map<string, FieldResolution>,
  minConfidence = 0.0,
) {
  return function get(label: string): string | null {
    const r = results.get(label.toLowerCase().trim())
    if (!r || r.confidence < minConfidence) return null
    return r.value
  }
}
