// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@solidjs/testing-library"
import fc from "fast-check"
import { state } from "../content/core"
import type { AccountCasesResult } from "../content/load-account-cases"
import type { PriorCase } from "../content/case-types"

// Mock webextension-polyfill — components import it for browser.runtime.sendMessage
vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({ hasSession: true }),
    },
  },
}))

// Helper: set state fields and notify listeners
function setState(patch: Partial<typeof state>) {
  Object.assign(state, patch)
  state.notify()
}

// Reset state before each test
beforeEach(() => {
  setState({
    accountData: null,
    accountCases: null,
    loading: false,
    error: null,
    conversations: null,
    loadingConversations: false,
    conversationError: null,
    diagnostics: [],
  })
})

// ── Arbitraries ──────────────────────────────────

const CASE_STATUSES = ["Open", "In Progress", "Closed", "Resolved"] as const
const CASE_TYPES = ["Academic Dishonesty", "Grade Appeal", "General Inquiry", "Withdrawal"] as const

const arbCase: fc.Arbitrary<PriorCase> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 18 }),
  caseNumber: fc.stringMatching(/^[0-9]{5,8}$/),
  subject: fc.option(fc.string({ minLength: 1 }), { nil: null }),
  type: fc.constantFrom(...CASE_TYPES),
  subType: fc.option(fc.string({ minLength: 1 }), { nil: null }),
  status: fc.constantFrom(...CASE_STATUSES),
  createdDate: fc.date({ min: new Date("2020-01-01T00:00:00Z"), max: new Date("2026-12-31T00:00:00Z"), noInvalidDate: true }).map(d => d.toISOString()),
  courseName: fc.option(fc.string({ minLength: 1 }), { nil: null }),
  courseCode: fc.option(fc.string({ minLength: 1 }), { nil: null }),
  courseOfferingId: fc.option(fc.string({ minLength: 1, maxLength: 18 }), { nil: null }),
  termName: fc.option(fc.string({ minLength: 1 }), { nil: null }),
})

const arbCasesResult: fc.Arbitrary<AccountCasesResult> = fc
  .array(arbCase.filter(c => c.type.length > 0), { minLength: 0, maxLength: 15 })
  .map(cases => {
    const openCount = cases.filter(c => c.status !== "Closed" && c.status !== "Resolved").length
    return { cases, openCount, error: null }
  })

const arbAccountData = fc.record({
  accountName: fc.string({ minLength: 1 }),
  canvasUserId: fc.option(fc.stringMatching(/^[0-9]+$/), { nil: null }),
  lastActivityAt: fc.option(fc.date().map(d => d.toISOString()), { nil: null }),
  error: fc.constant(null),
  termGroups: fc.constant([]),
})

// ── Tests ────────────────────────────────────────

describe("AccountView", () => {
  async function renderAccountView() {
    const { AccountView } = await import("./AccountView")
    return render(() => <AccountView />)
  }

  // Property: case signal badge shows iff openCount > 0
  describe("prop: case signal visibility tracks openCount", () => {
    it("shows badge when openCount > 0, hides when 0", async () => {
      await fc.assert(
        fc.asyncProperty(arbAccountData, arbCasesResult, async (account, cases) => {
          setState({ accountData: account as any, accountCases: cases })
          const { unmount } = await renderAccountView()

          if (cases.openCount > 0) {
            expect(screen.getByText(String(cases.openCount))).toBeTruthy()
            const label = cases.openCount === 1 ? "open case" : "open cases"
            expect(screen.getByText(label)).toBeTruthy()
          } else {
            expect(screen.queryByText("open case")).toBeNull()
            expect(screen.queryByText("open cases")).toBeNull()
          }

          unmount()
        }),
        { numRuns: 20 },
      )
    })
  })

  // Property: expanding case signal shows case numbers
  describe("prop: case list expands to show case details", () => {
    it("renders case numbers after clicking expand", async () => {
      await fc.assert(
        fc.asyncProperty(arbAccountData, arbCasesResult, async (account, cases) => {
          fc.pre(cases.cases.length > 0)

          setState({ accountData: account as any, accountCases: cases })
          const { unmount } = await renderAccountView()

          // Click the toggle to expand
          const toggle = document.querySelector(".ueu-case-signal-toggle")
          if (toggle) {
            (toggle as HTMLElement).click()
            // Case numbers should now be visible
            for (const c of cases.cases) {
              expect(screen.getByText(c.caseNumber)).toBeTruthy()
            }
          }

          unmount()
        }),
        { numRuns: 20 },
      )
    })
  })

  // Property: error strings are rendered verbatim
  describe("prop: error messages display verbatim", () => {
    it("renders any non-empty error string", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate realistic error strings: "SF API 500: Something went wrong"
          fc.stringMatching(/^[A-Z][A-Za-z0-9 :.]{5,80}$/).filter(s => s === s.trim() && !s.includes("  ") && !s.includes("no-canvas-id") && !s.includes("canvas-session-required")),
          async (errorMsg) => {
            setState({ error: errorMsg })
            const { unmount } = await renderAccountView()
            // Error should appear somewhere in the DOM
            const el = screen.queryByText(errorMsg)
            expect(el).not.toBeNull()
            unmount()
          },
        ),
        { numRuns: 15 },
      )
    })
  })

  // Property: no-canvas-id always shows specific message
  it("shows no-canvas-id message when error is no-canvas-id", async () => {
    setState({
      accountData: {
        accountName: "Test",
        canvasUserId: null,
        lastActivityAt: null,
        error: "no-canvas-id",
        termGroups: [],
      } as any,
    })
    await renderAccountView()
    expect(screen.getByText("No Canvas user ID on this account.")).toBeTruthy()
  })

  // Property: loading state shows Loading...
  it("shows loading state", async () => {
    setState({ loading: true })
    await renderAccountView()
    expect(screen.getByText("Loading...")).toBeTruthy()
  })
})
