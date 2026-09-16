/**
 * The notification operations queue, from the outside.
 *
 * Three properties are worth a request rather than a unit test, because they
 * are about what crosses the wire and who is allowed to ask:
 *
 *   - An operator sees a status and never a payload. The presenter drops both
 *     the body and the address; these check that no layer between it and the
 *     response puts either back.
 *   - The queue is platform-scoped. An organiser with every organisation
 *     capability there is still cannot see it.
 *   - Requeue and cancel are conditional on the state they were decided
 *     against, so two operators pressing the same button produce one change.
 *
 * @module @desi-event/api/tests/operations-notifications
 */

import { describe, expect, it } from 'vitest'

import { apiRoutes } from '@desi-event/api-contract'
import { OUTBOX_STATES, dedupeKeyFor } from '@desi-event/notifications'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { makeWorld } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/** The address every fixture message goes to. */
const RECIPIENT = 'priya.sharma@example.com'

/**
 * A world holding one outbox row.
 *
 * @param {object} [overrides] Columns to override on the row.
 * @returns {Promise<object>} The harness plus the row's id.
 */
async function worldWithMessage(overrides = {}) {
  const world = await makeWorld()
  const { seed, ids } = world
  const id = cuid()

  seed.notificationOutbox = [
    {
      id,
      template: 'event.cancelled',
      channel: 'EMAIL',
      recipient: RECIPIENT,
      userId: null,
      payload: { eventTitle: 'A Night of Ragas', secretNote: 'never-shown-to-an-operator' },
      businessEvent: `event.cancelled:${ids.publishedEvent.id}`,
      templateVersion: 1,
      status: OUTBOX_STATES.DEAD_LETTER,
      dedupeKey: dedupeKeyFor({
        businessEvent: `event.cancelled:${ids.publishedEvent.id}`,
        recipient: RECIPIENT,
        channel: 'EMAIL',
      }),
      attempts: 5,
      maxAttempts: 5,
      scheduledFor: new Date('2026-09-16T10:00:00Z'),
      sentAt: null,
      lastAttemptAt: new Date('2026-09-16T10:05:00Z'),
      failureCategory: 'TRANSIENT',
      lastError: 'SEND_FAILED: the gateway would not answer',
      leaseOwner: null,
      leaseExpiresAt: null,
      providerMessageId: null,
      organizationId: null,
      suppressible: false,
      createdAt: new Date('2026-09-16T09:00:00Z'),
      updatedAt: new Date('2026-09-16T10:05:00Z'),
      ...overrides,
    },
  ]

  const harness = await createTestApp({ seed, ids })

  return { ...harness, messageId: id }
}

/** The platform operations account in the shared fixture world. */
const OPERATOR = 'ops@desi-event.example'

/**
 * Sign in as the platform operator and step up.
 *
 * Through the challenge rather than around it: a test that skipped the second
 * factor would be testing a system nobody runs.
 *
 * @param {object} app The Fastify instance.
 * @returns {Promise<object>} Bearer headers with a fresh step-up.
 */
async function asOperator(app) {
  const token = await signIn(app, OPERATOR)
  const headers = bearer(token)

  await stepUp(app, OPERATOR, headers)

  return headers
}

describe('GET /v1/operations/notifications', () => {
  it('lists what the outbox is holding', async () => {
    const { app, messageId } = await worldWithMessage()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/operations/notifications',
      headers: await asOperator(app),
    })

    expect(response.statusCode, response.body).toBe(200)

    const { data, pagination } = response.json()

    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({
      id: messageId,
      template: 'event.cancelled',
      status: OUTBOX_STATES.DEAD_LETTER,
      attempts: 5,
      failureCategory: 'TRANSIENT',
    })
    expect(pagination.total).toBe(1)

    await app.close()
  })

  it('masks the recipient and never returns the payload', async () => {
    const { app } = await worldWithMessage()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/operations/notifications',
      headers: await asOperator(app),
    })

    expect(response.body).not.toContain(RECIPIENT)
    expect(response.body).not.toContain('never-shown-to-an-operator')
    expect(response.body).not.toContain('secretNote')
    // The dedupe key carries the address, so it is not returned either.
    expect(response.body).not.toContain('priya.sharma')
    expect(response.json().data[0].recipientMasked).toBe('p**********a@example.com')

    await app.close()
  })

  it('narrows by status', async () => {
    const { app } = await worldWithMessage()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/operations/notifications?status=SENT',
      headers: await asOperator(app),
    })

    expect(response.json().data).toHaveLength(0)

    await app.close()
  })

  it('is closed to an organiser, however senior', async () => {
    const { app } = await worldWithMessage()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/operations/notifications',
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('is closed to an anonymous caller', async () => {
    const { app } = await worldWithMessage()

    const response = await app.inject({ method: 'GET', url: '/v1/operations/notifications' })

    expect(response.statusCode).toBe(401)

    await app.close()
  })
})

describe('GET /v1/operations/notifications/:id', () => {
  it('shows one message, redacted the same way', async () => {
    const { app, messageId } = await worldWithMessage()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/operations/notifications/${messageId}`,
      headers: await asOperator(app),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.lastError).toContain('SEND_FAILED')
    expect(response.body).not.toContain(RECIPIENT)

    await app.close()
  })

  it('answers 404 for a message that is not there', async () => {
    const { app } = await worldWithMessage()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/operations/notifications/${cuid()}`,
      headers: await asOperator(app),
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })
})

