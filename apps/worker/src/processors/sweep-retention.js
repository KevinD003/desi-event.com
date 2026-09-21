/**
 * The retention rehearsal: counting what a proposal *would* reach, and deleting
 * nothing.
 *
 * ## This job cannot delete, and that is structural rather than careful
 *
 * There is no deletion path in this file, in `../retention/classes.js`, or
 * anywhere else in the repository. The processor issues `count` queries and
 * writes one `RetentionSweep` row per class. Three separate things would each
 * have to fail before a row could be removed, and only the first is independent
 * of this code being right:
 *
 *   1. `retention_sweep_dry_run_changes_nothing` — a CHECK constraint that
 *      refuses any `DRY_RUN` row claiming a non-zero `affectedCount`.
 *   2. Nothing here calls a mutating Prisma method on a swept table.
 *   3. The activation gate below.
 *
 * ## Why an unactivated environment records a row rather than doing nothing
 *
 * "Nothing happened" and "we were told not to" are different answers, and an
 * operator who cannot tell them apart will go looking for a broken worker. So a
 * refusal is recorded as `SKIPPED_DISABLED` — the state the schema anticipated
 * and nothing previously wrote — with the cut-off it *would* have used. The
 * evidence that the system declined is itself evidence.
 *
 * ## Why the sweep row is the only evidence
 *
 * `recordAudit` and `recordPrivacyAudit` live in `apps/api/src/lib`, and this
 * package cannot depend on `apps/api`. `PrivacyAuditEvent` could not carry a
 * platform-wide sweep in any case: `organizationId`, `targetId`, `targetType`,
 * `reasonCode`, `holdDecision`, `result` and `correlationId` are all NOT NULL,
 * and a sweep has no organisation. So the `RetentionSweep` row *is* the record,
 * and `AUDIT_ACTIONS.PRIVACY_RETENTION_SWEEP_RAN` deliberately keeps no writer
 * rather than acquiring a dishonest one.
 *
 * ## Why a failure writes a row and still fails the job
 *
 * A rehearsal that cannot reach the database used to throw and leave nothing
 * behind. That produced the same empty table as "no rehearsal has ever run
 * here" and as "it ran and declined" — the exact three-way confusion the
 * `/retention` screen exists to resolve. A failure now records a `FAILED` row
 * per class, carrying a code from a closed vocabulary and never the driver's
 * message.
 *
 * And it does **not** stop at the first failing class. Aborting would leave the
 * remaining classes with no row at all, which the screen renders with the same
 * words it uses for a class no sweep has ever covered — so abandoning the run
 * quietly adds a fourth ambiguity to a surface built to remove three. Each
 * count is an independent query; the loop runs to the end, records what each
 * class did, and then rethrows so BullMQ still sees a failed job.
 *
 * ## Why a second delivery writes nothing new
 *
 * The queue is declared with `attempts: 2`, so a redelivery is the normal case.
 * Each row's id is derived from the instant, the class and the *kind of
 * evidence* — see `../retention/run-key.js`, which explains at length why the
 * kind has to be in there and what breaks when it is not. A retry loses on the
 * primary key and reads the winner's row; two genuinely different facts at one
 * instant stay two rows.
 *
 * ## No lease, and the columns are not an oversight
 *
 * `RetentionSweep.leaseOwner` and `leaseExpiresAt`, and the `SCHEDULED` and
 * `CLAIMED` states, are modelled on `PrivacyRequest`, where a lease protects a
 * mutating, resumable, multi-step operation on a row that already exists. This
 * job has none of those properties: it counts, then inserts a row that is
 * already finished. There is no window in which a row exists for a second
 * worker to steal, so there is nothing for a lease to protect.
 *
 * Building one would mean inventing a create-then-update lifecycle purely to
 * have somewhere to put it — adding the first `UPDATE` path on `RetentionSweep`
 * to a job whose entire claim is that it counts and inserts. It would not even
 * solve the problem it resembles: duplicate rows survive a lost lock, a restart
 * and a stalled-job redelivery, none of which a lease covers and all of which
 * the deterministic id does. The columns stay unwritten, and
 * `concurrencyFor` in `../workers.js` pins this queue to one worker.
 *
 * ## No schedule
 *
 * This processor is registered so that a rehearsal can be enqueued
 * deliberately. It is **not** given a repeatable job, because a retention sweep
 * that runs on a timer in production is the first step towards a retention
 * sweep that deletes on a timer in production, and the durations are proposals
 * nobody has approved.
 *
 * @module worker/processors/sweep-retention
 */

