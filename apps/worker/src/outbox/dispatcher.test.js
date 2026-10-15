/**
 * The outbox worker, against a real database.
 *
 * Leases only mean something under real concurrency. A stub that hands one row
 * to two callers because nobody told it not to would prove nothing, and a stub
 * that refuses because somebody taught it the rule would prove only that the
 * rule was written twice. So this runs against PostgreSQL.
 *
 * With `REQUIRE_DATABASE` set — which `db:verify:fresh` and CI both do — an
 * unreachable database fails rather than skips.
 *
 * ## Only this suite's messages
 *
 * The database is shared. `pnpm verify:tests:fresh` and `pnpm test:coverage`
 * run every package's tests at once against one `TEST_DATABASE_URL`, and CI
 * runs both, one after the other, on the same database. The API suite writes
 * outbox messages that are due at once — refund, cancellation and change
 * notices — and leaves hundreds of them behind. A claim here takes the oldest
 * due message in the table, so this suite used to take the API's messages
 * instead of its own (eight cases failed whenever the two overlapped, or the
 * API had run first), and its clean-up drains sent the API's messages while
 * the API suite was still reading them.
 *
 * So the dispatcher is handed {@link outbox}: the same client, with every
 * outbox read and write the dispatcher makes narrowed to the messages this run
 * wrote. The dispatcher's own code and SQL are unchanged; nothing it does can
 * reach a row another suite wrote, and no assertion below is weaker for it —
 * "the queue is empty" now means this suite's part of it, which is the only
 * part a shared database lets it own.
 *
 * @module @desi-event/worker/outbox/dispatcher.test
 */

import { afterAll, describe, expect, it } from 'vitest'

import { createPrismaClient } from '@desi-event/db'
import { FAILURE_CATEGORIES, OUTBOX_STATES, dedupeKeyFor } from '@desi-event/notifications'
import { ProviderError, PROVIDER_ERROR_CODES } from '@desi-event/providers'

import {
  classifyFailure,
  claimOne,
  dispatchOne,
  drainOutbox,
  recordFailure,
  recordSent,
  redactFailure,
} from './dispatcher.js'

const CONNECTION =
  process.env.TEST_DATABASE_URL ??
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public'

/**
 * Whether a build has declared the database is not optional.
 *
 * @returns {boolean} True when `REQUIRE_DATABASE` is set to anything truthy.
 */
function databaseIsRequired() {
  const flag = process.env.REQUIRE_DATABASE

  return flag !== undefined && flag !== '' && flag !== '0' && flag.toLowerCase() !== 'false'
}

const prisma = createPrismaClient({ connectionString: CONNECTION })
const reachable = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false)

if (!reachable) {
  const where = CONNECTION.replace(/:[^:@/]*@/, ':***@')

  if (databaseIsRequired()) {
    throw new Error(
      `the outbox dispatcher suite needs PostgreSQL and ${where} is unreachable. ` +
        'REQUIRE_DATABASE is set, so this is a failure rather than a skip.',
    )
  }

  console.warn(`[worker] skipping the outbox dispatcher suite: ${where} is unreachable`)
}

/** A suffix unique to this run, so two runs cannot collide. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** How every message this run writes begins its business event. */
const MINE = `event.cancelled:evt-${RUN}-`

/** The dispatcher's outbox queries that pick rows by condition rather than by id. */
const SCOPED = Object.freeze(['findFirst', 'findMany', 'updateMany', 'count'])

/**
 * The client the dispatcher is handed: `prisma`, with every outbox query in
 * {@link SCOPED} narrowed to this run's messages. See the module comment.
 *
 * @type {object}
 */
const outbox = prisma.$extends({
  query: {
    notificationOutbox: Object.fromEntries(
      SCOPED.map((operation) => [
        operation,
        ({ args, query }) =>
          query({
            ...args,
            where: { AND: [args?.where ?? {}, { businessEvent: { startsWith: MINE } }] },
          }),
      ]),
    ),
  },
})

