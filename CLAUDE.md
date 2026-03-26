# Dean Tools — Codebase Guide

Chrome MV3 extension for UEU deans, advisors, and staff. Lives on Salesforce pages, surfaces Canvas data alongside case records.

## Architecture

```
src/
  background/index.ts       — Service worker. Proxies SF + Canvas API calls (cookie auth). Message router.
  content/
    core.ts                 — Heart. URL polling, navigation dispatch, state ownership, clearAllPageState().
    state.ts                — Shared reactive state object, clear functions, applyPatch, navToken.
    load-case.ts            — Case page orchestrator. Injected deps, never touches state directly.
    load-account.ts         — Account page loader.
    load-course-offering.ts — CourseOffering page loader. Canvas roster is primary student source.
    load-canvas-messages.ts — Canvas conversations + masquerade probe. Pure async.
    case-helpers.ts         — SOQL builder, record mapper, incident classifier, email matcher.
    case-types.ts           — Shared type definitions for the case loading pipeline.
    case-student-resolution.ts — Student lookup pipeline: account → enrollment → contact → email.
    case-course-and-instructor.ts — CO resolution + instructor Canvas lookup.
    sfapi.ts                — SF REST API helpers (getRecord, sfQuery, describeObject, parseRecordUrl).
    permissions.ts          — Extension storage: consent gate, settings, canvas capabilities cache.
    field-utils.ts          — Shared utilities (cleanTermName).
    resolve.ts              — Field resolution with diagnostic logging (pick, diag, makeFieldAccessor).
    observer.ts             — DOM field observation for SF pages.
    student-courses.ts      — Canvas course grouping by term.
    overlay.css             — All styles (injected into Shadow DOM).
  components/
    Overlay.tsx             — Root shell. Permission gate, view routing, diagnostic builder, update check.
    CaseView.tsx            — Case page shell — composes sub-components below.
    HistoryDrawer.tsx       — Prior cases list with subtype filter chips.
    CanvasSection.tsx       — Canvas course links, student info, message viewer.
    DishonestySummary.tsx   — Academic dishonesty details.
    GradeAppealSummary.tsx  — Grade appeal details.
    InstructorCard.tsx      — Instructor info with Canvas links.
    CanvasUserLinks.tsx     — Shared Profile/Act-as/Grades links (deduped).
    DevTools.tsx            — Diagnostic panel, field dump, support messaging.
    FeedbackFooter.tsx      — Close, docs link, feedback form.
    AccountView.tsx         — Account page: courses by term, scores, case list, inbox.
    CourseOfferingView.tsx  — Course roster with grades.
    useStore.ts             — Reactive accessor factory for shared state.
    caseViewHelpers.ts      — Acronym helper, incident labels.
    safe-text.ts            — FERPA-safe hashing for diagnostics.
    format.ts               — Score formatting, LDA formatting, color helpers.
```

## Key Patterns

**Reactive state without a framework store.** `state` in core.ts is a plain object with a `listeners` Set. Components subscribe via `version` signal bumped on `state.notify()`. Accessors look like: `const field = () => { version(); return state.field }`. This is intentional — it's simple, greppable, and every Claude can read it immediately.

**Injected deps for loaders.** Each loader (load-case, load-account, etc.) takes a deps object with `getRecord`, `canvasFetch`, `isStale`, etc. This keeps loaders pure and testable. `core.ts` wires deps via `makeCaseDeps()`.

**Stale token pattern.** `navToken` increments on every navigation. Async operations capture it and bail via `stale(token)` if navigation moved on. Prevents stale writes from superseded page loads.

**Masquerade permission.** `probeCanvasMasquerade` returns `true` (has permission), `false` (no permission), or `null` (no Canvas session — can't determine). Cached in `browser.storage.local` via `canvasCapabilities`. Views use `showCanvasFeatures()` to ghost UI while re-verifying from cache.

**Canvas API auth.** Cookie-based, not OAuth. Background script reads `_csrf_token` from `unity.instructure.com`. No API keys in the extension. Session check via `canvas-session-check` message type.

## When Adding State

1. Add the field to `state` in state.ts
2. Add it to `clearAllPageState()` in state.ts (this is the **sole authority** for state resets — loaders do not clear state)
3. If it comes from a loader via `CasePatch`, add it to the `CasePatch` interface in case-types.ts AND the `applyPatch` function in state.ts
4. Add the accessor in the relevant view component via `get("fieldName")`
5. **Always use `get()` reactive accessors in JSX** — never read `state.*` directly in `<Show when=...>` or other reactive positions (Solid won't track plain property reads)

## Who Uses This

Six user classes — see [docs/users.md](docs/users.md) for the full picture. Summary: Dean (case adjudicator), Advisor (longitudinal student view), Coordinator (course-level ops), Staff without masquerade, New user (no Canvas session), and Claude (codebase contributor). The extension doesn't model roles — it models permissions. Understanding who's behind those permissions shapes what we build.

## Build + Dev

```bash
npm run dev       # watch mode
npm run build     # production → dist/chrome/
npm test          # vitest
```

Load `dist/chrome/` as unpacked extension in chrome://extensions (Developer mode).

## Canvas API Host

All Canvas calls go to `unity.instructure.com`. Hardcoded in background/index.ts and core.ts.