import { JOB_NAMES, sweepRetentionJobSchema } from '@desi-event/schemas/jobs'

import { PermanentJobError, WORKER_ERROR_CODES, parseJobPayload } from '../errors.js'
import { failureCodeFor } from '../retention/failures.js'
import { RETENTION_CLASSES, cutOffFor, rehearseClass } from '../retention/classes.js'
import { SWEEP_ROW_KINDS, sweepRowId } from '../retention/run-key.js'

/**
 * Prisma's unique-constraint violation.
 *
 * @type {string}
 */
const UNIQUE_VIOLATION = 'P2002'

/**
 * Write a sweep row, or read back the one a previous delivery already wrote.
 *
 * The idempotency is the database's, not this function's. There is no
 * read-then-write here on purpose: a `findUnique` followed by a conditional
 * `create` is a race two replicas can both lose, and the primary key already
 * answers the question atomically.
 *
 * A conflict that is *not* this row's id would be a bug, not a duplicate — so
 * if the read that follows a `P2002` comes back empty, the original error is
 * rethrown rather than a `null` being pushed into the list of rows the summary
 * counts.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} row The row to write, with its deterministic `id`.
 * @returns {Promise<{row: object, deduplicated: boolean}>} The stored row.
 */
async function recordOnce(prisma, row) {
  try {
    return { row: await prisma.retentionSweep.create({ data: row }), deduplicated: false }
  } catch (error) {
    if (error?.code !== UNIQUE_VIOLATION) throw error

    const existing = await prisma.retentionSweep.findUnique({ where: { id: row.id } })

    if (!existing) throw error

    return { row: existing, deduplicated: true }
  }
}

/**
 * @typedef {object} RetentionSweepDependencies
 * @property {object} prisma A Prisma client.
 * @property {object} logger A pino-style logger.
 * @property {boolean} activated Whether retention enforcement is activated here.
 * @property {function(): Date} [clock] The clock, injectable for tests.
 */

/**
 * Build the retention rehearsal processor.
 *
 * @param {RetentionSweepDependencies} dependencies What it needs.
 * @returns {function(object): Promise<object>} The processor.
 */
