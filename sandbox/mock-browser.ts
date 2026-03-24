/**
 * Mock webextension-polyfill for sandbox mode.
 * Must be imported before any component that uses browser.runtime.sendMessage.
 */

const mockBrowser = {
  runtime: {
    sendMessage: async (msg: any) => {
      console.log("[sandbox] browser.runtime.sendMessage:", msg)
      if (msg.type === "canvas-session-check") return { hasSession: true }
      if (msg.type === "canvas-api") return { error: "Sandbox mode — no real Canvas API" }
      return {}
    },
    getURL: (path: string) => path,
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
    },
  },
  cookies: {
    get: async () => null,
  },
}

// Register as the module that `webextension-polyfill` would provide
;(globalThis as any).__SANDBOX_BROWSER__ = mockBrowser
export default mockBrowser
