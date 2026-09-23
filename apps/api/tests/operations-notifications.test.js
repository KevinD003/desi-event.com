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
 *     capability there is still cannot see it, and neither can a platform role
 *     that does not hold `reconciliation:manage`.
 *   - Requeue and cancel are conditional on the state they were decided
 *     against, so two operators pressing the same button produce one change.
 *
 * @module @desi-event/api/tests/operations-notifications
 */

import { describe, expect, it } from 'vitest'

import { apiRoutes } from '@desi-event/api-contract'
import { OUTBOX_STATES, dedupeKeyFor } from '@desi-event/notifications'
import {
  CAPABILITIES,
  PLATFORM_ROLE_CAPABILITIES,
  PLATFORM_ROLE_ORDER,
} from '@desi-event/permissions'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { makeWorld } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/** The address every fixture message goes to. */
const RECIPIENT = 'priya.sharma@example.com'

/**
 * The address of the account {@link worldWithMessage} seeds for a platform role.
 *
 * @param {string} role A platform `UserRole`.
 * @returns {string} The address.
 */
function platformEmail(role) {
  return `${role.toLowerCase().replaceAll('_', '-')}@platform.example`
}

/**
 * A world holding one outbox row.
 *
 * @param {object} [overrides] Columns to override on the row.
 * @param {object} [options] Options.
 * @param {string} [options.platformRole] Also seed an account holding this platform role, at {@link platformEmail}.
 * @returns {Promise<object>} The harness plus the row's id.
 */
async function worldWithMessage(overrides = {}, { platformRole } = {}) {
  const world = await makeWorld()
  const { seed, ids } = world
  const id = cuid()

  if (platformRole) {
    // Copied from the attendee, who belongs to no organisation, so the
    // platform role is the only authority the account holds.
    const template = seed.user.find((row) => row.email === 'priya@example.com')

    seed.user.push({
      ...template,
      id: cuid(),
      email: platformEmail(platformRole),
      displayName: `Platform ${platformRole}`,
      role: platformRole,
    })
  }

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

/** The owner of the fixture world's other organisation. */
const RIVAL = 'rival@dhol.example'

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
    expect(response.json().error.code).toBe('FORBIDDEN')

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

  it('refuses a message a worker holds, with its lease left alone', async () => {
    // The defect: retry accepted CLAIMED, wiped the lease, and let a second
    // worker send the same message. The race itself is proved against real
    // PostgreSQL in notification-lease-integration.test.js.
    const leaseExpiresAt = new Date(Date.now() + 60_000)
    const { app, prisma, messageId } = await worldWithMessage({
      status: OUTBOX_STATES.CLAIMED,
      leaseOwner: 'worker-7',
      leaseExpiresAt,
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/notifications/${messageId}/retry`,
      headers: await asOperator(app),
      payload: { reason: 'looks stuck to me' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.reason).toBe('LEASED')
    expect(prisma._store.notificationOutbox[0]).toMatchObject({
      status: 'CLAIMED',
      leaseOwner: 'worker-7',
      leaseExpiresAt,
    })

    await app.close()
  })

  it('is closed to an organiser, even the owner of the organisation the message is about', async () => {
    const world = await worldWithMessage()

    world.prisma._store.notificationOutbox[0].organizationId = world.ids.organization.id

    const response = await world.app.inject({
      method: 'POST',
      url: `/v1/operations/notifications/${world.messageId}/retry`,
      headers: bearer(await signIn(world.app, 'owner@rangoli.example')),
      payload: { reason: 'our own message' },
    })

    // Platform-only by design: reconciliation:manage cannot be granted by any
    // organisation role, and a module-load check refuses a table that tries.
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('FORBIDDEN')
    expect(world.prisma._store.notificationOutbox[0].status).toBe('DEAD_LETTER')

    await world.app.close()
  })

  it('is closed to a member of another organisation, even with a fresh second factor', async () => {
    const world = await worldWithMessage()

    world.prisma._store.notificationOutbox[0].organizationId = world.ids.organization.id

    const headers = bearer(await signIn(world.app, RIVAL))

    // Stepped up, so what refuses is the capability and not a missing factor.
    await stepUp(world.app, RIVAL, headers)

    const response = await world.app.inject({
      method: 'POST',
      url: `/v1/operations/notifications/${world.messageId}/retry`,
      headers,
      payload: { reason: 'not ours, but let us try' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('FORBIDDEN')
    expect(world.prisma._store.notificationOutbox[0].status).toBe('DEAD_LETTER')

    await world.app.close()
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
    expect(response.json().error.code).toBe('FORBIDDEN')

    await app.close()
  })

  it('is closed to a member of another organisation, even with a fresh second factor', async () => {
    const world = await worldWithMessage()

    world.prisma._store.notificationOutbox[0].organizationId = world.ids.organization.id

    const headers = bearer(await signIn(world.app, RIVAL))

    await stepUp(world.app, RIVAL, headers)

    const response = await world.app.inject({
      method: 'POST',
      url: `/v1/operations/notifications/${world.messageId}/cancel`,
      headers,
      payload: { reason: 'not ours to cancel' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('FORBIDDEN')
    expect(world.prisma._store.notificationOutbox[0].status).toBe('DEAD_LETTER')

    await world.app.close()
  })
})

describe('retry and cancel, by platform role', () => {
  // Split by the permissions package rather than listed here, so the two tables
  // below follow the capability table. The first case pins the roles that must
  // stay on each side: SUPPORT and MODERATOR refused, SUPER_ADMIN allowed. A
  // role moving silently otherwise is caught by the platform matrix in
  // packages/permissions/src/can.test.js.
  const capability = CAPABILITIES.RECONCILIATION_MANAGE
  const holds = (role) => PLATFORM_ROLE_CAPABILITIES[role].includes(capability)
  const refused = PLATFORM_ROLE_ORDER.filter((role) => !holds(role))
  const allowed = PLATFORM_ROLE_ORDER.filter(holds)
  const actions = ['retry', 'cancel']
  const cases = (roles) => roles.flatMap((role) => actions.map((action) => [role, action]))

  it('has a role on each side of the split, so neither table below is empty', () => {
    expect(refused).toEqual(expect.arrayContaining(['SUPPORT', 'MODERATOR']))
    expect(allowed).toContain('SUPER_ADMIN')
  })

  it.each(cases(refused))('refuses %s to %s', async (role, action) => {
    const { app, prisma, enrolled, messageId } = await worldWithMessage({}, { platformRole: role })
    const email = platformEmail(role)
    const headers = bearer(await signIn(app, email))

    // Stepped up where the role has a factor to do it with, so what refuses is
    // the capability and not a missing step-up.
    if (enrolled.has(email)) await stepUp(app, email, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/notifications/${messageId}/${action}`,
      headers,
      payload: { reason: 'my role says I may' },
    })

    expect(response.statusCode, response.body).toBe(403)
    expect(response.json().error.code).toBe('FORBIDDEN')
    expect(prisma._store.notificationOutbox[0].status).toBe('DEAD_LETTER')

    await app.close()
  })

  it.each(cases(allowed))('allows %s to %s', async (role, action) => {
    const { app, prisma, messageId } = await worldWithMessage({}, { platformRole: role })
    const email = platformEmail(role)
    const headers = bearer(await signIn(app, email))

    await stepUp(app, email, headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/operations/notifications/${messageId}/${action}`,
      headers,
      payload: { reason: 'the mail gateway is back' },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(prisma._store.notificationOutbox[0].status).toBe(
      action === 'retry' ? OUTBOX_STATES.QUEUED : OUTBOX_STATES.CANCELLED,
    )

    await app.close()
  })
})