let sequence = 0

/**
 * Write one queued message.
 *
 * @param {object} [overrides] Columns to override.
 * @returns {Promise<object>} The created row.
 */
async function queueMessage(overrides = {}) {
  sequence += 1

  return prisma.notificationOutbox.create({
    data: {
      template: 'event.cancelled',
      channel: 'EMAIL',
      recipient: `outbox-${RUN}-${sequence}@desi-event.example`,
      payload: { eventTitle: 'A Night of Ragas', orderReference: `DE-${RUN}` },
      businessEvent: `event.cancelled:evt-${RUN}-${sequence}`,
      dedupeKey: dedupeKeyFor({
        businessEvent: `event.cancelled:evt-${RUN}-${sequence}`,
        recipient: `outbox-${RUN}-${sequence}@desi-event.example`,
        channel: 'EMAIL',
      }),
      scheduledFor: new Date(Date.now() - 1000),
      suppressible: false,
      ...overrides,
    },
  })
}

/**
 * A provider that records what it was asked to send.
 *
 * @param {object} [behaviour] How it behaves.
 * @param {Error} [behaviour.failWith] Throw this instead of sending.
 * @returns {object} A registry shaped like the real one.
 */
function recordingProvider({ failWith } = {}) {
  const sent = []

  return {
    sent,
    email: {
      name: 'recording',
      /**
       * Accept or refuse one message.
       *
       * @param {object} message The rendered message.
       * @returns {object} A receipt.
       */
      send(message) {
        if (failWith) throw failWith

        sent.push(message)

        return { id: `msg-${sent.length}` }
      },
    },
  }
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => {})
})

/** `describe` when the database answered, `describe.skip` when it did not. */
const when = () => (reachable ? describe : describe.skip)

