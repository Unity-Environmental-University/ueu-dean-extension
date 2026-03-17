/**
 * Content script — injected into Salesforce pages.
 *
 * Watches URL for record page navigation, fetches data via SF API,
 * and mounts the overlay UI.
 */

import { startWatching } from "./core"
import { mountOverlay } from "./overlay"

let mounted = false

function tryMount() {
  if (mounted) return
  const root = document.body
  if (!root) return

  startWatching()
  mountOverlay(root)
  mounted = true

  // SF may have already routed before our pushState intercept was installed.
  // Retry with backoff until data loads or we give up.
  const delays = [500, 1000, 2000, 4000]
  let attempt = 0
  function retryIfNeeded() {
    if (attempt >= delays.length) return
    setTimeout(async () => {
      const m = await import("./core")
      if (!m.state.caseData && !m.state.canvas && !m.state.loading) {
        m.refresh()
      }
      attempt++
      retryIfNeeded()
    }, delays[attempt])
  }
  retryIfNeeded()
}

tryMount()

// Salesforce is a SPA — re-check if we haven't mounted yet
const observer = new MutationObserver(() => {
  if (!mounted) tryMount()
})

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
})
