/**
 * Page bridge — injected into the Salesforce page context.
 *
 * Runs as a regular page script (not content script), so it has
 * access to window globals like the aura framework ($A).
 *
 * Communicates with the content script via postMessage on a
 * namespaced channel.
 */

const CHANNEL = "ueu-dean-bridge"

window.addEventListener("message", (event) => {
  if (event.source !== window) return
  if (event.data?.channel !== CHANNEL) return
  if (event.data?.direction !== "to-page") return

  const { id, action } = event.data

  if (action === "get-session") {
    let token: string | null = null

    // Try aura framework — this is the API-ready session token
    try {
      const aura = (window as any).$A
      if (aura) {
        token = aura.get("$Token") ?? null
      }
    } catch {}

    // Try grabbing from aura config in page HTML
    if (!token) {
      try {
        const scripts = document.querySelectorAll("script")
        for (const s of scripts) {
          const text = s.textContent ?? ""
          const m = text.match(/"token"\s*:\s*"([^"]+)"/)
          if (m) { token = m[1]; break }
        }
      } catch {}
    }

    // Last resort: sid cookie (may not have API scope)
    if (!token) {
      try {
        const match = document.cookie.match(/sid=([^;]+)/)
        if (match) token = match[1]
      } catch {}
    }

    window.postMessage({
      channel: CHANNEL,
      direction: "to-content",
      id,
      result: { token },
    }, "*")
  }
})

// Signal ready
window.postMessage({
  channel: CHANNEL,
  direction: "to-content",
  id: "ready",
  result: { ready: true },
}, "*")
