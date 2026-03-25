import { defineConfig, type Plugin } from "vite"
import { cpSync } from "node:fs"
import { resolve } from "node:path"
import solid from "vite-plugin-solid"
import webExtension from "vite-plugin-web-extension"
import manifest from "./manifest.json"

/** Copy static dirs (e.g. docs/) into the build output. */
function copyStatic(...dirs: string[]): Plugin {
  return {
    name: "copy-static",
    writeBundle(options) {
      const outDir = options.dir ?? "dist"
      for (const dir of dirs) {
        cpSync(resolve(__dirname, dir), resolve(outDir, dir), { recursive: true })
      }
    },
  }
}

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
    __BUILD_HASH__: JSON.stringify(new Date().toISOString().slice(0, 16)),
  },
  plugins: [
    solid(),
    webExtension({
      manifest: browserManifest,
      browser,
      additionalInputs: ["src/content/page-bridge.ts"],
    }),
    copyStatic("docs"),
  ],
})
