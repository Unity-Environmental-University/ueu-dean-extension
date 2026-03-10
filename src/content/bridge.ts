/**
 * Content-script side of the page bridge.
 *
 * Injects page-bridge.ts into the page context and provides
 * a promise-based API for the rest of the extension to use.
 */

const CHANNEL = "ueu-dean-tools"

let bridgeReady = false
const pending = new Map<string, (data: any) => void>()

// Listen for responses from the page bridge
window.addEventListener("message", (event) => {
  if (event.source !== window) return
  const msg = event.data
  if (msg?.channel !== CHANNEL) return

  if (msg.type === "ready") {
    bridgeReady = true
    return
  }

  const resolve = pending.get(msg.type)
  if (resolve) {
    pending.delete(msg.type)
    resolve(msg.data)
  }
})

async function request<T>(action: string, extra?: Record<string, any>): Promise<T> {
  await ensureBridge()
  return new Promise((resolve) => {
    // Map action to response type
    const responseType =
      action === "capture-labels" ? "labels" :
      action === "read-all-fields" ? "all-fields" :
      action === "read-field" ? "field" : action

    pending.set(responseType, resolve)
    window.postMessage({ channel: CHANNEL, action, ...extra }, "*")

    // Timeout after 3s
    setTimeout(() => {
      if (pending.has(responseType)) {
        pending.delete(responseType)
        resolve((action === "capture-labels" ? [] : action === "read-all-fields" ? {} : null) as T)
      }
    }, 3000)
  })
}

export function injectBridge() {
  inject()
}

function inject(): Promise<void> {
  return new Promise((resolve) => {
    // If already ready, resolve immediately
    if (bridgeReady) { resolve(); return }

    const script = document.createElement("script")
    script.src = chrome.runtime.getURL("src/content/page-bridge.js")
    document.head.appendChild(script)
    script.onload = () => {
      script.remove()
      // Wait for the ready message
      const check = setInterval(() => {
        if (bridgeReady) { clearInterval(check); resolve() }
      }, 50)
      // Give up after 2s
      setTimeout(() => { clearInterval(check); resolve() }, 2000)
    }
  })
}

/** Ensure bridge is injected and ready before making a request */
async function ensureBridge() {
  if (!bridgeReady) await inject()
}

export function captureLabels(): Promise<string[]> {
  return request<string[]>("capture-labels")
}

export function readAllFields(): Promise<Record<string, string>> {
  return request<Record<string, string>>("read-all-fields")
}

export function readField(label: string): Promise<string | null> {
  return request<string | null>("read-field", { label })
}
