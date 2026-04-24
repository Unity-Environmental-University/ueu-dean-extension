import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { classifyIncident, findExactEmailMatch, extractCourseCode, mapCaseRecord, type CaseListRecord } from "./case-helpers"

describe("classifyIncident", () => {
  it("prop: null always yields 'other'", () => {
    expect(classifyIncident(null)).toBe("other")
  })

  it("prop: any string containing 'plagiari' (case-insensitive) yields 'plagiarism'", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (prefix, suffix) => {
        expect(classifyIncident(`${prefix}plagiari${suffix}`)).toBe("plagiarism")
        expect(classifyIncident(`${prefix}PLAGIARI${suffix}`)).toBe("plagiarism")
        expect(classifyIncident(`${prefix}Plagiari${suffix}`)).toBe("plagiarism")
      }),
      { numRuns: 50 },
    )
  })

  it("prop: any string containing 'cheat' yields 'cheating'", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (prefix, suffix) => {
        // Skip if it also contains plagiari (which takes priority)
        const input = `${prefix}cheat${suffix}`
        if (input.toLowerCase().includes("plagiari")) return
        expect(classifyIncident(input)).toBe("cheating")
      }),
      { numRuns: 50 },
    )
  })

  it("prop: any string containing 'fabricat' yields 'fabrication'", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (prefix, suffix) => {
        const input = `${prefix}fabricat${suffix}`
        if (input.toLowerCase().includes("plagiari") || input.toLowerCase().includes("cheat")) return
        expect(classifyIncident(input)).toBe("fabrication")
      }),
      { numRuns: 50 },
    )
  })

  it("prop: strings without any keyword yield 'other'", () => {
    fc.assert(
      fc.property(
        fc.string().filter(s => {
          const l = s.toLowerCase()
          return !l.includes("plagiari") && !l.includes("cheat") && !l.includes("fabricat")
        }),
        (s) => {
          expect(classifyIncident(s)).toBe("other")
        },
      ),
      { numRuns: 100 },
    )
  })

  it("handles real SF incident type values", () => {
    expect(classifyIncident("Plagiarism")).toBe("plagiarism")
    expect(classifyIncident("Cheating on Exam")).toBe("cheating")
    expect(classifyIncident("Data Fabrication")).toBe("fabrication")
    expect(classifyIncident("Other Violation")).toBe("other")
  })
})

describe("findExactEmailMatch", () => {
  it("prop: returns null for empty user list", () => {
    fc.assert(
      fc.property(fc.emailAddress(), (email) => {
        expect(findExactEmailMatch([], email)).toBeNull()
      }),
      { numRuns: 20 },
    )
  })

  it("prop: exact email match always found", () => {
    fc.assert(
      fc.property(
        fc.emailAddress(),
        fc.nat({ max: 99999 }),
        fc.string({ minLength: 1 }),
        (email, id, name) => {
          const users = [{ id, name, email }]
          const result = findExactEmailMatch(users, email)
          expect(result).toMatchObject({ id, name })
        },
      ),
      { numRuns: 50 },
    )
  })

  it("prop: exact login_id match found", () => {
    fc.assert(
      fc.property(
        fc.emailAddress(),
        fc.nat({ max: 99999 }),
        fc.string({ minLength: 1 }),
        (email, id, name) => {
          const users = [{ id, name, login_id: email }]
          const result = findExactEmailMatch(users, email)
          expect(result).toMatchObject({ id, name })
        },
      ),
      { numRuns: 50 },
    )
  })

  it("prop: case-insensitive matching", () => {
    fc.assert(
      fc.property(
        fc.emailAddress(),
        fc.nat({ max: 99999 }),
        fc.string({ minLength: 1 }),
        (email, id, name) => {
          const users = [{ id, name, email: email.toUpperCase() }]
          const result = findExactEmailMatch(users, email.toLowerCase())
          expect(result).toMatchObject({ id, name })
        },
      ),
      { numRuns: 50 },
    )
  })

  it("prop: single non-matching user returns null (strict — no loose fallback)", () => {
    // Regression guard: the prior implementation returned users[0] when there was
    // exactly one result, even if its email/login_id did not match. That was the
    // silent "wrong student" bug: Canvas search_users matches name tokens, so a
    // lone hit with a different email was accepted as "close enough".
    fc.assert(
      fc.property(
        fc.emailAddress(),
        fc.emailAddress().filter(e => e.length > 5),
        fc.nat({ max: 99999 }),
        fc.string({ minLength: 1 }),
        (searchEmail, otherEmail, id, name) => {
          if (searchEmail.toLowerCase() === otherEmail.toLowerCase()) return
          const users = [{ id, name, email: otherEmail }]
          expect(findExactEmailMatch(users, searchEmail)).toBeNull()
        },
      ),
      { numRuns: 30 },
    )
  })

  it("prop: multiple non-matching users returns null", () => {
    fc.assert(
      fc.property(
        fc.emailAddress(),
        fc.array(
          fc.record({
            id: fc.nat({ max: 99999 }),
            name: fc.string({ minLength: 1 }),
            email: fc.emailAddress(),
          }),
          { minLength: 2, maxLength: 5 },
        ),
        (searchEmail, users) => {
          // Ensure no user matches
          const filtered = users.filter(u =>
            u.email.toLowerCase() !== searchEmail.toLowerCase()
          )
          if (filtered.length < 2) return
          expect(findExactEmailMatch(filtered, searchEmail)).toBeNull()
        },
      ),
      { numRuns: 30 },
    )
  })
})

