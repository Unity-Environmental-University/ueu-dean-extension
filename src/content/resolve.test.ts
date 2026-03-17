// @vitest-environment node
import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { pick, diag, makeFieldAccessor, type DiagLog } from "./resolve"

/** SF API field names: alphanumeric + underscores, never prototype-polluting */
const sfKey = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_]{0,30}$/)

describe("pick", () => {
  it("returns the first non-null, non-empty value", () => {
    fc.assert(
      fc.property(
        sfKey,                         // the winning key
        fc.string({ minLength: 1 }),   // the winning value
        fc.nat({ max: 5 }),            // position of the winning key
        (key, value, pos) => {
          // Build a record where only the key at `pos` has a value
          const keys = Array.from({ length: pos + 3 }, (_, i) => `key_${i}`)
          keys[pos] = key
          const record: Record<string, unknown> = {}
          keys.forEach((k, i) => { record[k] = i === pos ? value : null })

          const log: DiagLog = []
          const result = pick(log, record, ...keys)

          expect(result).toBe(value)
          expect(log).toHaveLength(1)
          expect(log[0].type).toBe("pick-hit")
          expect(log[0].field).toBe(key)
        },
      ),
    )
  })

  it("returns null and logs miss when no key matches", () => {
    fc.assert(
      fc.property(
        fc.array(sfKey, { minLength: 1, maxLength: 6 }),
        (keys) => {
          // Record with none of the keys
          const record: Record<string, unknown> = {}
          const log: DiagLog = []
          const result = pick(log, record, ...keys)

          expect(result).toBeNull()
          expect(log).toHaveLength(1)
          expect(log[0].type).toBe("pick-miss")
          expect(log[0].detail).toContain(keys[0])
        },
      ),
    )
  })

  it("skips empty strings", () => {
    const log: DiagLog = []
    const result = pick(log, { a: "", b: "found" }, "a", "b")
    expect(result).toBe("found")
    expect(log[0].field).toBe("b")
  })

  it("coerces non-string values to string", () => {
    const log: DiagLog = []
    expect(pick(log, { n: 42 }, "n")).toBe("42")
    expect(pick(log, { b: false }, "b")).toBe("false")
    expect(pick(log, { z: 0 }, "z")).toBe("0")
  })

  it("never mutates the input record", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.constant(null), fc.integer())),
        fc.array(fc.string(), { minLength: 1, maxLength: 4 }),
        (record, keys) => {
          const frozen = Object.freeze({ ...record })
          const log: DiagLog = []
          // Should not throw on frozen object
          pick(log, frozen, ...keys)
        },
      ),
    )
  })
})

describe("diag", () => {
  it("appends an entry with the given type and detail", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (type, detail) => {
        const log: DiagLog = []
        diag(log, type, detail)
        expect(log).toHaveLength(1)
        expect(log[0]).toEqual({ type, detail })
      }),
    )
  })
})

describe("makeFieldAccessor", () => {
  it("resolves by label when fieldMap has a match", () => {
    const record = { Status: "Open", Status__c: "Closed" }
    const fieldMap = new Map([["status", { name: "Status" }]])
    const log: DiagLog = []
    const f = makeFieldAccessor(log, record, fieldMap)

    expect(f("Status", "Status__c")).toBe("Open")
    expect(log.some(d => d.type === "field-hit" && d.field === "Status")).toBe(true)
  })

  it("falls back to pick keys when label match is empty", () => {
    const record = { Status: "", Status__c: "Closed" }
    const fieldMap = new Map([["status", { name: "Status" }]])
    const log: DiagLog = []
    const f = makeFieldAccessor(log, record, fieldMap)

    expect(f("Status", "Status__c")).toBe("Closed")
    expect(log.some(d => d.type === "field-miss")).toBe(true)
    expect(log.some(d => d.type === "pick-hit" && d.field === "Status__c")).toBe(true)
  })

  it("falls back to pick keys when label is not in describe", () => {
    const record = { Weird_Field__c: "hello" }
    const fieldMap = new Map<string, { name: string }>()
    const log: DiagLog = []
    const f = makeFieldAccessor(log, record, fieldMap)

    expect(f("Nonexistent Label", "Weird_Field__c")).toBe("hello")
    expect(log.some(d => d.type === "field-unknown")).toBe(true)
  })

  it("degrades to pure pick when fieldMap is null", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (key, value) => {
          const record = { [key]: value }
          const log: DiagLog = []
          const f = makeFieldAccessor(log, record, null)

          expect(f("Any Label", key)).toBe(value)
          // Should have a pick-hit, no field-hit
          expect(log.every(d => d.type !== "field-hit")).toBe(true)
          expect(log.some(d => d.type === "pick-hit")).toBe(true)
        },
      ),
    )
  })

  it("label matching is case-insensitive", () => {
    const record = { CaseNumber: "123" }
    const fieldMap = new Map([["case number", { name: "CaseNumber" }]])
    const log: DiagLog = []
    const f = makeFieldAccessor(log, record, fieldMap)

    expect(f("Case Number")).toBe("123")
    expect(f("CASE NUMBER")).toBe("123") // case-insensitive: both resolve
  })

  it("accessor calls are independent (no shared state between calls)", () => {
    const record = { A: "1", B: "2" }
    const fieldMap = new Map([
      ["alpha", { name: "A" }],
      ["beta", { name: "B" }],
    ])
    const log: DiagLog = []
    const f = makeFieldAccessor(log, record, fieldMap)

    expect(f("Alpha")).toBe("1")
    expect(f("Beta")).toBe("2")
    // Both should produce field-hit entries
    const hits = log.filter(d => d.type === "field-hit")
    expect(hits).toHaveLength(2)
  })
})
