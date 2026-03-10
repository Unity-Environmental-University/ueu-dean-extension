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

/** Parse a Lightning URL into object type + record ID */
export function parseRecordUrl(
  pathname: string,
): { objectType: string; recordId: string } | null {
  const match = pathname.match(/\/lightning\/r\/([^/]+)\/([a-zA-Z0-9]+)\/view/)
  if (!match) return null
  return { objectType: match[1], recordId: match[2] }
}
