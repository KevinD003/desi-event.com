/**
 * Repeatable jobs.
 *
 * Exactly one thing needs to happen on a clock rather than in response to an
 * event: the hold sweep. Everything else in this worker is enqueued by
 * something that just happened — an order was paid, an event was published.
 *
 * BullMQ 6 expresses this as a *job scheduler*: a named record that mints one
 * job per interval. Schedulers are upserted by id, so restarting the worker
 * updates the existing schedule in place instead of accumulating a duplicate
 * per deploy — the failure mode that used to make the old `repeat` option
 * sweep four times a minute after four restarts.
 *
 * @module @desi-event/worker/scheduler
 */

import { JOB_NAMES, QUEUE_NAMES } from '@desi-event/schemas/jobs'

import { validateJobPayload } from './queues.js'

/**
 * Scheduler id for the hold sweep. Stable across deploys by design: it is the
 * key the upsert matches on.
 */
export const EXPIRE_HOLDS_SCHEDULER_ID = 'expire-holds-sweep'

/**
 * How often the sweep runs when the environment does not say.
 *
 * A minute is the right order of magnitude: a hold that lapsed is invisible to
 * buyers for at most that long — and not even that, because `activeHeldQuantity`
 * already discounts lapsed holds at read time. The sweep is what keeps the
 * *table* honest, not what keeps availability correct.
 */
export const DEFAULT_EXPIRE_HOLDS_INTERVAL_MS = 60_000

/**
 * Holds examined per sweep. Large enough to drain a busy minute in one pass,
 * small enough that a single job cannot hold a long transaction or blow up a
 * log line.
 */
export const DEFAULT_SWEEP_BATCH_SIZE = 250

/**
 * Register (or update) every repeatable job.
 *
 * The scheduler template deliberately carries **no `now`**. `expireHoldsJobSchema`
 * accepts one, and baking it into a template would freeze every future run to
 * the instant the worker booted — the sweep would then expire nothing, forever,
 * while looking perfectly healthy. The processor falls back to the wall clock
 * at run time precisely so this cannot happen.
 *
 * @param {object} options Registration options.
 * @param {Record<string, object>} options.queues The queue map from `createQueues`.
 * @param {number} [options.intervalMs] How often to sweep. Defaults to {@link DEFAULT_EXPIRE_HOLDS_INTERVAL_MS}.
 * @param {number} [options.batchSize] Holds per sweep.
 * @param {object} [options.logger] Logger for the registration line.
 * @returns {Promise<Array<{id: string, queue: string, everyMs: number}>>} One entry per registered scheduler.
 * @throws {TypeError} When the holds queue is missing.
 * @throws {ValidationError} When the template payload does not satisfy the job schema.
 */
export async function registerRepeatableJobs({
  queues,
  intervalMs = DEFAULT_EXPIRE_HOLDS_INTERVAL_MS,
  batchSize = DEFAULT_SWEEP_BATCH_SIZE,
  logger,
}) {
  const queue = queues?.[QUEUE_NAMES.HOLDS]

  if (!queue) {
    throw new TypeError(`registerRepeatableJobs requires the "${QUEUE_NAMES.HOLDS}" queue`)
  }

  // Validate the template the same way an ad-hoc enqueue would be, so a typo
  // here fails at boot rather than once a minute forever.
  const data = validateJobPayload(JOB_NAMES.EXPIRE_HOLDS, { batchSize })

  await queue.upsertJobScheduler(
    EXPIRE_HOLDS_SCHEDULER_ID,
    { every: intervalMs },
    {
      name: JOB_NAMES.EXPIRE_HOLDS,
      data,
      // A job minted every minute is 1,440 Redis keys a day if kept. An hour
      // of completions is enough to answer "is the sweep still running?";
      // failures are kept by count so a burst is not silently truncated.
      opts: { removeOnComplete: { age: 3600, count: 120 }, removeOnFail: { count: 500 } },
    },
  )

  logger?.info?.(
    { scheduler: EXPIRE_HOLDS_SCHEDULER_ID, everyMs: intervalMs, batchSize },
    'repeatable hold sweep registered',
  )

  return [{ id: EXPIRE_HOLDS_SCHEDULER_ID, queue: QUEUE_NAMES.HOLDS, everyMs: intervalMs }]
}

/**
 * Remove the repeatable jobs this worker owns.
 *
 * Not called on shutdown — a scheduler must outlive a rolling restart, or the
 * sweep would stop the moment the last old pod went away. This exists for
 * tests and for decommissioning a queue deliberately.
 *
 * @param {object} options Options.
 * @param {Record<string, object>} options.queues The queue map.
 * @returns {Promise<string[]>} The scheduler ids that were actually removed.
 */
export async function removeRepeatableJobs({ queues }) {
  const queue = queues?.[QUEUE_NAMES.HOLDS]
  if (!queue) return []

  const removed = await queue.removeJobScheduler(EXPIRE_HOLDS_SCHEDULER_ID)
  return removed ? [EXPIRE_HOLDS_SCHEDULER_ID] : []
}

/**
 * List the schedulers currently registered on the holds queue.
 *
 * @param {object} options Options.
 * @param {Record<string, object>} options.queues The queue map.
 * @returns {Promise<Array<object>>} Scheduler records as BullMQ reports them.
 */
export async function listRepeatableJobs({ queues }) {
  const queue = queues?.[QUEUE_NAMES.HOLDS]
  if (!queue) return []
  return queue.getJobSchedulers()
}
