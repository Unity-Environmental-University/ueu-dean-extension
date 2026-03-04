import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import webExtension from "vite-plugin-web-extension"

export default defineConfig({
  plugins: [
    solid(),
    webExtension({
      manifest: "manifest.json",
      browser: process.env.TARGET_BROWSER ?? "chrome",
    }),
  ],
})
