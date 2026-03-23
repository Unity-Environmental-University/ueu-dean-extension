# Dean Tools — Codebase Guide

Chrome MV3 extension for UEU deans, advisors, and staff. Lives on Salesforce pages, surfaces Canvas data alongside case records.

## Architecture

```
src/
  background/index.ts    — Service worker. Proxies SF + Canvas API calls (cookie auth). Message router.
  content/
    core.ts              — Heart. Watches URL, dispatches loaders, owns shared reactive state.
    load-case.ts         — Pure async loader for Case pages. Injected deps, never touches state directly.
    load-account.ts      — Pure async loader for Account pages.
    load-course-offering.ts — Pure async loader for CourseOffering pages.
    load-canvas-messages.ts — Canvas conversations + masquerade probe. Pure async.
    sfapi.ts             — SF REST API helpers (getRecord, sfQuery, describeObject).
    permissions.ts       — Extension storage: consent gate, settings, canvas capabilities cache.
    field-utils.ts       — Shared utilities (cleanTermName).
    resolve.ts           — Field resolution with diagnostic logging (pick, diag, makeFieldAccessor).
    observer.ts          — DOM field observation for SF pages.
    student-courses.ts   — Canvas course grouping by term.
    overlay.css          — All styles (injected into Shadow DOM).
  components/
    Overlay.tsx          — Root component. Permission gate, dev tools, feedback.
    CaseView.tsx         — Case page: case info, dishonesty, grade appeal, Canvas, messages, history drawer.
    AccountView.tsx      — Account page: courses by term, scores, inbox.
    CourseOfferingView.tsx — Course roster with grades.
```

## Key Patterns

**Reactive state without a framework store.** `state` in core.ts is a plain object with a `listeners` Set. Components subscribe via `version` signal bumped on `state.notify()`. Accessors look like: `const field = () => { version(); return state.field }`. This is intentional — it's simple, greppable, and every Claude can read it immediately.

**Injected deps for loaders.** Each loader (load-case, load-account, etc.) takes a deps object with `getRecord`, `canvasFetch`, `isStale`, etc. This keeps loaders pure and testable. `core.ts` wires deps via `makeCaseDeps()`.

**Stale token pattern.** `navToken` increments on every navigation. Async operations capture it and bail via `stale(token)` if navigation moved on. Prevents stale writes from superseded page loads.

**Masquerade permission.** `probeCanvasMasquerade` returns `true` (has permission), `false` (no permission), or `null` (no Canvas session — can't determine). Cached in `browser.storage.local` via `canvasCapabilities`. Views use `showCanvasFeatures()` to ghost UI while re-verifying from cache.

**Canvas API auth.** Cookie-based, not OAuth. Background script reads `_csrf_token` from `unity.instructure.com`. No API keys in the extension. Session check via `canvas-session-check` message type.

## When Adding State

1. Add the field to `state` in core.ts
2. If it comes from a loader via `CasePatch`, add it to the `CasePatch` interface in load-case.ts AND the `applyPatch` function in core.ts
3. Add the accessor in the relevant view component
4. Reset it in the appropriate loader wrapper (loadCaseWrapper, loadAccount, etc.) and in `doNavigate`'s clear block

## Build + Dev

```bash
npm run dev       # watch mode
npm run build     # production → dist/chrome/
npm test          # vitest
```

Load `dist/chrome/` as unpacked extension in chrome://extensions (Developer mode).

## Canvas API Host

All Canvas calls go to `unity.instructure.com`. Hardcoded in background/index.ts and core.ts.
