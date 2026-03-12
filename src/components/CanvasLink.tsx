/**
 * CaseView — reads from the reactive API-driven state.
 *
 * Shows case info, dishonesty details, and Canvas link.
 * All data comes from SF REST API — no DOM scraping.
 */

import { createSignal, onCleanup, Show, createEffect } from "solid-js"
import browser from "webextension-polyfill"
import { state, refresh } from "../content/features"

const INCIDENT_LABELS: Record<string, string> = {
  plagiarism: "Plagiarism",
  cheating: "Cheating",
  fabrication: "Fabrication",
  other: "Other",
}

export function CanvasLink() {
  const [version, setVersion] = createSignal(0)
  const bump = () => setVersion(v => v + 1)
  state.listeners.add(bump)
  onCleanup(() => state.listeners.delete(bump))

  const caseData = () => { version(); return state.caseData }
  const dishonesty = () => { version(); return state.dishonesty }
  const gradeAppeal = () => { version(); return state.gradeAppeal }
  const canvas = () => { version(); return state.canvas }
  const loading = () => { version(); return state.loading }
  const loadingCO = () => { version(); return state.loadingCourseOffering }
  const loadingStudent = () => { version(); return state.loadingStudent }
  const error = () => { version(); return state.error }
  const courseOfferingError = () => { version(); return state.courseOfferingError }
  const studentError = () => { version(); return state.studentError }

  // Poll for Canvas session when the auth prompt is showing
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

  return (
    <div>
      <Show when={error()}>
        <p class="ueu-error">{error()}</p>
      </Show>

      <Show when={loading()}>
        <p class="ueu-muted">Loading...</p>
      </Show>

      {/* Case info */}
      <Show when={caseData()}>
        {info => (
          <article>
            <h3 class="ueu-label">Case</h3>
            <div class="ueu-case-meta">
              <span class="ueu-case-number">{info().caseNumber}</span>
              <span class="ueu-pill" data-status={info().status.toLowerCase()}>{info().status}</span>
              <Show when={info().type}>
                <span class="ueu-pill-outline">{info().type}</span>
              </Show>
            </div>
            <Show when={info().subject}>
              <p class="ueu-subject">{info().subject}</p>
            </Show>
          </article>
        )}
      </Show>

      {/* Dishonesty details */}
      <Show when={dishonesty()}>
        {d => (
          <article>
            <h3 class="ueu-label">Academic Dishonesty</h3>
            <div class="ueu-case-meta">
              <span class="ueu-pill" data-incident>{INCIDENT_LABELS[d().incidentType] ?? d().incidentType}</span>
            </div>
            <dl class="ueu-case-fields">
              <Show when={d().courseOfferingName}>
                <dt>Course</dt><dd>{d().courseOfferingName}</dd>
              </Show>
              <Show when={d().assignmentName}>
                <dt>Assignment</dt><dd>{d().assignmentName}</dd>
              </Show>
              <Show when={d().instructor}>
                <dt>Instructor</dt><dd>{d().instructor}</dd>
              </Show>
              <Show when={d().severity}>
                <dt>Severity</dt><dd>{d().severity}</dd>
              </Show>
            </dl>
          </article>
        )}
      </Show>

      {/* Grade appeal */}
      <Show when={gradeAppeal()}>
        {g => (
          <article>
            <h3 class="ueu-label">Grade Appeal</h3>
            <dl class="ueu-case-fields">
              <Show when={g().courseOfferingName}>
                <dt>Course</dt><dd>{g().courseOfferingName}</dd>
              </Show>
              <Show when={g().currentGrade}>
                <dt>Current Grade</dt><dd>{g().currentGrade}</dd>
              </Show>
              <Show when={g().changedGrade}>
                <dt>Changed To</dt><dd>{g().changedGrade}</dd>
              </Show>
              <Show when={g().decisionStatus}>
                <dt>Decision</dt><dd>{g().decisionStatus}</dd>
              </Show>
              <Show when={g().instructor}>
                <dt>Instructor</dt><dd>{g().instructor}</dd>
              </Show>
            </dl>
          </article>
        )}
      </Show>

      {/* Canvas link */}
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
            <Show when={c().studentId}>
              <h3 class="ueu-label" style={{"margin-top": "0.75rem"}}>Student in Canvas</h3>
              <p class="ueu-muted" style={{"margin-bottom": "0.4rem"}}>{c().studentName}</p>
              <div class="ueu-canvas-links">
                <a href={`${c().url}/grades/${c().studentId}`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                  Grades &rarr;
                </a>
                <a href={`https://unity.instructure.com/users/${c().studentId}`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                  Profile &rarr;
                </a>
                <a href={`https://unity.instructure.com/users/${c().studentId}/masquerade`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                  Act as &rarr;
                </a>
              </div>
            </Show>
          </article>
        )}
      </Show>

      {/* No data state */}
      <Show when={!loading() && !caseData() && !error()}>
        <p class="ueu-muted">Navigate to a Case or Course Offering page.</p>
      </Show>
    </div>
  )
}
