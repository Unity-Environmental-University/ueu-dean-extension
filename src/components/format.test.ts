import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { scoreColor, formatScore, formatLda } from "./format"

describe("scoreColor", () => {
  it("prop: null always yields gray", () => {
    expect(scoreColor(null)).toBe("#888")
  })

  it("prop: color thresholds are monotonic (higher score → greener)", () => {
    // Define the expected order from best to worst
    const thresholds = [
      { min: 90, color: "#16a34a" },
      { min: 80, color: "#65a30d" },
      { min: 70, color: "#ca8a04" },
      { min: 60, color: "#ea580c" },
      { min: 0, color: "#dc2626" },
    ]

    fc.assert(
      fc.property(fc.double({ min: 0, max: 100, noNaN: true }), (score) => {
        const color = scoreColor(score)
        const expected = thresholds.find(t => score >= t.min)!
        expect(color).toBe(expected.color)
      }),
      { numRuns: 200 },
    )
  })

  it("prop: scores in same band always yield same color", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (a, b) => {
          // If both are in the same 10-point band, same color
          const band = (n: number) => n >= 90 ? 90 : n >= 80 ? 80 : n >= 70 ? 70 : n >= 60 ? 60 : 0
          if (band(a) === band(b)) {
            expect(scoreColor(a)).toBe(scoreColor(b))
          }
        },
      ),
      { numRuns: 100 },
    )
  })
})

describe("formatScore", () => {
  it("prop: null always yields em-dash", () => {
    expect(formatScore(null)).toBe("—")
  })

  it("prop: result always ends with %", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (score) => {
        expect(formatScore(score)).toMatch(/%$/)
      }),
    )
  })

  it("prop: result always has exactly one decimal place", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 200, noNaN: true }), (score) => {
        const result = formatScore(score)
        // Matches "NN.N%" pattern
        expect(result).toMatch(/\.\d%$/)
      }),
      { numRuns: 200 },
    )
  })

  it("prop: round-trip — parsing the formatted score recovers the original (to 1 decimal)", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 200, noNaN: true }), (score) => {
        const formatted = formatScore(score)
        const parsed = parseFloat(formatted.replace("%", ""))
        expect(parsed).toBeCloseTo(score, 1)
      }),
      { numRuns: 200 },
    )
  })
})

describe("formatLda", () => {
  it("prop: null/empty always yields em-dash", () => {
    expect(formatLda(null)).toBe("—")
    expect(formatLda("")).toBe("—")
  })

  it("prop: valid ISO dates produce non-dash output", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2030-12-31T00:00:00Z"), noInvalidDate: true }),
        (date) => {
          const result = formatLda(date.toISOString())
          expect(result).not.toBe("—")
          // Should contain a year
          expect(result).toMatch(/\d{4}/)
        },
      ),
      { numRuns: 50 },
    )
  })
})
