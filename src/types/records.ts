/**
 * Domain types for Salesforce case records.
 *
 * Types marked @decohere are stubs — run `npm run decohere` to let
 * alkahest flesh them out from constraints. Review and commit the
 * generated output from src/generated/.
 */

/**
 * @decohere
 * A Salesforce case record. Base type for all case types at UEU.
 * Has a Salesforce record ID, student name, status (open / pending / resolved),
 * a createdAt date string, and an optional human-readable caseNumber.
 */
export type CaseRecord = unknown

/**
 * @decohere
 * Extends CaseRecord for academic dishonesty cases specifically.
 * Has a Canvas courseId linking to the relevant course, an incidentType
 * (e.g. plagiarism, cheating, fabrication), and a policyReference or
 * violation code. May have an assignmentName for the affected work.
 * Used by deans to track and resolve academic integrity cases.
 */
export type DishonestyCaseRecord = unknown

/**
 * @decohere
 * Parses raw DOM text from a Salesforce Lightning record page.
 * Returns a DishonestyCaseRecord if the page contains a dishonesty case,
 * null if it is a valid case but not a dishonesty case, or undefined if
 * the page cannot be parsed as a case record at all.
 * Should extract: courseId, incidentType, studentName, caseId, status.
 */
export type ParsePage = (pageData: string) => DishonestyCaseRecord | null | undefined