when()('claiming', () => {
  it('takes a lease naming the worker that holds it', async () => {
    // Drained first, because this database is not reset between runs and a
    // leftover row from a previous one would be claimed instead of this one.
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    const queued = await queueMessage()
    const now = new Date()

    const claimed = await claimOne(outbox, { workerId: `worker-a-${RUN}`, now })

    expect(claimed).not.toBeNull()
    expect(claimed.id).toBe(queued.id)
    expect(claimed.status).toBe(OUTBOX_STATES.CLAIMED)
    expect(claimed.leaseOwner).toBe(`worker-a-${RUN}`)
    expect(claimed.leaseExpiresAt.getTime()).toBeGreaterThan(now.getTime())
    expect(claimed.attempts).toBe(queued.attempts + 1)
  })

  it('hands one message to exactly one of two workers racing for it', async () => {
    // Clear the field first, so the two claims below can only be contending
    // for the row this test wrote.
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    const queued = await queueMessage()
    const now = new Date()

    const results = await Promise.all([
      claimOne(outbox, { workerId: `race-a-${RUN}`, now }),
      claimOne(outbox, { workerId: `race-b-${RUN}`, now }),
    ])

    const winners = results.filter(Boolean).filter((row) => row.id === queued.id)

    expect(winners).toHaveLength(1)

    const after = await prisma.notificationOutbox.findUnique({ where: { id: queued.id } })

    expect(after.attempts).toBe(1)
    expect([`race-a-${RUN}`, `race-b-${RUN}`]).toContain(after.leaseOwner)
  })

  it('does not offer a message that is not due yet', async () => {
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    const future = await queueMessage({ scheduledFor: new Date(Date.now() + 3_600_000) })
    const claimed = await claimOne(outbox, { workerId: `early-${RUN}`, now: new Date() })

    expect(claimed?.id).not.toBe(future.id)
  })

  it('recovers a message whose lease lapsed, without calling it a failure', async () => {
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    const queued = await queueMessage()

    await claimOne(outbox, { workerId: `dead-${RUN}`, now: new Date(), leaseMs: -1000 })

    const recovered = await claimOne(outbox, { workerId: `alive-${RUN}`, now: new Date() })

    expect(recovered.id).toBe(queued.id)
    expect(recovered.leaseOwner).toBe(`alive-${RUN}`)
    // Two attempts, because two workers genuinely attempted it. Neither was a
    // failure, and neither is recorded as one.
    expect(recovered.attempts).toBe(2)
    expect(recovered.failureCategory).toBeNull()
  })

  it('leaves a message another suite wrote alone, even one due before its own', async () => {
    // What the API suite leaves in the shared database: a notice that has been
    // due for a while. Oldest first is how a claim picks, so a claim that could
    // see it would take it.
    const theirs = await prisma.notificationOutbox.create({
      data: {
        template: 'event.cancelled',
        channel: 'EMAIL',
        recipient: `api-suite-${RUN}@desi-event.example`,
        payload: { eventTitle: 'Another suite’s event', orderReference: `DE-API-${RUN}` },
        businessEvent: `event.cancelled:api-${RUN}`,
        dedupeKey: dedupeKeyFor({
          businessEvent: `event.cancelled:api-${RUN}`,
          recipient: `api-suite-${RUN}@desi-event.example`,
          channel: 'EMAIL',
        }),
        scheduledFor: new Date(Date.now() - 86_400_000),
        suppressible: false,
      },
    })

    try {
      await drainOutbox({
        prisma: outbox,
        providers: recordingProvider(),
        workerId: `drain-${RUN}`,
      })

      const queued = await queueMessage()
      const claimed = await claimOne(outbox, { workerId: `own-${RUN}`, now: new Date() })

      expect(claimed.id).toBe(queued.id)

      const untouched = await prisma.notificationOutbox.findUnique({ where: { id: theirs.id } })

      expect(untouched.status).toBe(OUTBOX_STATES.QUEUED)
      expect(untouched.attempts).toBe(0)
      expect(untouched.leaseOwner).toBeNull()
    } finally {
      // Not left due behind this suite for whatever drains the database next.
      await prisma.notificationOutbox.update({
        where: { id: theirs.id },
        data: { status: OUTBOX_STATES.CANCELLED },
      })
    }
  })

  it('refuses a duplicate of a message already queued', async () => {
    const first = await queueMessage()

    await expect(
      prisma.notificationOutbox.create({
        data: {
          template: first.template,
          channel: first.channel,
          recipient: first.recipient,
          payload: first.payload,
          dedupeKey: first.dedupeKey,
        },
      }),
    ).rejects.toThrow(/Unique constraint/i)
  })
})

when()('sending', () => {
  it('records the send and clears the lease', async () => {
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    const queued = await queueMessage()
    const providers = recordingProvider()

    const result = await dispatchOne({ prisma: outbox, providers, workerId: `send-${RUN}` })

    expect(result).toMatchObject({ claimed: true, sent: true, id: queued.id })

    const after = await prisma.notificationOutbox.findUnique({ where: { id: queued.id } })

    expect(after.status).toBe(OUTBOX_STATES.SENT)
    expect(after.sentAt).toBeInstanceOf(Date)
    expect(after.leaseOwner).toBeNull()
    expect(after.leaseExpiresAt).toBeNull()
    expect(after.providerMessageId).toBe('msg-1')
  })

  it('hands the provider a rendered message and its dedupe key', async () => {
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    const queued = await queueMessage()
    const providers = recordingProvider()

    await dispatchOne({ prisma: outbox, providers, workerId: `render-${RUN}` })

    expect(providers.sent).toHaveLength(1)
    expect(providers.sent[0].to).toBe(queued.recipient)
    expect(providers.sent[0].subject).toContain('A Night of Ragas')
    // The idempotency key is what collapses the duplicate a crash between the
    // send and the acknowledgement would otherwise produce.
    expect(providers.sent[0].idempotencyKey).toBe(queued.dedupeKey)
  })

  it('says it is a mock, in the subject, where it cannot be scrolled past', async () => {
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    await queueMessage()
    const providers = recordingProvider()

    await dispatchOne({ prisma: outbox, providers, workerId: `demo-${RUN}` })

    expect(providers.sent[0].subject).toMatch(/\[.*\]/)
    expect(providers.sent[0].text.toLowerCase()).toContain('no money')
  })

  it('does nothing when the queue is empty', async () => {
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    const result = await dispatchOne({
      prisma: outbox,
      providers: recordingProvider(),
      workerId: `idle-${RUN}`,
    })

    expect(result).toEqual({ claimed: false, sent: false, status: null, id: null })
  })
})

