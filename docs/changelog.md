# Dean Tools — Changelog

---

## 2026-03-18 (v0.2.0)

### New

- **Student History drawer.** Click "Student History" on any case to open a slide-out panel showing all prior cases for that student. Filter by case subtype — the current case's subtype is auto-selected, and your filter choice is remembered across sessions.

- **Instructor links.** The extension now resolves instructors in Canvas and shows Profile, In Course, Act as, and Email links — the same set of links you get for students.

- **Works on all case types.** Any case with a Course Offering now resolves Canvas course, student, and instructor links — not just dishonesty and grade appeal cases.

### Fixed

- **Student Canvas links now resolve reliably.** The extension was trying to look up students using an incorrect identifier (Unity ID as SIS ID). It now reads the Canvas User ID directly from the student's SF Account record, with fallbacks to enrollment and email search.

- **Instructor resolution works without admin scope.** Instructor lookup now searches within the course first (which works with a standard Canvas session) instead of requiring admin-level API access.

### Improved

- The main dialog and drawer move together with weighted, spring-damped transitions — things feel like they have mass.

---

## 2026-03-12 (v0.1.2)

### Fixed
- **The extension now reliably recognises Case pages.** An intermittent bug caused it to occasionally miss that you'd navigated to a case and show nothing. This is fixed.
- **Student lookup fallback is more reliable.** If the primary lookup method fails, the extension now correctly falls back to searching by email in all situations.

### Improved
- Internal cleanup: removed leftover placeholder code that was no longer used.

---

## 2026-03-09 (v0.1.1)

### New

- **Case data comes directly from Salesforce, not screen-scraping.** The extension reads case records through the Salesforce API using your existing session — more reliable, less likely to break when Salesforce updates its layout.

- **Student lookup.** From a dishonesty or grade appeal case, Dean Tools now finds the student in Canvas automatically. It tries three paths in order — enrollment record, contact record, email search — and shows you the student's name with direct links to their grades, profile, and "act as" view.

- **Canvas session prompt.** If you aren't logged into Canvas, the extension tells you clearly and waits. Open Canvas in another tab, log in, and the extension updates automatically — no need to refresh or click retry.

- **Grade appeal details.** The extension now shows course, current grade, changed grade, decision status, and instructor for grade appeal cases, alongside the existing academic dishonesty view.

- **Loading is incremental.** Case info, course details, and student each load and appear as soon as they're ready, so you're not waiting for everything before you see anything.

- **Report issue button.** If something goes wrong, a "Report issue" button appears and sends a diagnostic snapshot to the support inbox in one click — no need to describe what you were doing.

- **Feedback button.** There's now a small "Feedback / request" link in the footer of every dialog. Use it to send notes, requests, or bug reports directly from the extension.

- **Send diagnostic.** In the Dev section, you can send a full (PII-safe) state snapshot to the support inbox to help debug tricky cases.

- **Consent gate.** The extension now asks for explicit permission before reading any Salesforce data.

---

## 2026-02 (v0.1)

### New
- Initial release: Canvas course link from a Salesforce case page, course search shortcut, dev workflow tools.
