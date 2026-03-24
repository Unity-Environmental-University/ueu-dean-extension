/**
 * CourseOfferingView — roster + grades for a CourseOffering page.
 *
 * Shows instructor, Canvas course link, and enrolled students with
 * current scores, grades, and last activity dates.
 */

import { createSignal, Show, For } from "solid-js"
import type { EnrolledStudent } from "../content/load-course-offering"
import { scoreColor, formatScore, formatLda } from "./format"
import { useStore } from "./useStore"
import { CANVAS_URL } from "../constants"

type SortKey = "name" | "score" | "lda"

export function CourseOfferingView() {
  const get = useStore()

  const [sortKey, setSortKey] = createSignal<SortKey>("name")
  const [sortAsc, setSortAsc] = createSignal(true)

  const data = get("offeringData")
  const loading = get("loading")
  const error = get("error")

  function toggleSort(key: SortKey) {
    if (sortKey() === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(key === "name") }
  }

  const rosterStats = () => {
    const d = data()
    if (!d || d.students.length === 0) return null
    const students = d.students
    const withScores = students.filter(s => s.currentScore !== null)
    const avg = withScores.length > 0
      ? withScores.reduce((sum, s) => sum + s.currentScore!, 0) / withScores.length
      : null
    const below70 = withScores.filter(s => s.currentScore! < 70).length
    const now = Date.now()
    const fourteenDays = 14 * 24 * 60 * 60 * 1000
    const inactive = students.filter(s => {
      if (!s.lastActivityAt) return true
      return now - new Date(s.lastActivityAt).getTime() > fourteenDays
    }).length
    return { total: students.length, withScores: withScores.length, avg, below70, inactive }
  }

  const sorted = () => {
    const d = data()
    if (!d) return []
    const students = [...d.students]
    const key = sortKey()
    const asc = sortAsc()
    students.sort((a, b) => {
      let cmp = 0
      if (key === "name") cmp = a.name.localeCompare(b.name)
      else if (key === "score") cmp = (a.currentScore ?? -1) - (b.currentScore ?? -1)
      else if (key === "lda") cmp = (a.lastActivityAt ?? "").localeCompare(b.lastActivityAt ?? "")
      return asc ? cmp : -cmp
    })
    return students
  }

  function SortHeader(props: { label: string; key: SortKey }) {
    const active = () => sortKey() === props.key
    const arrow = () => active() ? (sortAsc() ? " ↑" : " ↓") : ""
    return (
      <th
        class="ueu-roster-th"
        classList={{"ueu-roster-th-active": active()}}
        onClick={() => toggleSort(props.key)}
      >
        {props.label}{arrow()}
      </th>
    )
  }

  return (
    <div>
      <Show when={loading()}>
        <p class="ueu-muted">Loading...</p>
      </Show>

      <Show when={error()}>
        <p class="ueu-error">{error()}</p>
      </Show>

      <Show when={data()}>
        {d => (
          <>
            {/* Header */}
            <Show when={d().offeringName}>
              <h3 class="ueu-label">{d().offeringName}</h3>
            </Show>

            <Show when={d().termName}>
              <p class="ueu-muted" style={{"margin": "0 0 0.5rem"}}>{d().termName}</p>
            </Show>

            {/* Instructor + Canvas link */}
            <div class="ueu-co-meta">
              <Show when={d().instructorName}>
                <span class="ueu-co-instructor">
                  <span class="ueu-muted">Instructor: </span>
                  {d().instructorName}
                </span>
              </Show>
              <Show when={d().canvasCourseUrl}>
                <a
                  href={d().canvasCourseUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="ueu-canvas-link"
                >
                  Canvas &rarr;
                </a>
              </Show>
            </div>

            <Show when={d().error === "canvas-session-required"}>
              <div class="ueu-canvas-session-prompt">
                <p>Canvas session required for grades.</p>
                <p>
                  <a href={CANVAS_URL} target="_blank" rel="noopener noreferrer">
                    Open Canvas
                  </a>
                  {" "}and log in.
                </p>
              </div>
            </Show>

            {/* Roster */}
            <Show when={d().students.length > 0}>
              <div class="ueu-roster-summary">
                <span>{rosterStats()?.total} students</span>
                <Show when={rosterStats()?.avg !== null}>
                  <span class="ueu-roster-stat">
                    avg <strong style={{"color": scoreColor(rosterStats()!.avg!)}}>{rosterStats()!.avg!.toFixed(1)}%</strong>
                  </span>
                </Show>
                <Show when={rosterStats()?.below70! > 0}>
                  <span class="ueu-roster-stat ueu-roster-warn">
                    {rosterStats()!.below70} below 70%
                  </span>
                </Show>
                <Show when={rosterStats()?.inactive! > 0}>
                  <span class="ueu-roster-stat ueu-roster-warn">
                    {rosterStats()!.inactive} inactive 14d+
                  </span>
                </Show>
              </div>
              <table class="ueu-roster">
                <thead>
                  <tr>
                    <SortHeader label="Name" key="name" />
                    <SortHeader label="Score" key="score" />
                    <SortHeader label="Last Active" key="lda" />
                  </tr>
                </thead>
                <tbody>
                  <For each={sorted()}>
                    {(s: EnrolledStudent) => (
                      <tr class="ueu-roster-row">
                        <td class="ueu-roster-name">
                          <Show when={s.accountId} fallback={<span>{s.name}</span>}>
                            <a
                              href={`/lightning/r/Account/${s.accountId}/view`}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="ueu-case-link"
                            >
                              {s.name}
                            </a>
                          </Show>
                        </td>
                        <td class="ueu-roster-score" style={{"color": scoreColor(s.currentScore)}}>
                          {formatScore(s.currentScore)}
                          <Show when={s.currentGrade}>
                            <span class="ueu-grade" style={{"margin-left": "0.25rem"}}>{s.currentGrade}</span>
                          </Show>
                        </td>
                        <td class="ueu-roster-lda">{formatLda(s.lastActivityAt)}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>

            <Show when={!d().error && d().students.length === 0 && !loading()}>
              <p class="ueu-muted">No enrolled students found.</p>
            </Show>
          </>
        )}
      </Show>

      <Show when={!loading() && !data() && !error()}>
        <p class="ueu-muted">Loading course...</p>
      </Show>
    </div>
  )
}
