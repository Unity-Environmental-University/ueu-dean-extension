/**
 * Overlay root — mounts the Solid app into the host page.
 *
 * Uses a Shadow DOM so our styles don't fight Salesforce/Canvas.
 * Portals from here can escape into document.body for modals.
 */

import { render } from "solid-js/web"
import { Overlay } from "../components/Overlay"

export function mountOverlay(host: HTMLElement) {
  const container = document.createElement("div")
  container.id = "ueu-dean-tools-root"

  const shadow = container.attachShadow({ mode: "open" })
  const mountPoint = document.createElement("div")
  shadow.appendChild(mountPoint)

  host.appendChild(container)
  render(() => <Overlay />, mountPoint)
}
