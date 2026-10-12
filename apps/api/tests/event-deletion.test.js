import {
  PROVIDER_ERROR_CODES,
  ProviderError,
  createInMemoryProviderRegistry,
  createProviderRegistry,
} from '@desi-event/providers'
import { describe, expect, it } from 'vitest'

import { classifyDeletion, deletionAuthority } from '../src/lib/event-deletion.js'
import { approveRefund, requestRefund, submitRefund } from '../src/lib/refunds.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import {
  addRows,
  deletedEventFixture,
  makeWorld,
  minutesFromNow,
  threeNightEventFixture,
} from './helpers/fixtures.js'
import { seedPicture } from './helpers/media-world.js'
import { cuid } from './helpers/prisma-stub.js'

/**
 * Deleting an event (SPEC2-XI X-D): what deleting does is decided on the
 * server from what was sold, by whom, and again at commit.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc namepath.
 *
 * @file @desi-event/api/tests/event-deletion
 */

/** A reason long enough for every reason box. */
const REASON = 'The organiser called the whole season off.'

/** Facts for a pure classification: nothing sold, nothing moving. */
const NOTHING = Object.freeze({
  orders: 0,
  soldOrders: 0,
  refundableOrders: 0,
  refundableCents: 0,
  currency: null,
  disputedOrders: 0,
  zeroValueOrders: 0,
  partlyRefundedOrders: 0,
  pendingOrders: 0,
  inFlight: 0,
  paymentsInFlight: 0,
  activeHolds: 0,
  tickets: 0,
  checkIns: 0,
  nights: 1,
  everyNightCancelled: false,
  started: false,
  finished: false,
  archivedFrom: null,
})

/**
 * Sign in, and confirm a second factor when the account has one.
 *
 * @param {object} app The app.
 * @param {string} email Who.
 * @param {object} [options] Options.
 * @param {boolean} [options.step] Whether to step up.
 * @returns {Promise<object>} The request headers.
 */
async function as(app, email, { step = true } = {}) {
  const headers = bearer(await signIn(app, email))

  if (step) await stepUp(app, email, headers)

  return headers
}

/**
 * A delete request body for an event as it stands in the store.
 *
 * @param {object} event The event row.
 * @param {string} outcome The outcome expected.
 * @param {object} [extra] More fields.
 * @returns {object} The body.
 */
function body(event, outcome, extra = {}) {
  return {
    revision: event.revision ?? 0,
    reason: REASON,
    confirmSlug: event.slug,
    expectedOutcome: outcome,
    ...extra,
  }
}

/**
 * Put every seeded succeeded payment in front of the in-memory provider, as a
 * captured intent, so a refund of it can be sent: the fixtures write the rows
 * a settlement leaves, and the provider knows nothing of them otherwise.
 *
 * @param {object} harness `createTestApp()`'s result.
 * @returns {object} The harness.
 */
function backPayments(harness) {
  for (const payment of harness.prisma._store.payment) {
    if (payment.status !== 'SUCCEEDED') continue

    const intent = harness.providers.payments.createIntent({
      amountCents: payment.amountCents,
      currency: payment.currency,
      orderId: payment.orderId,
    })

    harness.providers.payments.capture(intent.id)
    payment.providerRef = intent.id
  }

  return harness
}

/**
 * The app with the three-night live event added.
 *
 * @param {object} [overrides] Event column overrides.
 * @param {function(object): void} [shape] Changes the fixture before it is seeded.
 * @param {object} [options] Options.
 * @param {object} [options.providers] A provider registry other than the in-memory default.
 * @returns {Promise<object>} The harness and the fixture.
 */
async function threeNightApp(overrides = {}, shape = () => {}, { providers } = {}) {
  const world = await makeWorld()
  const fixture = threeNightEventFixture(world.ids, { overrides })

  shape(fixture)
  addRows(world.seed, fixture.rows)

  const harness = backPayments(await createTestApp({ seed: world.seed, ids: world.ids, providers }))

  return { ...harness, fixture }
}

describe('classifyDeletion (the first matching case wins)', () => {
  const live = { status: 'ON_SALE' }

  it('refuses a deleted event, a payment in flight and paid orders a status cannot have', () => {
    expect(classifyDeletion({ status: 'DELETED' }, NOTHING).refusal.code).toBe('ALREADY_DELETED')
    expect(classifyDeletion(live, { ...NOTHING, inFlight: 1 }).refusal.code).toBe(
      'PAYMENT_IN_FLIGHT',
    )
    expect(classifyDeletion({ status: 'DRAFT' }, { ...NOTHING, soldOrders: 2 }).refusal.code).toBe(
      'UNEXPECTED_ORDERS',
    )
    expect(
      classifyDeletion({ status: 'ARCHIVED' }, { ...NOTHING, soldOrders: 2, archivedFrom: 'DRAFT' })
        .refusal.code,
    ).toBe('UNEXPECTED_ORDERS')
  })

  it('removes an unsold event whatever its status', () => {
    for (const status of ['DRAFT', 'ON_SALE', 'CANCELLED', 'COMPLETED', 'ARCHIVED']) {
      expect(classifyDeletion({ status }, NOTHING).outcome).toBe('REMOVE')
    }
  })

  it('refunds a sold cancelled or postponed event, and one not yet started', () => {
    const sold = { ...NOTHING, soldOrders: 3 }

    expect(classifyDeletion({ status: 'CANCELLED' }, sold).outcome).toBe('CANCEL_AND_REFUND')
    expect(classifyDeletion({ status: 'POSTPONED' }, sold).outcome).toBe('CANCEL_AND_REFUND')
    expect(classifyDeletion(live, sold).outcome).toBe('CANCEL_AND_REFUND')
    expect(classifyDeletion(live, { ...sold, nights: 0, everyNightCancelled: true }).outcome).toBe(
      'CANCEL_AND_REFUND',
    )
  })

  it('keeps the orders of an event that took place', () => {
    const sold = { ...NOTHING, soldOrders: 3 }

    expect(classifyDeletion({ status: 'COMPLETED' }, sold).outcome).toBe('REMOVE_AFTER_EVENT')
    expect(
      classifyDeletion({ status: 'ARCHIVED' }, { ...sold, archivedFrom: 'COMPLETED' }).outcome,
    ).toBe('REMOVE_AFTER_EVENT')
    expect(
      classifyDeletion(live, { ...sold, started: true, finished: true, checkIns: 4 }).outcome,
    ).toBe('REMOVE_AFTER_EVENT')
  })

  it('refuses a started multi-night event until its last night is over', () => {
    const decision = classifyDeletion(live, { ...NOTHING, soldOrders: 3, started: true })

    expect(decision.refusal.code).toBe('EVENT_IN_PROGRESS')
    expect(decision.refusal.message).toMatch(/Cancel the nights still to come/)
  })

  it('asks what happened to a finished event nobody was checked in at', () => {
    const decision = classifyDeletion(live, {
      ...NOTHING,
      soldOrders: 3,
      started: true,
      finished: true,
    })

    expect(decision).toEqual({
      outcome: null,
      refusal: null,
      choices: ['REMOVE_AFTER_EVENT', 'CANCEL_AND_REFUND'],
      needsTookPlaceConfirmation: true,
    })
  })
})

