// @vitest-environment node
import { describe, it, expect } from "vitest"
import fc from "fast-check"
import {
  toCourseView,
  groupByTerm,
  isCurrentTerm,
  termAverage,
  type CanvasCourse,
  type CanvasTerm,
  type CanvasEnrollment,
  type TermGroup,
} from "./student-courses"

// --- Arbitraries ---

const arbTerm: fc.Arbitrary<CanvasTerm> = fc.record({
  id: fc.nat(),
  name: fc.string({ minLength: 1 }),
  start_at: fc.oneof(fc.integer({ min: 1577836800000, max: 1893456000000 }).map(ms => new Date(ms).toISOString()), fc.constant(null)),
  end_at: fc.oneof(fc.integer({ min: 1577836800000, max: 1893456000000 }).map(ms => new Date(ms).toISOString()), fc.constant(null)),
})

const arbEnrollment: fc.Arbitrary<CanvasEnrollment> = fc.record({
  type: fc.constantFrom("StudentEnrollment", "TeacherEnrollment", "ObserverEnrollment"),
  enrollment_state: fc.constantFrom("active", "completed", "inactive"),
  computed_current_score: fc.oneof(fc.double({ min: 0, max: 100, noNaN: true }), fc.constant(null)),
  computed_final_score: fc.oneof(fc.double({ min: 0, max: 100, noNaN: true }), fc.constant(null)),
  computed_current_grade: fc.oneof(fc.constantFrom("A", "B", "C", "D", "F"), fc.constant(null)),
  computed_final_grade: fc.oneof(fc.constantFrom("A", "B", "C", "D", "F"), fc.constant(null)),
})

const arbCourse = (term: CanvasTerm): fc.Arbitrary<CanvasCourse> =>
  fc.record({
    id: fc.nat(),
    name: fc.string({ minLength: 1 }),
    course_code: fc.string({ minLength: 1 }),
    enrollment_term_id: fc.constant(term.id),
    term: fc.constant(term),
    enrollments: fc.array(arbEnrollment, { minLength: 1, maxLength: 3 }),
  })

// --- toCourseView ---

describe("toCourseView", () => {
  it("extracts scores from StudentEnrollment", () => {
    const course: CanvasCourse = {
      id: 1,
      name: "BIO 101",
      course_code: "BIO-101-F24",
      enrollment_term_id: 10,
      enrollments: [
        { type: "TeacherEnrollment", enrollment_state: "active", computed_current_score: null, computed_final_score: null, computed_current_grade: null, computed_final_grade: null },
        { type: "StudentEnrollment", enrollment_state: "active", computed_current_score: 92.5, computed_final_score: 88.0, computed_current_grade: "A", computed_final_grade: "B+" },
      ],
    }
    const view = toCourseView(course)
    expect(view.currentScore).toBe(92.5)
    expect(view.finalScore).toBe(88.0)
    expect(view.currentGrade).toBe("A")
    expect(view.enrollmentState).toBe("active")
  })

  it("handles missing enrollments gracefully", () => {
    const course: CanvasCourse = {
      id: 2,
      name: "ENG 201",
      course_code: "ENG-201",
      enrollment_term_id: 10,
    }
    const view = toCourseView(course)
    expect(view.currentScore).toBeNull()
    expect(view.finalScore).toBeNull()
    expect(view.enrollmentState).toBe("unknown")
  })

  it("preserves course identity for any input", () => {
    fc.assert(
      fc.property(
        arbTerm.chain(t => arbCourse(t)),
        (course) => {
          const view = toCourseView(course)
          expect(view.courseId).toBe(course.id)
          expect(view.name).toBe(course.name)
          expect(view.courseCode).toBe(course.course_code)
        },
      ),
    )
  })
})

// --- groupByTerm ---

