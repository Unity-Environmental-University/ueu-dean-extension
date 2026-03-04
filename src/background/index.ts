/**
 * Background service worker.
 * Handles extension lifecycle and message routing between popup and content scripts.
 */

import browser from "webextension-polyfill"

browser.runtime.onInstalled.addListener(() => {
  console.log("[dean-tools] installed")
})

browser.runtime.onMessage.addListener((message, _sender) => {
  console.log("[dean-tools] message:", message)
  // Route messages here as features grow
  return Promise.resolve({ ok: true })
})
