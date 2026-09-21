/**
 * The identity of one rehearsal row, derived rather than generated.
 *
 * ## The problem this solves, and the one it does not
 *
 * A queued job can arrive more than once. BullMQ retries a failure, redelivers
 * a job whose worker stalled, and will happily accept the same rehearsal
 * enqueued twice by two people who each thought the other had not. None of
 * those is exotic: the retention queue is declared with `attempts: 2` because
 * a repository invariant requires more than one attempt, so a *second delivery
 * is the normal case*, not the pathological one.
 *
 * Left alone, each delivery writes another set of `RetentionSweep` rows. The
 * table would then say four classes were rehearsed eight times, and an operator
 * counting rows would be counting deliveries.
 *
 * What it does not solve is two workers racing. It is not a lock. If two
 * processes genuinely run the same rehearsal at the same instant, one of the
 * `create` calls loses on the primary key and the loser reads the winner's row.
 * That is the intended outcome, and it is enforced by PostgreSQL rather than by
 * this module being careful.
 *
 * ## Why the primary key, and why no migration
 *
 * `RetentionSweep.id` is `String @id @default(cuid())`. A Prisma default
 * applies only when the writer omits the value, so supplying one turns the
 * primary key into the unique constraint this needs — and it already exists.
 * The alternative, a new unique index over (instant, class, kind), is a
 * migration to add a constraint the table already has under another name.
 *
 * The id has to satisfy `cuidSchema`, `^[a-z][a-z0-9]{7,31}$`, because the API
 * validates what it serves. `'r'` plus thirty-one lower-case hex characters
 * does, and the `r` is not decoration: it guarantees the leading character is a
 * letter for every possible digest.
 *
 * ## What the id namespaces: the kind of evidence, not the attempt
 *
 * This is the part worth reading twice, because the obvious design is wrong.
 *
 * The obvious design gives every row for one (instant, class) the same id, so
 * that a retry cannot duplicate it. That collapses **a run that declined** and
 * **a run that counted** into one row, and the first one to be written wins.
 * The concrete failure: an operator rehearses against an environment where
 * `RETENTION_ENFORCEMENT_ACTIVATED` is false and gets four `SKIPPED_DISABLED`
 * rows; the environment is then activated and the same rehearsal re-enqueued
 * with the same `now`, precisely so the two can be compared at one cut-off. The
 * ids match, every insert conflicts, and the run that actually examined rows
 * records nothing. The table now reports "we were told not to" about a run that
 * counted — and `/retention` reads that as `ALL_DECLINED`, which is one of the
 * three answers this surface exists to keep apart.
 *
 * So the namespace is the *kind of evidence the row is*: a count, a refusal, or
 * a failure. Two of those at the same instant are two different facts and get
 * two different rows. Two deliveries of the same fact are one row.
 *
 * @module worker/retention/run-key
 */

import { createHash } from 'node:crypto'

/**
 * What a sweep row is evidence of.
 *
 * Not the same axis as `RetentionSweepState`, and deliberately so. The state is
 * what the database records about the row; this is what the row is *for*, and
 * it is what must not collide.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SWEEP_ROW_KINDS = Object.freeze({
  /** It counted. */
  RESULT: 'RESULT',
  /** It declined, because enforcement is not activated here. */
  DECLINED: 'DECLINED',
  /** It tried and gave way. */
  FAILURE: 'FAILURE',
})

/**
 * The id one rehearsal row will have, every time it is written.
 *
 * Deterministic in its three inputs and nothing else. In particular it does not
 * include the attempt number, the worker name or the wall clock — any of those
 * would make a retry mint a fresh id, which is the behaviour this exists to
 * prevent.
 *
 * @param {object} params Parameters.
 * @param {Date} params.runInstant The instant the rehearsal counts back from.
 * @param {string} params.retentionClass Which class.
 * @param {string} params.kind One of {@link SWEEP_ROW_KINDS}.
 * @returns {string} A cuid-shaped id.
 */
export function sweepRowId({ runInstant, retentionClass, kind }) {
  if (!SWEEP_ROW_KINDS[kind]) {
    // Loud rather than lenient. An unknown kind would silently share a
    // namespace with whatever hashed to the same thing, which is the failure
    // this module is built to avoid.
    throw new Error(`unknown sweep row kind "${kind}"`)
  }

  const digest = createHash('sha256')
    // Separated by a character that cannot appear in an ISO instant, a class
    // name or a kind, so that no two different triples can produce one string.
    .update(`${runInstant.toISOString()}\u0000${retentionClass}\u0000${kind}`)
    .digest('hex')

  return `r${digest.slice(0, 31)}`
}
