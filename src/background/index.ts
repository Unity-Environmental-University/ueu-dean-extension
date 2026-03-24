/**
 * Background service worker.
 * Handles extension lifecycle, message routing, and SF API proxying.
 *
 * The SF REST API lives on *.my.salesforce.com while the Lightning UI
 * is on *.lightning.force.com. The background script can fetch cross-origin
 * thanks to host_permissions, and can read cookies for the API domain.
 */

import browser from "webextension-polyfill"
import { observe, query } from "./rhizome"

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

import { CANVAS_HOST } from "../constants"

async function canvasApiFetch(path: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const cookie = await browser.cookies.get({
    url: `https://${CANVAS_HOST}`,
    name: "_csrf_token",
  })

  const csrfToken = cookie?.value ? decodeURIComponent(cookie.value) : undefined
  const method = options.method ?? "GET"

  const res = await fetch(`https://${CANVAS_HOST}${path}`, {
    method,
    headers: {
      "Accept": "application/json",
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
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

  if (message.type === "canvas-message") {
    const { recipientId, subject, body } = message as { recipientId: string; subject: string; body: string }
    return canvasApiFetch("/api/v1/conversations", {
      method: "POST",
      body: { recipients: [recipientId], subject, body, group_conversation: false },
    })
  }

  if (message.type === "canvas-session-check") {
    return browser.cookies.get({ url: `https://${CANVAS_HOST}`, name: "_canvas_session" })
      .then(cookie => ({ hasSession: !!cookie?.value }))
  }

  if (message.type === "rhizome-observe") {
    const { subject, predicate, object, confidence, phase, note } = message as {
      subject: string; predicate: string; object: string
      confidence?: number; phase?: "volatile" | "fluid" | "salt"; note?: string
    }
    return observe({ subject, predicate, object, confidence, phase, note })
      .then(() => ({ ok: true }))
      .catch((e: unknown) => ({ ok: false, error: String(e) }))
  }

  if (message.type === "rhizome-query") {
    const { subject } = message as { subject: string }
    return query(subject)
      .then(edges => ({ ok: true, edges }))
      .catch((e: unknown) => ({ ok: false, error: String(e), edges: [] }))
  }

  return Promise.resolve({ ok: true })
})
