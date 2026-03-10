/**
 * Overlay root — mounts the Solid app into the host page.
 *
 * Uses a Shadow DOM so our styles don't fight Salesforce/Canvas.
 */

import { render } from "solid-js/web"
import { Overlay } from "../components/Overlay"
import css from "./overlay.css?inline"

export function mountOverlay(host: HTMLElement) {
  const container = document.createElement("div")
  container.id = "ueu-dean-tools-root"

  const shadow = container.attachShadow({ mode: "open" })

  const style = document.createElement("style")
  style.textContent = css
  shadow.appendChild(style)

  const mountPoint = document.createElement("div")
  shadow.appendChild(mountPoint)

  host.appendChild(container)
  render(() => <Overlay />, mountPoint)
}
