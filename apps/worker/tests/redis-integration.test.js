/**
 * The one test that touches real infrastructure.
 *
 * Everything else in this package runs against fakes, which proves the logic
 * but not the wiring: that the queue and the worker agree on a key prefix, that
 * a payload survives BullMQ's serialisation intact, that a scheduler is
 * actually registered, that `UnrecoverableError` really does stop the retries.
 * Those only fail against a real Redis.
 *
 * It skips itself when Redis is unreachable, so `pnpm test` still passes on a
 * laptop with nothing running — the alternative, a suite that fails for
 * environmental reasons, trains people to ignore red.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QueueEvents } from 'bullmq'
import { JOB_NAMES, QUEUE_NAMES } from '@desi-event/schemas/jobs'
import { createInMemoryEmailProvider } from '@desi-event/providers'

import { closeRedisConnection, createRedisConnection } from '../src/connection.js'
import { closeQueues, createQueues, enqueueExpireHolds, enqueueSendEmail } from '../src/queues.js'
import { createProcessors } from '../src/processors/index.js'
import { closeWorkers, createWorkers } from '../src/workers.js'
import {
  DRAIN_OUTBOX_SCHEDULER_ID,
  EXPIRE_HOLDS_SCHEDULER_ID,
  listRepeatableJobs,
  registerRepeatableJobs,
  removeRepeatableJobs,
} from '../src/scheduler.js'
import { buildHold, createFakePrisma } from './helpers/fakes.js'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'

// A prefix unique to this run, so a parallel suite or a developer's own queues
// can never be drained by this test's cleanup.
const PREFIX = `desi-event-test-${process.pid}-${Date.now()}`

// How long to wait for BullMQ to finish a job, and how long to give the test
// around that wait. Both are derived from the configuration under test rather
// than picked: `src/queues.js` gives the search queue an exponential backoff
// starting at ten seconds, so the old fifteen-second wait could not survive a
// single retry, and it left only about five seconds of slack for the first
// attempt to be picked up at all. On a two-core CI runner, where `pnpm run
// test` fans nineteen Turborepo tasks out at once, five seconds of scheduling
// slack is a coin toss — which is how run 35130417097 went red on a commit
// that changed nothing but Markdown. Thirty seconds clears one whole backoff;
// the per-test timeout has to clear the wait itself, or vitest kills the test
// before the wait can report what actually happened.
const WAIT_MS = 30_000
const TEST_TIMEOUT_MS = 45_000

/**
 * Probe Redis without leaving a connection behind.
 *
 * @returns {Promise<boolean>} Whether a PING succeeded.
 */
async function redisReachable() {
  const probe = createRedisConnection({
    url: REDIS_URL,
    redisOptions: { lazyConnect: true, connectTimeout: 750, retryStrategy: () => null },
  })

  try {
    await probe.connect()
    await probe.ping()
    return true
  } catch {
    return false
  } finally {
    await closeRedisConnection(probe)
  }
}

const reachable = await redisReachable()
const when = reachable ? describe : describe.skip

if (!reachable) {
  console.warn(`[worker] skipping the Redis integration test: ${REDIS_URL} is unreachable`)
}

