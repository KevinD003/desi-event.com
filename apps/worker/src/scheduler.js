/**
 * Repeatable jobs.
 *
 * Two things happen on a clock rather than in response to an event: the hold
 * sweep, and the notification outbox drain. Everything else in this worker is
 * enqueued by something that just happened — an order was paid, an event was
 * published.
 *
 * The outbox drain is on a clock for a specific reason. The rows it sends are
 * written inside the transactions that justify them, so there is no moment at
 * which anything could reliably enqueue a job for one: the only safe enqueue is
 * after the commit, and a process that dies in between would lose the message.
 * A clock that asks the outbox what is due needs nobody to remember anything.
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

/** Scheduler id for the outbox drain. Stable across deploys, like the sweep. */
export const DRAIN_OUTBOX_SCHEDULER_ID = 'drain-outbox'

/**
 * How often the outbox is drained when the environment does not say.
 *
 * Ten seconds. A cancellation notice that arrives ten seconds late is fine; one
 * that arrives a minute late is noticeable to somebody refreshing their inbox
 * after being told the event is off. The drain costs one indexed query when the
 * queue is empty, which is cheap enough to do often.
 */
export const DEFAULT_DRAIN_OUTBOX_INTERVAL_MS = 10_000

/** Messages one drain pass may send. */
export const DEFAULT_DRAIN_OUTBOX_LIMIT = 50

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
 * @param {number} [options.drainIntervalMs] How often to drain the outbox.
 * @param {number} [options.drainLimit] Messages per drain pass.
 * @param {object} [options.logger] Logger for the registration line.
 * @returns {Promise<Array<{id: string, queue: string, everyMs: number}>>} One entry per registered scheduler.
 * @throws {TypeError} When a required queue is missing.
 * @throws {ValidationError} When a template payload does not satisfy its job schema.
 */
export async function registerRepeatableJobs({
  queues,
  intervalMs = DEFAULT_EXPIRE_HOLDS_INTERVAL_MS,
  batchSize = DEFAULT_SWEEP_BATCH_SIZE,
  drainIntervalMs = DEFAULT_DRAIN_OUTBOX_INTERVAL_MS,
  drainLimit = DEFAULT_DRAIN_OUTBOX_LIMIT,
  logger,
}) {
  const queue = queues?.[QUEUE_NAMES.HOLDS]

  if (!queue) {
    throw new TypeError(`registerRepeatableJobs requires the "${QUEUE_NAMES.HOLDS}" queue`)
  }

  const emailQueue = queues?.[QUEUE_NAMES.EMAIL]

  if (!emailQueue) {
    throw new TypeError(`registerRepeatableJobs requires the "${QUEUE_NAMES.EMAIL}" queue`)
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

  const drainData = validateJobPayload(JOB_NAMES.DRAIN_OUTBOX, { limit: drainLimit })

  await emailQueue.upsertJobScheduler(
    DRAIN_OUTBOX_SCHEDULER_ID,
    { every: drainIntervalMs },
    {
      name: JOB_NAMES.DRAIN_OUTBOX,
      data: drainData,
      opts: { removeOnComplete: { age: 3600, count: 120 }, removeOnFail: { count: 500 } },
    },
  )

  logger?.info?.(
    { scheduler: DRAIN_OUTBOX_SCHEDULER_ID, everyMs: drainIntervalMs, limit: drainLimit },
    'repeatable outbox drain registered',
  )

  return [
    { id: EXPIRE_HOLDS_SCHEDULER_ID, queue: QUEUE_NAMES.HOLDS, everyMs: intervalMs },
    { id: DRAIN_OUTBOX_SCHEDULER_ID, queue: QUEUE_NAMES.EMAIL, everyMs: drainIntervalMs },
  ]
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
  /** @type {string[]} */
  const removed = []

  // Every scheduler this module owns, not just the first one it grew. A
  // decommission that left the outbox drain running would be exactly the
  // accumulation this function exists to prevent.
  for (const [id, queueName] of [
    [EXPIRE_HOLDS_SCHEDULER_ID, QUEUE_NAMES.HOLDS],
    [DRAIN_OUTBOX_SCHEDULER_ID, QUEUE_NAMES.EMAIL],
  ]) {
    const queue = queues?.[queueName]
    if (!queue) continue

    if (await queue.removeJobScheduler(id)) removed.push(id)
  }

  return removed
}

/**
 * List the schedulers currently registered on the queues this module owns.
 *
 * @param {object} options Options.
 * @param {Record<string, object>} options.queues The queue map.
 * @returns {Promise<Array<object>>} Scheduler records as BullMQ reports them.
 */
export async function listRepeatableJobs({ queues }) {
  const listed = []

  for (const queueName of [QUEUE_NAMES.HOLDS, QUEUE_NAMES.EMAIL]) {
    const queue = queues?.[queueName]
    if (!queue) continue

    listed.push(...(await queue.getJobSchedulers()))
  }

  return listed
}