describe("mapCaseRecord", () => {
  const base: CaseListRecord = {
    Id: "500abc",
    CaseNumber: "00123456",
    Subject: "Student missed exam",
    Type: "Academic Dishonesty",
    SubType__c: "Plagiarism",
    Status: "Escalated",
    CreatedDate: "2025-11-15T00:00:00.000Z",
    Course_Offering__c: "a0Babc",
    Course_Offering__r: { Name: "BIO101 Fall 2025 - 01", Academic_Term_Display_Name__c: "Fall 2025 - Distance Education" },
  }

  it("maps all fields from a full record", () => {
    const result = mapCaseRecord(base)
    expect(result.id).toBe("500abc")
    expect(result.caseNumber).toBe("00123456")
    expect(result.subject).toBe("Student missed exam")
    expect(result.type).toBe("Academic Dishonesty")
    expect(result.subType).toBe("Plagiarism")
    expect(result.status).toBe("Escalated")
    expect(result.courseCode).toBe("BIO101 - 01")
    expect(result.courseOfferingId).toBe("a0Babc")
    expect(result.termName).toBe("Fall 2025")
  })

  it("handles null subject, type, status gracefully", () => {
    const result = mapCaseRecord({ ...base, Subject: null, Type: null, Status: null })
    expect(result.subject).toBeNull()
    expect(result.type).toBe("Unknown")
    expect(result.status).toBe("Unknown")
  })

  it("handles missing Course_Offering__r", () => {
    const result = mapCaseRecord({ ...base, Course_Offering__c: null, Course_Offering__r: undefined })
    expect(result.courseName).toBeNull()
    expect(result.courseCode).toBeNull()
    expect(result.courseOfferingId).toBeNull()
    expect(result.termName).toBeNull()
  })

  it("prop: mapped caseNumber always matches input", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{5,8}$/), (num) => {
        const result = mapCaseRecord({ ...base, CaseNumber: num })
        expect(result.caseNumber).toBe(num)
      }),
      { numRuns: 30 },
    )
  })
})

describe("extractCourseCode", () => {
  it("prop: null always yields null", () => {
    expect(extractCourseCode(null)).toBeNull()
  })

  it("extracts standard course codes", () => {
    expect(extractCourseCode("BIO101 Fall 2024 - 01")).toBe("BIO101 - 01")
    expect(extractCourseCode("MATH2010 Spring 2025 - 02")).toBe("MATH2010 - 02")
    expect(extractCourseCode("ENG100 - 03")).toBe("ENG100 - 03")
  })

  it("prop: result always matches CODE - SECTION format when non-null", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z]{3,4}\d{3,4}/),
        fc.string({ minLength: 0, maxLength: 20 }),
        fc.stringMatching(/^\d{1,3}$/),
        (code, middle, section) => {
          const input = `${code}${middle} - ${section}`
          const result = extractCourseCode(input)
          if (result) {
            expect(result).toMatch(/^[A-Z]{3,4}\d{3,4} - \d+$/i)
          }
        },
      ),
      { numRuns: 50 },
    )
  })

  it("prop: strings without course code pattern yield null", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50 }).filter(s => !/[A-Z]{3,4}\d{3,4}.*\s-\s\d+/i.test(s)),
        (s) => {
          expect(extractCourseCode(s)).toBeNull()
        },
      ),
      { numRuns: 100 },
    )
  })
})
