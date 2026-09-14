/**
 * Queue construction, retention policy and the typed enqueue helpers the rest
 * of the system uses to hand work to this worker.
 *
 * Queue and job names come from `@desi-event/schemas` rather than being spelled
 * out here, so a producer and this consumer cannot drift apart over a typo.
 *
 * Every helper validates its payload **before** the job reaches Redis. A job is
 * validated twice on purpose — once by the producer, once by the processor —
 * because the two checks catch different bugs: the producer-side check fails in
 * the caller's stack trace where the mistake was made, while the consumer-side
 * check catches payloads written by an older deploy that is no longer running.
 *
 * @module @desi-event/worker/queues
 */

import { Queue } from 'bullmq'
import { JOB_NAMES, QUEUE_NAMES, jobSchemaFor, parseOrThrow } from '@desi-event/schemas'

export { JOB_NAMES, QUEUE_NAMES }

/** Default BullMQ key prefix; overridden from `QUEUE_PREFIX`. */
export const DEFAULT_QUEUE_PREFIX = 'desi-event'

/** Which queue each job name belongs to. */
export const QUEUE_FOR_JOB = Object.freeze({
  [JOB_NAMES.SEND_EMAIL]: QUEUE_NAMES.EMAIL,
  [JOB_NAMES.EXPIRE_HOLDS]: QUEUE_NAMES.HOLDS,
  [JOB_NAMES.ISSUE_TICKETS]: QUEUE_NAMES.TICKETS,
  [JOB_NAMES.INDEX_EVENT]: QUEUE_NAMES.SEARCH,
})

/**
 * BullMQ expresses retention ages in *seconds*, so the windows below are named
 * in seconds too; a millisecond value here silently keeps jobs 1000x too long.
 */
const HOUR_S = 60 * 60

/** One day, in seconds. */
const DAY_S = 24 * HOUR_S

/**
 * Retry and retention defaults applied to every job unless a queue overrides
 * them.
 *
 * Three attempts with exponential backoff from two seconds (2s, 4s, 8s) rides
 * out the failure this system actually sees — a brief database failover or a
 * provider hiccup — without hammering a service that is genuinely down.
 *
 * Completed jobs are evicted aggressively because a finished job is a Redis
 * key that costs memory and buys nothing; failed jobs are kept far longer
 * because they are the only record of work that did not happen, and someone
 * has to be able to look at them on Monday morning.
 *
 * @type {Readonly<Record<string, unknown>>}
 */
export const DEFAULT_JOB_OPTIONS = Object.freeze({
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: HOUR_S, count: 1000 },
  removeOnFail: { age: 7 * DAY_S, count: 5000 },
})

/**
 * Per-queue overrides. Each deviation from {@link DEFAULT_JOB_OPTIONS} is a
 * deliberate statement about what failure means for that queue.
 *
 * @type {Readonly<Record<string, Record<string, unknown>>>}
 */
export const QUEUE_JOB_OPTIONS = Object.freeze({
  // Email is the most failure-prone thing the worker does and the most
  // recoverable: SMTP providers rate-limit and time out constantly. Five
  // attempts starting at five seconds spans roughly a minute and a half,
  // which covers a typical provider blip without spamming a real recipient.
  [QUEUE_NAMES.EMAIL]: Object.freeze({
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3 * DAY_S, count: 5000 },
    removeOnFail: { age: 14 * DAY_S, count: 5000 },
  }),

  // The hold sweep runs every minute forever, so retention is the concern, not
  // retries: a missed sweep is picked up whole by the next one a minute later.
  // Keeping an hour of completions is enough to answer "is it still running?"
  // without accumulating 1,440 keys a day.
  [QUEUE_NAMES.HOLDS]: Object.freeze({
    attempts: 3,
    backoff: { type: 'fixed', delay: 5000 },
    removeOnComplete: { age: HOUR_S, count: 120 },
    removeOnFail: { age: 3 * DAY_S, count: 1000 },
  }),

  // Ticket issuance is money-adjacent: a buyer has paid and has no tickets
  // until this succeeds. It gets the most attempts, and both its completions
  // and its failures are kept for a month, which is long enough to answer a
  // "where are my tickets?" query about any event still in the future.
  [QUEUE_NAMES.TICKETS]: Object.freeze({
    attempts: 8,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { age: 30 * DAY_S, count: 10_000 },
    removeOnFail: { age: 30 * DAY_S, count: 10_000 },
  }),

  // A stale search index is a cosmetic problem and the next write re-enqueues
  // the same event anyway, so completions are dropped immediately.
  [QUEUE_NAMES.SEARCH]: Object.freeze({
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: true,
    removeOnFail: { age: DAY_S, count: 500 },
  }),
})

