/**
 * Student courses — transforms Canvas API responses into term-grouped course views.
 *
 * Pure data layer. No side effects, no API calls, no DOM.
 */

export interface CanvasTerm {
  id: number
  name: string
  start_at: string | null
  end_at: string | null
}

export interface CanvasEnrollment {
  type: string
  enrollment_state: string
  computed_current_score: number | null
  computed_final_score: number | null
  computed_current_grade: string | null
  computed_final_grade: string | null
}

export interface CanvasCourse {
  id: number
  name: string
  course_code: string
  enrollment_term_id: number
  term?: CanvasTerm
  enrollments?: CanvasEnrollment[]
}

export interface CourseView {
  courseId: number
  name: string
  courseCode: string
  currentScore: number | null
  finalScore: number | null
  currentGrade: string | null
  finalGrade: string | null
  enrollmentState: string
}

export interface TermGroup {
  termId: number
  termName: string
  startAt: string | null
  courses: CourseView[]
}

/** Extract the student enrollment from a course's enrollments array */
function studentEnrollment(course: CanvasCourse): CanvasEnrollment | null {
  if (!course.enrollments?.length) return null
  // Prefer StudentEnrollment, fall back to first
  return course.enrollments.find(e => e.type === "StudentEnrollment") ?? course.enrollments[0]
}

/** Transform a single Canvas course into a CourseView */
export function toCourseView(course: CanvasCourse): CourseView {
  const enrollment = studentEnrollment(course)
  return {
    courseId: course.id,
    name: course.name,
    courseCode: course.course_code,
    currentScore: enrollment?.computed_current_score ?? null,
    finalScore: enrollment?.computed_final_score ?? null,
    currentGrade: enrollment?.computed_current_grade ?? null,
    finalGrade: enrollment?.computed_final_grade ?? null,
    enrollmentState: enrollment?.enrollment_state ?? "unknown",
  }
}

/** Group courses by term, sorted by term start date (most recent first) */
export function groupByTerm(courses: CanvasCourse[]): TermGroup[] {
  const groups = new Map<number, TermGroup>()

  for (const course of courses) {
    const termId = course.term?.id ?? course.enrollment_term_id
    const existing = groups.get(termId)

    if (existing) {
      existing.courses.push(toCourseView(course))
    } else {
      groups.set(termId, {
        termId,
        termName: course.term?.name ?? `Term ${termId}`,
        startAt: course.term?.start_at ?? null,
        courses: [toCourseView(course)],
      })
    }
  }

  // Sort terms: most recent first (by start_at, nulls last)
  const sorted = [...groups.values()].sort((a, b) => {
    if (!a.startAt && !b.startAt) return 0
    if (!a.startAt) return 1
    if (!b.startAt) return -1
    return b.startAt.localeCompare(a.startAt)
  })

  // Sort courses within each term alphabetically by name
  for (const group of sorted) {
    group.courses.sort((a, b) => a.name.localeCompare(b.name))
  }

  return sorted
}

/** Is this term likely "current" based on dates? */
export function isCurrentTerm(term: TermGroup, now: Date = new Date()): boolean {
  if (!term.startAt) return false
  const start = new Date(term.startAt)
  // If term has started and either has no end or hasn't ended yet
  return start <= now
}

/** Compute term GPA-like summary: average of non-null current scores */
export function termAverage(term: TermGroup): number | null {
  const scores = term.courses
    .map(c => c.currentScore)
    .filter((s): s is number => s !== null)
  if (scores.length === 0) return null
  return scores.reduce((sum, s) => sum + s, 0) / scores.length
}
