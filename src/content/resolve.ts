/**
 * Field resolution — the hands of the extension.
 *
 * Touches SF records and feels for field names. Returns structured results
 * so consumers (core UI, observer) can each use what they need.
 */

export interface FieldHit {
  type: "field-hit"
  label: string
  field: string
  detail: string
}

export interface PickHit {
  type: "pick-hit"
  field: string
  detail: string
}

export interface FieldMiss {
  type: "field-miss" | "field-unknown" | "pick-miss"
  detail: string
}

export interface DiagEntry {
  type: string
  detail: string
  /** Populated on field-hit and pick-hit — the API field name that matched */
  field?: string
  /** Populated on field-hit — the human label that was searched */
  label?: string
}

export type DiagLog = DiagEntry[]

/** Try multiple field name variants — SF custom fields are unpredictable */
export function pick(log: DiagLog, record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    if (!Object.hasOwn(record, k)) continue
    const v = record[k]
    if (v != null && v !== "") {
      log.push({ type: "pick-hit", detail: `key:${k}`, field: k })
      return String(v)
    }
  }
  log.push({ type: "pick-miss", detail: `tried: ${keys.join(", ")}` })
  return null
}

export function diag(log: DiagLog, type: string, detail: string) {
  log.push({ type, detail })
}

/**
 * Build a field accessor for a described SObject record.
 * Looks up by human label first (exact, from describe), falls back to pick() variants.
 */
export function makeFieldAccessor(log: DiagLog, record: Record<string, unknown>, fieldMap: Map<string, { name: string }> | null) {
  return function get(label: string, ...fallbackKeys: string[]): string | null {
    if (fieldMap) {
      const info = fieldMap.get(label.toLowerCase())
      if (info) {
        const v = record[info.name]
        if (v != null && v !== "") {
          log.push({ type: "field-hit", detail: `"${label}" → ${info.name}`, field: info.name, label })
          return String(v)
        }
        log.push({ type: "field-miss", detail: `"${label}" → ${info.name} (present but empty)` })
      } else {
        log.push({ type: "field-unknown", detail: `"${label}" not in describe` })
      }
    }
    return pick(log, record, ...fallbackKeys)
  }
}