describe("groupByTerm", () => {
  it("groups courses with the same term together", () => {
    const term: CanvasTerm = { id: 10, name: "Fall 2025", start_at: "2025-09-01T00:00:00Z", end_at: null }
    const courses: CanvasCourse[] = [
      { id: 1, name: "BIO 101", course_code: "BIO", enrollment_term_id: 10, term, enrollments: [{ type: "StudentEnrollment", enrollment_state: "active", computed_current_score: 90, computed_final_score: null, computed_current_grade: "A", computed_final_grade: null }] },
      { id: 2, name: "ART 100", course_code: "ART", enrollment_term_id: 10, term, enrollments: [{ type: "StudentEnrollment", enrollment_state: "active", computed_current_score: 85, computed_final_score: null, computed_current_grade: "B", computed_final_grade: null }] },
    ]
    const groups = groupByTerm(courses)
    expect(groups).toHaveLength(1)
    expect(groups[0].termName).toBe("Fall 2025")
    expect(groups[0].courses).toHaveLength(2)
    // Sorted alphabetically: ART before BIO
    expect(groups[0].courses[0].name).toBe("ART 100")
    expect(groups[0].courses[1].name).toBe("BIO 101")
  })

  it("separates courses from different terms", () => {
    const fall: CanvasTerm = { id: 10, name: "Fall 2025", start_at: "2025-09-01T00:00:00Z", end_at: null }
    const spring: CanvasTerm = { id: 11, name: "Spring 2026", start_at: "2026-01-15T00:00:00Z", end_at: null }
    const courses: CanvasCourse[] = [
      { id: 1, name: "BIO 101", course_code: "BIO", enrollment_term_id: 10, term: fall, enrollments: [] },
      { id: 2, name: "ENG 201", course_code: "ENG", enrollment_term_id: 11, term: spring, enrollments: [] },
    ]
    const groups = groupByTerm(courses)
    expect(groups).toHaveLength(2)
    // Most recent first
    expect(groups[0].termName).toBe("Spring 2026")
    expect(groups[1].termName).toBe("Fall 2025")
  })

  it("sorts terms most recent first", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            term: fc.record({
              id: fc.nat(),
              name: fc.string({ minLength: 1 }),
              start_at: fc.integer({ min: 1577836800000, max: 1893456000000 }).map(ms => new Date(ms).toISOString()),
              end_at: fc.constant(null as string | null),
            }),
          }).chain(({ term }) =>
            arbCourse(term).map(course => course)
          ),
          { minLength: 2, maxLength: 10 },
        ),
        (courses) => {
          const groups = groupByTerm(courses)
          // Verify descending order by startAt
          for (let i = 1; i < groups.length; i++) {
            if (groups[i - 1].startAt && groups[i].startAt) {
              expect(groups[i - 1].startAt! >= groups[i].startAt!).toBe(true)
            }
          }
        },
      ),
    )
  })

  it("returns empty array for empty input", () => {
    expect(groupByTerm([])).toEqual([])
  })

  it("falls back to enrollment_term_id when term object is missing", () => {
    const courses: CanvasCourse[] = [
      { id: 1, name: "BIO 101", course_code: "BIO", enrollment_term_id: 99 },
    ]
    const groups = groupByTerm(courses)
    expect(groups).toHaveLength(1)
    expect(groups[0].termId).toBe(99)
    expect(groups[0].termName).toBe("Term 99")
  })

  it("never loses courses during grouping", () => {
    fc.assert(
      fc.property(
        fc.array(
          arbTerm.chain(t => arbCourse(t)),
          { minLength: 0, maxLength: 20 },
        ),
        (courses) => {
          const groups = groupByTerm(courses)
          const totalCourses = groups.reduce((sum, g) => sum + g.courses.length, 0)
          expect(totalCourses).toBe(courses.length)
        },
      ),
    )
  })
})

// --- isCurrentTerm ---

describe("isCurrentTerm", () => {
  it("returns true for a term that has started", () => {
    const term: TermGroup = {
      termId: 1,
      termName: "Current",
      startAt: "2025-01-01T00:00:00Z",
      courses: [],
    }
    expect(isCurrentTerm(term, new Date("2025-06-01"))).toBe(true)
  })

  it("returns false for a future term", () => {
    const term: TermGroup = {
      termId: 1,
      termName: "Future",
      startAt: "2026-09-01T00:00:00Z",
      courses: [],
    }
    expect(isCurrentTerm(term, new Date("2025-06-01"))).toBe(false)
  })

  it("returns false when startAt is null", () => {
    const term: TermGroup = {
      termId: 1,
      termName: "Unknown",
      startAt: null,
      courses: [],
    }
    expect(isCurrentTerm(term)).toBe(false)
  })
})

// --- termAverage ---

describe("termAverage", () => {
  it("computes average of non-null scores", () => {
    const term: TermGroup = {
      termId: 1,
      termName: "Fall",
      startAt: null,
      courses: [
        { courseId: 1, name: "A", courseCode: "A", currentScore: 90, finalScore: null, currentGrade: null, finalGrade: null, enrollmentState: "active" },
        { courseId: 2, name: "B", courseCode: "B", currentScore: 80, finalScore: null, currentGrade: null, finalGrade: null, enrollmentState: "active" },
        { courseId: 3, name: "C", courseCode: "C", currentScore: null, finalScore: null, currentGrade: null, finalGrade: null, enrollmentState: "active" },
      ],
    }
    expect(termAverage(term)).toBe(85)
  })

  it("returns null when no scores exist", () => {
    const term: TermGroup = {
      termId: 1,
      termName: "Empty",
      startAt: null,
      courses: [
        { courseId: 1, name: "A", courseCode: "A", currentScore: null, finalScore: null, currentGrade: null, finalGrade: null, enrollmentState: "active" },
      ],
    }
    expect(termAverage(term)).toBeNull()
  })

  it("average is always between min and max scores", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.double({ min: 0, max: 100, noNaN: true }),
          { minLength: 1, maxLength: 10 },
        ),
        (scores) => {
          const term: TermGroup = {
            termId: 1,
            termName: "T",
            startAt: null,
            courses: scores.map((s, i) => ({
              courseId: i,
              name: `C${i}`,
              courseCode: `C${i}`,
              currentScore: s,
              finalScore: null,
              currentGrade: null,
              finalGrade: null,
              enrollmentState: "active",
            })),
          }
          const avg = termAverage(term)!
          expect(avg).toBeGreaterThanOrEqual(Math.min(...scores))
          expect(avg).toBeLessThanOrEqual(Math.max(...scores))
        },
      ),
    )
  })
})
