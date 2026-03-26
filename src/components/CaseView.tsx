/**
 * CaseView — the full case page view.
 *
 * Composes: CaseHeader, HistoryDrawer, DishonestySummary, GradeAppealSummary,
 * CanvasSection, InstructorCard.
 * All data comes from SF REST API — no DOM scraping.
 */

import { createSignal, Show } from "solid-js"
import browser from "webextension-polyfill"
import { getSettings } from "../content/permissions"
import { state } from "../content/core"
import { useStore, useCanvasPermissions, useSessionPoll } from "./useStore"
import { HistoryToggle, type HistoryDrawerState } from "./HistoryDrawer"
import { DishonestySummary } from "./DishonestySummary"
import { GradeAppealSummary } from "./GradeAppealSummary"
import { CanvasSection } from "./CanvasSection"
import { InstructorCard } from "./InstructorCard"

export function CaseView(props: { historyState: HistoryDrawerState; onDrawerToggle?: (open: boolean) => void }) {
  const get = useStore()

  const caseData = get("caseData")
  const dishonesty = get("dishonesty")
  const gradeAppeal = get("gradeAppeal")
  const canvas = get("canvas")
  const loading = get("loading")
  const error = get("error")
  const courseOfferingError = get("courseOfferingError")
  const studentError = get("studentError")
  const instructor = get("instructor")
  const page = get("page")
  const { showCanvasFeatures, canvasFeaturesPending } = useCanvasPermissions(get)
  const anyError = () => error() || courseOfferingError() || (studentError() && studentError() !== "canvas-session-required")

  const [reportStatus, setReportStatus] = createSignal<"idle" | "sending" | "sent" | "error">("idle")

  async function sendReport() {
    setReportStatus("sending")
    try {
      const settings = await getSettings()
      const caseNum = state.caseData?.caseNumber ?? state.page?.recordId ?? "unknown"
      const lines = [
        `[ueu-dean-tools diagnostic] case ${caseNum}`,
        `[url] ${window.location.pathname}`,
        `[page] ${JSON.stringify(state.page)}`,
        `[errors] sf=${state.error ?? "null"} co=${state.courseOfferingError ?? "null"} student=${state.studentError ?? "null"}`,
        `[canvas] courseId=${state.canvas?.courseId ?? "null"} studentId=${state.canvas?.studentId ?? "null"}`,
        `[diagnostics]`,
        ...state.diagnostics.map(d => `  ${d.type}: ${d.detail}`),
      ]
      await browser.runtime.sendMessage({
        type: "canvas-message",
        recipientId: settings.supportCanvasId,
        subject: `Dean Tools issue — case ${caseNum}`,
        body: lines.join("\n"),
      })
      setReportStatus("sent")
      setTimeout(() => setReportStatus("idle"), 3000)
    } catch {
      setReportStatus("error")
      setTimeout(() => setReportStatus("idle"), 3000)
    }
  }

  useSessionPoll(() => studentError() === "canvas-session-required")

  return (
    <div>
      <Show when={error()}>
        <p class="ueu-error">{error()}</p>
      </Show>

      <Show when={loading()}>
        <p class="ueu-muted">Loading...</p>
      </Show>

      {/* Case info */}
      <Show when={caseData()}>
        {info => (
          <article>
            <h3 class="ueu-label">Case</h3>
            <div class="ueu-case-meta">
              <span class="ueu-case-number">{info().caseNumber}</span>
              <span class="ueu-pill" data-status={info().status.toLowerCase()}>{info().status}</span>
              <Show when={info().type}>
                <span class="ueu-pill-outline">{info().type}</span>
              </Show>
            </div>
            <Show when={info().subject}>
              <p class="ueu-subject">{info().subject}</p>
            </Show>
            <Show when={info().contactName}>
              <div class="ueu-case-contact">
                <Show when={info().accountId} fallback={<span>{info().contactName}</span>}>
                  <a href={`/lightning/r/Account/${info().accountId}/view`} target="_blank" rel="noopener noreferrer" class="ueu-contact-link">{info().contactName}</a>
                </Show>
                <Show when={info().contactEmail}>
                  <span class="ueu-contact-email">{info().contactEmail}</span>
                </Show>
              </div>
            </Show>
          </article>
        )}
      </Show>

      {/* Prior cases toggle */}
      <HistoryToggle get={get} state={props.historyState} onToggle={props.onDrawerToggle} />

      {/* Dishonesty details */}
      <Show when={dishonesty()}>
        {d => <DishonestySummary dishonesty={d()} />}
      </Show>

      {/* Grade appeal */}
      <Show when={gradeAppeal()}>
        {g => <GradeAppealSummary gradeAppeal={g()} />}
      </Show>

      {/* Canvas + student + messages */}
      <CanvasSection get={get} showCanvasFeatures={showCanvasFeatures} canvasFeaturesPending={canvasFeaturesPending} />

      {/* Instructor */}
      <Show when={instructor()}>
        {i => (
          <InstructorCard
            instructor={i()}
            canvas={canvas() ?? null}
            showCanvasFeatures={showCanvasFeatures()}
            canvasFeaturesPending={canvasFeaturesPending()}
          />
        )}
      </Show>

      {/* No data state */}
      <Show when={!loading() && !caseData() && !canvas() && !error()}>
        <Show when={page()} fallback={
          <p class="ueu-muted">Navigate to a Case or Course Offering page.</p>
        }>
          <p class="ueu-muted">Detecting page<span class="ueu-ellipsis">…</span></p>
        </Show>
      </Show>

      {/* Report button */}
      <Show when={anyError()}>
        <div class="ueu-report">
          <button
            class="ueu-btn-report"
            disabled={reportStatus() === "sending"}
            onClick={sendReport}
          >
            {reportStatus() === "sending" ? "Sending…" : reportStatus() === "sent" ? "Sent!" : reportStatus() === "error" ? "Failed — try again" : "Report issue"}
          </button>
        </div>
      </Show>
    </div>
  )
}
