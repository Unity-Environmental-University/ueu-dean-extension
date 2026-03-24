/**
 * Sandbox fixtures — dummy data for all three views.
 * Each scenario is a state patch that can be applied to core.ts state.
 */

import type { AccountCasesResult } from "../src/content/load-account-cases"

const NOW = new Date().toISOString()
const PAST = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString()

export const SCENARIOS = {
  // ── Account View ──────────────────────────────
  "account:happy": {
    label: "Account — full data",
    page: { objectType: "Account", recordId: "001FAKE" },
    accountData: {
      accountName: "Jordan Rivera",
      canvasUserId: "98765",
      lastActivityAt: PAST(1),
      error: null,
      termGroups: [
        {
          termId: 2024010,
          termName: "2024 Spring",
          startAt: "2024-01-15",
          endAt: "2024-05-15",
          courses: [
            { courseId: 1001, name: "ENV 101 — Intro to Environmental Science", enrollmentState: "active", currentScore: 92, currentGrade: "A-", lastActivityAt: PAST(1) },
            { courseId: 1002, name: "BIO 210 — Ecology", enrollmentState: "active", currentScore: 78, currentGrade: "C+", lastActivityAt: PAST(3) },
            { courseId: 1003, name: "MAT 120 — Statistics", enrollmentState: "active", currentScore: 65, currentGrade: "D", lastActivityAt: PAST(14) },
          ],
        },
        {
          termId: 2023040,
          termName: "2023 Fall",
          startAt: "2023-09-01",
          endAt: "2023-12-15",
          courses: [
            { courseId: 900, name: "ENG 101 — College Writing", enrollmentState: "completed", currentScore: 88, currentGrade: "B+", lastActivityAt: PAST(90) },
            { courseId: 901, name: "ENV 100 — Sustainability Foundations", enrollmentState: "completed", currentScore: 95, currentGrade: "A", lastActivityAt: PAST(90) },
          ],
        },
        {
          termId: 2023010,
          termName: "2023 Spring",
          startAt: "2023-01-15",
          endAt: "2023-05-15",
          courses: [
            { courseId: 800, name: "GEN 100 — First Year Seminar", enrollmentState: "completed", currentScore: 90, currentGrade: "A-", lastActivityAt: PAST(365) },
          ],
        },
      ],
    },
    accountCases: {
      cases: [
        { id: "500FAKE1", caseNumber: "00012345", type: "Academic Dishonesty", subType: "Plagiarism", status: "Open", createdDate: PAST(5), courseName: "ENV 101", courseCode: null, termName: "2024 Spring" },
        { id: "500FAKE2", caseNumber: "00012300", type: "Grade Appeal", subType: null, status: "Open", createdDate: PAST(10), courseName: "BIO 210", courseCode: null, termName: "2024 Spring" },
        { id: "500FAKE3", caseNumber: "00011000", type: "Academic Dishonesty", subType: "Cheating", status: "Closed", createdDate: PAST(120), courseName: "ENG 101", courseCode: null, termName: "2023 Fall" },
      ],
      openCount: 2,
      error: null,
    } satisfies AccountCasesResult,
    canMasquerade: true,
    canMasqueradeCache: true,
    loading: false,
    error: null,
  },

  "account:no-canvas": {
    label: "Account — no Canvas ID",
    page: { objectType: "Account", recordId: "001FAKE" },
    accountData: {
      accountName: "Alex Chen",
      canvasUserId: null,
      lastActivityAt: null,
      error: "no-canvas-id",
      termGroups: [],
    },
    accountCases: null,
    loading: false,
    error: null,
  },

  "account:session-required": {
    label: "Account — Canvas session needed",
    page: { objectType: "Account", recordId: "001FAKE" },
    accountData: {
      accountName: "Sam Taylor",
      canvasUserId: "55555",
      lastActivityAt: null,
      error: "canvas-session-required",
      termGroups: [],
    },
    accountCases: null,
    loading: false,
    error: null,
  },

  "account:no-masquerade": {
    label: "Account — no masquerade permission",
    page: { objectType: "Account", recordId: "001FAKE" },
    accountData: {
      accountName: "Jordan Rivera",
      canvasUserId: "98765",
      lastActivityAt: PAST(1),
      error: null,
      termGroups: [
        {
          termId: 2024010,
          termName: "2024 Spring",
          startAt: "2024-01-15",
          endAt: "2024-05-15",
          courses: [
            { courseId: 1001, name: "ENV 101 — Intro to Environmental Science", enrollmentState: "active", currentScore: 92, currentGrade: "A-", lastActivityAt: PAST(1) },
          ],
        },
      ],
    },
    canMasquerade: false,
    canMasqueradeCache: false,
    loading: false,
    error: null,
  },

  "account:many-terms": {
    label: "Account — 8 terms (chip overflow test)",
    page: { objectType: "Account", recordId: "001FAKE" },
    accountData: {
      accountName: "Long Career Student",
      canvasUserId: "11111",
      lastActivityAt: PAST(2),
      error: null,
      termGroups: Array.from({ length: 8 }, (_, i) => ({
        termId: 2020010 + i * 5,
        termName: `${2020 + Math.floor(i / 2)} ${i % 2 === 0 ? "Spring" : "Fall"}`,
        startAt: `${2020 + Math.floor(i / 2)}-0${i % 2 === 0 ? 1 : 9}-01`,
        endAt: `${2020 + Math.floor(i / 2)}-0${i % 2 === 0 ? 5 : 12}-15`,
        courses: [
          { courseId: 100 + i, name: `COURSE ${100 + i}`, enrollmentState: i < 6 ? "completed" : "active", currentScore: 70 + i * 3, currentGrade: "B", lastActivityAt: PAST(i * 30) },
        ],
      })),
    },
    accountCases: { cases: [], openCount: 0, error: null },
    loading: false,
    error: null,
  },

  // ── Case View ──────────────────────────────────
  "case:dishonesty": {
    label: "Case — Academic Dishonesty",
    page: { objectType: "Case", recordId: "500FAKE" },
    caseData: {
      caseNumber: "00012345",
      status: "Open",
      contactName: "Jordan Rivera",
      contactEmail: "jrivera@unity.edu",
      accountName: "Jordan Rivera",
      accountId: "001FAKE",
      type: "Academic Dishonesty",
      subType: "Plagiarism",
      description: "Student submitted work with significant AI-generated content in ENV 101 midterm paper.",
      createdDate: PAST(5),
      courseName: "ENV 101 — Intro to Environmental Science",
      courseOfferingId: "a0AFAKE",
      termName: "2024 Spring",
    },
    dishonesty: {
      incidentType: "plagiarism",
      plagiarismScore: "67%",
      priorOffenses: "1",
      sanctionRequested: "F on assignment",
    },
    canvas: {
      courseId: 1001,
      url: "https://unity.instructure.com/courses/1001",
      enrollmentUrl: null,
      studentId: "98765",
      studentName: "Jordan Rivera",
    },
    instructor: {
      name: "Dr. Sarah Mitchell",
      email: "smitchell@unity.edu",
      canvasId: "44444",
    },
    priorCases: [
      { id: "500OLD1", caseNumber: "00011000", type: "Academic Dishonesty", subType: "Cheating", status: "Closed", createdDate: PAST(120), courseName: "ENG 101" },
    ],
    canMasquerade: true,
    canMasqueradeCache: true,
    loading: false,
    error: null,
  },

  "case:grade-appeal": {
    label: "Case — Grade Appeal",
    page: { objectType: "Case", recordId: "500FAKE2" },
    caseData: {
      caseNumber: "00012300",
      status: "Open",
      contactName: "Jordan Rivera",
      contactEmail: "jrivera@unity.edu",
      accountName: "Jordan Rivera",
      accountId: "001FAKE",
      type: "Grade Appeal",
      subType: null,
      description: "Student is appealing final grade in BIO 210, claiming grading rubric was not followed for the final project.",
      createdDate: PAST(10),
      courseName: "BIO 210 — Ecology",
      courseOfferingId: "a0AFAKE2",
      termName: "2024 Spring",
    },
    gradeAppeal: {
      currentGrade: "C+",
      requestedGrade: "B",
      basis: "Grading criteria not applied consistently",
    },
    canvas: {
      courseId: 1002,
      url: "https://unity.instructure.com/courses/1002",
      enrollmentUrl: null,
      studentId: "98765",
      studentName: "Jordan Rivera",
    },
    loading: false,
    error: null,
  },

  // ── Course Offering View ──────────────────────
  "offering:roster": {
    label: "Course Offering — roster with grades",
    page: { objectType: "CourseOffering", recordId: "a0AFAKE" },
    offeringData: {
      offeringName: "ENV 101 — Intro to Environmental Science",
      canvasCourseId: 1001,
      canvasCourseUrl: "https://unity.instructure.com/courses/1001",
      termName: "2024 Spring",
      instructorName: "Dr. Sarah Mitchell",
      instructorCanvasId: "44444",
      students: [
        { name: "Jordan Rivera", canvasUserId: 98765, sfContactId: "003FAKE1", currentScore: 92, currentGrade: "A-", lastActivityAt: PAST(1), enrollmentState: "active" },
        { name: "Alex Chen", canvasUserId: 98766, sfContactId: "003FAKE2", currentScore: 78, currentGrade: "C+", lastActivityAt: PAST(3), enrollmentState: "active" },
        { name: "Sam Taylor", canvasUserId: 98767, sfContactId: "003FAKE3", currentScore: 65, currentGrade: "D", lastActivityAt: PAST(14), enrollmentState: "active" },
        { name: "Casey Kim", canvasUserId: 98768, sfContactId: "003FAKE4", currentScore: 95, currentGrade: "A", lastActivityAt: PAST(0), enrollmentState: "active" },
        { name: "Morgan Lee", canvasUserId: 98769, sfContactId: "003FAKE5", currentScore: null, currentGrade: null, lastActivityAt: null, enrollmentState: "active" },
      ],
      error: null,
      diagnostics: [],
    },
    loading: false,
    error: null,
  },

  // ── Edge states ────────────────────────────────
  "loading": {
    label: "Loading state",
    loading: true,
    page: { objectType: "Account", recordId: "001FAKE" },
  },

  "error": {
    label: "Error state",
    error: "SF API 500: Internal Server Error",
    page: { objectType: "Account", recordId: "001FAKE" },
  },
} as const satisfies Record<string, { label: string } & Record<string, any>>

export type ScenarioKey = keyof typeof SCENARIOS
