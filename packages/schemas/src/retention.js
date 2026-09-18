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
      'Nothing in this repository has ever written an ExportArtifact row, so the table is empty by construction. A count over it would report "no writer exists" while looking like "nothing is old enough".',
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
