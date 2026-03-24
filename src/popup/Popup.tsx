import { createSignal, createResource, For, Show } from "solid-js"
import { fetchJson, fetchAllPages, type CourseData, type AccountData } from "@ueu/canvas-alkahest"

import { CANVAS_URL } from "../constants"
const CANVAS = CANVAS_URL
const cfg = { baseUrl: CANVAS }

async function searchAllCourses(query: string): Promise<CourseData[]> {
  // Try self account first, fall back to account search
  const self = await fetchJson<AccountData[]>(`/api/v1/accounts`, cfg)
  if (self.length > 0) {
    const params = new URLSearchParams({ search_term: query, per_page: "20" })
    return fetchAllPages<CourseData>(
      `/api/v1/accounts/${self[0].id}/courses?${params}`,
      cfg,
    )
  }
  // Fallback: search own courses client-side
  const courses = await fetchAllPages<CourseData>(`/api/v1/courses?per_page=100`, cfg)
  const q = query.toLowerCase()
  return courses.filter(c =>
    c.course_code?.toLowerCase().includes(q) ||
    c.name?.toLowerCase().includes(q)
  )
}

export function Popup() {
  const [query, setQuery] = createSignal("")
  const [search, setSearch] = createSignal<string>()

  const [results] = createResource(search, async (q) => {
    if (!q) return []
    return searchAllCourses(q)
  })

  function onSubmit(e: Event) {
    e.preventDefault()
    const q = query().trim()
    if (q) setSearch(q)
  }

  function openCourse(course: CourseData) {
    chrome.tabs.create({ url: `${CANVAS}/courses/${course.id}` })
  }

  return (
    <div style={{ padding: "0.75rem", width: "400px", "font-family": "system-ui, sans-serif", "font-size": "13px" }}>
      <form onSubmit={onSubmit} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          autofocus
          type="text"
          placeholder="Course code (e.g. ENV1001)"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          style={{ flex: 1, padding: "0.4rem 0.5rem", border: "1px solid #ccc", "border-radius": "4px", "font-size": "13px" }}
        />
        <button type="submit" style={{ padding: "0.4rem 0.75rem", "border-radius": "4px", border: "1px solid #ccc", cursor: "pointer", "font-size": "13px" }}>
          Go
        </button>
      </form>

      <Show when={results.loading}>
        <p style={{ margin: "0.5rem 0 0", color: "#888" }}>Searching...</p>
      </Show>

      <Show when={results.error}>
        <p style={{ margin: "0.5rem 0 0", color: "#c33" }}>
          {results.error?.message ?? "Search failed"}
        </p>
      </Show>

      <Show when={results()?.length}>
        <ul style={{ margin: "0.5rem 0 0", padding: 0, "list-style": "none" }}>
          <For each={results()}>
            {(course) => (
              <li
                onClick={() => openCourse(course)}
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

      <Show when={results() && results()!.length === 0 && search()}>
        <p style={{ margin: "0.5rem 0 0", color: "#888" }}>No courses found</p>
      </Show>
    </div>
  )
}