describe('deletionAuthority (X-9 matrix, membership first)', () => {
  it('gives an event manager the unsold deletion only, and an owner every outcome', async () => {
    const { ids } = await makeWorld()
    const memberOf = (role) => ({
      id: cuid(),
      role: 'ORGANIZER',
      memberships: [{ organizationId: ids.organization.id, role }],
    })
    const event = { organizationId: ids.organization.id }

    expect(deletionAuthority(memberOf('EVENT_MANAGER'), event, 'REMOVE')).toMatchObject({
      permitted: true,
      authority: 'ORGANIZATION',
    })
    expect(
      deletionAuthority(memberOf('MANAGER'), event, 'CANCEL_AND_REFUND', { refundableOrders: 12 }),
    ).toEqual({
      permitted: false,
      authority: null,
      missing:
        'Deleting this event refunds 12 paid orders, which an organisation administrator or owner decides. Ask one of them, or the Desi-Event team.',
    })
    expect(deletionAuthority(memberOf('OWNER'), event, 'CANCEL_AND_REFUND').permitted).toBe(true)
    expect(deletionAuthority(memberOf('ADMIN'), event, 'REMOVE_AFTER_EVENT').permitted).toBe(true)
    expect(deletionAuthority({ id: cuid(), role: 'ADMIN' }, event, 'CANCEL_AND_REFUND')).toEqual({
      permitted: true,
      missing: null,
      authority: 'PLATFORM',
    })
    expect(deletionAuthority({ id: cuid(), role: 'MODERATOR' }, event, 'REMOVE').permitted).toBe(
      false,
    )
  })
})

describe('GET /v1/events/:id/deletion', () => {
  it('answers the people who may delete, never cached, and 404 to everybody else', async () => {
    const { app, ids } = await createTestApp()
    const url = `/v1/events/${ids.publishedEvent.id}/deletion`

    const manager = await app.inject({
      method: 'GET',
      url,
      headers: await as(app, 'arun@rangoli.example', { step: false }),
    })

    expect(manager.statusCode).toBe(200)
    expect(manager.headers['cache-control']).toBe('no-store')
    expect(manager.json().data).toMatchObject({
      eventId: ids.publishedEvent.id,
      outcome: 'REMOVE',
      refusal: null,
      permitted: true,
      authority: 'ORGANIZATION',
      slug: { value: 'navratri-garba-night', keptRetired: true },
      paymentMode: 'MOCK',
    })

    const admin = await app.inject({
      method: 'GET',
      url,
      headers: await as(app, 'anil@desi-event.example', { step: false }),
    })

    expect(admin.json().data.authority).toBe('PLATFORM')

    for (const email of ['finance@rangoli.example', 'rival@dhol.example', 'door@rangoli.example']) {
      const refused = await app.inject({
        method: 'GET',
        url,
        headers: await as(app, email, { step: false }),
      })

      expect(refused.statusCode).toBe(404)
    }

    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)

    await app.close()
  })
})

