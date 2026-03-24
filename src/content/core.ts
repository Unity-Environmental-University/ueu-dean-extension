/**
 * Core — the heart of the dean's tool.
 *
 * Watches the URL for record page navigation, dispatches loaders,
 * and wires dependencies. State lives in state.ts.
 */

import browser from "webextension-polyfill"
import { getRecord, parseRecordUrl, describeObject, sfQuery } from "./sfapi"
import { getPermissions, getCanvasCapabilities, saveCanvasCapabilities } from "./permissions"
import { pick, createDiagLog, type DiagLog } from "./resolve"
import { observeFields, observeCaseComplete } from "./observer"
import { loadAccountCourses } from "./load-account"
import { loadCase as loadCaseImpl } from "./load-case"
import { loadCourseOffering as loadCourseOfferingImpl } from "./load-course-offering"
import { loadAccountCases as loadAccountCasesImpl } from "./load-account-cases"
import { probeCanvasMasquerade, loadCanvasConversations } from "./load-canvas-messages"
import { CANVAS_HOST } from "../constants"
import {
  state, clearCaseState, clearConversationState,
  stale, bumpNavToken, currentNavToken, applyPatch,
} from "./state"

// Re-export state and refresh for consumers
export { state } from "./state"

// ── Canvas API helpers ───────────────────────────────────────────────────────

async function checkCanvasSession(): Promise<boolean> {
  const result = await browser.runtime.sendMessage({ type: "canvas-session-check" }) as { hasSession: boolean }
  return !!result?.hasSession
}

async function canvasFetch<T>(path: string): Promise<T> {
  const result = await browser.runtime.sendMessage({
    type: "canvas-api",
    path,
  })
  if (result?.error) throw new Error(result.error)
  return result as T
}

// ── Dep factories ────────────────────────────────────────────────────────────

function makeCaseDeps(token: number) {
  return {
    getRecord,
    sfQuery,
    describeObject,
    canvasFetch,
    checkSession: checkCanvasSession,
    isStale: () => stale(token),
    onUpdate: applyPatch,
    observeFields,
    observeCaseComplete,
  }
}

// ── Loader wrappers ──────────────────────────────────────────────────────────

async function loadCaseWrapper(recordId: string, token: number) {
  state.loading = true
  state.error = null
  clearCaseState()
  clearConversationState()
  state.diagnostics = []
  state.notify()

  await loadCaseImpl(recordId, makeCaseDeps(token))
}

async function loadCourseOffering(recordId: string, token: number) {
  state.loading = true
  state.error = null
  state.canvas = null
  state.offeringData = null
  state.diagnostics = []
  state.notify()

  const result = await loadCourseOfferingImpl(recordId, {
    getRecord,
    sfQuery,
    canvasFetch,
    isStale: () => stale(token),
  })

  if (stale(token)) return

  state.offeringData = result
  state.diagnostics.push(...result.diagnostics)

  if (result.canvasCourseId) {
    state.canvas = {
      courseId: result.canvasCourseId,
      url: result.canvasCourseUrl!,
      enrollmentUrl: null,
      studentId: null,
      studentName: null,
      studentPronouns: null,
    }
  }

  if (result.error && result.error !== "canvas-session-required") {
    state.error = result.error
  }

  state.loading = false
  state.notify()
}

async function loadTerm(recordId: string, token: number) {
  state.loading = true
  state.error = null
  state.diagnostics = []
  state.notify()

  try {
    const term = await getRecord<Record<string, unknown>>("Term", recordId)
    if (stale(token)) return
    const termLog = createDiagLog()
    termLog.pick(term, "Name")
    termLog.pick(term, "StartDate", "Start_Date__c", "hed__Start_Date__c")
    termLog.pick(term, "EndDate", "End_Date__c", "hed__End_Date__c")
    termLog.pick(term, "Status__c", "Status", "hed__Status__c")
    state.diagnostics.push(...termLog)
    state.loading = false
    state.notify()
    observeFields("Term", termLog)
  } catch (e) {
    if (stale(token)) return
    state.loading = false
    state.error = e instanceof Error ? e.message : String(e)
    state.notify()
    console.error("[UEU] Failed to load term:", e)
  }
}

/** Set canMasquerade in state and persist to storage if it resolved to a definite value. */
async function setCanMasquerade(value: boolean | null): Promise<void> {
  state.canMasquerade = value
  if (value !== null) {
    await saveCanvasCapabilities({ canMasquerade: value })
  }
}

