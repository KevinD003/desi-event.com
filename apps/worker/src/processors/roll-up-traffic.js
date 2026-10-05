/**
 * Add visits up into daily totals: the `roll-up-traffic` job.
 *
 * The work is `runTrafficRollup` in `@desi-event/db/traffic-rollup`, so this
 * worker, the browser suites and the database verifiers run one
 * implementation. This processor only validates the payload, names itself as
 * the lease owner and logs counts.
 *
 * ## It deletes, and the retention rehearsal still cannot
 *
 * The roll-up deletes raw visit rows once they are added up and two days old.
 * Those rows hold an event, a kind, a place, a category, a UTC day and a keyed
 * digest whose key is itself deleted when the day ends — no address, browser
 * string, URL or account — and the daily totals are the record. That is data
 * minimisation, and it is the one deletion on a timer in this repository. The
 * retention rehearsal (`sweep-retention.js`) is a different thing with
 * unapproved durations, and it still has no deletion path.
 *
 * `now` in a payload is the business instant (which day is today and which
 * days may be purged); the lease is always judged on the wall clock, so a job
 * replayed with an old `now` can neither steal a live lease nor keep a dead one.
 *
 * @module @desi-event/worker/processors/roll-up-traffic
 */

import { runTrafficRollup } from '@desi-event/db/traffic-rollup'
import { JOB_NAMES, rollUpTrafficJobSchema } from '@desi-event/schemas/jobs'

import { parseJobPayload } from '../errors.js'

/**
 * Build the roll-up processor.
 *
 * @param {object} deps Dependencies.
 * @param {object} deps.prisma A Prisma client.
 * @param {string} deps.workerId Who this process is: the name on the lease.
 * @param {object} [deps.logger] Logger; given counts only.
 * @param {Function} [deps.rollUp] The roll-up itself; tests pass a fake.
 * @returns {function(object): Promise<object>} The processor.
 * @throws {TypeError} When `prisma` is missing or `workerId` is empty.
 */
export function createRollUpTrafficProcessor({
  prisma,
  workerId,
  logger,
  rollUp = runTrafficRollup,
}) {
  if (!prisma) throw new TypeError('createRollUpTrafficProcessor requires a Prisma client')

  if (typeof workerId !== 'string' || workerId.trim() === '') {
    // A lease owned by an empty string is a lease two workers both hold.
    throw new TypeError('createRollUpTrafficProcessor requires a non-empty workerId')
  }

  /**
   * Run one roll-up.
   *
   * @param {object} job The BullMQ job; only `job.data` is read.
   * @returns {Promise<{claimed: boolean, leaseLost: boolean, days: number, rowsPurged: number, saltsDiscarded: number}>} What was done.
   */
  return async function rollUpTraffic(job) {
    const payload = parseJobPayload(
      rollUpTrafficJobSchema,
      job?.data ?? {},
      JOB_NAMES.ROLL_UP_TRAFFIC,
    )

    const summary = await rollUp(prisma, {
      workerId,
      now: payload.now ? new Date(payload.now) : new Date(),
      leaseMs: payload.leaseMs,
      logger,
    })

    if (!summary.claimed) {
      logger?.debug?.('traffic roll-up skipped: another worker holds the lease')

      return summary
    }

    // Counts only: which events were visited, and by whom, is not a log line.
    if (summary.days > 0 || summary.rowsPurged > 0 || summary.saltsDiscarded > 0) {
      logger?.info?.(
        {
          days: summary.days,
          rowsPurged: summary.rowsPurged,
          saltsDiscarded: summary.saltsDiscarded,
          leaseLost: summary.leaseLost,
        },
        'traffic added up',
      )
    }

    return summary
  }
}
