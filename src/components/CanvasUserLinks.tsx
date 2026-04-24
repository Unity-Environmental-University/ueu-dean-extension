/**
 * CanvasUserLinks — reusable Canvas profile/act-as/grades links for any user.
 */

import { Show } from "solid-js"
import { CANVAS_URL } from "../constants"

export function CanvasUserLinks(props: {
  userId: string
  courseId?: string | null
  /** Show "Grades →" link (student in a course context) */
  showGrades?: boolean
  /** Show "In Course →" link (instructor in a course context) */
  showInCourse?: boolean
}) {
  return (
    <div class="ueu-canvas-links">
      <Show when={props.showGrades && props.courseId}>
        <a href={`${CANVAS_URL}/courses/${props.courseId}/grades/${props.userId}`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
          Grades &rarr;
        </a>
      </Show>
      <a href={`${CANVAS_URL}/users/${props.userId}`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
        Profile &rarr;
      </a>
      <Show when={props.showInCourse && props.courseId}>
        <a href={`${CANVAS_URL}/courses/${props.courseId}/users/${props.userId}`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
          In Course &rarr;
        </a>
      </Show>
      <a href={`${CANVAS_URL}/users/${props.userId}/masquerade`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
        Act as &rarr;
      </a>
    </div>
  )
}
