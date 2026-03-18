import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import webExtension from "vite-plugin-web-extension"
import manifest from "./manifest.json"

const browser = process.env.TARGET_BROWSER ?? "chrome"

function browserManifest() {
  const m = structuredClone(manifest) as Record<string, any>

  if (browser === "firefox") {
    // Firefox wants background.scripts, not service_worker
    m.background = {
      scripts: [manifest.background.service_worker],
      type: "module",
    }
  } else {
    // Chrome doesn't want gecko settings
    delete m.browser_specific_settings
  }

  return m
}

export default defineConfig({
  build: {
    outDir: `dist/${browser}`,
  },
  define: {
    __SUPPORT_CANVAS_ID__: JSON.stringify(process.env.SUPPORT_CANVAS_ID ?? "13279328"),
    __FEEDBACK_EMAIL__: JSON.stringify(process.env.FEEDBACK_EMAIL ?? "hlarsson@unity.edu"),
  },
  plugins: [
    solid(),
    webExtension({
      manifest: browserManifest,
      browser,
      additionalInputs: ["src/content/page-bridge.ts"],
    }),
  ],
})
