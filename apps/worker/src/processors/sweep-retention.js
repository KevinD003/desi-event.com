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

import { parseJobPayload } from '../errors.js'
import { RETENTION_CLASSES, cutOffFor, rehearseClass } from '../retention/classes.js'

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
      throw new Error(`no retention class named ${only} is evaluated`)
    }

    const sweeps = []

    for (const definition of classes) {
      if (!activated) {
        // Recorded, not skipped silently. The cut-off it would have used is
        // written down so that the refusal can be reasoned about later.
        const row = {
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

        sweeps.push(await prisma.retentionSweep.create({ data: row }))
        continue
      }

      const row = await rehearseClass(prisma, definition, now)

      sweeps.push(await prisma.retentionSweep.create({ data: row }))

      logger?.info?.(
        {
          retentionClass: definition.retentionClass,
          examinedCount: row.examinedCount,
          heldCount: row.heldCount,
          // Stated on every line so a log reader never has to remember it.
          approval: definition.approval,
        },
        'retention rehearsal completed; nothing was changed',
      )
    }

    if (!activated) {
      logger?.warn?.(
        { classes: classes.length },
        'retention enforcement is not activated here; recorded SKIPPED_DISABLED and examined nothing',
      )
    }

    return {
      job: JOB_NAMES.SWEEP_RETENTION,
      activated,
      swept: sweeps.length,
      // Always zero. A rehearsal that changed something is a bug the database
      // itself refuses to record.
      affectedCount: 0,
    }
  }
}
