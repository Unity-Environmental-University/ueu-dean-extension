/**
 * FeedbackFooter — close button, docs link, and feedback form.
 */

import { createSignal, Show } from "solid-js"
import browser from "webextension-polyfill"

export function FeedbackFooter(props: {
  onClose: () => void
  buildDiagnosticText: () => string
  caseTag: () => string
}) {
  const [feedbackOpen, setFeedbackOpen] = createSignal(false)
  const [feedbackText, setFeedbackText] = createSignal("")

  function handleSendFeedback() {
    const text = feedbackText().trim()
    if (!text) return

    const email = (typeof __FEEDBACK_EMAIL__ !== "undefined" ? __FEEDBACK_EMAIL__ : "") as string
    if (!email) return

    const subject = `Dean Tools feedback${props.caseTag()}`
    const telemetry = props.buildDiagnosticText()
    const body = [
      text,
      "",
      "---",
      "If you have a screenshot, please attach it to this email.",
      "",
      telemetry,
    ].join("\n")

    window.open(
      `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      "_blank"
    )

    setFeedbackText("")
    setFeedbackOpen(false)
  }

  return (
    <footer>
      <Show when={feedbackOpen()} fallback={
        <div class="ueu-footer-row">
          <button onClick={props.onClose}>Close</button>
          <a
            class="ueu-btn-feedback"
            href={browser.runtime.getURL("docs/index.html")}
            target="_blank"
            rel="noopener noreferrer"
          >
            Docs →
          </a>
          <Show when={typeof __FEEDBACK_EMAIL__ !== "undefined" && __FEEDBACK_EMAIL__}>
            <button class="ueu-btn-feedback" onClick={() => setFeedbackOpen(true)}>
              Feedback / request
            </button>
          </Show>
        </div>
      }>
        <div class="ueu-feedback">
          <textarea
            class="ueu-feedback-input"
            placeholder="What's working, what's not, what would help…"
            rows={3}
            value={feedbackText()}
            onInput={e => setFeedbackText(e.currentTarget.value)}
          />
          <div class="ueu-footer-row">
            <button onClick={() => { setFeedbackOpen(false); setFeedbackText("") }}>Cancel</button>
            <button
              class="ueu-btn-consent"
              disabled={!feedbackText().trim()}
              onClick={handleSendFeedback}
            >
              Open in Mail →
            </button>
          </div>
        </div>
      </Show>
    </footer>
  )
}
