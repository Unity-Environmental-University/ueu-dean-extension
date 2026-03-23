# Who Uses Dean Tools

The extension doesn't model user roles in code. It models **permissions**. But the humans (and Claudes) behind those permissions fall into distinct classes with different workflows, and understanding them shapes what we build.

## User Classes

### 1. The Dean (case adjudicator)

**Lives on:** Case pages
**Needs:** The whole picture for one incident — student history, grades, instructor info, Canvas messages — without leaving the case.
**Permission profile:** Has Canvas masquerade. This is their primary tool.

Typical question: *"I'm deciding on a dishonesty case. I need prior cases, current grade, instructor report, and student-instructor messages — all without opening four tabs."*

**Served by:** CaseView — case info, dishonesty/grade-appeal sections, Canvas links, message threads, history drawer.

### 2. The Advisor (longitudinal student view)

**Lives on:** Account pages
**Needs:** The student across time, not a single incident. Courses by term, scores, LDA, engagement patterns. Whether there are open cases they should know about.
**Permission profile:** May or may not have masquerade. Account view works either way for scores/LDA. Inbox requires masquerade.

Typical question: *"A student missed two weeks. I need LDA across all courses, current grades, and whether there's an open case."*

**Served by:** AccountView — courses by term, scores, LDA banner, inbox.
**Known gap:** No case awareness on Account pages. Advisor can't see that a student has open cases without navigating to Cases. (Play branch `play/advisor-case-awareness` has a sketch for this.)

### 3. The Coordinator (course-level operations)

**Lives on:** CourseOffering pages
**Needs:** Section-level visibility. Who's failing, who's inactive, who needs intervention. Sort and scan.
**Permission profile:** Needs SF access. Masquerade is a bonus (enables student profile links) but roster works without it.

Typical question: *"Instructor flagged low engagement in this section. Who's inactive and what are their grades?"*

**Served by:** CourseOfferingView — sortable roster with scores, LDA, student links.
**Known gap:** No escalation path. Can see who's struggling but can't create a case or flag for an advisor from the roster.

### 4. Staff Without Masquerade

Any of the above roles, but their Canvas admin account lacks "Become other users." They see:
- All SF-sourced data (case details, prior history, course offerings)
- Canvas scores and LDA (no masquerade needed)
- Canvas profile links
- **Not:** Act-as links, student inbox, message threads

The code handles this explicitly: grayed-out features with `ueu-canvas-pending`, and the "Some Canvas features are unavailable" message when `canMasquerade === false`.

### 5. The New User (no Canvas session)

Any role, first use or expired session. The extension detects this and shows "Canvas session required" with a link to Canvas. Auto-polls every 1.5s and refreshes when session appears. SF data still loads — Canvas features light up once authenticated.

### 6. The Claude (codebase contributor)

Multiple Claudes work on this codebase, sometimes concurrently. They need:
- CLAUDE.md for architecture and patterns
- This doc for who they're building for
- The "When Adding State" checklist to avoid the applyPatch wiring trap
- Clean, greppable code (no framework magic, plain objects, explicit wiring)

The reactive state pattern (plain object + listeners + version signal) was chosen partly because it's immediately legible to any Claude without framework knowledge.

## Design Principles (SPICES lens)

**Simplicity:** One overlay, one interface. The SF object type determines which view loads — no role selector, no mode switch.

**Equality:** Same tool for everyone. Capabilities determined by Canvas permissions, not by a role dropdown. The case signal (if built) would show for all roles, not just deans.

**Integrity:** The tool makes truth visible at the right moment. An advisor who doesn't know about an open case can't advise well. A dean who can't see messages can't judge fairly. Don't hide what matters.

**Community:** Multiple Claudes build without collision. CSS and cache from one session, messages and masquerade from another. The codebase holds.

**Stewardship:** Long-horizon tool for real people making real decisions about students. Every feature should reduce context-switching, not add cognitive load.

## The Blind Spot

Students are the most affected stakeholder and the only one who never uses the tool. The extension reads their grades, messages, and activity — they don't know. This is not currently addressed. It may be a Canvas-level concern (masquerade is a Canvas permission, not ours), but it's worth naming: **the tool's power comes from asymmetric visibility, and that asymmetry should be held with care.**

Specific tensions:
- **No audit trail in the extension.** Canvas may log masquerade events, but the extension doesn't surface or record when conversations are viewed. A dean reading student messages leaves no trace in our system.
- **Grades vs. messages.** Viewing grades extends visibility an instructor already has. Reading private student-instructor conversations is qualitatively different — neither party knows.
- **Binary permission model.** Canvas masquerade is all-or-nothing. There's no "grades but not messages" tier. The extension inherits this, but could choose to gate message access separately if the asymmetry proves uncomfortable.