describe('POST /v1/events/:id/delete — REMOVE', () => {
  it('needs a second factor within the EVENT_CANCEL window', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'arun@rangoli.example', { step: false })

    // The factor given at sign-in, moved back past the five-minute window.
    for (const session of prisma._store.session) {
      if (session.userId === ids.manager.id) {
        session.mfaSatisfiedAt = new Date(Date.now() - 6 * 60_000)
      }
    }

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/delete`,
      headers,
      payload: body(ids.draftEvent, 'REMOVE'),
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(prisma._store.event.find((row) => row.id === ids.draftEvent.id).status).toBe('DRAFT')

    await app.close()
  })

  it('takes an unsold draft off, releases its web address and writes its record', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/delete`,
      headers,
      payload: body(ids.draftEvent, 'REMOVE'),
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json().data.refunds).toBeNull()
    expect(response.json().data.event.deletion).toMatchObject({
      outcome: 'REMOVE',
      authority: 'ORGANIZATION',
      statusBefore: 'DRAFT',
      restoreTo: 'DRAFT',
      deletedByName: 'Arun Rao',
    })

    const row = prisma._store.event.find((event) => event.id === ids.draftEvent.id)

    expect(row).toMatchObject({
      status: 'DELETED',
      deletionOutcome: 'REMOVED',
      deletionAuthority: 'ORGANIZATION',
      statusBeforeDeletion: 'DRAFT',
      deletionReason: REASON,
      // Never public: the address is released, and kept to give back.
      slug: `deleted-${ids.draftEvent.id}`,
      deletedSlug: 'secret-bollywood-night',
    })

    const action = prisma._store.eventModerationAction.find(
      (entry) => entry.eventId === ids.draftEvent.id && entry.toStatus === 'DELETED',
    )

    expect(action).toMatchObject({ fromStatus: 'DRAFT', reason: REASON })

    const audit = prisma._store.auditLog.find(
      (entry) => entry.action === 'event.deleted' && entry.entityId === ids.draftEvent.id,
    )

    expect(audit.metadata).toMatchObject({
      from: 'DRAFT',
      outcome: 'REMOVE',
      authority: 'ORGANIZATION',
      reason: REASON,
      slugReleased: true,
    })

    // The released name can be used again.
    const again = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers,
      payload: {
        organizationId: ids.organization.id,
        venueId: ids.venue.id,
        title: 'Secret Bollywood Night',
        slug: 'secret-bollywood-night',
        summary: 'A short summary that is long enough to pass validation.',
        description: 'A description of the event, long enough to be plausible prose.',
        category: 'BOLLYWOOD_NIGHT',
        startsAt: minutesFromNow(60 * 24 * 30).toISOString(),
        endsAt: minutesFromNow(60 * 24 * 30 + 180).toISOString(),
        timezone: 'Asia/Kolkata',
      },
    })

    expect(again.statusCode).toBe(201)

    await app.close()
  })

  it('keeps a public web address retired, refuses it to a new event, and hides the event from strangers', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'arun@rangoli.example')
    const event = ids.publishedEvent

    const deleted = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/delete`,
      headers,
      payload: body(event, 'REMOVE'),
    })

    expect(deleted.statusCode).toBe(200)
    expect(prisma._store.event.find((row) => row.id === event.id).slug).toBe(event.slug)

    // Strangers: the 404 an unknown event gets, by slug and by id.
    expect((await app.inject({ method: 'GET', url: `/v1/events/${event.slug}` })).statusCode).toBe(
      404,
    )

    const buyer = await as(app, 'priya@example.com', { step: false })

    expect(
      (await app.inject({ method: 'GET', url: `/v1/events/${event.id}`, headers: buyer }))
        .statusCode,
    ).toBe(404)

    // Its team reads it, with its record.
    const insider = await app.inject({ method: 'GET', url: `/v1/events/${event.id}`, headers })

    expect(insider.statusCode).toBe(200)
    expect(insider.json().data.deletion).toMatchObject({
      outcome: 'REMOVE',
      statusBefore: 'PUBLISHED',
    })

    // Listed only when asked for by name, and only to its team.
    const listed = await app.inject({ method: 'GET', url: '/v1/events?perPage=100', headers })

    expect(listed.json().data.map((row) => row.id)).not.toContain(event.id)

    const deletedOnly = await app.inject({
      method: 'GET',
      url: '/v1/events?status=DELETED&perPage=100',
      headers,
    })

    expect(deletedOnly.json().data.map((row) => row.id)).toContain(event.id)

    const strangers = await app.inject({ method: 'GET', url: '/v1/events?status=DELETED' })

    expect(strangers.json().data).toEqual([])

    // The address stays retired.
    const reused = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers,
      payload: {
        organizationId: ids.organization.id,
        venueId: ids.venue.id,
        title: 'Another Garba Night',
        slug: event.slug,
        summary: 'A short summary that is long enough to pass validation.',
        description: 'A description of the event, long enough to be plausible prose.',
        category: 'GARBA_DANDIYA',
        startsAt: minutesFromNow(60 * 24 * 30).toISOString(),
        endsAt: minutesFromNow(60 * 24 * 30 + 180).toISOString(),
        timezone: 'Asia/Kolkata',
      },
    })

    expect(reused.statusCode).toBe(409)
    expect(reused.json().error.code).toBe('SLUG_RETIRED')

    // Nothing more may be written to it.
    const edit = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${event.id}`,
      headers,
      payload: {
        revision: prisma._store.event.find((row) => row.id === event.id).revision,
        title: 'x'.repeat(10),
      },
    })

    expect(edit.statusCode).toBe(409)
    expect(edit.json().error.message).toMatch(/deleted/)

    // A second delete is refused.
    const twice = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/delete`,
      headers,
      payload: body(
        prisma._store.event.find((row) => row.id === event.id),
        'REMOVE',
      ),
    })

    expect(twice.statusCode).toBe(409)
    expect(twice.json().error.code).toBe('ALREADY_DELETED')

    await app.close()
  })

  it('sells nothing afterwards and serves none of its pictures', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = ids.publishedEvent
    const cover = seedPicture(prisma, { event })
    const buyer = await as(app, 'priya@example.com', { step: false })

    prisma._store.event.find((row) => row.id === event.id).status = 'ON_SALE'

    // Served while the event stands.
    expect((await app.inject({ method: 'GET', url: `/v1/media/${cover.id}` })).statusCode).toBe(200)

    const deleted = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/delete`,
      headers: await as(app, 'arun@rangoli.example'),
      payload: body(
        prisma._store.event.find((row) => row.id === event.id),
        'REMOVE',
      ),
    })

    expect(deleted.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/v1/media/${cover.id}` })).statusCode).toBe(404)

    const held = await app.inject({
      method: 'POST',
      url: '/v1/holds',
      headers: buyer,
      payload: { ticketTypeId: ids.generalAdmission.id, quantity: 1 },
    })
    const ordered = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: buyer,
      payload: {
        eventId: event.id,
        buyerEmail: 'priya@example.com',
        buyerName: 'Priya',
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
      },
    })

    for (const refused of [held, ordered]) {
      expect(refused.statusCode).toBe(422)
      expect(refused.json().error.message).toBe('This event is not on sale.')
    }

    expect(prisma._store.order.filter((row) => row.eventId === event.id)).toEqual([])

    await app.close()
  })

  it('refuses a mistyped web address, a stale outcome and a stale revision, writing nothing', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'arun@rangoli.example')
    const url = `/v1/events/${ids.draftEvent.id}/delete`

    const typo = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: body(ids.draftEvent, 'REMOVE', { confirmSlug: 'secret-bollywood' }),
    })

    expect(typo.statusCode).toBe(422)
    expect(typo.json().error.code).toBe('CONFIRMATION_MISMATCH')

    // Typed in capitals with spaces round it: still the address.
    const outcome = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: body(ids.draftEvent, 'CANCEL_AND_REFUND', {
        confirmSlug: '  SECRET-BOLLYWOOD-NIGHT ',
      }),
    })

    expect(outcome.statusCode).toBe(409)
    expect(outcome.json().error.code).toBe('OUTCOME_CHANGED')

    const stale = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: body(ids.draftEvent, 'REMOVE', { revision: 7 }),
    })

    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('STALE_REVISION')
    expect(prisma._store.event.find((row) => row.id === ids.draftEvent.id).status).toBe('DRAFT')
    expect(prisma._store.auditLog.some((entry) => entry.action === 'event.deleted')).toBe(false)

    await app.close()
  })

  it('answers insiders who may not delete with a 403 and everybody else with a 404', async () => {
    const { app, ids } = await createTestApp()
    const url = `/v1/events/${ids.draftEvent.id}/delete`

    const viewer = await app.inject({
      method: 'POST',
      url,
      headers: await as(app, 'finance@rangoli.example', { step: false }),
      payload: body(ids.draftEvent, 'REMOVE'),
    })

    expect(viewer.statusCode).toBe(403)

    const moderator = await app.inject({
      method: 'POST',
      url,
      headers: await as(app, 'maya@desi-event.example'),
      payload: body(ids.draftEvent, 'REMOVE'),
    })

    expect(moderator.statusCode).toBe(403)

    const rival = await app.inject({
      method: 'POST',
      url,
      headers: await as(app, 'rival@dhol.example'),
      payload: body(ids.draftEvent, 'REMOVE'),
    })

    expect(rival.statusCode).toBe(404)

    await app.close()
  })

  it('lets the Desi-Event team delete any organisation’s event, recorded as theirs', async () => {
    const { app, prisma, ids } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.reviewPendingEvent.id}/delete`,
      headers: await as(app, 'anil@desi-event.example'),
      payload: body(ids.reviewPendingEvent, 'REMOVE'),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.event.deletion).toMatchObject({
      authority: 'PLATFORM',
      // Under review when deleted: a restore brings back a draft.
      restoreTo: 'DRAFT',
      deletedByName: 'Anil Administrator',
    })

    // The organiser reads it without the administrator's name.
    const owner = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.reviewPendingEvent.id}`,
      headers: await as(app, 'owner@rangoli.example', { step: false }),
    })

    expect(owner.json().data.deletion).toMatchObject({ authority: 'PLATFORM', deletedByName: null })
    expect(
      prisma._store.event.find((row) => row.id === ids.reviewPendingEvent.id).deletionAuthority,
    ).toBe('PLATFORM')

    await app.close()
  })

  it('releases the event’s holds and cancels the unpaid orders nobody is paying for', async () => {
    const world = await makeWorld()
    const hold = {
      id: cuid(),
      ticketTypeId: world.ids.generalAdmission.id,
      orderId: null,
      quantity: 2,
      status: 'ACTIVE',
      expiresAt: minutesFromNow(10),
      userId: world.ids.attendee.id,
      guestTokenHash: null,
      releasedAt: null,
      releasedBy: null,
      releaseReason: null,
      eventSessionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const pending = {
      id: cuid(),
      reference: 'DE-PEND01',
      idempotencyKey: null,
      eventId: world.ids.publishedEvent.id,
      eventSessionId: null,
      userId: world.ids.attendee.id,
      buyerEmail: world.ids.attendee.email,
      buyerName: world.ids.attendee.displayName,
      status: 'PENDING',
      currency: 'INR',
      subtotalCents: 1000,
      discountCents: 0,
      feesCents: 0,
      taxCents: 0,
      totalCents: 1000,
      promoCodeId: null,
      refundedCents: 0,
      refundPendingCents: 0,
      expiresAt: minutesFromNow(10),
      paidAt: null,
      cancelledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    addRows(world.seed, { ticketHold: [hold], order: [pending] })

    const { app, prisma, ids } = await createTestApp({ seed: world.seed, ids: world.ids })
    const headers = await as(app, 'arun@rangoli.example')

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/deletion`,
      headers,
    })

    expect(preview.json().data.counts).toMatchObject({ pendingOrders: 1, activeHolds: 1 })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/delete`,
      headers,
      payload: body(ids.publishedEvent, 'REMOVE'),
    })

    expect(response.statusCode).toBe(200)
    expect(prisma._store.ticketHold.find((row) => row.id === hold.id).status).toBe('RELEASED')
    expect(prisma._store.order.find((row) => row.id === pending.id).status).toBe('CANCELLED')

    await app.close()
  })

  it('cancels an unpaid order as a declined checkout is: promo use back, names cleared, audited', async () => {
    const { app, prisma, fixture } = await threeNightApp()
    const paid = prisma._store.order.find((row) => row.reference === 'DE-3N02')
    const line = prisma._store.orderItem.find((item) => item.orderId === paid.id)
    const promo = {
      id: cuid(),
      organizationId: fixture.event.organizationId,
      eventId: fixture.event.id,
      code: 'NIGHTS10',
      type: 'PERCENTAGE',
      value: 1000,
      currency: null,
      maxRedemptions: 1,
      redemptionCount: 1,
      startsAt: null,
      endsAt: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const unpaidId = cuid()
    const unpaidLine = cuid()

    prisma._store.promoCode.push(promo)
    prisma._store.order.push({
      ...paid,
      id: unpaidId,
      reference: 'DE-3NPEND',
      status: 'PENDING',
      promoCodeId: promo.id,
      paidAt: null,
      idempotencyKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    prisma._store.orderItem.push({
      ...line,
      id: unpaidLine,
      orderId: unpaidId,
      attendeeNames: ['Asha Patel'],
      refundedCents: 0,
      refundedQuantity: 0,
    })

    const event = prisma._store.event.find((row) => row.id === fixture.event.id)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/delete`,
      headers: await as(app, 'owner@rangoli.example'),
      payload: body(event, 'CANCEL_AND_REFUND'),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(prisma._store.order.find((row) => row.id === unpaidId).status).toBe('CANCELLED')
    // The limited code's one use comes back; the staged name goes.
    expect(promo.redemptionCount).toBe(0)
    expect(prisma._store.orderItem.find((row) => row.id === unpaidLine).attendeeNames).toEqual([])

    const audit = prisma._store.auditLog.find(
      (row) => row.action === 'order.cancelled' && row.entityId === unpaidId,
    )

    expect(audit.metadata).toMatchObject({
      previousStatus: 'PENDING',
      newStatus: 'CANCELLED',
      reason: 'EVENT_DELETED',
      promoRedemptionReturned: true,
    })

    await app.close()
  })

  it('refuses while a payment that succeeded has not yet been applied to its order', async () => {
    const world = await makeWorld()
    const order = {
      id: cuid(),
      reference: 'DE-FLIGHT1',
      idempotencyKey: null,
      eventId: world.ids.publishedEvent.id,
      eventSessionId: null,
      userId: world.ids.attendee.id,
      buyerEmail: world.ids.attendee.email,
      buyerName: world.ids.attendee.displayName,
      status: 'PENDING',
      currency: 'INR',
      subtotalCents: 1000,
      discountCents: 0,
      feesCents: 0,
      taxCents: 0,
      totalCents: 1000,
      promoCodeId: null,
      refundedCents: 0,
      refundPendingCents: 0,
      expiresAt: minutesFromNow(10),
      paidAt: null,
      cancelledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const payment = {
      id: cuid(),
      orderId: order.id,
      provider: 'in-memory-payments',
      providerRef: 'pi_flight1',
      status: 'SUCCEEDED',
      amountCents: 1000,
      currency: 'INR',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    addRows(world.seed, { order: [order], payment: [payment] })

    const { app, prisma, ids } = await createTestApp({ seed: world.seed, ids: world.ids })
    const headers = await as(app, 'arun@rangoli.example')

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/deletion`,
      headers,
    })

    expect(preview.json().data.refusal.code).toBe('PAYMENT_IN_FLIGHT')
    expect(preview.json().data.permitted).toBe(false)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/delete`,
      headers,
      payload: body(ids.publishedEvent, 'REMOVE'),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('PAYMENT_IN_FLIGHT')
    expect(prisma._store.event.find((row) => row.id === ids.publishedEvent.id).status).toBe(
      'PUBLISHED',
    )

    await app.close()
  })
})

