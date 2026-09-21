/**
 * The retention rehearsal against a real Redis, in its own file and with one
 * worker.
 *
 * ## Why a separate file rather than a case in `redis-integration.test.js`
 *
 * Because that suite's worker count is load-bearing and pinned. Every BullMQ
 * `Worker` duplicates the shared connection for a blocking read, and run
 * 35319113778 went red when the suite grew from four workers to six — a
 * `send-email` job the in-memory provider finishes in milliseconds was never
 * picked up inside thirty seconds, on a commit whose diff was two web pages.
 * Its `EXERCISED_JOBS` guard exists to stop exactly that, and adding retention
 * there would mean either breaking the guard or raising the number it defends.
 *
 * So this file starts **one** worker, on the retention queue alone, and touches
 * neither the other suite nor the shared `createFakePrisma` it imports.
 *
 * ## Why this file is short, and what it deliberately does not prove
 *
 * Only the things a real Redis is the only witness to: that a payload survives
 * BullMQ's serialisation, that the queue's retry policy is what `queues.js`
 * declares, that the worker really is pinned to one, and that a failure
 * genuinely reaches the failed set rather than being swallowed.
 *
 * It does **not** re-prove idempotency here. That property is about a primary
 * key, and proving it through a Redis round-trip against an in-memory
 * unique-index emulation would mostly be testing the emulation; the real
 * assertion lives in `retention-postgres.test.js`, against a real primary key,
 * and the unit test in `src/processors/sweep-retention.test.js` covers the
 * logic. Spending a second blocking reader on a weaker version of a test that
 * already exists is how the other suite got into trouble.
 *
 * Skips itself when Redis is unreachable: a suite that fails for environmental
 * reasons trains people to ignore red.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { QueueEvents } from 'bullmq'
import { JOB_NAMES, QUEUE_NAMES } from '@desi-event/schemas/jobs'

import { closeRedisConnection, createRedisConnection } from '../src/connection.js'
import { closeQueues, createQueues, enqueueSweepRetention } from '../src/queues.js'
import { createRetentionSweepProcessor } from '../src/processors/sweep-retention.js'
import { RETENTION_CLASSES } from '../src/retention/classes.js'
import { closeWorkers, createWorkers } from '../src/workers.js'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'

// This run's own prefix, so cleanup can never reach another suite's keys.
const PREFIX = `desi-event-retention-${process.pid}-${Date.now()}`

// Same reasoning as the sibling suite: derived from the queue under test rather
// than picked. The retention queue backs off a fixed 30s, so a wait shorter
// than that cannot survive one retry, and the per-test timeout has to clear the
// wait itself or vitest kills the test before the wait can report anything.
const WAIT_MS = 30_000
const TEST_TIMEOUT_MS = 45_000

/** A fixed instant, so the ids and cut-offs are predictable. */
const NOW = new Date('2026-09-18T00:00:00.000Z')

/**
 * A Prisma stand-in for this file alone.
 *
 * Deliberately not `createFakePrisma` from `./helpers/fakes.js`: that helper is
 * imported by the fragile suite next door, and extending it to carry a
 * `retentionSweep` model would put a change to that suite's dependencies inside
 * a commit about retention. It has no such model today.
 *
 * Every mutating method on a swept table throws, so a rehearsal that acquired
 * the ability to change something fails here rather than in production.
 *
 * @returns {object} The stub, carrying what it was asked to write.
 */
function countingPrisma() {
  const rows = new Map()
  const attempts = []
  const forbid = (name) => () => {
    throw new Error(`a retention rehearsal must not call ${name}`)
  }
  const swept = () => ({
    count: async () => 3,
    delete: forbid('delete'),
    deleteMany: forbid('deleteMany'),
    update: forbid('update'),
    updateMany: forbid('updateMany'),
  })

  return {
    rows,
    attempts,
    loginAttempt: swept(),
    session: swept(),
    notificationOutbox: swept(),
    privacyHold: swept(),
    retentionSweep: {
      create: async ({ data }) => {
        attempts.push(data)

        if (rows.has(data.id)) {
          const conflict = new Error('Unique constraint failed on the fields: (`id`)')

          conflict.code = 'P2002'
          throw conflict
        }

        rows.set(data.id, data)

        return data
      },
      findUnique: async ({ where }) => rows.get(where.id) ?? null,
    },
    $executeRaw: forbid('$executeRaw'),
    $executeRawUnsafe: forbid('$executeRawUnsafe'),
  }
}

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
  console.warn(`[worker] skipping the retention Redis test: ${REDIS_URL} is unreachable`)
}

