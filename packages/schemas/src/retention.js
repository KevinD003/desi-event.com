/**
 * The retention proposal: what each class is, how long it is proposed to live,
 * and what has not been decided.
 *
 * Shared rather than worker-local because two processes need the same answer to
 * the same question. The worker rehearses against these durations; the API
 * describes them to whoever reads the result. A copy in each would be two
 * copies that drift, and the first symptom of the drift would be an operator
 * shown a number under the wrong label.
 *
 * **Every duration here is a proposal, not a policy.** Nobody has approved any
 * of them. No jurisdiction has been supplied, no statutory minimum for
 * financial records, no maximum for non-evidential personal data. Until
 * somebody with the authority to decide does, these numbers exist so that a
 * *rehearsal* can be described — "if the proposal were adopted, this many rows
 * would be in scope" — and for nothing else.
 *
 * What is deliberately absent from this module is a query. There is no `where`
 * clause here, no model name, and no Prisma anything: this is the vocabulary,
 * and the thing that knows how to count lives in the worker. A module that held
 * both would be a module one bad edit away from being able to delete.
 *
 * @module @desi-event/schemas/retention
 */

/**
 * The status every duration in this module carries.
 *
 * Attached to each class rather than stated once at the top, so that the label
 * travels with the number. A duration that arrives at an operator's screen
 * without its status beside it is a duration somebody will eventually mistake
 * for policy.
 */
export const RETENTION_APPROVAL = 'PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW'

/**
 * The classes a rehearsal evaluates, as proposals.
 *
 * `retentionClass` matches the closed vocabulary named in `RetentionSweep`'s
 * own doc-comment, extended with `session_metadata`: the schema names three
 * classes while the retention table proposes distinct durations for the session
 * row and the security metadata on it, and the two expire on different clocks.
 * Folding them into one class would sweep one of them on the wrong proposal.
 *
 * @type {ReadonlyArray<object>}
 */
export const RETENTION_CLASS_PROPOSALS = Object.freeze([
  Object.freeze({
    retentionClass: 'login_attempt',
    proposedDays: 30,
    approval: RETENTION_APPROVAL,
    basis: 'It exists for rate limiting, not history',
  }),
  Object.freeze({
    retentionClass: 'session',
    proposedDays: 30,
    approval: RETENTION_APPROVAL,
    basis: 'Nothing needs a spent token',
  }),
  Object.freeze({
    retentionClass: 'session_metadata',
    proposedDays: 90,
    approval: RETENTION_APPROVAL,
    basis: 'Security metadata, already hashed',
  }),
  Object.freeze({
    retentionClass: 'notification_recipient',
    proposedDays: 30,
    approval: RETENTION_APPROVAL,
    basis: 'The evidence is that it went, not where',
  }),
])

/**
 * Classes the policy names that no rehearsal evaluates, and why.
 *
 * Reported rather than omitted. A class that silently disappeared from the list
 * would read as a class that was swept and found empty, which is a different
 * claim entirely — and the wrong one.
 *
 * @type {ReadonlyArray<object>}
 */
export const RETENTION_NOT_EVALUATED = Object.freeze([
  Object.freeze({
    retentionClass: 'export_artifact',
    proposedDays: 7,
    approval: RETENTION_APPROVAL,
    reason:
      'The proposed seven days is a duration for export BYTES, and no bytes are kept: both CSV routes stream to the caller and record the artefact with ephemeral true and no storage key. What the table holds is the record that an export happened, which is evidence the privacy surface exists to keep — sweeping it would delete the answer to "was an export taken", not a working copy anybody could regenerate.',
  }),
])

/**
 * The approval status for a class name, whether or not it is evaluated.
 *
 * Falls back to {@link RETENTION_APPROVAL} for a class this module does not
 * know, which is the safe direction: an unrecognised class name is still an
 * unapproved duration, and answering "no status" for one would be the single
 * way a number could reach a reader unlabelled.
 *
 * @param {string} retentionClass The class name.
 * @returns {string} The approval status.
 */
export function retentionApprovalFor(retentionClass) {
  const known =
    RETENTION_CLASS_PROPOSALS.find((entry) => entry.retentionClass === retentionClass) ??
    RETENTION_NOT_EVALUATED.find((entry) => entry.retentionClass === retentionClass)

  return known?.approval ?? RETENTION_APPROVAL
}

/**
 * Why a rehearsal failed, from a closed vocabulary.
 *
 * `RetentionSweep.failureCode` is a nullable string in the database, which
 * means the column will hold whatever is put in it — and the obvious thing to
 * put in it is the driver's message. That would be wrong twice over. A driver
 * message is not a vocabulary an operator can filter, group or write a runbook
 * entry against; and a message from a failed query against a table of personal
 * data is exactly the kind of string that arrives carrying a fragment of a row.
 *
 * So the codes say **which step of the rehearsal gave way**, and nothing about
 * what the database said while giving way. The underlying error is logged by
 * the worker, where an operator with access to the logs can read it, and is not
 * written to a row that a screen renders.
 *
 * `UNEXPECTED` is deliberately part of the vocabulary rather than a gap in it.
 * A failure nobody anticipated still has to produce a row, because the
 * alternative is the failure producing nothing — and an empty table is the one
 * answer this whole surface exists to stop being ambiguous.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RETENTION_FAILURE_CODES = Object.freeze({
  /** Counting the candidates for a class did not complete. */
  CANDIDATE_COUNT_FAILED: 'CANDIDATE_COUNT_FAILED',
  /** Counting the holds that bear on a class did not complete. */
  HOLD_COUNT_FAILED: 'HOLD_COUNT_FAILED',
  /** The counting worked and writing the evidence row did not. */
  EVIDENCE_WRITE_FAILED: 'EVIDENCE_WRITE_FAILED',
  /** Something else. Recorded rather than swallowed. */
  UNEXPECTED: 'UNEXPECTED',
})

/**
 * Every failure code, as a list.
 *
 * @type {ReadonlyArray<string>}
 */
export const RETENTION_FAILURE_CODE_VALUES = Object.freeze(Object.values(RETENTION_FAILURE_CODES))

/**
 * What a failure code means to somebody reading the sweep table.
 *
 * Held beside the codes rather than in the web package, because the worker
 * writes them, the API serves them and the browser renders them, and a wording
 * that lived in only one of those three would be a wording the other two had to
 * guess at.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RETENTION_FAILURE_DESCRIPTIONS = Object.freeze({
  CANDIDATE_COUNT_FAILED:
    'The count of rows this class would reach did not complete. Nothing was examined and nothing was changed.',
  HOLD_COUNT_FAILED:
    'The candidates were counted, but the count of holds protecting them did not complete. The run stopped rather than record a figure it could not qualify.',
  EVIDENCE_WRITE_FAILED:
    'The counting completed and writing it down did not. Whatever this class would have reported is lost; the counting itself changed nothing.',
  UNEXPECTED:
    'The rehearsal failed for a reason the worker does not have a code for. See the worker logs.',
})

/**
 * The wording for a failure code, falling back to the code itself.
 *
 * Never invents a reassuring sentence for a code it does not know: an
 * unrecognised code is shown as it was stored, so an operator can quote it.
 *
 * @param {string|null} failureCode The code on the row.
 * @returns {string|null} Its wording, or null when the row did not fail.
 */
export function retentionFailureDescription(failureCode) {
  if (typeof failureCode !== 'string' || failureCode === '') return null

  return RETENTION_FAILURE_DESCRIPTIONS[failureCode] ?? failureCode
}
