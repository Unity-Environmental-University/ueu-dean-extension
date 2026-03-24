import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { isCanvasAuthError, CANVAS_HOST, CANVAS_URL } from "./constants"

describe("isCanvasAuthError", () => {
  it("prop: any Error with '401' in message is detected", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (prefix, suffix) => {
        const err = new Error(`${prefix}401${suffix}`)
        expect(isCanvasAuthError(err)).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it("prop: errors without '401' are not detected", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }).filter(s => !s.includes("401")),
        (msg) => {
          expect(isCanvasAuthError(new Error(msg))).toBe(false)
        },
      ),
      { numRuns: 100 },
    )
  })

  it("prop: string inputs are coerced and checked", () => {
    fc.assert(
      fc.property(fc.string(), (msg) => {
        const result = isCanvasAuthError(msg)
        expect(result).toBe(msg.includes("401"))
      }),
      { numRuns: 100 },
    )
  })

  it("handles real Canvas error message formats", () => {
    // These are the actual formats from the SF/Canvas proxy
    expect(isCanvasAuthError(new Error("Canvas API 401: /api/v1/users/123/courses"))).toBe(true)
    expect(isCanvasAuthError(new Error("401: Unauthorized"))).toBe(true)
    expect(isCanvasAuthError(new Error("401 Unauthorized"))).toBe(true)
    expect(isCanvasAuthError(new Error("Canvas API 403: Forbidden"))).toBe(false)
    expect(isCanvasAuthError(new Error("Canvas API 500: Internal Server Error"))).toBe(false)
  })
})

describe("CANVAS_URL", () => {
  it("is https + CANVAS_HOST", () => {
    expect(CANVAS_URL).toBe(`https://${CANVAS_HOST}`)
  })

  it("is a valid URL", () => {
    expect(() => new URL(CANVAS_URL)).not.toThrow()
  })
})
