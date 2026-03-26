import { createSignal, createResource, For, Show } from "solid-js"
import { fetchJson, fetchAllPages, type CourseData, type AccountData } from "@ueu/canvas-alkahest"

import { CANVAS_URL } from "../constants"
const CANVAS = CANVAS_URL
const cfg = { baseUrl: CANVAS }

interface CanvasUser {
  id: number
  name: string
  email?: string
  login_id?: string
}

type SearchMode = "course" | "student" | "instructor"
type SearchResult = { mode: SearchMode; courses: CourseData[]; people: CanvasUser[] }

/** Guess whether a query is a course code or a person name */
function guessMode(query: string): SearchMode {
  // Has digits → probably a course code (BIO101, ENV1001)
  if (/\d/.test(query)) return "course"
  return "student"
}

let cachedAccountId: number | null = null

async function getAccountId(): Promise<number | null> {
  if (cachedAccountId !== null) return cachedAccountId
  try {
    const accounts = await fetchJson<AccountData[]>(`/api/v1/accounts`, cfg)
    cachedAccountId = accounts.length > 0 ? accounts[0].id : null
  } catch {
    cachedAccountId = null
  }
  return cachedAccountId
}

async function searchCourses(query: string): Promise<CourseData[]> {
  const accountId = await getAccountId()
  if (accountId) {
    return fetchJson<CourseData[]>(
      `/api/v1/accounts/${accountId}/courses?search_term=${encodeURIComponent(query)}&per_page=15`, cfg
    )
  }
  // Fallback: client-side filter
  const courses = await fetchAllPages<CourseData>(`/api/v1/courses?per_page=100`, cfg)
  const q = query.toLowerCase()
  return courses.filter(c =>
    c.course_code?.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q)
  ).slice(0, 15)
}

async function searchPeople(query: string, mode: "student" | "instructor"): Promise<CanvasUser[]> {
  const accountId = await getAccountId()
  if (!accountId) return []
  const params = new URLSearchParams({
    search_term: query,
    per_page: "15",
    include: "email",
    enrollment_type: mode === "instructor" ? "teacher" : "student",
  })
  return fetchJson<CanvasUser[]>(`/api/v1/accounts/${accountId}/users?${params}`, cfg)
}

async function doSearch(query: string, mode: SearchMode): Promise<SearchResult> {
  if (mode === "course") {
    return { mode, courses: await searchCourses(query), people: [] }
  }
  return { mode, courses: [], people: await searchPeople(query, mode) }
}

export function Popup() {
  const [query, setQuery] = createSignal("")
  const [mode, setMode] = createSignal<SearchMode>("course")
  const [searchTrigger, setSearchTrigger] = createSignal<{ q: string; m: SearchMode } | undefined>()

  const [results] = createResource(searchTrigger, async (trigger) => {
    if (!trigger) return null
    return doSearch(trigger.q, trigger.m)
  })

  function submit(overrideMode?: SearchMode) {
    const q = query().trim()
    if (!q) return
    const m = overrideMode ?? mode()
    setMode(m)
    setSearchTrigger({ q, m })
  }

  function onInput(value: string) {
    setQuery(value)
    const q = value.trim()
    if (q) setMode(guessMode(q))
  }

  function onSubmit(e: Event) {
    e.preventDefault()
    submit()
  }

  const chipStyle = (active: boolean) => ({
    padding: "2px 8px",
    "border-radius": "3px",
    border: "1px solid " + (active ? "#2d6a4f" : "#ddd"),
    background: active ? "#2d6a4f" : "white",
    color: active ? "white" : "#666",
    cursor: "pointer",
    "font-size": "11px",
    "font-weight": active ? "600" : "400",
    transition: "all 0.15s ease",
  })

  return (
    <div style={{ padding: "0.75rem", width: "420px", "font-family": "system-ui, sans-serif", "font-size": "13px" }}>
      <form onSubmit={onSubmit} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          autofocus
          type="text"
          placeholder={
            mode() === "course" ? "Course code (e.g. BIO101)..." :
            mode() === "instructor" ? "Instructor name or email..." :
            "Student name or email..."
          }
          value={query()}
          onInput={(e) => onInput(e.currentTarget.value)}
          style={{ flex: 1, padding: "0.4rem 0.5rem", border: "1px solid #ccc", "border-radius": "4px", "font-size": "13px" }}
        />
        <button type="submit" style={{ padding: "0.4rem 0.75rem", "border-radius": "4px", border: "1px solid #ccc", cursor: "pointer", "font-size": "13px" }}>
          Go
        </button>
      </form>

      {/* Mode chips */}
      <div style={{ display: "flex", gap: "0.3rem", "margin-top": "0.4rem" }}>
        <button style={chipStyle(mode() === "course")} onClick={() => { setMode("course"); submit("course") }}>
          Courses
        </button>
        <button style={chipStyle(mode() === "student")} onClick={() => { setMode("student"); submit("student") }}>
          Students
        </button>
        <button style={chipStyle(mode() === "instructor")} onClick={() => { setMode("instructor"); submit("instructor") }}>
          Instructors
        </button>
      </div>

      <Show when={results.loading}>
        <p style={{ margin: "0.5rem 0 0", color: "#888" }}>Searching...</p>
      </Show>

      <Show when={results.error}>
        <p style={{ margin: "0.5rem 0 0", color: "#c33" }}>
          {results.error?.message ?? "Search failed"}
        </p>
      </Show>

      {/* People results */}
      <Show when={(results()?.people.length ?? 0) > 0}>
        <ul style={{ margin: "0.5rem 0 0", padding: 0, "list-style": "none" }}>
          <For each={results()!.people}>
            {(user) => (
              <li
                onClick={() => chrome.tabs.create({ url: `${CANVAS}/users/${user.id}` })}
                style={{ padding: "0.35rem 0.5rem", cursor: "pointer", "border-radius": "4px", display: "flex", "align-items": "baseline", gap: "0.5rem" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f0f0")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <strong style={{ flex: 1 }}>{user.name}</strong>
                <Show when={user.email}>
                  <span style={{ color: "#999", "font-size": "11px" }}>{user.email}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>

      {/* Course results */}
      <Show when={(results()?.courses.length ?? 0) > 0}>
        <ul style={{ margin: "0.5rem 0 0", padding: 0, "list-style": "none" }}>
          <For each={results()!.courses}>
            {(course) => (
              <li
                onClick={() => chrome.tabs.create({ url: `${CANVAS}/courses/${course.id}` })}
                style={{ padding: "0.4rem 0.5rem", cursor: "pointer", "border-radius": "4px" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f0f0")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <strong>{course.course_code}</strong>
                <span style={{ color: "#666", "margin-left": "0.5rem" }}>{course.name}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={results() && (results()!.courses.length + results()!.people.length === 0) && searchTrigger()}>
        <p style={{ margin: "0.5rem 0 0", color: "#888" }}>No results found</p>
      </Show>
    </div>
  )
}
