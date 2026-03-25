// @vitest-environment node
import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { probeCanvasMasquerade, loadCanvasConversations, type LoadMessagesDeps } from "./load-canvas-messages"

function makeDeps(overrides: Partial<{
  hasSession: boolean
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
    checkSession: async () => overrides.hasSession ?? true,
    isStale: () => callCount > staleAfter,
  }
}

// ── probeCanvasMasquerade ────────────────────────────────────────────────────

describe("probeCanvasMasquerade", () => {
  it("no session → null (unknown)", async () => {
    const deps = makeDeps({ hasSession: false })
    const result = await probeCanvasMasquerade("42", deps)
    expect(result).toBeNull()
  })

  it("session + successful fetch → true", async () => {
    const deps = makeDeps({
      hasSession: true,
      canvasFetchResults: [{ id: 42 }],
    })
    const result = await probeCanvasMasquerade("42", deps)
    expect(result).toBe(true)
  })

  it("session + fetch throws → false", async () => {
    const deps = makeDeps({
      hasSession: true,
      canvasFetchError: new Error("403 Forbidden"),
    })
    const result = await probeCanvasMasquerade("42", deps)
    expect(result).toBe(false)
  })

  it("prop: result is always null, true, or false", async () => {
    await fc.assert(fc.asyncProperty(
      fc.boolean(),
      fc.boolean(),
      async (hasSession, fetchSucceeds) => {
        const deps = makeDeps({
          hasSession,
          ...(fetchSucceeds
            ? { canvasFetchResults: [{ id: 1 }] }
            : { canvasFetchError: new Error("fail") }),
        })
        const result = await probeCanvasMasquerade("1", deps)
        expect([null, true, false]).toContain(result)
      }
    ), { numRuns: 10 })
  })
})

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
      checkSession: async () => true,
      isStale: () => false,
    }

    const result = await loadCanvasConversations("42", null, deps)

    expect(result.conversations).toHaveLength(1)
    expect(result.conversations[0].messages).toEqual([])  // fallback
  })
})
