/**
 * Sandbox entry — renders dean extension components with fake state.
 *
 * Run: npx vite sandbox
 * Opens at http://localhost:5174
 */

// Mock browser APIs before any component import
import "./mock-browser"

// Inject CSS from the extension overlay
import overlayCSS from "../src/content/overlay.css?inline"

import { render } from "solid-js/web"
import { createSignal, For, Show } from "solid-js"
import { state } from "../src/content/core"
import { CaseView } from "../src/components/CaseView"
import { AccountView } from "../src/components/AccountView"
import { CourseOfferingView } from "../src/components/CourseOfferingView"
import { SCENARIOS, type ScenarioKey } from "./fixtures"

function applyScenario(key: ScenarioKey) {
  // Reset everything first
  const resetFields: Partial<typeof state> = {
    page: null,
    caseData: null,
    dishonesty: null,
    gradeAppeal: null,
    canvas: null,
    instructor: null,
    priorCases: null,
    loadingPriorCases: false,
    accountData: null,
    accountCases: null,
    offeringData: null,
    canMasquerade: null,
    canMasqueradeCache: null,
    conversations: null,
    loadingConversations: false,
    conversationError: null,
    loading: false,
    loadingCourseOffering: false,
    loadingStudent: false,
    error: null,
    courseOfferingError: null,
    studentError: null,
    copRaw: null,
    contactRaw: null,
    diagnostics: [],
  }
  Object.assign(state, resetFields)

  // Apply scenario
  const scenario = SCENARIOS[key]
  const { label, ...fields } = scenario
  Object.assign(state, fields)
  state.notify()
}

function Sandbox() {
  const [current, setCurrent] = createSignal<ScenarioKey>("account:happy")

  // Apply initial scenario
  applyScenario("account:happy")

  function select(key: ScenarioKey) {
    setCurrent(key)
    applyScenario(key)
  }

  const viewType = () => {
    const key = current()
    if (key.startsWith("account:")) return "Account"
    if (key.startsWith("case:")) return "Case"
    if (key.startsWith("offering:")) return "CourseOffering"
    if (key === "loading" || key === "error") return "Account" // show in account context
    return "none"
  }

  return (
    <div class="sandbox-layout">
      <div class="sandbox-controls">
        <h1>Dean Extension Sandbox</h1>

        <h2>Scenarios</h2>
        <For each={Object.entries(SCENARIOS)}>
          {([key, scenario]) => (
            <button
              class="scenario-btn"
              style={{ opacity: current() === key ? 1 : 0.6 }}
              onClick={() => select(key as ScenarioKey)}
            >
              {scenario.label}
            </button>
          )}
        </For>

        <p class="hint">
          Click a scenario to swap the state. The component re-renders reactively.
        </p>
        <p class="hint" style={{ "margin-top": "1rem" }}>
          Current view: <strong>{viewType()}</strong>
        </p>
      </div>

      <div class="sandbox-preview">
        <div class="sandbox-panel">
          {/* Inject extension styles */}
          <style>{overlayCSS}</style>

          <Show when={viewType() === "Account"}>
            <AccountView />
          </Show>
          <Show when={viewType() === "Case"}>
            <CaseView />
          </Show>
          <Show when={viewType() === "CourseOffering"}>
            <CourseOfferingView />
          </Show>
          <Show when={viewType() === "none"}>
            <p style={{ color: "#888" }}>Select a scenario →</p>
          </Show>
        </div>
      </div>
    </div>
  )
}

render(Sandbox, document.getElementById("app")!)
