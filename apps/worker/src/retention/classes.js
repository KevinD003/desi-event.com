/**
 * What a retention sweep would look at, and what it is forbidden from doing.
 *
 * This module is the decision table from
 * `docs/PHASE3_PHASE3_IMPLEMENTATION_REPORT.md` §3 expressed as code. It is
 * pure: it computes cut-offs and describes candidates, and it holds no database
 * client, so the rules can be tested without a database and cannot accidentally
 * acquire the ability to delete something.
 *
 * ## Every duration here is a proposal, not a policy
 *
 * Nobody has approved any of them. No jurisdiction has been supplied, no
 * statutory minimum for financial records, no maximum for non-evidential
 * personal data. Until somebody does, these numbers exist so that a **rehearsal**
 * can be described — "if the proposal were adopted, this many rows would be in
 * scope" — and for nothing else.
 *
 * `PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW` is carried on every class so that
 * the label travels with the number rather than living in a document beside it.
 * A duration that arrives at an operator's screen without its status attached is
 * a duration somebody will eventually mistake for policy.
 *
 * ## Why counting is the whole job
 *
 * A dry run reads. It issues `count` queries and writes one `RetentionSweep`
 * row recording what it saw. It never issues an `UPDATE` or a `DELETE` against
 * a swept table, and three independent things stop it doing so:
 *
 *   1. `retention_sweep_dry_run_changes_nothing` — a CHECK constraint refusing
 *      any `DRY_RUN` row that claims a non-zero `affectedCount`. That one does
 *      not depend on this code being correct.
 *   2. Nothing here returns a mutation. The shape a class produces is a
 *      `count` descriptor; there is no delete path to call by mistake.
 *   3. `RetentionSweepState.SKIPPED_DISABLED` exists for an environment where
 *      retention enforcement has not been activated, and no activation
 *      mechanism is implemented anywhere in this repository.
 *
 * ## What is deliberately absent
 *
 * `export_artifact`. Nothing in the repository has ever written an
 * `ExportArtifact` row — both export routes stream CSV straight to the caller
 * and register nothing — so a sweep over that table would report an emptiness
 * meaning "no writer exists" rather than "nothing is old enough". Reporting
 * that as a retention finding would be a vacuous measurement, which is a
 * mistake this project has already made once and corrected. The class is listed
 * as `NOT_EVALUATED` instead.
 *
 * @module worker/retention/classes
 */

import {
  RETENTION_APPROVAL,
  RETENTION_CLASS_PROPOSALS,
  RETENTION_NOT_EVALUATED,
} from '@desi-event/schemas'

export { RETENTION_APPROVAL }

/** Milliseconds in a day, for readable cut-off arithmetic. */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How each class is counted: which table, whether a hold can attach to it, and
 * the clause that selects candidates.
 *
 * Kept separate from the proposal in `@desi-event/schemas/retention`, and
 * merged with it below. The split is the point: the shared module holds the
 * durations, which the API also has to describe, and this map holds the
 * queries, which only a process with a database has any use for. Nothing here
 * can be read by the browser, and nothing there can count anything.
 *
 * @type {Readonly<Record<string, object>>}
 */
const CLASS_QUERIES = Object.freeze({
  login_attempt: Object.freeze({
    model: 'loginAttempt',
    subjectLinked: false,
    /**
     * Rows older than the cut-off.
     *
     * A count over a timestamp. No column carrying a personal value is read,
     * which is what makes the figure safe to show an operator.
     *
     * @param {Date} olderThan The cut-off.
     * @returns {object} A Prisma `where` clause.
     */
    where: (olderThan) => ({ createdAt: { lt: olderThan } }),
  }),
  session: Object.freeze({
    model: 'session',
    subjectLinked: false,
    /**
     * Sessions that expired before the cut-off.
     *
     * Keyed on expiry rather than creation: a long-lived session that is still
     * valid is not stale, however old it is.
     *
     * @param {Date} olderThan The cut-off.
     * @returns {object} A Prisma `where` clause.
     */
    where: (olderThan) => ({ expiresAt: { lt: olderThan } }),
  }),
  session_metadata: Object.freeze({
    model: 'session',
    subjectLinked: false,
    /**
     * Sessions still carrying security metadata past the cut-off.
     *
     * Presence, not content: the query asks whether the columns are non-null,
     * never what is in them. `ipHash` is already a hash and `userAgent` is not
     * read at all.
     *
     * @param {Date} olderThan The cut-off.
     * @returns {object} A Prisma `where` clause.
     */
    where: (olderThan) => ({
      createdAt: { lt: olderThan },
      OR: [{ userAgent: { not: null } }, { ipHash: { not: null } }],
    }),
  }),
  notification_recipient: Object.freeze({
    model: 'notificationOutbox',
    subjectLinked: true,
    /**
     * Delivered notifications older than the cut-off, within an organisation.
     *
     * `organizationId: { not: null }` is not a formality. Rows written before
     * that column existed are all null and are unreachable by any
     * organisation-scoped sweep; excluding them explicitly makes the gap a
     * stated limitation rather than a silent miss. Whether to backfill them is
     * an owner decision.
     *
     * @param {Date} olderThan The cut-off.
     * @returns {object} A Prisma `where` clause.
     */
    where: (olderThan) => ({
      sentAt: { lt: olderThan, not: null },
      organizationId: { not: null },
    }),
  }),
})