when('worker against live Redis', () => {
  /** @type {object} */
  let connection
  /** @type {Record<string, object>} */
  let queues
  /** @type {Array<object>} */
  let workers
  /** @type {object} */
  let email
  /** @type {object} */
  let prisma
  /** @type {object} */
  let queueEvents

  beforeAll(async () => {
    connection = createRedisConnection({ url: REDIS_URL })
    queues = createQueues({ connection, prefix: PREFIX })

    email = createInMemoryEmailProvider()
    prisma = createFakePrisma({
      holds: [
        buildHold({ id: 'lapsed', expiresAt: new Date('2020-01-01T00:00:00.000Z'), quantity: 3 }),
        buildHold({ id: 'fresh', expiresAt: new Date('2099-01-01T00:00:00.000Z'), quantity: 1 }),
      ],
    })

    workers = createWorkers({
      processors: createProcessors({ prisma, providers: { email } }),
      connection,
      prefix: PREFIX,
      concurrency: 2,
    })

    // Nothing else orders a worker's Redis connection against the first job
    // that needs it: `createWorkers` returns as soon as the `Worker` objects
    // exist. Measured at about 30ms on an idle machine, so this costs nothing
    // and removes a dependency that was previously left to luck.
    await Promise.all(workers.map((worker) => worker.waitUntilReady()))

    queueEvents = new QueueEvents(QUEUE_NAMES.EMAIL, { connection, prefix: PREFIX })
    await queueEvents.waitUntilReady()
  }, TEST_TIMEOUT_MS)

  afterAll(async () => {
    await closeWorkers(workers)
    await queueEvents?.close()
    // Leave no keys behind: this prefix belongs to this run alone.
    await Promise.all(Object.values(queues).map((queue) => queue.obliterate({ force: true })))
    await closeQueues(queues)
    await closeRedisConnection(connection)
  }, TEST_TIMEOUT_MS)

  it(
    'carries a payload through Redis and runs the real processor',
    async () => {
      const job = await enqueueSendEmail(queues, {
        to: 'buyer@example.com',
        template: 'ORDER_CONFIRMATION',
        data: { buyerName: 'Priya Sharma', orderReference: 'DE-8F3K2Q', totalCents: 150_000 },
      })

      const result = await job.waitUntilFinished(queueEvents, WAIT_MS)

      expect(result).toMatchObject({ to: 'buyer@example.com', template: 'ORDER_CONFIRMATION' })
      expect(email.sent).toHaveLength(1)
      expect(email.sent[0].subject).toContain('DE-8F3K2Q')
      expect(email.sent[0].text).toContain('INR 1500.00')
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'applies the queue retry policy to jobs it enqueues',
    async () => {
      const job = await enqueueSendEmail(queues, {
        to: 'buyer@example.com',
        template: 'EVENT_REMINDER',
      })

      expect(job.opts.attempts).toBe(5)
      expect(job.opts.backoff).toMatchObject({ type: 'exponential' })

      await job.waitUntilFinished(queueEvents, WAIT_MS)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'sweeps real holds through the holds queue',
    async () => {
      const holdEvents = new QueueEvents(QUEUE_NAMES.HOLDS, { connection, prefix: PREFIX })
      await holdEvents.waitUntilReady()

      try {
        const job = await enqueueExpireHolds(queues, { batchSize: 10 })
        const result = await job.waitUntilFinished(holdEvents, WAIT_MS)

        expect(result).toMatchObject({ scanned: 2, expired: 1, updated: 1, releasedQuantity: 3 })
        expect(prisma.rows.holds.find((hold) => hold.id === 'lapsed').status).toBe('EXPIRED')
        expect(prisma.rows.holds.find((hold) => hold.id === 'fresh').status).toBe('ACTIVE')
      } finally {
        await holdEvents.close()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'fails a malformed payload without burning its retries',
    async () => {
      // Enqueued directly, bypassing the validating helper, exactly as a stale
      // producer or a hand-inserted job would arrive.
      const job = await queues[QUEUE_NAMES.SEARCH].add(
        JOB_NAMES.INDEX_EVENT,
        { eventId: 'NOT A CUID' },
        { attempts: 5 },
      )

      const searchEvents = new QueueEvents(QUEUE_NAMES.SEARCH, { connection, prefix: PREFIX })
      await searchEvents.waitUntilReady()

      try {
        await expect(job.waitUntilFinished(searchEvents, WAIT_MS)).rejects.toThrow(/Invalid/)

        const failed = await queues[QUEUE_NAMES.SEARCH].getJob(job.id)
        expect(failed.attemptsMade).toBe(1)
      } finally {
        await searchEvents.close()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'registers both repeatable jobs, and upserting again does not duplicate them',
    async () => {
      await registerRepeatableJobs({ queues, intervalMs: 60_000 })
      await registerRepeatableJobs({ queues, intervalMs: 60_000 })

      const schedulers = await listRepeatableJobs({ queues })
      const names = schedulers.map((scheduler) => scheduler.key ?? scheduler.name)

      expect(names).toContain(EXPIRE_HOLDS_SCHEDULER_ID)
      expect(names).toContain(DRAIN_OUTBOX_SCHEDULER_ID)
      // Two, not four: the upsert is keyed by id, which is what stops a rolling
      // restart accumulating one sweep per deploy.
      expect(schedulers).toHaveLength(2)

      await removeRepeatableJobs({ queues })
      expect(await listRepeatableJobs({ queues })).toHaveLength(0)
    },
    TEST_TIMEOUT_MS,
  )
})
