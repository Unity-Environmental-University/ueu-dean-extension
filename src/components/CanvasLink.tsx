/**
 * CaseView — reads from the reactive API-driven state.
 *
 * Shows case info, dishonesty details, and Canvas link.
 * All data comes from SF REST API — no DOM scraping.
 */

import { createSignal, onCleanup, Show, createEffect, For, createMemo } from "solid-js"
import browser from "webextension-polyfill"
import { state, refresh } from "../content/core"
import { getSettings, saveSettings } from "../content/permissions"

const INCIDENT_LABELS: Record<string, string> = {
  plagiarism: "Plagiarism",
  cheating: "Cheating",
  fabrication: "Fabrication",
  other: "Other",
}

export function CanvasLink(props: { onDrawerToggle?: (open: boolean) => void }) {
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
  const page = () => { version(); return state.page }
  const priorCases = () => { version(); return state.priorCases }
  const loadingPriorCases = () => { version(); return state.loadingPriorCases }
  const instructor = () => { version(); return state.instructor }
  const anyError = () => error() || courseOfferingError() || (studentError() && studentError() !== "canvas-session-required")

  // Drawer state
  const [drawerOpen, setDrawerOpen] = createSignal(false)
  const [subTypeFilter, setSubTypeFilter] = createSignal("")

  // Load sticky filter, then auto-select current case's subtype if no sticky value
  getSettings().then(s => {
    if (s.historySubTypeFilter) {
      setSubTypeFilter(s.historySubTypeFilter)
    }
  })

  // Auto-select current case's subtype when case data loads (only if no sticky override)
  createEffect(() => {
    const sub = caseData()?.subType
    if (sub && !subTypeFilter()) {
      setSubTypeFilter(sub)
    }
  })

  function toggleDrawer() {
    const next = !drawerOpen()
    setDrawerOpen(next)
    props.onDrawerToggle?.(next)
  }

  function setFilter(value: string) {
    setSubTypeFilter(value)
    saveSettings({ historySubTypeFilter: value })
  }

  // Unique subtypes from prior cases for filter chips
  const subTypes = createMemo(() => {
    const cases = priorCases()
    if (!cases) return []
    const set = new Set<string>()
    for (const c of cases) {
      if (c.subType) set.add(c.subType)
    }
    // Also include current case's subtype
    const current = caseData()?.subType
    if (current) set.add(current)
    return [...set].sort()
  })

  const filteredCases = createMemo(() => {
    const cases = priorCases()
    if (!cases) return null
    const filter = subTypeFilter()
    if (!filter) return cases
    return cases.filter(c => c.subType === filter)
  })

  const [reportStatus, setReportStatus] = createSignal<"idle" | "sending" | "sent" | "error">("idle")

  async function sendReport() {
    setReportStatus("sending")
    try {
      const settings = await getSettings()
      const caseNum = state.caseData?.caseNumber ?? state.page?.recordId ?? "unknown"
      const lines = [
        `[ueu-dean-tools diagnostic] case ${caseNum}`,
        `[url] ${window.location.pathname}`,
        `[page] ${JSON.stringify(state.page)}`,
        `[errors] sf=${state.error ?? "null"} co=${state.courseOfferingError ?? "null"} student=${state.studentError ?? "null"}`,
        `[canvas] courseId=${state.canvas?.courseId ?? "null"} studentId=${state.canvas?.studentId ?? "null"}`,
        `[diagnostics]`,
        ...state.diagnostics.map(d => `  ${d.type}: ${d.detail}`),
      ]
      await browser.runtime.sendMessage({
        type: "canvas-message",
        recipientId: settings.supportCanvasId,
        subject: `Dean Tools issue — case ${caseNum}`,
        body: lines.join("\n"),
      })
      setReportStatus("sent")
      setTimeout(() => setReportStatus("idle"), 3000)
    } catch {
      setReportStatus("error")
      setTimeout(() => setReportStatus("idle"), 3000)
    }
  }

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

      {/* Prior cases — drawer toggle */}
      <Show when={caseData()}>
        <article>
          <button class="ueu-history-toggle" onClick={toggleDrawer}>
            <span class="ueu-label" style={{"margin": "0"}}>Student History</span>
            <Show when={priorCases() !== null}>
              <span class="ueu-history-count">{priorCases()!.length}</span>
            </Show>
            <Show when={loadingPriorCases()}>
              <span class="ueu-history-count" style={{"color": "#888"}}>…</span>
            </Show>
            <span class="ueu-drawer-arrow" classList={{"ueu-drawer-arrow-open": drawerOpen()}}>&rsaquo;</span>
          </button>
        </article>
      </Show>

      {/* Prior cases drawer */}
      <Show when={drawerOpen()}>
        <div class="ueu-drawer">
          <header class="ueu-drawer-header">
            <h3 class="ueu-label" style={{"margin": "0"}}>Student History</h3>
            <button class="ueu-drawer-close" onClick={() => { setDrawerOpen(false); props.onDrawerToggle?.(false) }}>&times;</button>
          </header>

          {/* Subtype filter chips */}
          <Show when={subTypes().length > 0}>
            <div class="ueu-filter-chips">
              <button
                class="ueu-chip"
                classList={{"ueu-chip-active": subTypeFilter() === ""}}
                onClick={() => setFilter("")}
              >All</button>
              <For each={subTypes()}>
                {st => (
                  <button
                    class="ueu-chip"
                    classList={{"ueu-chip-active": subTypeFilter() === st}}
                    onClick={() => setFilter(subTypeFilter() === st ? "" : st)}
                  >{st}</button>
                )}
              </For>
            </div>
          </Show>

          <Show when={loadingPriorCases()}>
            <p class="ueu-loading">Loading&hellip;</p>
          </Show>
          <Show when={!loadingPriorCases() && priorCases() === null}>
            <p class="ueu-muted" style={{"font-size": "0.8rem", "color": "#f59e0b"}}>No contact ID — cannot load history</p>
          </Show>
          <Show when={filteredCases() !== null && filteredCases()!.length === 0}>
            <p class="ueu-muted">
              {priorCases()?.length ? "No cases match this filter." : "No prior cases."}
            </p>
          </Show>
          <Show when={filteredCases() !== null && filteredCases()!.length! > 0}>
            <ul class="ueu-history-list">
              <For each={filteredCases()!}>
                {c => (
                  <li class="ueu-history-card">
                    <a href={`/lightning/r/Case/${c.id}/view`} target="_blank" rel="noopener noreferrer" class="ueu-case-link">{c.caseNumber}</a>
                    <span class="ueu-history-type">{c.type}{c.subType ? ` · ${c.subType}` : ""}</span>
                    <span class="ueu-history-right">
                      <span class="ueu-pill" data-status={c.status.toLowerCase()}>{c.status}</span>
                      <span class="ueu-history-date">{new Date(c.createdDate).toLocaleDateString()}</span>
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
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
                  <a href={`https://unity.instructure.com/users/${c().studentId}`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                    Profile &rarr;
                  </a>
                  <a href={`https://unity.instructure.com/users/${c().studentId}/masquerade`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                    Act as &rarr;
                  </a>
                </div>
              </Show>
            </Show>
          </article>
        )}
      </Show>

      {/* Instructor */}
      <Show when={instructor()}>
        {i => (
          <article>
            <h3 class="ueu-label">Instructor</h3>
            <p class="ueu-muted" style={{"margin-bottom": "0.4rem"}}>{i().name ?? i().email}</p>
            <Show when={i().canvasId}>
              <div class="ueu-canvas-links">
                <a href={`https://unity.instructure.com/users/${i().canvasId}`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                  Profile &rarr;
                </a>
                <Show when={canvas()}>
                  <a href={`https://unity.instructure.com/courses/${canvas()!.courseId}/users/${i().canvasId}`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                    In Course &rarr;
                  </a>
                </Show>
                <a href={`https://unity.instructure.com/users/${i().canvasId}/masquerade`} target="_blank" rel="noopener noreferrer" class="ueu-canvas-link">
                  Act as &rarr;
                </a>
              </div>
            </Show>
            <Show when={i().email}>
              <div class="ueu-canvas-links" style={{"margin-top": "0.25rem"}}>
                <a href={`mailto:${i().email}`} class="ueu-canvas-link" style={{"font-size": "0.85rem"}}>
                  Email &rarr;
                </a>
              </div>
            </Show>
          </article>
        )}
      </Show>

      {/* No data state */}
      <Show when={!loading() && !caseData() && !canvas() && !error()}>
        <Show when={page()} fallback={
          <p class="ueu-muted">Navigate to a Case or Course Offering page.</p>
        }>
          <p class="ueu-muted">Detecting page<span class="ueu-ellipsis">…</span></p>
        </Show>
      </Show>

      {/* Report button — appears when anything went wrong */}
      <Show when={anyError()}>
        <div class="ueu-report">
          <button
            class="ueu-btn-report"
            disabled={reportStatus() === "sending"}
            onClick={sendReport}
          >
            {reportStatus() === "sending" ? "Sending…" : reportStatus() === "sent" ? "Sent!" : reportStatus() === "error" ? "Failed — try again" : "Report issue"}
          </button>
        </div>
      </Show>
    </div>
  )
}