export function createRetentionSweepProcessor({
  prisma,
  logger,
  activated,
  clock = () => new Date(),
}) {
  /**
   * Rehearse retention.
   *
   * @param {object} job The BullMQ job.
   * @returns {Promise<object>} A summary of what was examined.
   * @throws {PermanentJobError} When the payload does not satisfy `sweepRetentionJobSchema`.
   */
  return async function sweepRetention(job) {
    // Validated rather than trusted: a queued job outlives the process that
    // enqueued it, and this one decides how far back to count.
    const payload = parseJobPayload(
      sweepRetentionJobSchema,
      job?.data ?? {},
      JOB_NAMES.SWEEP_RETENTION,
    )
    const now = payload.now ? new Date(payload.now) : clock()
    const only = payload.retentionClass ?? null
    const classes = only
      ? RETENTION_CLASSES.filter((definition) => definition.retentionClass === only)
      : RETENTION_CLASSES

    if (only && classes.length === 0) {
      // A class the caller named but this worker does not evaluate. Refusing
      // loudly beats rehearsing everything and reporting it as though the
      // narrowing had been honoured.
      //
      // Permanent, not retryable, and that distinction cost a thirty-second
      // test timeout to notice. This is a statement about the payload: the
      // named class will not be evaluated on the second attempt either, so a
      // plain `Error` here burns a retry and a whole fixed backoff on a job
      // that can never succeed — and leaves the job sitting in `waiting` for
      // half a minute while an operator wonders whether it was picked up.
      throw new PermanentJobError(`no retention class named ${only} is evaluated`, {
        code: WORKER_ERROR_CODES.INVALID_JOB_PAYLOAD,
        jobName: JOB_NAMES.SWEEP_RETENTION,
        details: {
          retentionClass: only,
          evaluated: RETENTION_CLASSES.map((entry) => entry.retentionClass),
        },
      })
    }

    const sweeps = []
    const failures = []
    let deduplicated = 0

    for (const definition of classes) {
      if (!activated) {
        // Recorded, not skipped silently. The cut-off it would have used is
        // written down so that the refusal can be reasoned about later.
        //
        // Its own id namespace: a refusal and a count at the same instant are
        // two different facts, and sharing an id would let whichever was
        // written first speak for both.
        const row = {
          id: sweepRowId({
            runInstant: now,
            retentionClass: definition.retentionClass,
            kind: SWEEP_ROW_KINDS.DECLINED,
          }),
          retentionClass: definition.retentionClass,
          mode: 'DRY_RUN',
          state: 'SKIPPED_DISABLED',
          olderThan: cutOffFor(definition, now),
          examinedCount: 0,
          heldCount: 0,
          affectedCount: 0,
          startedAt: now,
          finishedAt: now,
        }

        const declined = await recordOnce(prisma, row)

        if (declined.deduplicated) deduplicated += 1
        sweeps.push(declined.row)
        continue
      }

      try {
        const counted = await rehearseClass(prisma, definition, now)
        const stored = await recordOnce(prisma, {
          ...counted,
          id: sweepRowId({
            runInstant: now,
            retentionClass: definition.retentionClass,
            kind: SWEEP_ROW_KINDS.RESULT,
          }),
        })

        if (stored.deduplicated) deduplicated += 1
        sweeps.push(stored.row)

        logger?.info?.(
          {
            retentionClass: definition.retentionClass,
            examinedCount: counted.examinedCount,
            heldCount: counted.heldCount,
            deduplicated: stored.deduplicated,
            // Stated on every line so a log reader never has to remember it.
            approval: definition.approval,
          },
          'retention rehearsal completed; nothing was changed',
        )
      } catch (error) {
        // Evidence first, then carry on. The remaining classes are independent
        // counts, and leaving them unrecorded would render on the screen as
        // "never rehearsed", which is a different and much calmer claim than
        // "the run failed before reaching this".
        const failureCode = failureCodeFor(error)

        failures.push({ retentionClass: definition.retentionClass, failureCode, error })

        // The driver's message goes to the log and never to the row.
        logger?.error?.(
          { retentionClass: definition.retentionClass, failureCode, err: error },
          'retention rehearsal failed for this class; recording it and continuing',
        )

        try {
          const failed = await recordOnce(prisma, {
            id: sweepRowId({
              runInstant: now,
              retentionClass: definition.retentionClass,
              kind: SWEEP_ROW_KINDS.FAILURE,
            }),
            retentionClass: definition.retentionClass,
            mode: 'DRY_RUN',
            state: 'FAILED',
            olderThan: cutOffFor(definition, now),
            // Nothing is claimed about what was reached. A failed count has no
            // figure, and zero here means "no figure", which the state says.
            examinedCount: 0,
            heldCount: 0,
            affectedCount: 0,
            startedAt: now,
            finishedAt: now,
            failureCode,
          })

          if (failed.deduplicated) deduplicated += 1
        } catch (writeError) {
          // The evidence write failed too. There is nowhere left to record
          // this, so it is logged and the class is still counted as failed —
          // the job will fail below either way.
          logger?.error?.(
            { retentionClass: definition.retentionClass, err: writeError },
            'could not record the retention failure row',
          )
        }
      }
    }

    if (!activated) {
      logger?.warn?.(
        { classes: classes.length },
        'retention enforcement is not activated here; recorded SKIPPED_DISABLED and examined nothing',
      )
    }

    if (failures.length > 0) {
      // Every class has had its turn and its row. Now the job fails, because a
      // rehearsal that could not count is not a rehearsal that found nothing.
      const [first] = failures

      throw new Error(
        `retention rehearsal failed for ${failures.length} of ${classes.length} classes: ${failures
          .map((failure) => `${failure.retentionClass} (${failure.failureCode})`)
          .join(', ')}`,
        { cause: first.error },
      )
    }

    return {
      job: JOB_NAMES.SWEEP_RETENTION,
      activated,
      swept: sweeps.length,
      // How many rows a previous delivery had already written. Reported rather
      // than hidden: an operator comparing "swept" against what they expected
      // deserves to know the difference was a redelivery and not a miscount.
      deduplicated,
      // Always zero. A rehearsal that changed something is a bug the database
      // itself refuses to record.
      affectedCount: 0,
    }
  }
}
