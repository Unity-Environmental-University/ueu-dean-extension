/**
 * InstructorCard — instructor info with Canvas links.
 */

import { Show } from "solid-js"
import { CanvasUserLinks } from "./CanvasUserLinks"
import type { InstructorState, CanvasState } from "../content/case-types"

export function InstructorCard(props: {
  instructor: InstructorState
  canvas: CanvasState | null
}) {
  const i = props.instructor
  return (
    <article>
      <h3 class="ueu-label">Instructor</h3>
      <p class="ueu-muted" style={{"margin-bottom": "0.4rem"}}>{i.name ?? i.email}</p>
      <Show when={i.canvasId}>
        <CanvasUserLinks
          userId={i.canvasId!}
          courseId={props.canvas?.courseId}
          showInCourse
        />
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
