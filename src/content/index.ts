/**
 * Content script — injected into Salesforce and Canvas pages.
 *
 * Mounts the overlay root and watches for dynamic navigation
 * (Salesforce is a SPA, so we need a MutationObserver).
 */

import { mountOverlay } from "./overlay"

let mounted = false

function tryMount() {
  if (mounted) return
  const root = document.body
  if (!root) return
  mountOverlay(root)
  mounted = true
}

// Initial mount
tryMount()

// Re-check on DOM mutations (Salesforce SPA navigation)
const observer = new MutationObserver(() => {
  if (!mounted) tryMount()
})

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
})
