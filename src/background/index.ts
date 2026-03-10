/**
 * Background service worker.
 * Handles extension lifecycle, message routing, and SF API proxying.
 *
 * The SF REST API lives on *.my.salesforce.com while the Lightning UI
 * is on *.lightning.force.com. The background script can fetch cross-origin
 * thanks to host_permissions, and can read cookies for the API domain.
 */

import browser from "webextension-polyfill"

browser.runtime.onInstalled.addListener(() => {
  console.log("[dean-tools] installed")
})

browser.commands.onCommand.addListener((command) => {
  if (command === "reload-extension") {
    console.log("[dean-tools] reloading...")
    browser.runtime.reload()
  }
})

const API_VERSION = "v59.0"

/** Derive the .my.salesforce.com API host from the lightning.force.com host */
function getApiHost(lightningHost: string): string {
  // unityenvironmentaluniversity.lightning.force.com → unityenvironmentaluniversity.my.salesforce.com
  const match = lightningHost.match(/^([^.]+)\.lightning\.force\.com$/)
  if (match) return `${match[1]}.my.salesforce.com`
  // Already a salesforce.com domain
  return lightningHost
}

async function sfApiFetch(sfHost: string, path: string): Promise<unknown> {
  const apiHost = getApiHost(sfHost)

  // Try cookie-based auth first (background script can read cookies for the API domain)
  const cookie = await browser.cookies.get({
    url: `https://${apiHost}`,
    name: "sid",
  })

  const headers: Record<string, string> = {}
  if (cookie?.value) {
    headers["Authorization"] = `Bearer ${cookie.value}`
  }

  const res = await fetch(`https://${apiHost}/services/data/${API_VERSION}${path}`, {
    headers,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`SF API ${res.status}: ${path} — ${text.slice(0, 200)}`)
  }

  return res.json()
}

const CANVAS_HOST = "unity.instructure.com"

async function canvasApiFetch(path: string): Promise<unknown> {
  const cookie = await browser.cookies.get({
    url: `https://${CANVAS_HOST}`,
    name: "_csrf_token",
  })

  // Canvas uses cookie-based auth — just include credentials
  const res = await fetch(`https://${CANVAS_HOST}${path}`, {
    headers: {
      "Accept": "application/json",
      ...(cookie?.value ? { "X-CSRF-Token": decodeURIComponent(cookie.value) } : {}),
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Canvas API ${res.status}: ${path} — ${text.slice(0, 200)}`)
  }

  return res.json()
}

browser.runtime.onMessage.addListener((message, _sender) => {
  if (message.type === "sf-api") {
    const { sfHost, path } = message as { sfHost: string; path: string }
    return sfApiFetch(sfHost, path)
  }

  if (message.type === "canvas-api") {
    const { path } = message as { path: string }
    return canvasApiFetch(path)
  }

  return Promise.resolve({ ok: true })
})
