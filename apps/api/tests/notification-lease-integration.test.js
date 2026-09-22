/**
 * An operator's retry and cancel against a worker's lease, on real PostgreSQL.
 *
 * The defect this suite exists for: retry accepted a `CLAIMED` row whose lease
 * was live, and its update was conditional on the status alone. A worker inside
 * the provider call lost its lease, the row went back to `QUEUED`, and a second
 * worker sent it again. Every case below is one of the ways an operator's
 * action and a worker's can meet, and each asserts what the row says afterwards
 * — not what the route answered.
 *
 * ## Why every instant here is in 2100
 *
 * The worker suite drains the shared test database with a real claim while
 * this suite runs. A row this suite made claimable at the real current time
 * could be taken by that drain in the middle of a case. So every row is
 * scheduled, and every lease expires, around `FUTURE`, and the operations and
 * the simulated worker here are told that `FUTURE` is now. To anything running
 * on the real clock these rows are not due and their leases are live; to this
 * suite they behave exactly as they would at any other instant.
 *
 * The worker is simulated with the same conditional `updateMany` and the same
 * `claimableWhere` the dispatcher uses, so a claim here is a claim there.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * @module @desi-event/api/tests/notification-lease-integration
 */

import { OUTBOX_STATES, claimableWhere, dedupeKeyFor } from '@desi-event/notifications'
import { afterAll, expect, it } from 'vitest'

import { cancelNotification, retryNotification } from '../src/lib/notification-operations.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, when } = await connectTestDatabase('the notification lease suite')

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** The instant this suite calls now. See the module comment. */
const FUTURE = new Date('2100-01-01T12:00:00.000Z')

/** Minutes either side of it. */
const at = (minutes) => new Date(FUTURE.getTime() + minutes * 60_000)

const RECIPIENT = `lease-${RUN}@example.test`

let sequence = 0

/**
 * An outbox row in a given state.
 *
 * @param {object} columns Columns to set.
 * @returns {Promise<object>} The row.
 */
function message(columns) {
  sequence += 1

  const businessEvent = `lease-suite:${RUN}:${sequence}`

  return prisma.notificationOutbox.create({
    data: {
      template: 'event.cancelled',
      channel: 'EMAIL',
      recipient: RECIPIENT,
      payload: { eventTitle: 'A Night of Ragas', privateNote: `note-${RUN}` },
      businessEvent,
      dedupeKey: dedupeKeyFor({ businessEvent, recipient: RECIPIENT, channel: 'EMAIL' }),
      scheduledFor: at(-10),
      attempts: 1,
      ...columns,
    },
  })
}

/**
 * A worker's claim, exactly as the dispatcher makes it.
 *
 * @param {string} id The row.
 * @param {string} workerId The worker.
 * @param {object} [db] A client or transaction client.
 * @param {Date} [now] The worker's clock.
 * @returns {Promise<boolean>} Whether it claimed.
 */
async function claim(id, workerId, db = prisma, now = FUTURE) {
  const { count } = await db.notificationOutbox.updateMany({
    where: { id, ...claimableWhere(now) },
    data: {
      status: OUTBOX_STATES.CLAIMED,
      leaseOwner: workerId,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      lastAttemptAt: now,
      attempts: { increment: 1 },
    },
  })

  return count === 1
}

/**
 * A worker recording a send, exactly as the dispatcher records one.
 *
 * @param {string} id The row.
 * @param {string} workerId The worker.
 * @param {object} [db] A client or transaction client.
 * @returns {Promise<boolean>} Whether it was recorded.
 */
