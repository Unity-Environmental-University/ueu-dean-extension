# Dean Tools — Changelog

---

## 2026-03-26 (v0.4.3-beta)

### What's fixed

- **Student pages could get stuck on "Loading."** When Salesforce changed the URL multiple times quickly (which it does sometimes), the extension could get confused and stop loading. Now it waits for things to settle before loading the page.

---

## 2026-03-26 (v0.4.2)

### What's fixed

- **Wrong student name when clicking between cases.** If you clicked from one case to another quickly, the first case's student name could show up on the second case. Fixed — the extension now throws away old data when you move to a new page.

- **History drawer wouldn't scroll.** If a student had a lot of cases, the list got cut off and you couldn't scroll down to see the rest. Now it scrolls, with a visible scrollbar.

- **Filters carried over between cases.** If you filtered the history list on one case (like "show only On Hold"), that filter stayed on when you went to the next case. Now filters reset every time you open a new case.

- **Only showed 25 past cases.** The history list was quietly limited to 25 cases. Now it shows up to 100.

---

## 2026-03-26 (v0.4.1)

### What's new

- **Search for people, not just courses.** Click the extension icon to search. Type a name to find students. Click "Instructors" to search for teachers instead. Type a course code and it switches to course search automatically.

- **Last Date of Activity.** You can now see when a student was last active in Canvas. This shows up on Account pages (green banner at the top) and on Case pages (under the student's name). On Account pages, you can also see activity for each course.

- **Better history drawer.** The past-cases drawer now opens next to the main panel instead of on top of it. Each case has a colored stripe on the left so you can see the status at a glance (red = escalated, green = resolved). You can also filter by status.

- **Case subjects in history.** Each past case now shows its subject line, so you can tell what it's about without clicking into it.

### What's fixed

- **Dev panel field lists now update when you change pages.** Before, the raw field names in the Dev section got stuck showing the previous page's data.

---

## 2026-03-25 (v0.4.0 beta)

### What's new

- **See actual cases on student profiles.** On an Account page, the open-cases count is now clickable. It shows each case with a link, status, type, and course.

- **Update notice.** When a new version comes out, you'll see a yellow banner at the top telling you to update.

### What's fixed

- **Pages no longer show leftover data.** Before, clicking from a Case to a student Account could show data from the last page. Now each page starts fresh.

- **Course Offering pages work.** They were accidentally showing the Case view instead of the roster.

- **Course Offering rosters come from Canvas now.** The old Salesforce query used the wrong table. Now the roster comes straight from Canvas, which also gives you grades and last-activity dates.

- **No more stuck "Loading..." screens.** Pages the extension doesn't support (like Learning Courses) no longer spin forever.

- **Extension reloads don't crash the page.** If Chrome restarts the extension in the background, you now get a clear message instead of a white screen.

- **Pronouns show up.** The extension was looking for the wrong field name. Fixed.

---

## 2026-03-23 (v0.3.0)

### What's new

- **Student Account pages.** Go to a student's Account in Salesforce to see their Canvas courses grouped by term, with scores, grades, and last activity. Click a term to filter. The current term is selected automatically.

- **Course Offering pages.** Go to a Course Offering to see the full Canvas roster with grades, enrollment status, last activity, and sortable columns.

- **Canvas messages.** On a Case page, click "View instructor ↔ student messages" to see their Canvas conversations. On an Account page, click "View student inbox" to see the student's full inbox. Only shows up if your Canvas account has the right permission.

- **Smart links.** "Act as" links only appear if your Canvas account can actually do it. No more broken links.

### What's improved

- **Cleaner term names.** "Spring 2026 - Distance Education" now just shows "Spring 2026."

- **Last Date of Activity** now shows on Account pages and Course Offering rosters — helps spot students who haven't been active.

- **Better Canvas session handling.** The extension now tells you clearly whether you need to log into Canvas or whether you're missing a permission.

### What's fixed

- **History filter glitch.** Clicking "All" no longer briefly shows the wrong results.

- **First page load could miss data.** Fixed a timing issue on the very first page load after install.

---

## 2026-03-18 (v0.2.0)

### What's new

- **Student History.** Click "Student History" on any case to see all past cases for that student in a slide-out panel. You can filter by case type.

- **Instructor links.** The extension now finds instructors in Canvas and shows links to their profile, course page, and email.

- **Works on all case types.** Any case with a Course Offering now shows Canvas links — not just dishonesty and grade appeal cases.

### What's fixed

- **Student lookup is more reliable.** The extension was using the wrong ID to find students in Canvas. Now it reads the Canvas User ID from Salesforce, with fallbacks to enrollment and email search.

- **Instructor lookup works without admin access.** It now searches within the course first, which works with a normal Canvas session.

---

## 2026-03-12 (v0.1.2)

### What's fixed
- **Pages no longer fail to load sometimes.** A bug caused the extension to occasionally miss that you'd opened a case. Fixed.
- **Student lookup fallback works in all cases.** If the main lookup method fails, email search now kicks in correctly.

---

## 2026-03-09 (v0.1.1)

### What's new

- **Case data comes from Salesforce directly.** The extension reads case records through the Salesforce API using your existing login — more reliable than reading from the page.

- **Student lookup.** The extension finds the student in Canvas automatically from a case. It shows the student's name with links to their grades, profile, and "act as" view.

- **Canvas session prompt.** If you aren't logged into Canvas, the extension tells you and waits. Log into Canvas in another tab and it updates on its own.

- **Grade appeal details.** Shows course, current grade, changed grade, decision status, and instructor for grade appeal cases.

- **Things load as they're ready.** Case info, course details, and student info each appear as soon as they load — you don't have to wait for everything.

- **Report issue button.** Sends a diagnostic snapshot to the support inbox in one click.

- **Feedback link.** A "Feedback / request" link in the footer lets you send notes or bug reports from the extension.

---

## 2026-02 (v0.1)

First release. Canvas course link from a Salesforce case page and course search.
