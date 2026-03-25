import { defineConfig } from "vitest/config"
import solid from "vite-plugin-solid"

export default defineConfig({
  plugins: [solid()],
  test: {
    // Default to node for pure-logic tests (loaders, utils).
    // Component tests opt into jsdom via @vitest-environment jsdom comment.
    environment: "node",
    globals: true,
    exclude: ["e2e/**", "node_modules/**"],
    environmentMatchGlobs: [
      ["src/components/**", "jsdom"],
    ],
  },
  resolve: {
    // Needed for solid-js JSX in jsdom tests
    conditions: ["development", "browser"],
  },
})
