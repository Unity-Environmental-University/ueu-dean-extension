/**
 * DishonestySummary — academic dishonesty details from the case.
 */

import { Show } from "solid-js"
import { INCIDENT_LABELS } from "./caseViewHelpers"
import type { DishonestyState } from "../content/case-types"

export function DishonestySummary(props: { dishonesty: DishonestyState }) {
  const d = props.dishonesty
  return (
    <article>
      <h3 class="ueu-label">Academic Dishonesty</h3>
      <div class="ueu-case-meta">
        <span class="ueu-pill" data-incident>{INCIDENT_LABELS[d.incidentType] ?? d.incidentType}</span>
      </div>
      <dl class="ueu-case-fields">
        <Show when={d.courseOfferingName}>
          <dt>Course</dt><dd>{d.courseOfferingName}</dd>
        </Show>
        <Show when={d.assignmentName}>
          <dt>Assignment</dt><dd>{d.assignmentName}</dd>
        </Show>
        <Show when={d.instructor}>
          <dt>Instructor</dt><dd>{d.instructor}</dd>
        </Show>
        <Show when={d.severity}>
          <dt>Severity</dt><dd>{d.severity}</dd>
        </Show>
      </dl>
    </article>
  )
}
