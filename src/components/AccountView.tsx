/**
 * AccountView — shows Canvas courses grouped by term for a student/instructor Account.
 *
 * Reads from state.accountData (populated by loadAccount in core.ts).
 */

import { createSignal, createEffect, onCleanup, Show, For } from "solid-js"
import browser from "webextension-polyfill"
import { state, refresh } from "../content/core"
import { isCurrentTerm, termAverage } from "../content/student-courses"

export function AccountView() {
  const [version, setVersion] = createSignal(0)
  const bump = () => setVersion(v => v + 1)
  state.listeners.add(bump)
  onCleanup(() => state.listeners.delete(bump))

  const accountData = () => { version(); return state.accountData }
  const loading = () => { version(); return state.loading }
  const error = () => { version(); return state.error }
  const studentError = () => { version(); return state.studentError }

  // Poll for Canvas session when auth is needed
  createEffect(() => {
    if (studentError() !== "canvas-session-required") return
    const interval = setInterval(async () => {
      const result = await browser.runtime.sendMessage({ type: "canvas-session-check" }) as { hasSession: boolean }
      if (result?.hasSession) {
        clearInterval(interval)
        refresh()
      }
    }, 1500)
    onCleanup(() => clearInterval(interval))
  })

  function scoreColor(score: number | null): string {
    if (score === null) return "#888"
    if (score >= 90) return "#16a34a"
    if (score >= 80) return "#65a30d"
    if (score >= 70) return "#ca8a04"
    if (score >= 60) return "#ea580c"
    return "#dc2626"
  }

  function formatScore(score: number | null): string {
    if (score === null) return "—"
    return score.toFixed(1) + "%"
  }

  return (
    <div>
      <Show when={error()}>
        <p class="ueu-error">{error()}</p>
      </Show>

      <Show when={loading()}>
        <p class="ueu-muted">Loading...</p>
      </Show>

      <Show when={accountData()}>
        {data => (
          <>
            <Show when={data().accountName}>
              <h3 class="ueu-label">{data().accountName}</h3>
            </Show>

            <Show when={data().error === "no-canvas-id"}>
              <p class="ueu-muted">No Canvas user ID on this account.</p>
            </Show>

            <Show when={data().error === "canvas-session-required"}>
              <div class="ueu-canvas-session-prompt">
                <p>Canvas session required.</p>
                <p>
                  <a href="https://unity.instructure.com" target="_blank" rel="noopener noreferrer">
                    Open Canvas
                  </a>
                  {" "}and log in — this will update automatically.
                </p>
              </div>
            </Show>

            <Show when={data().error && data().error !== "no-canvas-id" && data().error !== "canvas-session-required"}>
              <p class="ueu-warn">{data().error}</p>
            </Show>

            {/* Canvas links when we have a user ID */}
            <Show when={data().canvasUserId}>
              <div class="ueu-canvas-links" style={{"margin-bottom": "0.75rem"}}>
                <a href={`https://unity.instructure.com/users/${data().canvasUserId}`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                  Profile &rarr;
                </a>
                <a href={`https://unity.instructure.com/users/${data().canvasUserId}/masquerade`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                  Act as &rarr;
                </a>
              </div>
            </Show>

            {/* Term groups */}
            <Show when={data().termGroups.length > 0}>
              <For each={data().termGroups}>
                {(term, i) => {
                  const current = isCurrentTerm(term)
                  const avg = termAverage(term)
                  return (
                    <article class="ueu-term-group" classList={{"ueu-term-current": current}} style={{"animation-delay": `${i() * 60}ms`}}>
                      <div class="ueu-term-header">
                        <h4 class="ueu-term-name">
                          {term.termName}
                          <Show when={current}>
                            <span class="ueu-pill" style={{"margin-left": "0.5rem", "font-size": "0.65rem"}}>current</span>
                          </Show>
                        </h4>
                        <Show when={avg !== null}>
                          <span class="ueu-term-avg" style={{"color": scoreColor(avg)}}>
                            {formatScore(avg)} avg
                          </span>
                        </Show>
                      </div>
                      <ul class="ueu-course-list">
                        <For each={term.courses}>
                          {course => (
                            <li class="ueu-course-card">
                              <div class="ueu-course-name">
                                <a
                                  href={`https://unity.instructure.com/courses/${course.courseId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  class="ueu-course-link"
                                >
                                  {course.name}
                                </a>
                                <span class="ueu-pill" data-status={course.enrollmentState}>{course.enrollmentState}</span>
                              </div>
                              <div class="ueu-course-scores">
                                <span class="ueu-score" style={{"color": scoreColor(course.currentScore)}}>
                                  {formatScore(course.currentScore)}
                                </span>
                                <Show when={course.currentGrade}>
                                  <span class="ueu-grade">{course.currentGrade}</span>
                                </Show>
                              </div>
                            </li>
                          )}
                        </For>
                      </ul>
                    </article>
                  )
                }}
              </For>
            </Show>

            <Show when={!data().error && data().termGroups.length === 0}>
              <p class="ueu-muted">No courses found.</p>
            </Show>
          </>
        )}
      </Show>

      {/* No data state */}
      <Show when={!loading() && !accountData() && !error()}>
        <p class="ueu-muted">Loading account...</p>
      </Show>
    </div>
  )
}
