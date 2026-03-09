/**
 * CanvasLink + CaseInfo — reads the current SF page, shows case details
 * and a direct Canvas link.
 *
 * All data is anonymized. No PII enters the component tree.
 */

import { createResource, Show } from "solid-js"
import { readPageContext } from "../content/salesforce"

const CANVAS_BASE = "https://unity.instructure.com/courses"

const LABEL_STYLE = {
  margin: "0 0 0.5rem",
  "font-size": "0.75rem",
  "text-transform": "uppercase" as const,
  "letter-spacing": "0.05em",
  color: "#888",
}

const PILL_STYLE = (color: string) => ({
  display: "inline-block",
  padding: "0.15rem 0.5rem",
  "border-radius": "999px",
  "font-size": "0.75rem",
  "font-weight": "600",
  background: color,
  color: "white",
})

const STATUS_COLORS: Record<string, string> = {
  open: "#d97706",
  pending: "#2563eb",
  resolved: "#16a34a",
}

const INCIDENT_LABELS: Record<string, string> = {
  plagiarism: "Plagiarism",
  cheating: "Cheating",
  fabrication: "Fabrication",
  other: "Other",
}

export function CanvasLink() {
  const [ctx] = createResource(readPageContext)

  const href = () => {
    const c = ctx()
    return c?.courseId ? `${CANVAS_BASE}/${c.courseId}` : null
  }

  const rec = () => ctx()?.caseRecord

  return (
    <div>
      {/* Case details */}
      <Show when={rec()}>
        {r => (
          <div style={{ "margin-bottom": "1.25rem" }}>
            <h3 style={LABEL_STYLE}>Case</h3>
            <div style={{ display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" }}>
              <Show when={r().caseNumber}>
                <span style={{ "font-weight": "600", "font-size": "0.9rem" }}>{r().caseNumber}</span>
              </Show>
              <span style={PILL_STYLE(STATUS_COLORS[r().status] ?? "#888")}>{r().status}</span>
              <span style={PILL_STYLE("#6b21a8")}>{INCIDENT_LABELS[r().incidentType] ?? r().incidentType}</span>
            </div>

            <div style={{ "margin-top": "0.5rem", "font-size": "0.85rem", color: "#555" }}>
              <Show when={r().assignmentName}>
                <div>Assignment: {r().assignmentName}</div>
              </Show>
              <Show when={r().policyReference}>
                <div>Policy: {r().policyReference}</div>
              </Show>
              <Show when={r().createdAt}>
                <div>Opened: {r().createdAt}</div>
              </Show>
              <div style={{ "margin-top": "0.25rem", color: "#999", "font-size": "0.75rem" }}>
                Student token: {r().studentToken.slice(0, 8)}
              </div>
            </div>
          </div>
        )}
      </Show>

      {/* Show "not a dishonesty case" when parsePage returned null */}
      <Show when={ctx() && rec() === null && ctx()!.recordId}>
        <p style={{ margin: "0 0 1rem", color: "#999", "font-size": "0.85rem" }}>
          This case doesn't appear to be a dishonesty record.
        </p>
      </Show>

      {/* Canvas link */}
      <h3 style={LABEL_STYLE}>Canvas</h3>
      <Show
        when={href()}
        fallback={
          <p style={{ margin: 0, color: "#999", "font-size": "0.9rem" }}>
            {ctx()?.recordId
              ? "Course ID not found on this page."
              : ctx.loading
                ? "Reading page..."
                : "No Salesforce record detected."}
          </p>
        }
      >
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
      </Show>
    </div>
  )
}