async function loadAccount(recordId: string, token: number) {
  state.loading = true
  state.error = null
  state.accountData = null
  state.accountCases = null
  clearConversationState()
  state.diagnostics = []
  state.notify()

  // Fire case query in parallel with Canvas courses — it's SF-only, no Canvas needed
  loadAccountCasesImpl(recordId, { sfQuery, isStale: () => stale(token) }).then(casesResult => {
    if (stale(token)) return
    state.accountCases = casesResult
    state.notify()
  })

  const result = await loadAccountCourses(recordId, {
    getRecord,
    canvasFetch,
    isStale: () => stale(token),
  })

  if (stale(token)) return

  // If Canvas ID missing on first try, retry once after 2s — SF SPA pages sometimes
  // settle the record data after initial render
  if (result.error === "no-canvas-id" && !stale(token)) {
    await new Promise(r => setTimeout(r, 2000))
    if (stale(token)) return
    const retry = await loadAccountCourses(recordId, {
      getRecord,
      canvasFetch,
      isStale: () => stale(token),
    })
    if (!stale(token) && retry.canvasUserId) {
      state.accountData = {
        canvasUserId: retry.canvasUserId,
        accountName: retry.accountName,
        termGroups: retry.termGroups,
        lastActivityAt: retry.lastActivityAt,
        error: retry.error,
      }
      state.diagnostics.push(...retry.diagnostics)
      state.loading = false
      state.notify()
      if (state.canMasquerade === null && !stale(token)) {
        const masq = await probeCanvasMasquerade(retry.canvasUserId, { canvasFetch, checkSession: checkCanvasSession, isStale: () => stale(token) })
        if (!stale(token)) {
          await setCanMasquerade(masq)
          state.notify()
        }
      }
      return
    }
  }

  state.accountData = {
    canvasUserId: result.canvasUserId,
    accountName: result.accountName,
    termGroups: result.termGroups,
    lastActivityAt: result.lastActivityAt,
    error: result.error,
  }
  state.diagnostics.push(...result.diagnostics)
  state.loading = false

  if (result.error === "canvas-session-required") {
    state.studentError = "canvas-session-required"
  }

  state.notify()

  if (result.canvasUserId && state.canMasquerade === null && !result.error && !stale(token)) {
    const masq = await probeCanvasMasquerade(result.canvasUserId, { canvasFetch, checkSession: checkCanvasSession, isStale: () => stale(token) })
    if (!stale(token)) {
      await setCanMasquerade(masq)
      state.notify()
    }
  }
}

// ── Navigation dispatch ──────────────────────────────────────────────────────

let navigateTimer: ReturnType<typeof setTimeout> | null = null

function onNavigate() {
  if (navigateTimer) clearTimeout(navigateTimer)
  navigateTimer = setTimeout(doNavigate, 300)
}

async function doNavigate() {
  const parsed = parseRecordUrl(window.location.pathname)

  if (!parsed) {
    if (state.page) {
      state.page = null
      clearCaseState()
      state.accountData = null
      state.accountCases = null
      clearConversationState()
      state.loading = false
      state.error = null
      state.notify()
    }
    return
  }

  if (state.page?.recordId === parsed.recordId && (state.loading || state.caseData || state.canvas || state.accountData)) return

  state.page = parsed
  state.loading = true
  state.notify()
  const token = bumpNavToken()

  const perms = await getPermissions()
  if (stale(token)) return
  if (!perms.sfApi) {
    state.loading = false
    state.error = null
    state.notify()
    return
  }

  if (parsed.objectType === "Case") {
    await loadCaseWrapper(parsed.recordId, token)
  } else if (parsed.objectType === "CourseOffering") {
    await loadCourseOffering(parsed.recordId, token)
  } else if (parsed.objectType === "Term") {
    await loadTerm(parsed.recordId, token)
  } else if (parsed.objectType === "Account") {
    await loadAccount(parsed.recordId, token)
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Re-run navigation check (call after granting permissions) */
export function refresh() {
  state.page = null
  onNavigate()
}

/** Start watching for navigation changes */
export function startWatching() {
  getCanvasCapabilities().then(caps => {
    if (state.canMasqueradeCache !== caps.canMasquerade) {
      state.canMasqueradeCache = caps.canMasquerade
      state.notify()
    }
  })

  onNavigate()

  const origPush = history.pushState.bind(history)
  const origReplace = history.replaceState.bind(history)

  history.pushState = function (...args) {
    origPush(...args)
    onNavigate()
  }

  history.replaceState = function (...args) {
    origReplace(...args)
    onNavigate()
  }

  window.addEventListener("popstate", () => onNavigate())
}

/**
 * Load Canvas conversations on demand.
 */
export async function loadConversations(
  studentCanvasId: string,
  instructorCanvasId: string | null,
): Promise<void> {
  const token = currentNavToken()
  state.loadingConversations = true
  state.conversations = null
  state.conversationError = null
  state.notify()

  const result = await loadCanvasConversations(studentCanvasId, instructorCanvasId, {
    canvasFetch,
    checkSession: checkCanvasSession,
    isStale: () => stale(token),
  })

  if (stale(token)) return

  state.conversations = result.conversations
  state.conversationError = result.error
  state.loadingConversations = false
  state.notify()
}