when('the retention rehearsal against live Redis', () => {
  /** @type {object} */
  let connection
  /** @type {Record<string, object>} */
  let queues
  /** @type {Array<object>} */
  let workers
  /** @type {object} */
  let prisma
  /** @type {object} */
  let queueEvents

  beforeAll(async () => {
    connection = createRedisConnection({ url: REDIS_URL })
    queues = createQueues({ connection, prefix: PREFIX })
    prisma = countingPrisma()

    // One job, therefore one worker, therefore one blocking reader. The
    // processor is the real one: a fake here would leave the wiring — payload
    // serialisation, queue routing, the activation gate — unproven, which is
    // the only thing this file is for.
    workers = createWorkers({
      processors: {
        [JOB_NAMES.SWEEP_RETENTION]: createRetentionSweepProcessor({
          prisma,
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
          activated: true,
          clock: () => NOW,
        }),
      },
      connection,
      prefix: PREFIX,
    })

    await Promise.all(workers.map((worker) => worker.waitUntilReady()))

    queueEvents = new QueueEvents(QUEUE_NAMES.RETENTION, { connection, prefix: PREFIX })
    await queueEvents.waitUntilReady()
  }, TEST_TIMEOUT_MS)

  afterAll(async () => {
    await closeWorkers(workers)
    await queueEvents?.close()
    await Promise.all(Object.values(queues).map((queue) => queue.obliterate({ force: true })))
    await closeQueues(queues)
    await closeRedisConnection(connection)
  }, TEST_TIMEOUT_MS)

  it('starts exactly one worker, because that is what the retention queue is pinned to', () => {
    // `concurrencyFor` pins this queue to one, and this file starts one worker.
    // Both halves stated, because the sibling suite's failure was caused by a
    // worker count drifting upward without anybody noticing.
    expect(workers).toHaveLength(1)
    expect(workers[0].opts.concurrency).toBe(1)
  })

  it(
    'carries the payload through Redis and runs the real processor',
    async () => {
      const job = await enqueueSweepRetention(queues, { now: NOW.toISOString() })
      const result = await job.waitUntilFinished(queueEvents, WAIT_MS)

      expect(result.job).toBe(JOB_NAMES.SWEEP_RETENTION)
      expect(result.activated).toBe(true)
      expect(result.swept).toBe(RETENTION_CLASSES.length)
      expect(result.affectedCount).toBe(0)

      // Serialisation is the thing under test: `now` went out as an ISO string
      // and has to come back as the same instant, or every cut-off is wrong.
      for (const row of prisma.rows.values()) {
        expect(row.startedAt.toISOString()).toBe(NOW.toISOString())
        expect(row.mode).toBe('DRY_RUN')
        expect(row.state).toBe('COMPLETED')
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'applies the retry policy the queue module declares',
    async () => {
      // Read off the enqueued job rather than restated, so a change to
      // `QUEUE_JOB_OPTIONS` shows up here instead of in a production incident.
      // Two attempts, not one: a repository invariant requires more than one,
      // which is precisely why the deterministic row id exists.
      const job = await enqueueSweepRetention(queues, {
        now: NOW.toISOString(),
        retentionClass: 'login_attempt',
      })

      expect(job.opts.attempts).toBe(2)
      expect(job.opts.backoff).toMatchObject({ type: 'fixed', delay: 30_000 })

      await job.waitUntilFinished(queueEvents, WAIT_MS)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'refuses a class it does not evaluate, and the refusal reaches the failed set',
    async () => {
      // A named class the worker does not sweep must fail loudly. Rehearsing
      // everything and reporting it as though the narrowing had been honoured
      // is the worse outcome, and it would look identical from the queue.
      const job = await enqueueSweepRetention(queues, { retentionClass: 'export_artifact' })

      await expect(job.waitUntilFinished(queueEvents, WAIT_MS)).rejects.toThrow(
        /no retention class named export_artifact is evaluated/u,
      )

      // And it must not have retried. This assertion is here because its
      // absence cost a thirty-second timeout to diagnose: the refusal
      // originally threw a plain `Error`, so BullMQ took the payload mistake as
      // a transient one and scheduled a second attempt behind the queue's fixed
      // thirty-second backoff. Two attempts on a job that can never succeed,
      // and half a minute of an operator wondering whether it was picked up.
      const failed = await queues[QUEUE_NAMES.RETENTION].getJob(job.id)

      expect(failed.attemptsMade).toBe(1)
      expect(await failed.getState()).toBe('failed')
    },
    TEST_TIMEOUT_MS,
  )
})
