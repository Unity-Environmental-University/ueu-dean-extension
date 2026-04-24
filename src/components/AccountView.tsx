/**
 * AccountView — shows Canvas courses grouped by term for a student/instructor Account.
 *
 * Reads from state.accountData (populated by loadAccount in core.ts).
 */

import { createSignal, createEffect, Show, For } from "solid-js"
import { loadConversations } from "../content/core"
import { CANVAS_URL } from "../constants"
import { isCurrentTerm, termAverage } from "../content/student-courses"
import { scoreColor, formatScore, formatLda } from "./format"
import { CanvasUserLinks } from "./CanvasUserLinks"
import { useStore, useSessionPoll } from "./useStore"

export function AccountView() {
  const get = useStore()

  const [selectedTerm, setSelectedTerm] = createSignal<number | null>(null)
  const [expandedCourse, setExpandedCourse] = createSignal<number | null>(null)
  const [casesExpanded, setCasesExpanded] = createSignal(false)

  const accountData = get("accountData")
  const loading = get("loading")
  const error = get("error")
  const accountCases = get("accountCases")
  const conversations = get("conversations")
  const loadingConversations = get("loadingConversations")
  const conversationError = get("conversationError")

  // Auto-select current term when data loads
  createEffect(() => {
    const data = accountData()
    if (!data || selectedTerm() !== null) return
    const current = data.termGroups.find(t => isCurrentTerm(t))
    if (current) setSelectedTerm(current.termId)
  })

  useSessionPoll(() => accountData()?.error === "canvas-session-required")

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

            {/* Case awareness — open cases signal for advisors */}
            <Show when={accountCases()}>
              {cases => (
                <Show when={cases().cases.length > 0}>
                  <div class="ueu-case-signal">
                    <button class="ueu-case-signal-toggle" onClick={() => setCasesExpanded(!casesExpanded())}>
                      <Show when={cases().openCount > 0}>
                        <span class="ueu-case-signal-count">{cases().openCount}</span>
                        <span class="ueu-case-signal-label">
                          open {cases().openCount === 1 ? "case" : "cases"}
                        </span>
                      </Show>
                      <Show when={cases().openCount === 0}>
                        <span class="ueu-case-signal-label">{cases().cases.length} prior {cases().cases.length === 1 ? "case" : "cases"}</span>
                      </Show>
                      <span class="ueu-drawer-arrow" classList={{"ueu-drawer-arrow-open": casesExpanded()}}>&rsaquo;</span>
                    </button>
                  </div>
                  <Show when={casesExpanded()}>
                    <ul class="ueu-history-list">
                      <For each={cases().cases}>
                        {c => (
                          <li class="ueu-history-card" data-status={c.status.toLowerCase()}>
                            <div class="ueu-history-card-top">
                              <a href={`/lightning/r/Case/${c.id}/view`} target="_blank" rel="noopener noreferrer" class="ueu-case-link">
                                {c.caseNumber}
                              </a>
                              <span class="ueu-history-right">
                                <span class="ueu-history-date">
                                  {new Date(c.createdDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                                </span>
                              </span>
                            </div>
                            <div class="ueu-history-card-detail">
                              <Show when={c.status !== "Unknown"}>
                                <span class="ueu-history-status-text">{c.status}</span>
                              </Show>
                              <Show when={c.type !== "Unknown" || c.subType}>
                                <span class="ueu-history-type" title={`${c.type}${c.subType ? ` · ${c.subType}` : ""}`}>
                                  {c.status !== "Unknown" ? " · " : ""}{c.type !== "Unknown" ? c.type : ""}{c.subType ? `${c.type !== "Unknown" ? " · " : ""}${c.subType}` : ""}
                                </span>
                              </Show>
                            </div>
                            <Show when={c.subject}>
                              <div class="ueu-history-card-subject">{c.subject}</div>
                            </Show>
                            <Show when={c.courseCode || c.courseName}>
                              <div class="ueu-history-card-course">
                                {(() => {
                                  const label = c.courseCode ?? c.courseName!
                                  return c.courseOfferingId
                                    ? <a href={`/lightning/r/hed__Course_Offering__c/${c.courseOfferingId}/view`} target="_blank" rel="noopener noreferrer" class="ueu-history-course ueu-history-course-link">{label}</a>
                                    : <span class="ueu-history-course">{label}</span>
                                })()}
                                <Show when={c.termName}>
                                  <span class="ueu-history-term-tag">{c.termName}</span>
                                </Show>
                              </div>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </Show>
              )}
            </Show>

            <Show when={data().error === "no-canvas-id"}>
              <p class="ueu-muted">No Canvas user ID on this account.</p>
            </Show>

            <Show when={data().error === "canvas-session-required"}>
              <div class="ueu-canvas-session-prompt">
                <p>Canvas session required.</p>
                <p>
                  <a href={CANVAS_URL} target="_blank" rel="noopener noreferrer">
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
              <div style={{"margin-bottom": "0.5rem"}}>
                <CanvasUserLinks
                  userId={data().canvasUserId!}
                />
              </div>

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
                                        href={`${CANVAS_URL}/courses/${course.courseId}`}
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