async function recordSent(id, workerId, db = prisma) {
  const { count } = await db.notificationOutbox.updateMany({
    where: { id, status: OUTBOX_STATES.CLAIMED, leaseOwner: workerId },
    data: {
      status: OUTBOX_STATES.SENT,
      sentAt: FUTURE,
      providerMessageId: `msg-${workerId}`,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  })

  return count === 1
}

/**
 * Run an operator action and describe what came back.
 *
 * @param {Promise<object>} call A retry or cancel.
 * @returns {Promise<{status: number, reason?: string, row?: object}>} The outcome.
 */
async function outcome(call) {
  try {
    return { status: 200, row: await call }
  } catch (error) {
    if (typeof error?.statusCode !== 'number') throw error

    return { status: error.statusCode, reason: error.details?.reason }
  }
}

/**
 * Retry as the operator, at `FUTURE`.
 *
 * @param {string} id The row.
 * @returns {Promise<object>} From {@link outcome}.
 */
function retry(id) {
  return outcome(
    retryNotification(prisma, { id, actorId: null, reason: 'Gateway fixed; resend.', now: FUTURE }),
  )
}

/**
 * Cancel as the operator, at `FUTURE`.
 *
 * @param {string} id The row.
 * @returns {Promise<object>} From {@link outcome}.
 */
function cancel(id) {
  return outcome(
    cancelNotification(prisma, {
      id,
      actorId: null,
      reason: 'Event resolved; not needed.',
      now: FUTURE,
    }),
  )
}

/**
 * The row as it is now.
 *
 * @param {string} id The row.
 * @returns {Promise<object>} It.
 */
function reread(id) {
  return prisma.notificationOutbox.findUnique({ where: { id } })
}

/**
 * Wait until PostgreSQL reports a session blocked on a lock.
 *
 * @returns {Promise<void>} Once one is.
 * @throws {Error} After five seconds.
 */
async function untilBlocked() {
  const deadline = Date.now() + 5_000

  while (Date.now() < deadline) {
    const [{ waiting }] = await prisma.$queryRaw`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`

    if (waiting >= 1) return

    await new Promise((resolve) => {
      setTimeout(resolve, 25)
    })
  }

  throw new Error('No session blocked on a lock within five seconds.')
}

/**
 * Run `work` in a transaction that stays open until released.
 *
 * @param {function(object): Promise<unknown>} work What to do while holding it.
 * @returns {Promise<{release: function(): void, done: Promise<unknown>}>} Once `work` has run.
 */
async function holding(work) {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let ready
  const readyPromise = new Promise((resolve) => {
    ready = resolve
  })

  const done = prisma.$transaction(
    async (tx) => {
      const result = await work(tx)

      ready()
      await gate

      return result
    },
    { timeout: 20_000, maxWait: 10_000 },
  )

  await readyPromise

  return { release, done }
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => {})
})

when()('retry', () => {
  it('puts a dead letter back in the queue, where exactly one worker then claims it', async () => {
    const row = await message({
      status: OUTBOX_STATES.DEAD_LETTER,
      attempts: 5,
      lastError: 'SEND_FAILED',
    })

    const result = await retry(row.id)

    expect(result.status).toBe(200)
    expect(result.row).toMatchObject({
      status: 'QUEUED',
      attempts: 0,
      leaseOwner: null,
      lastError: null,
    })

    const claims = await Promise.all([claim(row.id, 'worker-a'), claim(row.id, 'worker-b')])

    expect(claims.filter(Boolean)).toHaveLength(1)
  })

  it('refuses a message a worker is sending, and leaves the lease exactly as it was', async () => {
    const row = await message({ status: OUTBOX_STATES.QUEUED })

    expect(await claim(row.id, 'worker-a')).toBe(true)

    const leased = await reread(row.id)
    const result = await retry(row.id)
    const after = await reread(row.id)

    expect(result).toMatchObject({ status: 409, reason: 'LEASED' })
    expect(after).toMatchObject({
      status: 'CLAIMED',
      leaseOwner: 'worker-a',
      leaseExpiresAt: leased.leaseExpiresAt,
      attempts: leased.attempts,
    })

    // The worker's own completion still lands, which is the point: the send it
    // made is the one recorded.
    expect(await recordSent(row.id, 'worker-a')).toBe(true)
    expect((await reread(row.id)).providerMessageId).toBe('msg-worker-a')
  })

  it('refuses a message whose lease has lapsed, leaving it for the next worker to reclaim', async () => {
    const row = await message({
      status: OUTBOX_STATES.CLAIMED,
      leaseOwner: 'worker-crashed',
      leaseExpiresAt: at(-1),
    })

    const result = await retry(row.id)

    expect(result).toMatchObject({ status: 409, reason: 'LEASED' })
    expect((await reread(row.id)).status).toBe('CLAIMED')

    // What does pick it up: a worker, through the ordinary claim.
    expect(await claim(row.id, 'worker-b')).toBe(true)
    expect((await reread(row.id)).leaseOwner).toBe('worker-b')
  })

  it('loses cleanly to a worker that claims a scheduled retry in the same instant', async () => {
    const row = await message({ status: OUTBOX_STATES.RETRY_SCHEDULED, scheduledFor: at(-1) })

    // The worker's claim is written and not yet committed. The retry reads the
    // row as RETRY_SCHEDULED, which is retryable, and its conditional update
    // waits on the worker's row lock.
    const worker = await holding((tx) => claim(row.id, 'worker-a', tx))
    const operator = retry(row.id)

    await untilBlocked()
    worker.release()
    expect(await worker.done).toBe(true)

    // PostgreSQL re-checks the WHERE against the committed claim, which no
    // longer matches: the operator is told, and the lease stands.
    expect(await operator).toMatchObject({ status: 409, reason: 'CHANGED' })
    expect(await reread(row.id)).toMatchObject({ status: 'CLAIMED', leaseOwner: 'worker-a' })
  })

  it('cannot undo a worker’s completion that lands while the operator is looking', async () => {
    const row = await message({ status: OUTBOX_STATES.QUEUED })

    expect(await claim(row.id, 'worker-a')).toBe(true)

    // The worker records the send and has not committed. The operator sees
    // the committed CLAIMED row and is refused without waiting.
    const worker = await holding((tx) => recordSent(row.id, 'worker-a', tx))
    const result = await retry(row.id)

    worker.release()
    expect(await worker.done).toBe(true)
    expect(result).toMatchObject({ status: 409, reason: 'LEASED' })
    expect(await reread(row.id)).toMatchObject({
      status: 'SENT',
      providerMessageId: 'msg-worker-a',
    })

    // And once sent, it stays sent.
    expect(await retry(row.id)).toMatchObject({ status: 409, reason: 'NOT_RETRYABLE' })
  })

  it('turns two operators pressing retry at once into one requeue and one audit row', async () => {
    const row = await message({ status: OUTBOX_STATES.DEAD_LETTER, attempts: 5 })

    const results = await Promise.all([retry(row.id), retry(row.id)])

    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
    expect(
      await prisma.auditLog.count({
        where: { action: 'notification.requeued', entityId: row.id },
      }),
    ).toBe(1)
  })

  it('refuses a redacted dead letter: there is nobody left to send it to', async () => {
    const row = await message({
      status: OUTBOX_STATES.DEAD_LETTER,
      recipient: `redacted-${RUN}@redacted.invalid`,
      payload: {},
    })

    expect(await retry(row.id)).toMatchObject({ status: 409, reason: 'REDACTED' })
    expect((await reread(row.id)).status).toBe('DEAD_LETTER')
  })
})