describe('POST /v1/events/:id/delete — CANCEL_AND_REFUND', () => {
  it('refuses an event manager the refunds, and tells them who decides', async () => {
    const { app, fixture } = await threeNightApp()
    const headers = await as(app, 'arun@rangoli.example')

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${fixture.event.id}/deletion`,
      headers,
    })

    expect(preview.json().data).toMatchObject({
      outcome: 'CANCEL_AND_REFUND',
      permitted: false,
      authority: null,
      counts: { paidOrders: 4, refundableCents: 440_000, currency: 'INR' },
    })
    expect(preview.json().data.missing).toMatch(/refunds 4 paid orders/)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/delete`,
      headers,
      payload: body(fixture.event, 'CANCEL_AND_REFUND'),
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('REFUND_AUTHORITY_REQUIRED')

    await app.close()
  })

  it('cancels, refunds every paid order through the refund service and withdraws every ticket', async () => {
    const { app, prisma, fixture } = await threeNightApp()
    const headers = await as(app, 'owner@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/delete`,
      headers,
      payload: body(fixture.event, 'CANCEL_AND_REFUND'),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.refunds).toMatchObject({
      owed: 4,
      settled: 4,
      waiting: 0,
      failed: 0,
      disputed: 0,
      amountCents: 440_000,
      currency: 'INR',
    })

    const event = prisma._store.event.find((row) => row.id === fixture.event.id)

    expect(event).toMatchObject({
      status: 'DELETED',
      statusBeforeDeletion: 'CANCELLED',
      deletionOutcome: 'CANCELLED_AND_REFUNDED',
    })

    const moves = prisma._store.eventModerationAction
      .filter((entry) => entry.eventId === fixture.event.id)
      .map((entry) => `${entry.fromStatus}>${entry.toStatus}`)

    expect(moves).toEqual(['ON_SALE>CANCELLED', 'CANCELLED>DELETED'])

    for (const order of [...fixture.orders, fixture.passOrder]) {
      expect(prisma._store.order.find((row) => row.id === order.id)).toMatchObject({
        status: 'REFUNDED',
        refundedCents: order.totalCents,
        refundPendingCents: 0,
      })
    }

    const refunds = prisma._store.refund.filter((row) =>
      row.idempotencyKey.startsWith(`event-cancelled:${fixture.event.id}:`),
    )

    expect(refunds).toHaveLength(4)
    expect(refunds.every((row) => row.status === 'SUCCEEDED')).toBe(true)

    const tickets = prisma._store.ticket.filter((ticket) =>
      prisma._store.orderItem.some(
        (item) =>
          item.id === ticket.orderItemId &&
          prisma._store.order.some(
            (order) => order.id === item.orderId && order.eventId === fixture.event.id,
          ),
      ),
    )

    expect(tickets).toHaveLength(4)
    expect(tickets.every((ticket) => ticket.status === 'REFUNDED')).toBe(true)
    expect(tickets.every((ticket) => ticket.credentialHash === null)).toBe(true)

    // One notice per change: the cancellation's and the deletion's.
    const notices = prisma._store.eventChangeNotice.filter(
      (row) => row.eventId === fixture.event.id,
    )

    expect(notices.map((row) => row.kind).sort()).toEqual(['CANCELLED', 'DELETED'])

    const driven = prisma._store.auditLog.find(
      (entry) => entry.action === 'event.refunds_driven' && entry.entityId === fixture.event.id,
    )

    expect(driven.metadata).toMatchObject({ via: 'event_deletion', settled: 4, batch: 500 })

    // Nothing is left to send.
    const finish = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/refunds/finish`,
      headers,
    })

    expect(finish.statusCode).toBe(409)
    expect(finish.json().error.code).toBe('NOTHING_OWED')

    await app.close()
  })

  it('leaves a refund the provider could not send as failed, its money released, and sends it on finish', async () => {
    const base = createInMemoryProviderRegistry()
    const lever = { refusals: 1 }
    const providers = createProviderRegistry({
      ...base,
      payments: {
        ...base.payments,
        refund: (reference, options) => {
          if (lever.refusals > 0) {
            lever.refusals -= 1

            throw new ProviderError(
              PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
              'Down for the test',
              {
                provider: base.payments.name,
              },
            )
          }

          return base.payments.refund(reference, options)
        },
      },
    })
    const { app, prisma, fixture } = await threeNightApp({}, () => {}, { providers })
    const headers = await as(app, 'owner@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/delete`,
      headers,
      payload: body(fixture.event, 'CANCEL_AND_REFUND'),
    })

    // The deletion stands; one refund did not go through.
    expect(response.statusCode).toBe(200)
    expect(response.json().data.event.status).toBe('DELETED')
    expect(response.json().data.refunds).toMatchObject({ owed: 4, settled: 3, failed: 1 })

    const ours = () =>
      prisma._store.refund.filter((row) =>
        row.idempotencyKey.startsWith(`event-cancelled:${fixture.event.id}:`),
      )
    const failed = ours().find((row) => row.status === 'FAILED')

    expect(failed).toBeTruthy()
    // Its reservation was given back, so the order owes it again.
    expect(prisma._store.order.find((row) => row.id === failed.orderId)).toMatchObject({
      status: 'PAID',
      refundPendingCents: 0,
      refundedCents: 0,
    })

    const finish = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/refunds/finish`,
      headers,
    })

    expect(finish.statusCode).toBe(200)
    expect(finish.json().data).toMatchObject({ owed: 1, settled: 1, failed: 0 })
    expect(ours().every((row) => row.status === 'SUCCEEDED')).toBe(true)
    expect(
      prisma._store.order
        .filter((row) => row.eventId === fixture.event.id)
        .every((row) => row.status === 'REFUNDED'),
    ).toBe(true)

    await app.close()
  })

  it('writes its record in the same transaction: a failure after the audit leaves nothing behind', async () => {
    const { app, prisma, fixture } = await threeNightApp()
    const headers = await as(app, 'owner@rangoli.example')
    const before = {
      event: { ...prisma._store.event.find((row) => row.id === fixture.event.id) },
      orders: prisma._store.order.map((row) => ({ ...row })),
      tickets: prisma._store.ticket.map((row) => ({ id: row.id, status: row.status })),
      audits: prisma._store.auditLog.length,
      outbox: prisma._store.notificationOutbox.length,
    }
    const create = prisma.eventChangeNotice.create.bind(prisma.eventChangeNotice)
    let audited = false

    // Step 10 runs after the `event.deleted` audit: fail there.
    prisma.eventChangeNotice.create = async (args) => {
      if (args?.data?.kind === 'DELETED') {
        audited = prisma._store.auditLog.some(
          (row) => row.action === 'event.deleted' && row.entityId === fixture.event.id,
        )
        throw new Error('The database went away for the test')
      }

      return create(args)
    }

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/delete`,
      headers,
      payload: body(fixture.event, 'CANCEL_AND_REFUND'),
    })

    // The audit had been written inside the transaction when it failed …
    expect(audited).toBe(true)
    expect(response.statusCode).toBe(500)

    // … and nothing of the deletion, the cancellation or the refunds is left.
    expect(prisma._store.event.find((row) => row.id === fixture.event.id)).toMatchObject({
      status: before.event.status,
      revision: before.event.revision,
      deletedAt: null,
      statusBeforeDeletion: null,
    })
    expect(prisma._store.auditLog).toHaveLength(before.audits)
    expect(
      prisma._store.auditLog.some((row) =>
        ['event.deleted', 'event.cancelled'].includes(row.action),
      ),
    ).toBe(false)
    expect(prisma._store.notificationOutbox).toHaveLength(before.outbox)
    expect(prisma._store.refund).toHaveLength(0)
    expect(prisma._store.order.map((row) => [row.id, row.status, row.refundPendingCents])).toEqual(
      before.orders.map((row) => [row.id, row.status, row.refundPendingCents]),
    )
    expect(prisma._store.ticket.map((row) => ({ id: row.id, status: row.status }))).toEqual(
      before.tickets,
    )
    expect(prisma._store.eventChangeNotice).toHaveLength(0)

    await app.close()
  })

  it('refunds a postponed event that was sold, rather than keeping its orders', async () => {
    const { app, fixture } = await threeNightApp({ status: 'POSTPONED' })

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${fixture.event.id}/deletion`,
      headers: await as(app, 'owner@rangoli.example', { step: false }),
    })

    expect(preview.json().data.outcome).toBe('CANCEL_AND_REFUND')

    await app.close()
  })

  it('counts a disputed order and leaves it to the finance team', async () => {
    const world = await makeWorld()
    const fixture = threeNightEventFixture(world.ids)
    const disputedPayment = fixture.rows.payment[0]

    addRows(world.seed, fixture.rows)
    addRows(world.seed, {
      dispute: [
        {
          id: cuid(),
          paymentId: disputedPayment.id,
          providerRef: 'dp_test_1',
          status: 'NEEDS_RESPONSE',
          amountCents: disputedPayment.amountCents,
          currency: 'INR',
          reason: 'fraudulent',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })

    const { app, prisma } = backPayments(await createTestApp({ seed: world.seed, ids: world.ids }))
    const headers = await as(app, 'owner@rangoli.example')

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${fixture.event.id}/deletion`,
      headers,
    })

    expect(preview.json().data.counts).toMatchObject({ paidOrders: 4, disputedOrders: 1 })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/delete`,
      headers,
      payload: body(fixture.event, 'CANCEL_AND_REFUND'),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.refunds).toMatchObject({ owed: 3, settled: 3 })
    expect(prisma._store.refund.some((row) => row.orderId === disputedPayment.orderId)).toBe(false)

    await app.close()
  })
})

describe('POST /v1/events/:id/delete — a cancelled event', () => {
  it('refunds what its paid orders have left when no refund holds it, and settles them', async () => {
    // Cancelled, with paid orders and no refund asked for: a disputed order
    // whose dispute was since won, say, or one whose refund finance cancelled.
    const { app, prisma, fixture } = await threeNightApp({
      status: 'CANCELLED',
      cancelledAt: new Date(),
    })
    const headers = await as(app, 'owner@rangoli.example')

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${fixture.event.id}/deletion`,
      headers,
    })

    expect(preview.json().data).toMatchObject({
      outcome: 'CANCEL_AND_REFUND',
      counts: { paidOrders: 4, refundableCents: 440_000 },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/delete`,
      headers,
      payload: body(fixture.event, 'CANCEL_AND_REFUND'),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.refunds).toMatchObject({
      owed: 4,
      settled: 4,
      waiting: 0,
      amountCents: 440_000,
    })

    const orders = prisma._store.order.filter((row) => row.eventId === fixture.event.id)

    expect(orders.map((row) => row.status)).toEqual([
      'REFUNDED',
      'REFUNDED',
      'REFUNDED',
      'REFUNDED',
    ])
    expect(orders.every((row) => row.refundedCents === row.totalCents)).toBe(true)
    expect(
      prisma._store.refund
        .filter((row) => orders.some((order) => order.id === row.orderId))
        .map((row) => row.idempotencyKey)
        .every((key) => key.startsWith(`event-cancelled:${fixture.event.id}:`)),
    ).toBe(true)

    const audit = prisma._store.auditLog.find(
      (row) => row.action === 'event.deleted' && row.entityId === fixture.event.id,
    )

    expect(audit.metadata.counts.refundsReserved).toBe(4)

    await app.close()
  })

  it('asks nothing twice: what the cancellation reserved is sent, and only that', async () => {
    const { app, prisma, fixture } = await threeNightApp()
    const headers = await as(app, 'owner@rangoli.example')

    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/cancel`,
      headers,
      payload: { reasonCode: 'VENUE_UNAVAILABLE', reason: 'The venue flooded this week.' },
    })

    expect(cancelled.statusCode).toBe(200)

    const event = prisma._store.event.find((row) => row.id === fixture.event.id)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/delete`,
      headers,
      payload: body(event, 'CANCEL_AND_REFUND'),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.refunds).toMatchObject({ owed: 4, settled: 4 })

    const orderIds = new Set(
      prisma._store.order.filter((row) => row.eventId === fixture.event.id).map((row) => row.id),
    )

    expect(prisma._store.refund.filter((row) => orderIds.has(row.orderId))).toHaveLength(4)

    await app.close()
  })

  it('asks again, under a key of its own, for an order whose refund finance cancelled', async () => {
    const { app, prisma, fixture } = await threeNightApp()
    const headers = await as(app, 'owner@rangoli.example')

    await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/cancel`,
      headers,
      payload: { reasonCode: 'VENUE_UNAVAILABLE', reason: 'The venue flooded this week.' },
    })

    // Finance withdrew one of the cancellation's refunds, giving back its
    // reservation: the order is paid, with everything left and nothing asked.
    const order = prisma._store.order.find((row) => row.reference === 'DE-3N02')
    const withdrawn = prisma._store.refund.find((row) => row.orderId === order.id)

    withdrawn.status = 'CANCELLED'
    order.refundPendingCents = 0

    const event = prisma._store.event.find((row) => row.id === fixture.event.id)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/delete`,
      headers,
      payload: body(event, 'CANCEL_AND_REFUND'),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.refunds).toMatchObject({ owed: 4, settled: 4 })
    expect(order.status).toBe('REFUNDED')
    expect(
      prisma._store.refund
        .filter((row) => row.orderId === order.id)
        .map((row) => [row.idempotencyKey, row.status]),
    ).toEqual([
      [`event-cancelled:${fixture.event.id}:${order.id}`, 'CANCELLED'],
      [`event-cancelled:${fixture.event.id}:${order.id}:d1`, 'SUCCEEDED'],
    ])

    await app.close()
  })
})

describe('POST /v1/events/:id/delete — after the event', () => {
  it('asks a finished event nobody was checked in at what happened, and keeps the orders when it took place', async () => {
    const past = minutesFromNow(-60 * 24 * 3)
    const world = await makeWorld()
    const fixture = threeNightEventFixture(world.ids, {
      overrides: { startsAt: past, endsAt: minutesFromNow(-60 * 24 * 1) },
    })

    // Every night over.
    fixture.nights.forEach((night, index) => {
      night.startsAt = new Date(past.getTime() + index * 3_600_000)
      night.endsAt = new Date(past.getTime() + (index + 1) * 3_600_000)
    })
    addRows(world.seed, fixture.rows)

    const { app, prisma } = await createTestApp({ seed: world.seed, ids: world.ids })
    const headers = await as(app, 'owner@rangoli.example')

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${fixture.event.id}/deletion`,
      headers,
    })

    expect(preview.json().data).toMatchObject({
      outcome: null,
      choices: ['REMOVE_AFTER_EVENT', 'CANCEL_AND_REFUND'],
      needsTookPlaceConfirmation: true,
    })

    const unconfirmed = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/delete`,
      headers,
      payload: body(fixture.event, 'REMOVE_AFTER_EVENT'),
    })

    expect(unconfirmed.statusCode).toBe(422)
    expect(unconfirmed.json().error.code).toBe('TOOK_PLACE_UNCONFIRMED')

    const confirmed = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/delete`,
      headers,
      payload: body(fixture.event, 'REMOVE_AFTER_EVENT', { confirmTookPlace: true }),
    })

    expect(confirmed.statusCode).toBe(200)
    expect(confirmed.json().data.refunds).toBeNull()
    expect(prisma._store.refund).toHaveLength(0)
    expect(
      prisma._store.ticket.filter((ticket) => ticket.status === 'VALID').length,
    ).toBeGreaterThanOrEqual(4)

    const audit = prisma._store.auditLog.find(
      (entry) => entry.action === 'event.deleted' && entry.entityId === fixture.event.id,
    )

    expect(audit.metadata).toMatchObject({ outcome: 'REMOVE_AFTER_EVENT', confirmTookPlace: true })

    await app.close()
  })

  it('refuses while a night has started and another is still to come', async () => {
    // Its doors open within the hour: started, by the 60-minute margin.
    const { app, fixture } = await threeNightApp({}, (shaped) => {
      shaped.nights[0].startsAt = minutesFromNow(50)
    })

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${fixture.event.id}/deletion`,
      headers: await as(app, 'owner@rangoli.example', { step: false }),
    })

    expect(preview.json().data.refusal.code).toBe('EVENT_IN_PROGRESS')

    await app.close()
  })

  it('removes a sold-out event whose orders were all free, withdrawing their tickets', async () => {
    const world = await makeWorld()
    const fixture = threeNightEventFixture(world.ids)

    for (const order of fixture.rows.order) {
      Object.assign(order, { subtotalCents: 0, totalCents: 0 })
    }
    for (const item of fixture.rows.orderItem) {
      Object.assign(item, { unitPriceCents: 0, subtotalCents: 0 })
    }
    addRows(world.seed, fixture.rows)

    const { app, prisma } = await createTestApp({ seed: world.seed, ids: world.ids })
    const headers = await as(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/delete`,
      headers,
      payload: body(fixture.event, 'REMOVE'),
    })

    expect(response.statusCode).toBe(200)

    const withdrawn = prisma._store.ticket.filter((ticket) =>
      String(ticket.revokedReason).startsWith(`event-deleted:${fixture.event.id}`),
    )

    expect(withdrawn).toHaveLength(4)
    expect(withdrawn.every((ticket) => ticket.status === 'CANCELLED')).toBe(true)

    await app.close()
  })
})

