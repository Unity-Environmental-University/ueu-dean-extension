/**
 * Overlay — the root component injected into Salesforce/Canvas pages.
 *
 * Renders lightweight injected UI. Modals and heavy UI render via Portal
 * into document.body to escape Shadow DOM stacking context.
 */

import { createSignal, Show } from "solid-js"
import { Portal } from "solid-js/web"

export function Overlay() {
  const [open, setOpen] = createSignal(false)

  return (
    <>
      {/* Injected trigger — small, unobtrusive */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: "fixed",
          bottom: "1.5rem",
          right: "1.5rem",
          "z-index": "2147483647",
          background: "#2d6a4f",
          color: "white",
          border: "none",
          "border-radius": "50%",
          width: "3rem",
          height: "3rem",
          cursor: "pointer",
          "font-size": "1.25rem",
          "box-shadow": "0 2px 8px rgba(0,0,0,0.3)",
        }}
        title="UEU Dean Tools"
      >
        ⚙
      </button>

      {/* Modal renders into document.body via Portal */}
      <Show when={open()}>
        <Portal mount={document.body}>
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.4)",
              "z-index": "2147483646",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
            }}
            onClick={() => setOpen(false)}
          >
            <div
              style={{
                background: "white",
                "border-radius": "0.5rem",
                padding: "2rem",
                "min-width": "400px",
                "max-width": "90vw",
                "box-shadow": "0 8px 32px rgba(0,0,0,0.2)",
              }}
              onClick={e => e.stopPropagation()}
            >
              <h2 style={{ margin: "0 0 1rem" }}>Dean Tools</h2>
              <p style={{ color: "#555" }}>Features coming soon.</p>
              <button onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  )
}