describe('POST /v1/operations/notifications/:id/retry', () => {
  it('puts a dead letter back in the queue, due now, with its attempts reset', async () => {
    const { app, prisma, messageId } = await worldWithMessage()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/notifications/${messageId}/retry`,
      headers: await asOperator(app),
      payload: { reason: 'the mail gateway is back' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.status).toBe(OUTBOX_STATES.QUEUED)

    const row = await prisma.notificationOutbox.findUnique({ where: { id: messageId } })

    expect(row.status).toBe(OUTBOX_STATES.QUEUED)
    expect(row.attempts).toBe(0)
    expect(row.failureCategory).toBeNull()

    await app.close()
  })

  it('records who did it and why', async () => {
    const { app, prisma, messageId } = await worldWithMessage()

    await app.inject({
      method: 'POST',
      url: `/v1/operations/notifications/${messageId}/retry`,
      headers: await asOperator(app),
      payload: { reason: 'the mail gateway is back' },
    })

    const audit = await prisma.auditLog.findMany({ where: { entityId: messageId } })

    expect(audit).toHaveLength(1)
    expect(audit[0].action).toBe('notification.requeued')
    expect(audit[0].metadata).toMatchObject({
      previousStatus: OUTBOX_STATES.DEAD_LETTER,
      newStatus: OUTBOX_STATES.QUEUED,
      reason: 'the mail gateway is back',
    })
    expect(audit[0].actorId).not.toBeNull()

    await app.close()
  })

  it('refuses to retry a message that was already sent', async () => {
    const { app, messageId } = await worldWithMessage({
      status: OUTBOX_STATES.SENT,
      sentAt: new Date('2026-09-16T10:06:00Z'),
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/notifications/${messageId}/retry`,
      headers: await asOperator(app),
      payload: { reason: 'wishful thinking' },
    })

    expect(response.statusCode).toBe(409)

    await app.close()
  })

  it('demands a reason', async () => {
    const { app, messageId } = await worldWithMessage()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/notifications/${messageId}/retry`,
      headers: await asOperator(app),
      payload: { reason: '' },
    })

    expect(response.statusCode).toBe(400)

    await app.close()
  })

  it('is declared to need a recent second factor', async () => {
    // Asserted against the contract rather than by making a request, because a
    // fixture account signs in *with* its second factor and is therefore
    // already inside the window. The thing worth pinning down is that the
    // route declares a policy at all, and which one: an omitted `stepUp` is
    // the failure mode, and it is invisible from a request that would have
    // passed either way.
    const route = apiRoutes.find((candidate) => candidate.id === 'notifications.retry')

    expect(route.stepUp).toBe('OPERATIONS')
    expect(route.capability).toBe('reconciliation:manage')
  })

  it('is declared to need a recent second factor to cancel, too', () => {
    const route = apiRoutes.find((candidate) => candidate.id === 'notifications.cancel')

    expect(route.stepUp).toBe('OPERATIONS')
    expect(route.capability).toBe('reconciliation:manage')
  })
})

describe('POST /v1/operations/notifications/:id/cancel', () => {
  it('withdraws a message that has not gone out', async () => {
    const { app, prisma, messageId } = await worldWithMessage({
      status: OUTBOX_STATES.QUEUED,
      attempts: 0,
      failureCategory: null,
      lastError: null,
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/notifications/${messageId}/cancel`,
      headers: await asOperator(app),
      payload: { reason: 'the organiser un-cancelled the event' },
    })

    expect(response.statusCode).toBe(200)
    expect((await prisma.notificationOutbox.findUnique({ where: { id: messageId } })).status).toBe(
      OUTBOX_STATES.CANCELLED,
    )

    await app.close()
  })

  it('refuses to withdraw one that was already sent', async () => {
    const { app, messageId } = await worldWithMessage({ status: OUTBOX_STATES.SENT })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/notifications/${messageId}/cancel`,
      headers: await asOperator(app),
      payload: { reason: 'too late' },
    })

    expect(response.statusCode).toBe(409)

    await app.close()
  })

  it('refuses while a worker still holds a live lease', async () => {
    const { app, messageId } = await worldWithMessage({
      status: OUTBOX_STATES.CLAIMED,
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/notifications/${messageId}/cancel`,
      headers: await asOperator(app),
      payload: { reason: 'mid-send' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/sending this message/i)

    await app.close()
  })

  it('allows it once the lease has lapsed, because nobody is holding it', async () => {
    const { app, messageId } = await worldWithMessage({
      status: OUTBOX_STATES.CLAIMED,
      leaseOwner: 'worker-that-died',
      leaseExpiresAt: new Date(Date.now() - 60_000),
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/notifications/${messageId}/cancel`,
      headers: await asOperator(app),
      payload: { reason: 'the worker died and this is no longer wanted' },
    })

    expect(response.statusCode).toBe(200)

    await app.close()
  })

  it('is closed to an organiser', async () => {
    const { app, messageId } = await worldWithMessage()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/notifications/${messageId}/cancel`,
      headers: bearer(token),
      payload: { reason: 'not mine to cancel' },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })
})