describe('POST /v1/events/:id/refunds/finish', () => {
  it('is only for a cancelled or deleted event', async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/refunds/finish`,
      headers: await as(app, 'owner@rangoli.example'),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('NOT_CANCELLED')

    await app.close()
  })

  it('sends what a cancellation reserved', async () => {
    const { app, prisma, fixture } = await threeNightApp()
    const headers = await as(app, 'owner@rangoli.example')

    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/cancel`,
      headers,
      payload: { reasonCode: 'VENUE_UNAVAILABLE', reason: 'The venue flooded this week.' },
    })

    expect(cancelled.statusCode).toBe(200)

    const finish = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/refunds/finish`,
      headers,
    })

    expect(finish.statusCode).toBe(200)
    expect(finish.headers['cache-control']).toBe('no-store')
    expect(finish.json().data).toMatchObject({ owed: 4, settled: 4, waiting: 0 })
    expect(
      prisma._store.order
        .filter((row) => row.eventId === fixture.event.id)
        .map((row) => row.status),
    ).toEqual(['REFUNDED', 'REFUNDED', 'REFUNDED', 'REFUNDED'])

    await app.close()
  })
})

describe('the refund driver', () => {
  it('gives a disputed refund no place in a batch, and tries the untried first', async () => {
    const { app, prisma, fixture } = await threeNightApp()
    const headers = await as(app, 'owner@rangoli.example')

    await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/cancel`,
      headers,
      payload: { reasonCode: 'VENUE_UNAVAILABLE', reason: 'The venue flooded this week.' },
    })

    const ours = prisma._store.refund.filter((row) =>
      row.idempotencyKey.startsWith(`event-cancelled:${fixture.event.id}:`),
    )

    expect(ours).toHaveLength(4)

    // One payment is disputed after the cancellation; another refund has been
    // tried before (it is the oldest, so by age alone it would go first).
    const [tried, held] = ours
    const heldPayment = prisma._store.payment.find((row) => row.id === held.paymentId)

    tried.attempts = 3
    prisma._store.dispute.push({
      id: cuid(),
      paymentId: heldPayment.id,
      providerRef: 'dp_after_cancel',
      status: 'NEEDS_RESPONSE',
      amountCents: heldPayment.amountCents,
      currency: heldPayment.currency,
      reason: 'fraudulent',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const selected = []
    const findMany = prisma.refund.findMany.bind(prisma.refund)

    prisma.refund.findMany = async (args) => {
      const rows = await findMany(args)

      if (args?.orderBy?.[0]?.attempts) selected.push(...rows.map((row) => row.id))

      return rows
    }

    const finish = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/refunds/finish`,
      headers,
    })

    expect(finish.statusCode).toBe(200)
    expect(finish.json().data).toMatchObject({ owed: 4, settled: 3, disputed: 1, waiting: 0 })
    // The disputed one was never picked; the one tried before went last.
    expect(selected).not.toContain(held.id)
    expect(selected.at(-1)).toBe(tried.id)

    // Only the disputed one is left: nothing can be sent from here, and the
    // answer says why rather than that everything was sent.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/refunds/finish`,
      headers,
    })

    expect(again.statusCode).toBe(409)
    expect(again.json().error).toMatchObject({
      code: 'NOTHING_OWED',
      message: expect.stringMatching(/One is held by a payment dispute/),
    })

    await app.close()
  })

  it('replaces a failed refund whose order has since been part refunded, and sends what is left', async () => {
    const base = createInMemoryProviderRegistry()
    const lever = { refusals: 1 }
    const providers = createProviderRegistry({
      ...base,
      payments: {
        ...base.payments,
        refund: (reference, options) => {
          if (lever.refusals > 0) {
            lever.refusals -= 1

            throw new ProviderError(
              PROVIDER_ERROR_CODES.PROVIDER_UNAVAILABLE,
              'Down for the test',
              {
                provider: base.payments.name,
              },
            )
          }

          return base.payments.refund(reference, options)
        },
      },
    })
    const { app, prisma, fixture } = await threeNightApp({}, () => {}, { providers })
    const headers = await as(app, 'owner@rangoli.example')

    const deleted = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/delete`,
      headers,
      payload: body(fixture.event, 'CANCEL_AND_REFUND'),
    })

    expect(deleted.json().data.refunds).toMatchObject({ owed: 4, settled: 3, failed: 1 })

    const failed = prisma._store.refund.find((row) => row.status === 'FAILED')
    const order = () => prisma._store.order.find((row) => row.id === failed.orderId)
    const payment = prisma._store.payment.find((row) => row.id === failed.paymentId)

    // Meanwhile finance refunded part of that order at the refund screen, so
    // the failed refund no longer fits what the order has left.
    const partial = await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({
        where: { id: failed.orderId },
        include: { items: true },
      })
      const { refund } = await requestRefund(tx, {
        order: current,
        payment,
        amountCents: 10_000,
        reason: 'CUSTOMER_REQUEST',
        reasonNote: 'Part of it, at the buyer’s request.',
        idempotencyKey: `finance-partial:${failed.orderId}`,
        actorId: null,
        now: new Date(),
      })

      await approveRefund(tx, { refund, order: current, actorId: null, now: new Date() })

      return tx.refund.findUnique({ where: { id: refund.id } })
    })
    const sent = await submitRefund(prisma, providers, {
      refund: partial,
      order: order(),
      payment,
      organizationId: fixture.event.organizationId,
    })

    expect(sent.refund.status).toBe('SUCCEEDED')
    expect(order()).toMatchObject({ refundedCents: 10_000, refundPendingCents: 0 })

    const finish = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/refunds/finish`,
      headers,
    })

    expect(finish.statusCode, finish.body).toBe(200)
    expect(finish.json().data).toMatchObject({
      owed: 1,
      settled: 1,
      failed: 0,
      amountCents: order().totalCents - 10_000,
    })

    // The failed one was withdrawn; what was left was asked for under a key
    // of its own, approved and settled.
    expect(prisma._store.refund.find((row) => row.id === failed.id).status).toBe('CANCELLED')

    const replacement = prisma._store.refund.find(
      (row) => row.idempotencyKey === `${failed.idempotencyKey}:r${failed.attempts + 1}`,
    )

    expect(replacement).toMatchObject({
      status: 'SUCCEEDED',
      reason: 'EVENT_CANCELLED',
      amountCents: order().totalCents - 10_000,
    })
    expect(order()).toMatchObject({
      status: 'REFUNDED',
      refundedCents: order().totalCents,
      refundPendingCents: 0,
    })

    await app.close()
  })

  it('answers a deletion whose refund pass broke off with what is waiting, never null', async () => {
    const { app, prisma, fixture } = await threeNightApp()
    const headers = await as(app, 'owner@rangoli.example')
    const findMany = prisma.refund.findMany.bind(prisma.refund)
    let broken = true

    // The driver's read fails once, after the deletion has committed.
    prisma.refund.findMany = async (args) => {
      if (broken && args?.orderBy?.[0]?.attempts) {
        broken = false
        throw new Error('The database went away for the test')
      }

      return findMany(args)
    }

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/delete`,
      headers,
      payload: body(fixture.event, 'CANCEL_AND_REFUND'),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.event.status).toBe('DELETED')
    expect(response.json().data.refunds).toEqual({
      owed: 4,
      settled: 0,
      waiting: 4,
      failed: 0,
      disputed: 0,
      amountCents: 0,
      currency: null,
    })

    const finish = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/refunds/finish`,
      headers,
    })

    expect(finish.json().data).toMatchObject({ owed: 4, settled: 4, waiting: 0 })

    await app.close()
  })
})

