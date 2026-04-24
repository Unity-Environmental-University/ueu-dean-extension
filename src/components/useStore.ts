/**
 * useStore — reactive accessor factory for the shared state object.
 *
 * Subscribes to state.listeners on mount, cleans up on unmount,
 * and returns a `get` function that creates reactive accessors
 * for any state field.
 *
 * Usage:
 *   const get = useStore()
 *   const loading = get("loading")
 *   // loading() is reactive — re-reads state.loading on each notify()
 */

import { createSignal, createEffect, onCleanup } from "solid-js"
import browser from "webextension-polyfill"
import { state, refresh } from "../content/core"

type State = typeof state

export function useStore() {
  const [version, setVersion] = createSignal(0)
  const bump = () => setVersion(v => v + 1)
  state.listeners.add(bump)
  onCleanup(() => state.listeners.delete(bump))

  return function get<K extends keyof State>(key: K): () => State[K] {
    return () => { version(); return state[key] }
  }
}

/**
 * Poll for Canvas session when auth is needed.
 * Triggers refresh() once a session is detected.
 *
 * @param needsSession - reactive signal returning true when poll should be active
 */
export function useSessionPoll(needsSession: () => boolean) {
  createEffect(() => {
    if (!needsSession()) return
    const interval = setInterval(async () => {
      const result = await browser.runtime.sendMessage({ type: "canvas-session-check" }) as { hasSession: boolean }
      if (result?.hasSession) {
        clearInterval(interval)
        refresh()
      }
    }, 1500)
    onCleanup(() => clearInterval(interval))
  })
}
