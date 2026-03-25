/**
 * InstructorCard — instructor info with Canvas links.
 */

import { Show } from "solid-js"
import { CANVAS_URL } from "../constants"
import type { InstructorState, CanvasState } from "../content/case-types"

export function InstructorCard(props: {
  instructor: InstructorState
  canvas: CanvasState | null
  showCanvasFeatures: boolean
  canvasFeaturesPending: boolean
}) {
  const i = props.instructor
  return (
    <article>
      <h3 class="ueu-label">Instructor</h3>
      <p class="ueu-muted" style={{"margin-bottom": "0.4rem"}}>{i.name ?? i.email}</p>
      <Show when={i.canvasId}>
        <div class="ueu-canvas-links">
          <a href={`${CANVAS_URL}/users/${i.canvasId}`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
            Profile &rarr;
          </a>
          <Show when={props.canvas}>
            <a href={`${CANVAS_URL}/courses/${props.canvas!.courseId}/users/${i.canvasId}`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
              In Course &rarr;
            </a>
          </Show>
          <Show when={props.showCanvasFeatures}>
            <a href={`${CANVAS_URL}/users/${i.canvasId}/masquerade`} target="_blank" rel="noopener noreferrer" class={`ueu-canvas-link${props.canvasFeaturesPending ? " ueu-canvas-pending" : ""}`} aria-disabled={props.canvasFeaturesPending}>
              Act as &rarr;
            </a>
          </Show>
        </div>
      </Show>
      <Show when={i.email}>
        <div class="ueu-canvas-links" style={{"margin-top": "0.25rem"}}>
          <a href={`mailto:${i.email}`} class="ueu-canvas-link" style={{"font-size": "0.85rem"}}>
            Email &rarr;
          </a>
        </div>
      </Show>
    </article>
  )
}