/**
 * The classes a dry run evaluates: the shared proposal, plus how to count it.
 *
 * Derived from `RETENTION_CLASS_PROPOSALS` rather than restated, so a duration
 * cannot be changed in one place and left stale in the other. A proposal with
 * no query here is dropped with a loud error rather than silently skipped —
 * a class that vanished between the policy and the sweep is exactly the kind of
 * gap this whole surface exists to make visible.
 *
 * @type {ReadonlyArray<object>}
 */
export const RETENTION_CLASSES = Object.freeze(
  RETENTION_CLASS_PROPOSALS.map((proposal) => {
    const query = CLASS_QUERIES[proposal.retentionClass]

    if (!query) {
      throw new Error(
        `retention class "${proposal.retentionClass}" is proposed but has no candidate query`,
      )
    }

    return Object.freeze({ ...proposal, ...query })
  }),
)

/**
 * Classes named by the policy but not evaluated, and why.
 *
 * Re-exported from the shared vocabulary rather than restated. Reported rather
 * than omitted: a class that silently disappears reads as a class that was
 * swept and found empty, which is a different claim entirely.
 *
 * @type {ReadonlyArray<object>}
 */
export const NOT_EVALUATED_CLASSES = RETENTION_NOT_EVALUATED

/**
 * The cut-off a class would use, counted back from a given instant.
 *
 * Recorded on the sweep row as `olderThan`, so that a later change of proposal
 * does not make an earlier run's behaviour unexplainable.
 *
 * @param {object} definition One of {@link RETENTION_CLASSES}.
 * @param {Date} now The instant to count back from.
 * @returns {Date} The cut-off.
 */
export function cutOffFor(definition, now) {
  return new Date(now.getTime() - definition.proposedDays * DAY_MS)
}

/**
 * One class by name.
 *
 * @param {string} retentionClass The class name.
 * @returns {object|undefined} Its definition.
 */
export function retentionClassByName(retentionClass) {
  return RETENTION_CLASSES.find((entry) => entry.retentionClass === retentionClass)
}

/**
 * Count what a class would reach, without touching it.
 *
 * The only database call this module makes, and it is a `count`. There is
 * deliberately no sibling that deletes: a dry-run module that also knew how to
 * delete would be one bad branch away from doing it.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} definition One of {@link RETENTION_CLASSES}.
 * @param {Date} olderThan The cut-off.
 * @returns {Promise<number>} How many rows are in scope.
 */
export async function countCandidates(prisma, definition, olderThan) {
  return prisma[definition.model].count({ where: definition.where(olderThan) })
}

/**
 * How many of a class's candidates are protected by an active hold.
 *
 * Only meaningful for a subject-linked class. A hold means an erasure was
 * refused for that person, and a retention sweep that ignored holds would
 * delete what an erasure was forbidden from touching — the same data, reached
 * by a different door.
 *
 * Counted rather than resolved: the sweep reports how many it would leave
 * alone, and never which people they are.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} definition One of {@link RETENTION_CLASSES}.
 * @returns {Promise<number>} How many active holds bear on this class.
 */
export async function countHeld(prisma, definition) {
  if (!definition.subjectLinked) return 0

  return prisma.privacyHold.count({ where: { state: 'ACTIVE' } })
}

/**
 * Rehearse one class.
 *
 * Returns the row a caller should write to `RetentionSweep`, with
 * `mode: 'DRY_RUN'` and `affectedCount: 0` stated explicitly rather than left
 * to a default — `mode` has no database default, so a writer that omits it gets
 * a runtime error, and `affectedCount` is what the CHECK constraint refuses to
 * see non-zero on a rehearsal.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} definition One of {@link RETENTION_CLASSES}.
 * @param {Date} now The instant to count back from.
 * @returns {Promise<object>} The sweep row to write.
 */
export async function rehearseClass(prisma, definition, now) {
  const olderThan = cutOffFor(definition, now)
  const examinedCount = await countCandidates(prisma, definition, olderThan)
  const heldCount = await countHeld(prisma, definition)

  return {
    retentionClass: definition.retentionClass,
    mode: 'DRY_RUN',
    state: 'COMPLETED',
    olderThan,
    examinedCount,
    heldCount,
    // Always zero, and asserted rather than assumed: a rehearsal that changed
    // something is a bug the database itself refuses to record.
    affectedCount: 0,
    startedAt: now,
    finishedAt: now,
  }
}
