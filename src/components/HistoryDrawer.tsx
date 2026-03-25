/**
 * HistoryDrawer — prior cases list with subtype filter chips.
 */

import { createSignal, createMemo, Show, For } from "solid-js"
import { acronym } from "./caseViewHelpers"
import type { useStore } from "./useStore"
import type { PriorCase } from "../content/case-types"

export function HistoryDrawer(props: {
  get: ReturnType<typeof useStore>
  onDrawerToggle?: (open: boolean) => void
}) {
  const caseData = props.get("caseData")
  const priorCases = props.get("priorCases")
  const loadingPriorCases = props.get("loadingPriorCases")

  const [drawerOpen, setDrawerOpen] = createSignal(false)
  const [subTypeFilter, setSubTypeFilter] = createSignal("")

  function toggleDrawer() {
    const next = !drawerOpen()
    setDrawerOpen(next)
    props.onDrawerToggle?.(next)
  }

  function setFilter(value: string) {
    setSubTypeFilter(value)
  }

  const subTypes = createMemo(() => {
    const cases = priorCases()
    if (!cases) return []
    const set = new Set<string>()
    for (const c of cases) {
      if (c.subType) set.add(c.subType)
    }
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

  return (
    <>
      {/* Toggle button */}
      <Show when={caseData()}>
        <article>
          <button class="ueu-history-toggle" onClick={toggleDrawer}>
            <span class="ueu-label" style={{"margin": "0"}}>Student History</span>
            <Show when={priorCases() !== null}>
              <span class="ueu-history-count">
                {subTypeFilter() && filteredCases() ? `${filteredCases()!.length}/${priorCases()!.length}` : priorCases()!.length}
              </span>
            </Show>
            <Show when={loadingPriorCases()}>
              <span class="ueu-history-count" style={{"color": "#888"}}>…</span>
            </Show>
            <span class="ueu-drawer-arrow" classList={{"ueu-drawer-arrow-open": drawerOpen()}}>&rsaquo;</span>
          </button>
        </article>
      </Show>

      {/* Drawer content */}
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
                {c => <HistoryCard case={c} currentCaseNumber={caseData()?.caseNumber ?? null} />}
              </For>
            </ul>
          </Show>
        </div>
      </Show>
    </>
  )
}

function HistoryCard(props: { case: PriorCase; currentCaseNumber: string | null }) {
  const c = props.case
  const isCurrent = () => c.caseNumber === props.currentCaseNumber
  return (
    <li class="ueu-history-card" classList={{"ueu-history-current": isCurrent()}}>
      <div class="ueu-history-card-top">
        <a href={`/lightning/r/Case/${c.id}/view`} target="_blank" rel="noopener noreferrer" class="ueu-case-link">
          {c.caseNumber}
          <Show when={isCurrent()}><span class="ueu-current-marker"> (this case)</span></Show>
        </a>
        <span class="ueu-history-right">
          <span class="ueu-history-date">
            {new Date(c.createdDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </span>
          <Show when={c.status !== "Unknown"}>
            <span class="ueu-pill" data-status={c.status.toLowerCase()}>{c.status}</span>
          </Show>
        </span>
      </div>
      <Show when={c.type !== "Unknown" || c.subType}>
        <div class="ueu-history-card-detail">
          <span class="ueu-history-type" title={`${c.type}${c.subType ? ` · ${c.subType}` : ""}`}>
            {c.type !== "Unknown" ? acronym(c.type) : ""}{c.subType ? `${c.type !== "Unknown" ? " · " : ""}${acronym(c.subType)}` : ""}
          </span>
        </div>
      </Show>
      <Show when={c.courseCode || c.courseName || c.termName}>
        <div class="ueu-history-card-course">
          <Show when={c.courseCode || c.courseName}>
            {() => {
              const label = c.courseCode ?? c.courseName!
              return c.courseOfferingId
                ? <a href={`/lightning/r/hed__Course_Offering__c/${c.courseOfferingId}/view`} target="_blank" rel="noopener noreferrer" class="ueu-history-course ueu-history-course-link">{label}</a>
                : <span class="ueu-history-course">{label}</span>
            }}
          </Show>
          <Show when={c.termName}>
            <span class="ueu-history-term-tag">{c.termName}</span>
          </Show>
        </div>
      </Show>
    </li>
  )
}
