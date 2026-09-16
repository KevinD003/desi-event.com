/**
 * The clock that reads the notification outbox.
 *
 * This processor carries no message id. A job that named one row would put the
 * queue between the domain and the outbox, and then two things would have an
 * opinion about what is due — the queue's retry policy and the outbox's. The
 * outbox *is* the queue; this job only wakes up and asks it what is waiting.
 *
 * That also means a lost job costs nothing. The next tick finds the same rows,
 * because nothing about being due depends on a job existing.
 *
 * @module @desi-event/worker/processors/drain-outbox
 */

import { JOB_NAMES, drainOutboxJobSchema } from '@desi-event/schemas/jobs'

import { parseJobPayload } from '../errors.js'
import { drainOutbox } from '../outbox/dispatcher.js'

/**
 * Build the `drain-outbox` processor.
 *
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma A Prisma client.
 * @param {object} deps.providers A provider registry, or at least `{ email }`.
 * @param {string} deps.workerId Who this worker is, for the lease it takes.
 * @param {object} [deps.logger] Logger for the per-pass summary.
 * @returns {function(object): Promise<object>} An async BullMQ processor.
 * @throws {TypeError} When `prisma` or `workerId` is missing.
 */
export function createDrainOutboxProcessor({ prisma, providers, workerId, logger }) {
  if (!prisma) throw new TypeError('createDrainOutboxProcessor requires a Prisma client')

  if (typeof workerId !== 'string' || workerId.trim() === '') {
    // A lease owned by an empty string is a lease two workers both hold.
    throw new TypeError('createDrainOutboxProcessor requires a non-empty workerId')
  }

  /**
   * Drain whatever is due.
   *
   * @param {object} job The BullMQ job; only `job.data` is read.
   * @returns {Promise<{claimed: number, sent: number, failed: number}>} A summary.
   */
  return async function drain(job) {
    const payload = parseJobPayload(drainOutboxJobSchema, job?.data ?? {}, JOB_NAMES.DRAIN_OUTBOX)

    const summary = await drainOutbox({
      prisma,
      providers,
      workerId,
      limit: payload.limit,
      leaseMs: payload.leaseMs,
      logger,
    })

    // Only counts. Which messages, to whom, and about what are all in the
    // outbox where they belong; a log line that carried them would put
    // recipients into the log aggregator.
    if (summary.claimed > 0) logger?.info?.(summary, 'outbox drained')

    return summary
  }
}
