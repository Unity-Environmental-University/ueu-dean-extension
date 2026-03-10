/**
 * Content script — injected into Salesforce pages.
 *
 * Watches URL for record page navigation, fetches data via SF API,
 * and mounts the overlay UI.
 */

import { startWatching } from "./features"
import { mountOverlay } from "./overlay"

let mounted = false

function tryMount() {
  if (mounted) return
  const root = document.body
  if (!root) return

  startWatching()
  mountOverlay(root)
  mounted = true
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