/**
 * Resolve the default job options for a queue.
 *
 * @param {string} queueName One of {@link QUEUE_NAMES}.
 * @returns {Record<string, unknown>} Options to hand to the `Queue` constructor.
 */
export function jobOptionsFor(queueName) {
  return { ...DEFAULT_JOB_OPTIONS, ...(QUEUE_JOB_OPTIONS[queueName] ?? {}) }
}

/**
 * @typedef {object} QueueHandle
 * @property {string} name The queue name.
 * @property {Function} add Enqueue a job.
 * @property {Function} close Release the queue's Redis resources.
 * @property {Function} upsertJobScheduler Create or update a repeatable job.
 */

/**
 * Create one BullMQ queue.
 *
 * @param {string} name One of {@link QUEUE_NAMES}.
 * @param {object} options Construction options.
 * @param {object} options.connection The shared Redis connection.
 * @param {string} [options.prefix] BullMQ key prefix.
 * @returns {QueueHandle} The queue.
 * @throws {TypeError} When `name` is not a known queue.
 */
export function createQueue(name, { connection, prefix = DEFAULT_QUEUE_PREFIX }) {
  if (!Object.values(QUEUE_NAMES).includes(name)) {
    throw new TypeError(
      `Unknown queue "${name}"; expected one of ${Object.values(QUEUE_NAMES).join(', ')}`,
    )
  }

  return new Queue(name, { connection, prefix, defaultJobOptions: jobOptionsFor(name) })
}

/**
 * Create every queue this worker owns, keyed by queue name.
 *
 * @param {object} options Construction options.
 * @param {object} options.connection The shared Redis connection.
 * @param {string} [options.prefix] BullMQ key prefix.
 * @returns {Record<string, QueueHandle>} A map of queue name to queue.
 */
export function createQueues({ connection, prefix = DEFAULT_QUEUE_PREFIX }) {
  /** @type {Record<string, QueueHandle>} */
  const queues = {}

  for (const name of Object.values(QUEUE_NAMES)) {
    queues[name] = createQueue(name, { connection, prefix })
  }

  return queues
}

/**
 * Close every queue in a map, even if one of them throws.
 *
 * @param {Record<string, QueueHandle>} queues The map returned by {@link createQueues}.
 * @returns {Promise<void>} Resolves once every queue has been closed or has failed to close.
 */
export async function closeQueues(queues) {
  await Promise.allSettled(Object.values(queues ?? {}).map((queue) => queue.close()))
}

/**
 * Validate a payload against its job schema.
 *
 * @param {string} jobName One of {@link JOB_NAMES}.
 * @param {unknown} payload The candidate payload.
 * @returns {object} The parsed payload, with schema defaults applied.
 * @throws {TypeError} When `jobName` is not a known job.
 * @throws {ValidationError} When the payload does not satisfy the job's schema.
 */
export function validateJobPayload(jobName, payload) {
  const schema = jobSchemaFor(jobName)

  if (!schema) {
    throw new TypeError(
      `Unknown job "${jobName}"; expected one of ${Object.values(JOB_NAMES).join(', ')}`,
    )
  }

  return /** @type {object} */ (
    parseOrThrow(schema, payload, `Invalid "${jobName}" job payload`)
  )
}

