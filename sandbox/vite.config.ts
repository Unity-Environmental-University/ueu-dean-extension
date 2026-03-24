import { defineConfig } from "vite"
import { resolve } from "node:path"
import solid from "vite-plugin-solid"

export default defineConfig({
  root: resolve(__dirname),
  plugins: [solid()],
  resolve: {
    alias: {
      "webextension-polyfill": resolve(__dirname, "mock-browser.ts"),
    },
  },
  define: {
    __SUPPORT_CANVAS_ID__: JSON.stringify("SANDBOX"),
    __FEEDBACK_EMAIL__: JSON.stringify("sandbox@example.com"),
  },
  server: {
    port: 5174,
  },
})
