/**
 * GradeAppealSummary — grade appeal details from the case.
 */

import { Show } from "solid-js"
import type { GradeAppealState } from "../content/case-types"

export function GradeAppealSummary(props: { gradeAppeal: GradeAppealState }) {
  const g = props.gradeAppeal
  return (
    <article>
      <h3 class="ueu-label">Grade Appeal</h3>
      <dl class="ueu-case-fields">
        <Show when={g.courseOfferingName}>
          <dt>Course</dt><dd>{g.courseOfferingName}</dd>
        </Show>
        <Show when={g.currentGrade}>
          <dt>Current Grade</dt><dd>{g.currentGrade}</dd>
        </Show>
        <Show when={g.changedGrade}>
          <dt>Changed To</dt><dd>{g.changedGrade}</dd>
        </Show>
        <Show when={g.decisionStatus}>
          <dt>Decision</dt><dd>{g.decisionStatus}</dd>
        </Show>
        <Show when={g.instructor}>
          <dt>Instructor</dt><dd>{g.instructor}</dd>
        </Show>
      </dl>
    </article>
  )
}
