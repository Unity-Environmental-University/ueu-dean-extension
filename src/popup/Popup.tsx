import { createResource } from "solid-js"
import { getCurrentDean } from "../api"

export function Popup() {
  const [dean] = createResource(getCurrentDean)

  return (
    <div style={{ padding: "1rem", "min-width": "240px", "font-family": "sans-serif" }}>
      <h2 style={{ margin: "0 0 0.5rem" }}>UEU Dean Tools</h2>
      {dean.loading && <p>Loading...</p>}
      {dean() && <p style={{ margin: 0, color: "#555" }}>{dean()!.name} — {dean()!.department}</p>}
    </div>
  )
}
