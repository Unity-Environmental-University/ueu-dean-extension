/**
 * CanvasLink — reads course ID from the current SF page and renders
 * a direct link to the Canvas course.
 *
 * No data leaves the browser. No consent gate needed.
 * Reading happens once, on mount, not continuously.
 */

import { createMemo } from "solid-js"
import { readPageContext } from "../content/salesforce"

const CANVAS_BASE = "https://unity.instructure.edu/courses"

export function CanvasLink() {
  // Read once on mount — lazy, surgical, no MutationObserver
  const ctx = createMemo(() => readPageContext())

  const href = createMemo(() =>
    ctx().courseId ? `${CANVAS_BASE}/${ctx().courseId}` : null
  )

  return (
    <div style={{ "margin-top": "1rem" }}>
      <h3 style={{ margin: "0 0 0.5rem", "font-size": "0.85rem", "text-transform": "uppercase", "letter-spacing": "0.05em", color: "#888" }}>
        Canvas
      </h3>

      {href() ? (
        <a
          href={href()!}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            "align-items": "center",
            gap: "0.4rem",
            color: "#2d6a4f",
            "font-weight": "600",
            "text-decoration": "none",
            "font-size": "0.95rem",
          }}
        >
          Open course in Canvas →
        </a>
      ) : (
        <p style={{ margin: 0, color: "#999", "font-size": "0.9rem" }}>
          {ctx().recordId
            ? "Course ID not found on this page."
            : "No Salesforce record detected."}
        </p>
      )}
    </div>
  )
}
