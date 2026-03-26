/**
 * HistoryDrawer — prior cases list with subtype + status filter chips.
 *
 * Split into two parts:
 *   HistoryToggle — inline button (renders inside CaseView)
 *   HistoryPanel  — drawer content (rendered by Overlay as a flex sibling)
 *
 * They share state via signals created in CaseView and threaded through props.
 */

import { createSignal, createMemo, Show, For, type Accessor, type Setter } from "solid-js"
import type { useStore } from "./useStore"
import type { PriorCase } from "../content/case-types"

export interface HistoryDrawerState {
  drawerOpen: Accessor<boolean>
  setDrawerOpen: Setter<boolean>
  subTypeFilter: Accessor<string>
  setSubTypeFilter: Setter<string>
  statusFilter: Accessor<string>
  setStatusFilter: Setter<string>
}

export function createHistoryState(): HistoryDrawerState {
  const [drawerOpen, setDrawerOpen] = createSignal(false)
  const [subTypeFilter, setSubTypeFilter] = createSignal("")
  const [statusFilter, setStatusFilter] = createSignal("")
  return { drawerOpen, setDrawerOpen, subTypeFilter, setSubTypeFilter, statusFilter, setStatusFilter }
}

/** Inline toggle button — rendered inside CaseView */
export function HistoryToggle(props: {
  get: ReturnType<typeof useStore>
  state: HistoryDrawerState
  onToggle?: (open: boolean) => void
}) {
  const caseData = props.get("caseData")
  const priorCases = props.get("priorCases")
  const loadingPriorCases = props.get("loadingPriorCases")
  const s = props.state

  const filteredCount = createMemo(() => {
    const cases = priorCases()
    if (!cases) return null
    const st = s.subTypeFilter()
    const sf = s.statusFilter()
    if (!st && !sf) return null
    let result = cases
    if (st) result = result.filter(c => c.subType === st)
    if (sf) result = result.filter(c => c.status === sf)
    return result.length
  })

  function toggle() {
    const next = !s.drawerOpen()
    s.setDrawerOpen(next)
    props.onToggle?.(next)
  }

  return (
    <Show when={caseData()}>
      <article>
        <button class="ueu-history-toggle" onClick={toggle}>
          <span class="ueu-label" style={{"margin": "0"}}>Student History</span>
          <Show when={priorCases() !== null}>
            <span class="ueu-history-count">
              {filteredCount() !== null ? `${filteredCount()}/${priorCases()!.length}` : priorCases()!.length}
            </span>
          </Show>
          <Show when={loadingPriorCases()}>
            <span class="ueu-history-count" style={{"color": "#888"}}>…</span>
          </Show>
          <span class="ueu-drawer-arrow" classList={{"ueu-drawer-arrow-open": s.drawerOpen()}}>&rsaquo;</span>
        </button>
      </article>
    </Show>
  )
}

/** Drawer panel — rendered by Overlay as a flex sibling of the main panel */
export function HistoryPanel(props: {
  get: ReturnType<typeof useStore>
  state: HistoryDrawerState
  onClose: () => void
}) {
  const caseData = props.get("caseData")
  const priorCases = props.get("priorCases")
  const loadingPriorCases = props.get("loadingPriorCases")
  const s = props.state

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

  const statuses = createMemo(() => {
    const cases = priorCases()
    if (!cases) return []
    const set = new Set<string>()
    for (const c of cases) {
      if (c.status && c.status !== "Unknown") set.add(c.status)
    }
    return [...set].sort()
  })

  const filteredCases = createMemo(() => {
    const cases = priorCases()
    if (!cases) return null
    const st = s.subTypeFilter()
    const sf = s.statusFilter()
    let result = cases
    if (st) result = result.filter(c => c.subType === st)
    if (sf) result = result.filter(c => c.status === sf)
    return result
  })

  return (
    <div class="ueu-drawer">
      <header class="ueu-drawer-header">
        <h3 class="ueu-label" style={{"margin": "0"}}>Student History</h3>
        <button class="ueu-drawer-close" onClick={props.onClose}>&times;</button>
      </header>

      <Show when={subTypes().length > 0}>
        <div class="ueu-filter-chips">
          <button class="ueu-chip" classList={{"ueu-chip-active": s.subTypeFilter() === ""}} onClick={() => s.setSubTypeFilter("")}>All</button>
          <For each={subTypes()}>
            {st => (
              <button class="ueu-chip" classList={{"ueu-chip-active": s.subTypeFilter() === st}} onClick={() => s.setSubTypeFilter(s.subTypeFilter() === st ? "" : st)}>{st}</button>
            )}
          </For>
        </div>
      </Show>

      <Show when={statuses().length > 1}>
        <div class="ueu-filter-chips">
          <button class="ueu-chip" classList={{"ueu-chip-active": s.statusFilter() === ""}} onClick={() => s.setStatusFilter("")}>Any status</button>
          <For each={statuses()}>
            {s2 => (
              <button class="ueu-chip" classList={{"ueu-chip-active": s.statusFilter() === s2}} onClick={() => s.setStatusFilter(s.statusFilter() === s2 ? "" : s2)}>{s2}</button>
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
  )
}

function HistoryCard(props: { case: PriorCase; currentCaseNumber: string | null }) {
  const c = props.case
  const isCurrent = () => c.caseNumber === props.currentCaseNumber
  return (
    <li class="ueu-history-card" classList={{"ueu-history-current": isCurrent()}} data-status={c.status.toLowerCase()}>
      <div class="ueu-history-card-top">
        <a href={`/lightning/r/Case/${c.id}/view`} target="_blank" rel="noopener noreferrer" class="ueu-case-link">
          {c.caseNumber}
          <Show when={isCurrent()}><span class="ueu-current-marker"> (this case)</span></Show>
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
          <span class="ueu-history-type">
            {c.status !== "Unknown" ? " · " : ""}{c.type !== "Unknown" ? c.type : ""}{c.subType ? `${c.type !== "Unknown" ? " · " : ""}${c.subType}` : ""}
          </span>
        </Show>
      </div>
      <Show when={c.subject}>
        <div class="ueu-history-card-subject">{c.subject}</div>
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
