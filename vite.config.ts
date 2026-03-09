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
  plugins: [
    solid(),
    webExtension({
      manifest: browserManifest,
      browser,
    }),
  ],
})
