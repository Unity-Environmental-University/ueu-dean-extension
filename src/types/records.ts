/**
 * Domain types for Salesforce case records.
 *
 * Types marked @decohere are stubs — run `npm run decohere` to let
 * alkahest flesh them out from constraints. Review and commit the
 * generated output from src/generated/.
 */

/**
 * @decohere
 * @context A Salesforce case record. Base type for all case types at UEU.
 * @context Has a Salesforce record ID (string).
 * @context Has a student name (string).
 * @context Has a status: one of "open", "pending", or "resolved".
 * @context Has a createdAt date string.
 * @context May have a caseNumber string for human reference.
 */
export type CaseRecord = unknown

/**
 * @decohere
 * @context Extends CaseRecord for academic dishonesty cases specifically.
 * @context Has a Canvas course ID (string) linking to the relevant course.
 * @context Has an incident type (e.g. plagiarism, cheating, fabrication).
 * @context Has a policy reference or violation code.
 * @context May have an associated assignment or assessment name.
 * @context Used by deans to track and resolve academic integrity cases.
 */
export type DishonestyCaseRecord = unknown

/**
 * @decohere
 * @context Parses raw DOM text from a Salesforce Lightning record page.
 * @context Returns a DishonestyCaseRecord if the page contains a dishonesty case.
 * @context Returns null if the page is a valid case but not a dishonesty case.
 * @context Returns undefined if the page cannot be parsed as a case record at all.
 * @context The input is the full text content of the Lightning record page.
 * @context Should extract: courseId, incidentType, studentName, caseId, status.
 */
export type ParsePage = (pageData: string) => DishonestyCaseRecord | null | undefined