when()('failing', () => {
  it('schedules a retry for a transient failure', async () => {
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    const queued = await queueMessage()
    const providers = recordingProvider({
      failWith: new ProviderError(PROVIDER_ERROR_CODES.SEND_FAILED, 'the gateway timed out', {
        provider: 'recording',
      }),
    })

    const result = await dispatchOne({ prisma: outbox, providers, workerId: `transient-${RUN}` })

    expect(result.status).toBe(OUTBOX_STATES.RETRY_SCHEDULED)

    const after = await prisma.notificationOutbox.findUnique({ where: { id: queued.id } })

    expect(after.status).toBe(OUTBOX_STATES.RETRY_SCHEDULED)
    expect(after.failureCategory).toBe(FAILURE_CATEGORIES.TRANSIENT)
    expect(after.scheduledFor.getTime()).toBeGreaterThan(queued.scheduledFor.getTime())
    expect(after.leaseOwner).toBeNull()
  })

  it('dead-letters a permanent failure without burning the attempts', async () => {
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    const queued = await queueMessage()
    const providers = recordingProvider({
      failWith: new ProviderError(
        PROVIDER_ERROR_CODES.INVALID_RECIPIENT,
        'that address does not exist',
        { provider: 'recording' },
      ),
    })

    await dispatchOne({ prisma: outbox, providers, workerId: `permanent-${RUN}` })

    const after = await prisma.notificationOutbox.findUnique({ where: { id: queued.id } })

    expect(after.status).toBe(OUTBOX_STATES.DEAD_LETTER)
    expect(after.failureCategory).toBe(FAILURE_CATEGORIES.PERMANENT)
    expect(after.attempts).toBe(1)
  })

  it('dead-letters a template nothing can render', async () => {
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    const queued = await queueMessage({ template: 'event.imaginary' })

    await dispatchOne({
      prisma: outbox,
      providers: recordingProvider(),
      workerId: `unknown-${RUN}`,
    })

    const after = await prisma.notificationOutbox.findUnique({ where: { id: queued.id } })

    expect(after.status).toBe(OUTBOX_STATES.DEAD_LETTER)
    expect(after.failureCategory).toBe(FAILURE_CATEGORIES.PERMANENT)
  })

  it('dead-letters a transient failure once the attempts are spent', async () => {
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    const queued = await queueMessage({ maxAttempts: 1 })
    const providers = recordingProvider({
      failWith: new ProviderError(PROVIDER_ERROR_CODES.SEND_FAILED, 'still down', {
        provider: 'recording',
      }),
    })

    await dispatchOne({ prisma: outbox, providers, workerId: `spent-${RUN}` })

    const after = await prisma.notificationOutbox.findUnique({ where: { id: queued.id } })

    expect(after.status).toBe(OUTBOX_STATES.DEAD_LETTER)
  })

  it('keeps no address in the recorded error', async () => {
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    const queued = await queueMessage()
    const providers = recordingProvider({
      failWith: new ProviderError(
        PROVIDER_ERROR_CODES.SEND_FAILED,
        `mailbox ${queued.recipient} rejected the message`,
        { provider: 'recording' },
      ),
    })

    await dispatchOne({ prisma: outbox, providers, workerId: `redact-${RUN}` })

    const after = await prisma.notificationOutbox.findUnique({ where: { id: queued.id } })

    expect(after.lastError).not.toContain(queued.recipient)
    expect(after.lastError).toContain('[address]')
    expect(after.lastError.length).toBeLessThanOrEqual(300)
  })
})