/**
 * Validate a payload and enqueue it on the queue that owns the job.
 *
 * The payload stored in Redis is the *parsed* one, so schema defaults
 * (`batchSize`, `locale`, `action`) are resolved by the producer and a job
 * replayed from the failed set months later behaves exactly as it did the
 * first time, even if a default has since changed.
 *
 * @param {Record<string, QueueHandle>} queues The queue map.
 * @param {string} jobName One of {@link JOB_NAMES}.
 * @param {object} payload The job payload.
 * @param {Record<string, unknown>} [options] Per-job BullMQ options, merged over the queue defaults.
 * @returns {Promise<object>} The created job.
 * @throws {TypeError} When the job or its queue is unknown.
 * @throws {ValidationError} When the payload does not satisfy the job's schema.
 */
export async function enqueue(queues, jobName, payload, options = {}) {
  const data = validateJobPayload(jobName, payload)
  const queueName = QUEUE_FOR_JOB[jobName]
  const queue = queues?.[queueName]

  if (!queue) {
    throw new TypeError(`No "${queueName}" queue was supplied for job "${jobName}"`)
  }

  return queue.add(jobName, data, options)
}

/**
 * Enqueue a transactional email.
 *
 * @param {Record<string, QueueHandle>} queues The queue map.
 * @param {object} payload A `sendEmailJobSchema` payload.
 * @param {Record<string, unknown>} [options] Per-job BullMQ options.
 * @returns {Promise<object>} The created job.
 * @throws {ValidationError} When the payload is invalid.
 */
export function enqueueSendEmail(queues, payload, options = {}) {
  return enqueue(queues, JOB_NAMES.SEND_EMAIL, payload, options)
}

/**
 * Enqueue an out-of-band hold sweep.
 *
 * The scheduler already runs this every minute; this helper exists for the
 * cases where waiting up to a minute is too long — releasing a specific tier
 * the moment a checkout is abandoned, or draining after a backlog.
 *
 * @param {Record<string, QueueHandle>} queues The queue map.
 * @param {object} [payload] An `expireHoldsJobSchema` payload.
 * @param {Record<string, unknown>} [options] Per-job BullMQ options.
 * @returns {Promise<object>} The created job.
 * @throws {ValidationError} When the payload is invalid.
 */
export function enqueueExpireHolds(queues, payload = {}, options = {}) {
  return enqueue(queues, JOB_NAMES.EXPIRE_HOLDS, payload, options)
}

/**
 * Enqueue ticket issuance for a paid order.
 *
 * A deterministic `jobId` is derived from the order id so that two callers
 * reacting to the same payment — a webhook and a polling reconciliation, say —
 * produce one job rather than two. The processor is idempotent regardless;
 * this just avoids the wasted work and the log noise.
 *
 * @param {Record<string, QueueHandle>} queues The queue map.
 * @param {object} payload An `issueTicketsJobSchema` payload.
 * @param {Record<string, unknown>} [options] Per-job BullMQ options; `jobId` may be overridden.
 * @returns {Promise<object>} The created job.
 * @throws {ValidationError} When the payload is invalid.
 */
export async function enqueueIssueTickets(queues, payload, options = {}) {
  // Async so that a validation failure surfaces as a rejected promise, the
  // same as every other helper here; a helper that sometimes throws
  // synchronously and sometimes rejects is a trap for its callers.
  const data = validateJobPayload(JOB_NAMES.ISSUE_TICKETS, payload)
  return enqueue(queues, JOB_NAMES.ISSUE_TICKETS, data, {
    jobId: `${JOB_NAMES.ISSUE_TICKETS}:${data.orderId}:${data.attempt}`,
    ...options,
  })
}

/**
 * Enqueue a search index update for an event.
 *
 * @param {Record<string, QueueHandle>} queues The queue map.
 * @param {object} payload An `indexEventJobSchema` payload.
 * @param {Record<string, unknown>} [options] Per-job BullMQ options.
 * @returns {Promise<object>} The created job.
 * @throws {ValidationError} When the payload is invalid.
 */
export function enqueueIndexEvent(queues, payload, options = {}) {
  return enqueue(queues, JOB_NAMES.INDEX_EVENT, payload, options)
}
