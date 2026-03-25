/**
 * CanvasSection — Canvas course links, student info, and message viewer.
 */

import { Show, For } from "solid-js"
import { loadConversations } from "../content/core"
import { CANVAS_URL } from "../constants"
import type { useStore } from "./useStore"

export function CanvasSection(props: {
  get: ReturnType<typeof useStore>
  showCanvasFeatures: () => boolean
  canvasFeaturesPending: () => boolean
}) {
  const canvas = props.get("canvas")
  const loadingCO = props.get("loadingCourseOffering")
  const loadingStudent = props.get("loadingStudent")
  const courseOfferingError = props.get("courseOfferingError")
  const studentError = props.get("studentError")
  const canMasquerade = props.get("canMasquerade")
  const instructor = props.get("instructor")
  const conversations = props.get("conversations")
  const loadingConversations = props.get("loadingConversations")
  const conversationError = props.get("conversationError")

  return (
    <>
      <Show when={loadingCO()}>
        <p class="ueu-loading">Loading course&hellip;</p>
      </Show>
      <Show when={courseOfferingError()}>
        <p class="ueu-warn">{courseOfferingError()}</p>
      </Show>
      <Show when={canvas()}>
        {c => (
          <article>
            <h3 class="ueu-label">Canvas</h3>
            <div class="ueu-canvas-links">
              <a href={c().url} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                Course &rarr;
              </a>
              <a href={`${c().url}/gradebook`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                Gradebook &rarr;
              </a>
              <Show when={c().enrollmentUrl}>
                <a href={c().enrollmentUrl!} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link" style={{"color": "#999", "font-size": "0.8rem"}}>
                  Enrollment &rarr;
                </a>
              </Show>
            </div>
            <Show when={loadingStudent()}>
              <p class="ueu-loading" style={{"margin-top": "0.5rem"}}>Looking up student&hellip;</p>
            </Show>
            <Show when={studentError() === "canvas-session-required"}>
              <div class="ueu-canvas-session-prompt">
                <p>Student lookup requires an active Canvas session.</p>
                <p>
                  <a href={c().url} target="_blank" rel="noopener noreferrer">
                    Open Canvas
                  </a>
                  {" "}in another tab and log in — this will update automatically.
                </p>
              </div>
            </Show>
            <Show when={studentError() && studentError() !== "canvas-session-required"}>
              <p class="ueu-warn">{studentError()}</p>
            </Show>
            <Show when={c().studentId || c().studentName}>
              <h3 class="ueu-label" style={{"margin-top": "0.75rem"}}>Student</h3>
              <p class="ueu-muted" style={{"margin-bottom": "0.4rem"}}>
                {c().studentName}
                <Show when={c().studentPronouns}>
                  {" "}<span class="ueu-pronouns">({c().studentPronouns})</span>
                </Show>
              </p>
              <Show when={c().studentId}>
                <div class="ueu-canvas-links">
                  <a href={`${c().url}/grades/${c().studentId}`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                    Grades &rarr;
                  </a>
                  <a href={`${CANVAS_URL}/users/${c().studentId}`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                    Profile &rarr;
                  </a>
                  <Show when={props.showCanvasFeatures()}>
                    <a href={`${CANVAS_URL}/users/${c().studentId}/masquerade`} target="_blank" rel="noopener noreferrer" class={`ueu-canvas-link${props.canvasFeaturesPending() ? " ueu-canvas-pending" : ""}`} aria-disabled={props.canvasFeaturesPending()}>
                      Act as &rarr;
                    </a>
                  </Show>
                </div>
              </Show>
            </Show>
          </article>
        )}
      </Show>

      {/* Canvas access unavailable */}
      <Show when={canMasquerade() === false}>
        <div class="ueu-canvas-no-access">
          Canvas message history is not available for your account. To view instructor–student communications, your Canvas account requires the "Become other users" permission.
        </div>
      </Show>

      {/* Messages */}
      <Show when={props.showCanvasFeatures() && canvas()?.studentId && instructor()?.canvasId}>
        <article class={props.canvasFeaturesPending() ? "ueu-canvas-pending" : ""}>
          <h3 class="ueu-label">Messages</h3>
          <Show when={!conversations() && !loadingConversations()}>
            <button
              class="ueu-btn-messages"
              onClick={() => loadConversations(canvas()!.studentId!, instructor()!.canvasId!)}
            >
              View instructor ↔ student messages
            </button>
          </Show>
          <Show when={loadingConversations()}>
            <p class="ueu-loading">Loading messages&hellip;</p>
          </Show>
          <Show when={conversationError()}>
            <p class="ueu-warn">{conversationError()}</p>
          </Show>
          <Show when={conversations()}>
            {convos => (
              <Show
                when={convos().length > 0}
                fallback={<p class="ueu-muted">No messages found between student and instructor.</p>}
              >
                <For each={convos()}>
                  {convo => (
                    <div class="ueu-convo">
                      <div class="ueu-convo-header">
                        <span class="ueu-convo-subject">{convo.subject || "(no subject)"}</span>
                        <span class="ueu-convo-count">{convo.message_count} msg{convo.message_count !== 1 ? "s" : ""}</span>
                      </div>
                      <div class="ueu-convo-messages">
                        <For each={[...convo.messages].reverse().filter(m => !m.generated)}>
                          {msg => {
                            const author = convo.participants.find(p => p.id === msg.author_id)
                            const d = new Date(msg.created_at)
                            const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                            return (
                              <div class="ueu-msg">
                                <div class="ueu-msg-meta">
                                  <span class="ueu-msg-author">{author?.full_name ?? author?.name ?? `User ${msg.author_id}`}</span>
                                  <span class="ueu-msg-date">{dateStr}</span>
                                </div>
                                <p class="ueu-msg-body">{msg.body}</p>
                              </div>
                            )
                          }}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            )}
          </Show>
        </article>
      </Show>
    </>
  )
}
