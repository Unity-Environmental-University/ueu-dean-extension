# Dean Tools — Changelog

---

## 2026-03-26 (v0.4.2)

### What's fixed

- **Wrong student name on fast navigation.** Clicking quickly between cases could show the previous case's student name. The async resolution pipeline now drops writes from superseded navigations.

- **History drawer not scrolling.** The prior-cases drawer was locked to its visible height — long case lists were cut off with no scrollbar. Fixed.

- **History filters persisting across cases.** If you filtered by status on one case, that filter silently carried over when you navigated to the next case. Filters now reset on every navigation.

- **Prior cases capped at 25.** The history query had a silent LIMIT 25. Bumped to 100 so high-volume students show their full history.

---

## 2026-03-26 (v0.4.1)

### What's new

- **Search for people, not just courses.** The popup search (click the extension icon) now finds students and instructors by name or email. Type a name and it searches students. Click "Instructors" to switch. Course search still works — type a course code and it switches automatically.

- **Student info on every case.** Cases now show the student's name and email with a link to their Account page, even when the case doesn't have a course attached.

- **Last Date of Activity.** The student's most recent Canvas activity now shows on Account pages (green banner at top) and on Case pages (under the student name). On Account pages, you can also see per-course activity when you expand a course.

- **Better history drawer.** The prior-cases drawer opens next to the main panel instead of floating on top. Both sides scroll together. Cases have a colored left border showing status at a glance (red = escalated, green = resolved). You can now filter by status too — not just case type.

- **Case subjects in history.** Each prior case card now shows the subject line, so you can tell what it's about without clicking into it.

### What's fixed

- **Dev panel field lists now update correctly.** The raw field name lists in the Dev section weren't updating when you navigated between pages. Fixed.

### Under the hood

- 166 automated tests (up from 160).
- History drawer split into two components for cleaner layout.
- Removed abbreviation system — full type names are clearer.

---

## 2026-03-25 (v0.4.0 beta)

### What's new

- **See actual cases on student profiles.** When you're on an Account page, the open-cases count is now clickable. It expands to show each case with a link, status, type, and course.

- **Update notice.** When a new version is available, you'll see a yellow banner at the top of the panel telling you to update.

- **Field name tool for developers.** The Dev panel has a "Copy field names" button. It copies all the Salesforce field names on the current page — no student data, just the field names. Useful for reporting which fields are missing.

### What's fixed

- **Moving between pages works now.** Before, clicking from a Case to a student Account (or to a Course Offering) could show leftover data from the last page. Now each page starts fresh.

- **Course Offering pages show the right thing.** They were accidentally showing the Case view. Fixed.

- **Course Offering rosters load from Canvas.** The Salesforce query for enrolled students was using the wrong table name. Now the extension pulls the roster directly from Canvas, which also gives you grades and last-activity dates.

- **No more "Unk" labels.** Cases that don't have a type or status used to show "Unk." Now they just don't show those fields.

- **No more stuck "Loading..." screens.** If you navigate to a page the extension doesn't support (like a Learning Course), it stops loading instead of spinning forever.

- **Crashes after reloading the extension.** If Chrome restarts the extension in the background, you used to get a white screen and console errors. Now you get a clear message: "Extension was reloaded — please refresh this page."

- **Pronouns now show up.** The extension was looking for the wrong field name. Now it finds `PersonGenderIdentity` and `PersonPronouns` correctly.

### Under the hood

- The two biggest files were split into smaller pieces (12 components total). This makes future changes safer and easier to review.
- 160 automated tests catch problems before they reach you.

---

## 2026-03-23 (v0.3.0)

### New

- **Account page view.** Navigate to a student's Account record in Salesforce to see their Canvas courses grouped by term, with current scores, grades, and last activity dates. Click any term chip to filter. Current term is auto-selected.

- **Course Offering page view.** Navigate to a Course Offering record to see the full Canvas roster with grades, enrollment state, last activity, and sortable columns.

- **Canvas messages (click-to-load).** On a Case page with both student and instructor resolved, click "View instructor ↔ student messages" to see recent Canvas conversations between them. On an Account page, click "View student inbox" to see the student's full inbox. Requires masquerade permission — the button only appears if you have it.

- **Permission-aware links.** "Act as →" links for students and instructors now only appear if your Canvas account has the "Become other users" permission. If you don't have it, the links simply aren't shown — no broken clicks.

### Improved

- **Term names are cleaner.** History cards and term group headers now strip internal suffixes (e.g. "Spring 2026 - Distance Education" → "Spring 2026").

- **History drawer polish.** Case subtype and type names are abbreviated for readability. Course codes are extracted and shown alongside term names. Course Offering links go directly to the SF record.

- **Last Date of Activity (LDA)** is now shown on Account pages and in Course Offering rosters — helps advisors spot disengaged students quickly.

- **Canvas session detection is smarter.** The extension now distinguishes "not logged into Canvas" from "no masquerade permission" — you get the right prompt for each situation.

### Fixed

- **All-filter race condition.** Selecting "All" in the history drawer no longer briefly shows stale filtered results.

- **First-load race.** Fixed a timing issue where the extension could miss data on the very first page load after install.

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
