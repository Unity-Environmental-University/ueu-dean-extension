/**
 * Salesforce REST API client — routes calls through the background script.
 *
 * The API lives on *.my.salesforce.com while Lightning UI is on
 * *.lightning.force.com. The background script handles the cross-origin
 * fetch and cookie-based auth.
 */

import browser from "webextension-polyfill"

function getSfHost(): string {
  return window.location.host
}

async function sfFetch<T>(path: string): Promise<T> {
  const result = await browser.runtime.sendMessage({
    type: "sf-api",
    sfHost: getSfHost(),
    path,
  })

  if (result?.error) throw new Error(result.error)
  return result as T
}

/** Fetch a single SObject record by type and ID */
export async function getRecord<T = Record<string, unknown>>(
  objectType: string,
  id: string,
): Promise<T> {
  return sfFetch<T>(`/sobjects/${objectType}/${id}`)
}

interface FieldInfo {
  name: string       // API name e.g. "Course_Offering__c"
  label: string      // Human label e.g. "Course Offering"
  type: string
}

/** Per-session describe cache — avoids re-fetching within a page load */
const describeCache = new Map<string, Map<string, FieldInfo>>()

/**
 * Fetch the field map for an SObject type.
 * Returns a Map from lowercased label → FieldInfo.
 * Cached per object type for the lifetime of the page.
 */
export async function describeObject(objectType: string): Promise<Map<string, FieldInfo>> {
  if (describeCache.has(objectType)) return describeCache.get(objectType)!

  const result = await sfFetch<{ fields: FieldInfo[] }>(`/sobjects/${objectType}/describe`)
  const map = new Map<string, FieldInfo>()
  for (const f of result.fields) {
    map.set(f.label.toLowerCase(), f)
    map.set(f.name.toLowerCase(), f)  // also index by API name for flexibility
  }
  describeCache.set(objectType, map)
  return map
}

/**
 * Look up the API field name by label (case-insensitive).
 * Returns null if not found — never guesses.
 */
export async function fieldByLabel(objectType: string, label: string): Promise<string | null> {
  const map = await describeObject(objectType)
  return map.get(label.toLowerCase())?.name ?? null
}

export interface SoqlResult<T = Record<string, unknown>> {
  totalSize: number
  done: boolean
  records: T[]
}

/** Run a SOQL query via the SF REST API */
export async function sfQuery<T = Record<string, unknown>>(
  soql: string,
): Promise<SoqlResult<T>> {
  return sfFetch<SoqlResult<T>>(`/query?q=${encodeURIComponent(soql)}`)
}

/** Parse a Lightning URL into object type + record ID */
export function parseRecordUrl(
  pathname: string,
): { objectType: string; recordId: string } | null {
  const match = pathname.match(/\/lightning\/r\/([^/]+)\/([a-zA-Z0-9]+)\/view/)
  if (!match) return null
  return { objectType: match[1], recordId: match[2] }
}