when()('cancel', () => {
  it('refuses a message a worker is sending, and leaves the lease exactly as it was', async () => {
    const row = await message({ status: OUTBOX_STATES.QUEUED })

    expect(await claim(row.id, 'worker-a')).toBe(true)

    const leased = await reread(row.id)

    expect(await cancel(row.id)).toMatchObject({ status: 409, reason: 'LEASED' })
    expect(await reread(row.id)).toMatchObject({
      status: 'CLAIMED',
      leaseOwner: 'worker-a',
      leaseExpiresAt: leased.leaseExpiresAt,
    })
  })

  it('withdraws a message whose lease lapsed, and records whose lease it was', async () => {
    const row = await message({
      status: OUTBOX_STATES.CLAIMED,
      leaseOwner: 'worker-crashed',
      leaseExpiresAt: at(-1),
    })

    const result = await cancel(row.id)

    expect(result.status).toBe(200)
    expect(result.row).toMatchObject({ status: 'CANCELLED', leaseOwner: null })

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'notification.cancelled', entityId: row.id },
    })

    expect(audit.metadata).toMatchObject({ lapsedLeaseOwner: 'worker-crashed' })
  })

  it('does not withdraw a lapsed lease that a worker re-claims in the same instant', async () => {
    const row = await message({
      status: OUTBOX_STATES.CLAIMED,
      leaseOwner: 'worker-crashed',
      leaseExpiresAt: at(-1),
    })

    // A fresh worker re-claims it — a new owner and a live lease — and has not
    // committed. The cancel reads the lapsed lease and waits on the row.
    const worker = await holding((tx) => claim(row.id, 'worker-b', tx))
    const operator = cancel(row.id)

    await untilBlocked()
    worker.release()
    expect(await worker.done).toBe(true)

    // Before this change the WHERE was the status alone, which still matched
    // CLAIMED, and the cancel wiped a live lease.
    expect(await operator).toMatchObject({ status: 409, reason: 'CHANGED' })
    expect(await reread(row.id)).toMatchObject({ status: 'CLAIMED', leaseOwner: 'worker-b' })
  })
})

when()('the audit trail', () => {
  it('records who, why and which transition, and never the recipient, the payload or the dedupe key', async () => {
    const retried = await message({ status: OUTBOX_STATES.DEAD_LETTER })
    const cancelled = await message({ status: OUTBOX_STATES.QUEUED, scheduledFor: at(30) })

    await retry(retried.id)
    await cancel(cancelled.id)

    const rows = await prisma.auditLog.findMany({
      where: { entityId: { in: [retried.id, cancelled.id] } },
    })

    expect(rows.map((row) => row.action).sort()).toEqual([
      'notification.cancelled',
      'notification.requeued',
    ])

    const everything = JSON.stringify(rows)

    expect(everything).not.toContain(RECIPIENT)
    expect(everything).not.toContain(`note-${RUN}`)
    expect(everything).not.toContain(retried.dedupeKey)
    expect(everything).not.toContain(cancelled.dedupeKey)
  })
})
