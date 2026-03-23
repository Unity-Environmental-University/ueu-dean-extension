/**
 * AccountView — shows Canvas courses grouped by term for a student/instructor Account.
 *
 * Reads from state.accountData (populated by loadAccount in core.ts).
 */

import { createSignal, createEffect, onCleanup, Show, For } from "solid-js"
import browser from "webextension-polyfill"
import { state, refresh, loadConversations } from "../content/core"
import { isCurrentTerm, termAverage } from "../content/student-courses"

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

function formatLda(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function AccountView() {
  const [version, setVersion] = createSignal(0)
  const bump = () => setVersion(v => v + 1)
  state.listeners.add(bump)
  onCleanup(() => state.listeners.delete(bump))

  const [selectedTerm, setSelectedTerm] = createSignal<number | null>(null)
  const [expandedCourse, setExpandedCourse] = createSignal<number | null>(null)

  const accountData = () => { version(); return state.accountData }
  const loading = () => { version(); return state.loading }
  const error = () => { version(); return state.error }
  const canMasquerade = () => { version(); return state.canMasquerade }
  const conversations = () => { version(); return state.conversations }
  const loadingConversations = () => { version(); return state.loadingConversations }
  const conversationError = () => { version(); return state.conversationError }

  // Auto-select current term when data loads
  createEffect(() => {
    const data = accountData()
    if (!data || selectedTerm() !== null) return
    const current = data.termGroups.find(t => isCurrentTerm(t))
    if (current) setSelectedTerm(current.termId)
  })

  // Poll for Canvas session when auth is needed
  createEffect(() => {
    const data = accountData()
    if (data?.error !== "canvas-session-required") return
    const interval = setInterval(async () => {
      const result = await browser.runtime.sendMessage({ type: "canvas-session-check" }) as { hasSession: boolean }
      if (result?.hasSession) {
        clearInterval(interval)
        refresh()
      }
    }, 1500)
    onCleanup(() => clearInterval(interval))
  })

  const visibleTerms = () => {
    const data = accountData()
    if (!data) return []
    const sel = selectedTerm()
    if (sel === null) return data.termGroups
    return data.termGroups.filter(t => t.termId === sel)
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

            {/* LDA at top */}
            <Show when={data().lastActivityAt}>
              <div class="ueu-lda-banner">
                <span class="ueu-lda-label">Last activity</span>
                <span class="ueu-lda-value">{formatLda(data().lastActivityAt)}</span>
              </div>
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
              <div class="ueu-canvas-links" style={{"margin-bottom": "0.5rem"}}>
                <a href={`https://unity.instructure.com/users/${data().canvasUserId}`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                  Profile &rarr;
                </a>
                <Show when={canMasquerade()}>
                  <a href={`https://unity.instructure.com/users/${data().canvasUserId}/masquerade`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                    Act as &rarr;
                  </a>
                </Show>
              </div>

              {/* Inbox — only available with masquerade permission */}
              <Show when={canMasquerade()}>
                <div style={{"margin-bottom": "0.75rem"}}>
                  <Show when={!conversations() && !loadingConversations()}>
                    <button
                      class="ueu-btn-messages"
                      onClick={() => loadConversations(data().canvasUserId!, null)}
                    >
                      View student inbox
                    </button>
                  </Show>
                  <Show when={loadingConversations()}>
                    <p class="ueu-loading">Loading inbox&hellip;</p>
                  </Show>
                  <Show when={conversationError()}>
                    <p class="ueu-warn">{conversationError()}</p>
                  </Show>
                  <Show when={conversations()}>
                    {convos => (
                      <Show
                        when={convos().length > 0}
                        fallback={<p class="ueu-muted">No conversations found.</p>}
                      >
                        <div class="ueu-convo-list">
                          <For each={convos()}>
                            {convo => (
                              <div class="ueu-convo-preview">
                                <span class="ueu-convo-subject">{convo.subject || "(no subject)"}</span>
                                <span class="ueu-convo-meta">
                                  {convo.participants.map(p => p.full_name ?? p.name).join(", ")}
                                  {" · "}
                                  {new Date(convo.last_message_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                </span>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    )}
                  </Show>
                </div>
              </Show>
            </Show>

            {/* Term filter chips */}
            <Show when={data().termGroups.length > 1}>
              <div class="ueu-term-chips">
                <button
                  class="ueu-chip"
                  classList={{"ueu-chip-active": selectedTerm() === null}}
                  onClick={() => setSelectedTerm(null)}
                >
                  All
                </button>
                <For each={data().termGroups}>
                  {term => (
                    <button
                      class="ueu-chip"
                      classList={{"ueu-chip-active": selectedTerm() === term.termId}}
                      onClick={() => setSelectedTerm(term.termId)}
                    >
                      {term.termName}
                    </button>
                  )}
                </For>
              </div>
            </Show>

            {/* Term groups */}
            <Show when={data().termGroups.length > 0}>
              <For each={visibleTerms()}>
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
                          {course => {
                            const expanded = () => expandedCourse() === course.courseId
                            return (
                              <li class="ueu-course-card" classList={{"ueu-course-expanded": expanded()}}>
                                <button
                                  class="ueu-course-row"
                                  onClick={() => setExpandedCourse(expanded() ? null : course.courseId)}
                                  aria-expanded={expanded()}
                                >
                                  <div class="ueu-course-name">
                                    <span class="ueu-course-link">{course.name}</span>
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
                                </button>

                                <Show when={expanded()}>
                                  <div class="ueu-course-detail">
                                    <div class="ueu-detail-row">
                                      <span class="ueu-detail-label">Last activity</span>
                                      <span class="ueu-detail-value">{formatLda(course.lastActivityAt)}</span>
                                    </div>
                                    <div class="ueu-detail-row">
                                      <a
                                        href={`https://unity.instructure.com/courses/${course.courseId}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        class="ueu-canvas-link"
                                      >
                                        Open in Canvas &rarr;
                                      </a>
                                    </div>
                                  </div>
                                </Show>
                              </li>
                            )
                          }}
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

      <Show when={!loading() && !accountData() && !error()}>
        <p class="ueu-muted">Loading account...</p>
      </Show>
    </div>
  )
}
