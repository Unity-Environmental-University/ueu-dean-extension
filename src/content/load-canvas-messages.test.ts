// @vitest-environment node
import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { loadCanvasConversations, type LoadMessagesDeps } from "./load-canvas-messages"

function makeDeps(overrides: Partial<{
  canvasFetchResults: unknown[]
  canvasFetchError: Error
  staleAfter: number
}>): LoadMessagesDeps {
  let callCount = 0
  const staleAfter = overrides.staleAfter ?? Infinity
  const fetchQueue = [...(overrides.canvasFetchResults ?? [])]

  return {
    canvasFetch: async <T>(_path: string): Promise<T> => {
      callCount++
      if (overrides.canvasFetchError) throw overrides.canvasFetchError
      const result = fetchQueue.shift()
      if (result instanceof Error) throw result
      return (result ?? []) as T
    },
    isStale: () => callCount > staleAfter,
  }
}

// ── loadCanvasConversations ──────────────────────────────────────────────────

describe("loadCanvasConversations", () => {
  it("happy path: fetches list + detail for up to 5 conversations", async () => {
    const list = Array.from({ length: 7 }, (_, i) => ({
      id: i + 1,
      subject: `Convo ${i + 1}`,
      last_message_at: "2025-11-01T00:00:00Z",
      message_count: 2,
      participants: [{ id: 1, name: "A" }],
    }))
    const details = list.slice(0, 5).map(item => ({
      ...item,
      messages: [{ id: 100, created_at: "2025-11-01T00:00:00Z", body: "Hello", author_id: 1, generated: false }],
    }))

    const deps = makeDeps({
      canvasFetchResults: [list, ...details],
    })

    const result = await loadCanvasConversations("42", "99", deps)

    expect(result.error).toBeNull()
    expect(result.conversations).toHaveLength(5) // capped at 5
    expect(result.conversations[0].messages).toHaveLength(1)
  })

  it("empty inbox → empty conversations, no error", async () => {
    const deps = makeDeps({
      canvasFetchResults: [[]],
    })

    const result = await loadCanvasConversations("42", null, deps)

    expect(result.conversations).toEqual([])
    expect(result.error).toBeNull()
  })

  it("401/403 → no-permission error", async () => {
    const deps = makeDeps({
      canvasFetchError: new Error("Canvas API 401: Unauthorized"),
    })

    const result = await loadCanvasConversations("42", null, deps)

    expect(result.error).toBe("no-permission")
    expect(result.conversations).toEqual([])
  })

  it("stale before list fetch → empty result", async () => {
    const deps = makeDeps({
      canvasFetchResults: [[{ id: 1, subject: "A", last_message_at: "2025-01-01T00:00:00Z", message_count: 1, participants: [] }]],
      staleAfter: 0, // stale immediately
    })

    const result = await loadCanvasConversations("42", null, deps)

    // isStale checked after list fetch — returns empty conversations
    expect(result.conversations).toEqual([])
    expect(result.error).toBeNull()
  })

  it("detail fetch failure → fallback to conversation without messages", async () => {
    const list = [
      { id: 1, subject: "Test", last_message_at: "2025-01-01T00:00:00Z", message_count: 1, participants: [{ id: 1, name: "A" }] },
    ]
    let fetchCount = 0
    const deps: LoadMessagesDeps = {
      canvasFetch: async <T>(_path: string): Promise<T> => {
        fetchCount++
        if (fetchCount === 1) return list as T  // list succeeds
        throw new Error("detail failed")        // detail fails
      },
      isStale: () => false,
    }

    const result = await loadCanvasConversations("42", null, deps)

    expect(result.conversations).toHaveLength(1)
    expect(result.conversations[0].messages).toEqual([])  // fallback
  })
})