when()('a worker whose lease was taken', () => {
  it('cannot record a send over the new owner', async () => {
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    const queued = await queueMessage()

    const mine = await claimOne(outbox, { workerId: `slow-${RUN}`, now: new Date(), leaseMs: -1 })

    await claimOne(outbox, { workerId: `fast-${RUN}`, now: new Date() })

    const applied = await recordSent(outbox, {
      row: mine,
      workerId: `slow-${RUN}`,
      providerMessageId: 'msg-late',
      now: new Date(),
    })

    expect(applied).toBe(false)

    const after = await prisma.notificationOutbox.findUnique({ where: { id: queued.id } })

    expect(after.status).toBe(OUTBOX_STATES.CLAIMED)
    expect(after.leaseOwner).toBe(`fast-${RUN}`)
  })

  it('cannot record a failure over the new owner either', async () => {
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    const queued = await queueMessage()
    const mine = await claimOne(outbox, { workerId: `slow2-${RUN}`, now: new Date(), leaseMs: -1 })

    await claimOne(outbox, { workerId: `fast2-${RUN}`, now: new Date() })

    const { applied } = await recordFailure(outbox, {
      row: mine,
      workerId: `slow2-${RUN}`,
      error: new Error('too late'),
      now: new Date(),
    })

    expect(applied).toBe(false)
    expect((await prisma.notificationOutbox.findUnique({ where: { id: queued.id } })).status).toBe(
      OUTBOX_STATES.CLAIMED,
    )
  })
})

when()('draining', () => {
  it('sends everything that is due and then stops', async () => {
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    await queueMessage()
    await queueMessage()
    await queueMessage()

    const providers = recordingProvider()
    const summary = await drainOutbox({ prisma: outbox, providers, workerId: `batch-${RUN}` })

    expect(summary).toEqual({ claimed: 3, sent: 3, failed: 0 })
    expect(providers.sent).toHaveLength(3)
  })

  it('stops at the limit rather than running forever behind a backlog', async () => {
    await drainOutbox({ prisma: outbox, providers: recordingProvider(), workerId: `drain-${RUN}` })

    await queueMessage()
    await queueMessage()

    const summary = await drainOutbox({
      prisma: outbox,
      providers: recordingProvider(),
      workerId: `limited-${RUN}`,
      limit: 1,
    })

    expect(summary.claimed).toBe(1)
  })
})

describe('classifying and redacting, without a database', () => {
  it('calls an unusable address permanent', () => {
    const error = new ProviderError(PROVIDER_ERROR_CODES.INVALID_RECIPIENT, 'no such mailbox', {
      provider: 'x',
    })

    expect(classifyFailure(error)).toBe(FAILURE_CATEGORIES.PERMANENT)
  })

  it('calls anything unrecognised transient, which is the safer default', () => {
    expect(classifyFailure(new Error('who knows'))).toBe(FAILURE_CATEGORIES.TRANSIENT)
    expect(classifyFailure(undefined)).toBe(FAILURE_CATEGORIES.TRANSIENT)
  })

  it('strips addresses out of a failure before it is stored', () => {
    const redacted = redactFailure(new Error('could not reach priya.sharma+tickets@example.co.in'))

    expect(redacted).not.toContain('priya')
    expect(redacted).toContain('[address]')
  })

  it('truncates a failure rather than storing a payload dump', () => {
    const redacted = redactFailure(new Error('x'.repeat(5000)))

    expect(redacted.length).toBeLessThanOrEqual(300)
  })
})
