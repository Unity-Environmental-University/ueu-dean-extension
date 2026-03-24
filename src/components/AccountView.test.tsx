// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@solidjs/testing-library"
import { state } from "../content/core"

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
    canMasquerade: null,
    canMasqueradeCache: null,
    conversations: null,
    loadingConversations: false,
    conversationError: null,
    diagnostics: [],
  })
})

describe("AccountView", () => {
  // Lazy import so mocks are in place
  async function renderAccountView() {
    const { AccountView } = await import("./AccountView")
    return render(() => <AccountView />)
  }

  it("shows loading state", async () => {
    setState({ loading: true })
    await renderAccountView()
    expect(screen.getByText("Loading...")).toBeTruthy()
  })

  it("shows error message", async () => {
    setState({ error: "Something went wrong" })
    await renderAccountView()
    expect(screen.getByText("Something went wrong")).toBeTruthy()
  })

  it("shows open case count badge when cases exist", async () => {
    setState({
      accountData: {
        accountName: "Test Student",
        canvasUserId: "123",
        lastActivityAt: null,
        error: null,
        termGroups: [],
      } as any,
      accountCases: {
        cases: [
          { id: "1", caseNumber: "00001", type: "Academic Dishonesty", subType: null, status: "Open", createdDate: "2026-01-15", courseName: null, courseCode: null, termName: null },
          { id: "2", caseNumber: "00002", type: "Grade Appeal", subType: null, status: "Open", createdDate: "2026-01-20", courseName: null, courseCode: null, termName: null },
        ],
        openCount: 2,
        error: null,
      },
    })

    await renderAccountView()
    expect(screen.getByText("2")).toBeTruthy() // count badge
    expect(screen.getByText("open cases")).toBeTruthy()
    // Types should be listed
    expect(screen.getByText("Academic Dishonesty, Grade Appeal")).toBeTruthy()
  })

  it("hides case signal when no open cases", async () => {
    setState({
      accountData: {
        accountName: "Test Student",
        canvasUserId: "123",
        lastActivityAt: null,
        error: null,
        termGroups: [],
      } as any,
      accountCases: {
        cases: [
          { id: "1", caseNumber: "00001", type: "Academic Dishonesty", subType: null, status: "Closed", createdDate: "2026-01-15", courseName: null, courseCode: null, termName: null },
        ],
        openCount: 0,
        error: null,
      },
    })

    await renderAccountView()
    expect(screen.queryByText("open cases")).toBeNull()
    expect(screen.queryByText("open case")).toBeNull()
  })

  it("shows no-canvas-id message", async () => {
    setState({
      accountData: {
        accountName: "Test Student",
        canvasUserId: null,
        lastActivityAt: null,
        error: "no-canvas-id",
        termGroups: [],
      } as any,
    })

    await renderAccountView()
    expect(screen.getByText("No Canvas user ID on this account.")).toBeTruthy()
  })
})