describe('a deleted event fixture', () => {
  it('is restorable data the team still reads', async () => {
    const world = await makeWorld()
    const fixture = deletedEventFixture(world.ids)

    addRows(world.seed, fixture.rows)

    const { app } = await createTestApp({ seed: world.seed, ids: world.ids })
    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${fixture.event.id}/deletion`,
      headers: await as(app, 'owner@rangoli.example', { step: false }),
    })

    expect(response.json().data.refusal.code).toBe('ALREADY_DELETED')

    await app.close()
  })
})

/**
 * A booking paid at the venue whose whole booking fee a referral code waived
 * (SPEC3-XI XR2), on the fixture's second night, PAID or, as checkout's first
 * transaction leaves it, PENDING with no payment and no tickets; and its code,
 * one use taken.
 *
 * @param {object} fixture `threeNightEventFixture`'s result.
 * @param {object} buyer The buyer's account.
 * @param {object} options Options.
 * @param {string} options.codeId The code's id.
 * @param {string} options.reference The booking's reference.
 * @param {'PAID'|'PENDING'} [options.status] Settled or not yet.
 * @returns {object} The rows to add.
 */
function waivedBooking(fixture, buyer, { codeId, reference, status = 'PAID' }) {
  const tier = fixture.tiers[1]
  const at = new Date('2026-09-01T12:00:00.000Z')
  const order = {
    id: cuid(),
    reference,
    idempotencyKey: null,
    eventId: fixture.event.id,
    eventSessionId: tier.eventSessionId,
    userId: buyer.id,
    buyerEmail: buyer.email,
    buyerName: buyer.displayName,
    status,
    currency: 'INR',
    subtotalCents: tier.priceCents,
    discountCents: 0,
    feesCents: 0,
    taxCents: 0,
    totalCents: 0,
    promoCodeId: null,
    refundedCents: 0,
    refundPendingCents: 0,
    expiresAt: status === 'PENDING' ? new Date(Date.now() + 600_000) : null,
    paidAt: status === 'PAID' ? at : null,
    cancelledAt: null,
    createdAt: at,
    updatedAt: at,
    paymentMethod: 'AT_VENUE',
    feeGrossCents: 2_400,
    feeWaivedCents: 2_400,
    referralCodeId: codeId,
    referralUseReturnedAt: null,
    referralUseReturnCause: null,
    venueDueCents: tier.priceCents,
    venueCancelledBasisCents: 0,
    venueFeeKeptCents: 0,
  }
  const item = {
    id: cuid(),
    orderId: order.id,
    ticketTypeId: tier.id,
    quantity: 1,
    unitPriceCents: tier.priceCents,
    subtotalCents: tier.priceCents,
    refundedQuantity: 0,
    refundedCents: 0,
    attendeeNames: [],
    venueDueCents: tier.priceCents,
    venueCancelledQuantity: 0,
  }
  const tickets =
    status === 'PAID'
      ? [
          {
            id: cuid(),
            orderItemId: item.id,
            code: `${reference}-1`,
            credentialHash: `${reference.toLowerCase()}-pass`,
            credentialVersion: 1,
            credentialIssuedAt: at,
            attendeeName: null,
            ownerUserId: buyer.id,
            eventSeatId: null,
            status: 'VALID',
            checkedInAt: null,
            revokedAt: null,
            revokedReason: null,
            supersedesTicketId: null,
            venueDueCents: tier.priceCents,
            venuePaymentId: null,
            venueCancellationId: null,
            createdAt: at,
            updatedAt: at,
          },
        ]
      : []
  const code = {
    id: codeId,
    code: `FRIENDS-${reference}`,
    label: null,
    scope: 'ALL_EVENTS',
    expiresAt: null,
    maxUses: null,
    useCount: 1,
    active: true,
    switchedOffAt: null,
    createdById: null,
    updatedById: null,
    createdAt: at,
    updatedAt: at,
  }

  return { order: [order], orderItem: [item], ticket: tickets, referralCode: [code] }
}

describe('the lock law and the referral uses (SPEC3-XI §2.3.2, §2.3.7, XR4)', () => {
  it('a deletion locks every paid order right after the nights, cancels unpaid orders without touching a code, and gives every use back last, ascending, in one batch', async () => {
    const [low, high] = [cuid(), cuid()].sort()
    let buyer = null
    const { app, prisma, fixture } = await threeNightApp({}, (shape) => {
      buyer = { id: shape.orders[0].userId, email: 'priya@example.com', displayName: 'Priya' }
      // The PAID booking names the higher code, the PENDING one the lower, so
      // ascending order is not the order the orders are met in.
      addRows(shape.rows, waivedBooking(shape, buyer, { codeId: high, reference: 'DE-WAIVEDPAID' }))
      addRows(
        shape.rows,
        waivedBooking(shape, buyer, {
          codeId: low,
          reference: 'DE-WAIVEDPEND',
          status: 'PENDING',
        }),
      )
    })
    const headers = await as(app, 'owner@rangoli.example')
    const from = prisma.lockLog.length

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/delete`,
      headers,
      payload: body(fixture.event, 'CANCEL_AND_REFUND'),
    })

    expect(response.statusCode, response.body).toBe(200)

    const paid = prisma._store.order.find((row) => row.reference === 'DE-WAIVEDPAID')
    const pending = prisma._store.order.find((row) => row.reference === 'DE-WAIVEDPEND')
    const log = prisma.lockLog.slice(from)
    const deleting = log.find((entry) => entry.table === 'EventSession').transaction
    const inTransaction = log.filter((entry) => entry.transaction === deleting)
    const lastNight = inTransaction.map((entry) => entry.table).lastIndexOf('EventSession')
    const paidIds = prisma._store.order
      .filter((row) => row.eventId === fixture.event.id && row.paidAt && row.id !== pending.id)
      .map((row) => row.id)
      .sort()
    const afterNights = inTransaction
      .slice(lastNight + 1, lastNight + 1 + paidIds.length)
      .map((entry) => `${entry.table}:${entry.kind}:${entry.id}`)

    // 2.3.2: every paid order, ascending, straight after the nights.
    expect(afterNights).toEqual(paidIds.map((id) => `Order:lock:${id}`))

    const firstTicketWrite = inTransaction.findIndex(
      (entry) => entry.table === 'Ticket' && entry.kind === 'write',
    )

    expect(firstTicketWrite).toBeGreaterThan(lastNight + paidIds.length)

    // The codes last, ascending, after every order, line, ticket and seat write.
    const codes = inTransaction.filter((entry) => entry.table === 'ReferralCode')
    const firstCode = inTransaction.findIndex((entry) => entry.table === 'ReferralCode')
    const lastRowWrite = inTransaction
      .map(
        (entry) =>
          entry.kind === 'write' &&
          ['Order', 'OrderItem', 'Ticket', 'EventSeat'].includes(entry.table),
      )
      .lastIndexOf(true)

    expect(firstCode).toBeGreaterThan(lastRowWrite)
    expect([...new Set(codes.map((entry) => entry.id))]).toEqual([low, high])

    expect(pending).toMatchObject({
      status: 'CANCELLED',
      referralUseReturnCause: 'UNPAID_ORDER_CANCELLED',
    })
    expect(paid).toMatchObject({ status: 'PAID', referralUseReturnCause: 'EVENT_DELETED' })

    for (const id of [low, high]) {
      expect(prisma._store.referralCode.find((row) => row.id === id).useCount).toBe(0)
    }

    await app.close()
  })

  it('an event’s cancellation locks the orders it read as PENDING, and gives a waived booking’s use back with EVENT_CANCELLED', async () => {
    const codeId = cuid()
    const { app, prisma, fixture } = await threeNightApp({}, (shape) => {
      const buyer = { id: shape.orders[0].userId, email: 'priya@example.com', displayName: 'P' }

      addRows(shape.rows, waivedBooking(shape, buyer, { codeId, reference: 'DE-WAIVEDCANC' }))
      addRows(
        shape.rows,
        waivedBooking(shape, buyer, {
          codeId: cuid(),
          reference: 'DE-WAIVEDWAIT',
          status: 'PENDING',
        }),
      )
    })
    const headers = await as(app, 'owner@rangoli.example')
    const from = prisma.lockLog.length

    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/cancel`,
      headers,
      payload: { reasonCode: 'VENUE_UNAVAILABLE', reason: 'The venue flooded this week.' },
    })

    expect(cancelled.statusCode, cancelled.body).toBe(200)

    const waived = prisma._store.order.find((row) => row.reference === 'DE-WAIVEDCANC')
    const waiting = prisma._store.order.find((row) => row.reference === 'DE-WAIVEDWAIT')
    const log = prisma.lockLog.slice(from)

    // The PENDING order was locked (2.3.7) and, still PENDING, left alone.
    expect(
      log.some(
        (entry) => entry.table === 'Order' && entry.kind === 'lock' && entry.id === waiting.id,
      ),
    ).toBe(true)
    expect(waiting).toMatchObject({ status: 'PENDING', referralUseReturnedAt: null })

    // The zero-online booking: its event cancelled, nothing to refund. Its use
    // goes back at once, after the last order lock.
    expect(waived).toMatchObject({ referralUseReturnCause: 'EVENT_CANCELLED' })
    expect(prisma._store.referralCode.find((row) => row.id === codeId).useCount).toBe(0)

    const codeAt = log.findIndex((entry) => entry.table === 'ReferralCode')
    const lastOrderLock = log
      .map((entry) => entry.table === 'Order' && entry.kind === 'lock')
      .lastIndexOf(true)

    expect(codeAt).toBeGreaterThan(lastOrderLock)

    await app.close()
  })
})
