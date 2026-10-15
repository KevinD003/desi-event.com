/**
 * SPEC3's foundation, against the stub: the thirteen routes registered with
 * the guards and budgets the contract and §4.4 give them, the referral code's
 * use count (`lib/referral-uses.js`), and the stub's own SPEC3 support — the
 * new models and their defaults, the uniques, the raw row locks, the
 * venue-booking count and the accounts fixture — and SPEC3-XI's cancellation
 * fixture, which later stages' stub suites build cancelled bookings with.
 *
 * Nothing here asserts what a handler answers once it passes its guards: the
 * next stage replaces every handler, and these tests hold either way.
 */

import { describe, expect, it } from 'vitest'

import { apiRoutes } from '@desi-event/api-contract'

import { databaseRefusal } from '../src/lib/errors.js'
import { consumeReferralUse, settleReferralUsesIfEnded } from '../src/lib/referral-uses.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import {
  VENUE_UNPAID_REASON_PREFIX,
  cancelledUnpaidFixture,
  generatedReferralText,
  referralCodeFixture,
} from './helpers/fee-orders.js'
import { addRows, makeWorld, paymentTermsAccountsFixture } from './helpers/fixtures.js'
import { createPrismaStub, cuid } from './helpers/prisma-stub.js'

/** The thirteen routes SPEC3 §11.1 adds. */
const NEW_ROUTES = [
  'paymentTerms.get',
  'paymentTerms.setFee',
  'paymentTerms.setVenuePayment',
  'referralCodes.list',
  'referralCodes.byAdministrator',
  'referralCodes.create',
  'referralCodes.get',
  'referralCodes.update',
  'referralCodes.switchOff',
  'referralCodes.switchOn',
  'platformFees.preview',
  'platformFees.refund',
  'venuePayments.report',
]

/** A reason inside every 10-500 character bound. */
const REASON = 'Checked by the SPEC3 foundation suite.'

/**
 * A well-formed body for each route that takes one, so a refusal is about who
 * is asking (the body is validated before the capability, 401 → 400 → 403).
 */
const BODIES = {
  'paymentTerms.setFee': { source: 'SITE_DEFAULT', reason: REASON, expectedSequence: 0 },
  'paymentTerms.setVenuePayment': {
    enabled: false,
    seen: { enabled: false, limit: null },
    reason: REASON,
  },
  'referralCodes.create': { generate: true, scope: 'ALL_EVENTS' },
  'referralCodes.update': { label: null, expectedUpdatedAt: '2026-10-09T10:00:00.000Z' },
  'referralCodes.switchOff': {},
  'platformFees.refund': { reason: REASON, expectedRefundableCents: 0 },
}

/**
 * A request to one contract route, its path parameters filled in.
 *
 * @param {object} app The Fastify instance.
 * @param {string} id The route id.
 * @param {object} [options] Options.
 * @param {object} [options.headers] Request headers.
 * @param {object} [options.body] The body, for a route that takes one.
 * @returns {Promise<object>} The response.
 */
function call(app, id, { headers = {}, body } = {}) {
  const route = apiRoutes.find((candidate) => candidate.id === id)
  const url = route.path.replace(':reference', 'DE-ABCDEF').replace(/:[A-Za-z]+/gu, () => cuid())

  return app.inject({
    method: route.method,
    url,
    headers,
    ...(route.body ? { payload: body ?? BODIES[id] ?? {} } : {}),
  })
}

/**
 * A world with SPEC3's accounts added.
 *
 * @returns {Promise<{seed: object, ids: object, accounts: object}>} The world.
 */
async function worldWithAccounts() {
  const world = await makeWorld()
  const accounts = paymentTermsAccountsFixture(world.ids)

  addRows(world.seed, accounts.rows)

  return { ...world, accounts }
}

describe('the thirteen routes are registered behind their guards', () => {
  it('registers every one', async () => {
    const { app } = await createTestApp()

    for (const id of NEW_ROUTES) {
      const route = apiRoutes.find((candidate) => candidate.id === id)

      expect(app.hasRoute({ method: route.method, url: route.path }), id).toBe(true)
    }

    await app.close()
  })

  it('refuses an anonymous caller with 401 on every one', async () => {
    const { app } = await createTestApp()

    for (const id of NEW_ROUTES) {
      expect((await call(app, id)).statusCode, id).toBe(401)
    }

    await app.close()
  })

  it('refuses an attendee and a moderator the platform capabilities with 403', async () => {
    const { app } = await createTestApp()

    for (const email of ['priya@example.com', 'maya@desi-event.example']) {
      const headers = bearer(await signIn(app, email))

      for (const id of NEW_ROUTES.filter((candidate) => candidate !== 'venuePayments.report')) {
        const response = await call(app, id, { headers })

        expect(response.statusCode, `${email} ${id}`).toBe(403)
      }
    }

    await app.close()
  })

  it('lets a finance administrator refund booking fees and nothing else', async () => {
    const { seed, ids } = await worldWithAccounts()
    const { app } = await createTestApp({ seed, ids })
    const headers = bearer(await signIn(app, 'farah-finance@desi-event.example'))

    for (const id of [
      'paymentTerms.setFee',
      'paymentTerms.setVenuePayment',
      'referralCodes.create',
    ]) {
      expect((await call(app, id, { headers })).statusCode, id).toBe(403)
    }

    const preview = await call(app, 'platformFees.preview', { headers })

    expect([401, 403]).not.toContain(preview.statusCode)

    await app.close()
  })

  it('lets a platform administrator past the guards of a booking-fee change', async () => {
    const { app } = await createTestApp()
    const headers = bearer(await signIn(app, 'anil@desi-event.example'))

    await stepUp(app, 'anil@desi-event.example', headers)

    const response = await call(app, 'paymentTerms.setFee', {
      headers,
      body: { source: 'SITE_DEFAULT', reason: REASON, expectedSequence: 0 },
    })

    expect([401, 403]).not.toContain(response.statusCode)
    expect(response.headers['cache-control']).toBe('no-store, private')

    await app.close()
  })

  it('draws the booking fee and the switch from one payment-terms budget', async () => {
    const { app } = await createTestApp({
      rateLimit: {
        global: { max: 10_000, timeWindow: '1 minute' },
        paymentTerms: { max: 2, timeWindow: '1 hour' },
      },
    })
    const headers = bearer(await signIn(app, 'anil@desi-event.example'))

    await stepUp(app, 'anil@desi-event.example', headers)

    const fee = { source: 'SITE_DEFAULT', reason: REASON, expectedSequence: 0 }
    const venue = { enabled: false, seen: { enabled: false, limit: null }, reason: REASON }

    expect((await call(app, 'paymentTerms.setFee', { headers, body: fee })).statusCode).not.toBe(
      429,
    )
    expect(
      (await call(app, 'paymentTerms.setVenuePayment', { headers, body: venue })).statusCode,
    ).not.toBe(429)

    const third = await call(app, 'paymentTerms.setFee', { headers, body: fee })

    expect(third.statusCode).toBe(429)
    expect(third.json().error.code).toBe('RATE_LIMITED')
    expect(third.headers['retry-after']).toBeDefined()

    await app.close()
  })

  it('draws every referral-code write from one referral-admin budget', async () => {
    const { app } = await createTestApp({
      rateLimit: {
        global: { max: 10_000, timeWindow: '1 minute' },
        referralAdmin: { max: 1, timeWindow: '1 hour' },
      },
    })
    const headers = bearer(await signIn(app, 'anil@desi-event.example'))

    await stepUp(app, 'anil@desi-event.example', headers)

    // Switching off needs no step-up and spends from the same bucket.
    expect((await call(app, 'referralCodes.switchOff', { headers })).statusCode).not.toBe(429)
    expect(
      (
        await call(app, 'referralCodes.create', {
          headers,
          body: { generate: true, scope: 'ALL_EVENTS' },
        })
      ).statusCode,
    ).toBe(429)

    await app.close()
  })
})

describe('SPEC3-XI’s two routes are registered behind their guards', () => {
  const ROUTES = ['venueBookings.unpaid', 'venueBookings.cancel']
  const CANCEL = { ticketIds: [cuid()], reason: REASON }

  it('registers both, and refuses an anonymous caller with 401', async () => {
    const { app } = await createTestApp()

    for (const id of ROUTES) {
      const route = apiRoutes.find((candidate) => candidate.id === id)

      expect(app.hasRoute({ method: route.method, url: route.path }), id).toBe(true)
      expect((await call(app, id, { body: CANCEL })).statusCode, id).toBe(401)
    }

    await app.close()
  })

  // Built by Stage B1-V pass 2 (SPEC3-XI §16): past the guards, a booking or
  // an event nobody may act on answers 404 rather than the 501 the stubs gave.
  it('asks for a recent second factor before anything else, then answers 404 for a booking it does not know, never cached', async () => {
    const { app, prisma } = await createTestApp()
    const headers = bearer(await signIn(app, 'anil@desi-event.example'))

    // The factor given at sign-in, moved back past both windows (FINANCE_VIEW
    // fifteen minutes, FINANCE_ACTION five).
    for (const session of prisma._store.session) {
      session.mfaSatisfiedAt = new Date(Date.now() - 16 * 60_000)
    }

    for (const id of ROUTES) {
      const response = await call(app, id, { headers, body: CANCEL })

      expect(response.statusCode, id).toBe(403)
      expect(response.json().error.code, id).toBe('STEP_UP_REQUIRED')
    }

    await stepUp(app, 'anil@desi-event.example', headers)

    for (const id of ROUTES) {
      const response = await call(app, id, { headers, body: CANCEL })

      expect(response.statusCode, id).toBe(404)
      expect(response.json().error.code, id).toBe('NOT_FOUND')
      expect(response.headers['cache-control'], id).toBe('no-store, private')
    }

    await app.close()
  })

  it('validates the cancel’s body before the handler: 1 to 100 distinct tickets and a reason', async () => {
    const { app } = await createTestApp()
    const headers = bearer(await signIn(app, 'anil@desi-event.example'))

    await stepUp(app, 'anil@desi-event.example', headers)

    const id = cuid()

    for (const body of [
      { ticketIds: [], reason: REASON },
      { ticketIds: [id, id], reason: REASON },
      { ticketIds: [cuid()], reason: 'Too short' },
    ]) {
      expect((await call(app, 'venueBookings.cancel', { headers, body })).statusCode).toBe(400)
    }

    await app.close()
  })

  it('draws every cancel from its own budget, per person', async () => {
    const { app } = await createTestApp({
      rateLimit: {
        global: { max: 10_000, timeWindow: '1 minute' },
        venueCancel: { max: 1, timeWindow: '1 hour' },
      },
    })
    const headers = bearer(await signIn(app, 'anil@desi-event.example'))

    await stepUp(app, 'anil@desi-event.example', headers)

    expect((await call(app, 'venueBookings.cancel', { headers, body: CANCEL })).statusCode).toBe(
      404,
    )

    const second = await call(app, 'venueBookings.cancel', { headers, body: CANCEL })

    expect(second.statusCode).toBe(429)
    expect(second.json().error.code).toBe('RATE_LIMITED')
    // The list has no such budget.
    expect((await call(app, 'venueBookings.unpaid', { headers })).statusCode).toBe(404)

    await app.close()
  })
})

describe('a referral code’s use count (lib/referral-uses.js)', () => {
  // SPEC3-XI §14.8: SPEC3's `returnReferralUse` (a decrement with no order
  // behind it) is gone; a use goes back only when an order naming the code
  // ended without being used, once, through `settleReferralUsesIfEnded`.
  it('takes a use, and gives it back once when its order ends, never below 0', async () => {
    const prisma = createPrismaStub({ event: [{ id: 'ev-1', status: 'ON_SALE' }] })
    const { row } = await referralCodeFixture(prisma, { createdById: null, maxUses: 2 })

    expect(await consumeReferralUse(prisma, { referralCodeId: row.id })).toBe(1)
    expect(await consumeReferralUse(prisma, { referralCodeId: row.id })).toBe(1)
    expect(prisma._store.referralCode[0].useCount).toBe(2)

    const ended = (id) =>
      prisma.order.create({
        data: {
          id,
          eventId: 'ev-1',
          reference: `R-${id}`,
          status: 'CANCELLED',
          paymentMethod: 'AT_VENUE',
          totalCents: 0,
          referralCodeId: row.id,
        },
      })
    const settle = (orderId) =>
      prisma.$transaction((tx) =>
        settleReferralUsesIfEnded(tx, {
          entries: [{ orderId, cause: 'UNPAID_ORDER_CANCELLED' }],
        }),
      )

    await ended('o-1')

    // The first call sets the marker and lowers the count once.
    expect(await settle('o-1')).toEqual([
      { orderId: 'o-1', referralCodeId: row.id, cause: 'UNPAID_ORDER_CANCELLED' },
    ])
    expect(prisma._store.referralCode[0].useCount).toBe(1)
    expect(prisma._store.order[0].referralUseReturnedAt).toBeInstanceOf(Date)

    // The second gives nothing back and writes nothing.
    const statements = prisma._rawStatements.length

    expect(await settle('o-1')).toEqual([])
    expect(prisma._store.referralCode[0].useCount).toBe(1)
    expect(prisma._rawStatements).toHaveLength(statements)

    // A count zeroed by hand stays 0; the order's marker is set all the same.
    prisma._store.referralCode[0].useCount = 0
    await ended('o-2')

    expect(await settle('o-2')).toHaveLength(1)
    expect(prisma._store.referralCode[0].useCount).toBe(0)
    expect(prisma._store.order[1].referralUseReturnCause).toBe('UNPAID_ORDER_CANCELLED')

    // An order that names no code gives nothing back.
    await prisma.order.create({
      data: { id: 'o-3', eventId: 'ev-1', reference: 'R-o-3', status: 'CANCELLED' },
    })

    expect(await settle('o-3')).toEqual([])
    expect(prisma._store.referralCode[0].useCount).toBe(0)
  })

  it('is refused past the limit by the CHECK, which the buyer hears as REFERRAL_NOT_ACCEPTED', async () => {
    const prisma = createPrismaStub({})
    const { row } = await referralCodeFixture(prisma, { createdById: null, maxUses: 1 })

    await consumeReferralUse(prisma, { referralCodeId: row.id })

    const refused = await consumeReferralUse(prisma, { referralCodeId: row.id }).catch(
      (error) => error,
    )

    expect(databaseRefusal(refused)).toMatchObject({
      statusCode: 409,
      code: 'REFERRAL_NOT_ACCEPTED',
    })
    expect(prisma._store.referralCode[0].useCount).toBe(1)
  })

  it('writes with one statement on the database’s own count, and leaves updatedAt alone', async () => {
    const prisma = createPrismaStub({})
    const { row } = await referralCodeFixture(prisma, { createdById: null })
    const before = prisma._store.referralCode[0].updatedAt

    await consumeReferralUse(prisma, { referralCodeId: row.id })

    expect(prisma._rawStatements.map((statement) => statement.sql)).toEqual([
      'UPDATE "ReferralCode" SET "useCount" = "useCount" + 1 WHERE "id" = ?',
    ])
    expect(prisma._rawStatements[0].values).toEqual([row.id])
    expect(prisma._store.referralCode[0].updatedAt).toBe(before)
  })

  it('answers 0 for a code that does not exist, and refuses no id at all', async () => {
    const prisma = createPrismaStub({})

    expect(await consumeReferralUse(prisma, { referralCodeId: cuid() })).toBe(0)
    await expect(consumeReferralUse(prisma, { referralCodeId: '' })).rejects.toThrow(TypeError)
    await expect(consumeReferralUse(prisma, {})).rejects.toThrow(TypeError)
  })
})

describe('the stub’s SPEC3 support', () => {
  it('gives new events, orders, lines and tickets the migrations’ defaults', async () => {
    const prisma = createPrismaStub({})
    const organizationId = cuid()
    const event = await prisma.event.create({ data: { organizationId, title: 'E', slug: 'e' } })
    const order = await prisma.order.create({ data: { eventId: event.id, reference: 'R' } })
    const item = await prisma.orderItem.create({ data: { orderId: order.id } })
    const ticket = await prisma.ticket.create({ data: { orderItemId: item.id, code: 'T' } })

    expect(event).toMatchObject({
      feeSource: 'SITE_DEFAULT',
      feePercentageBps: null,
      feeSettingId: null,
      venuePaymentEnabled: false,
      venuePaymentLimit: null,
    })
    expect(order).toMatchObject({
      paymentMethod: 'CARD',
      feeSource: 'SITE_DEFAULT',
      feeGrossCents: 0,
      feeWaivedCents: 0,
      referralCodeId: null,
      venueDueCents: 0,
      // SPEC3-XI: no use given back, nothing cancelled unpaid, no fee kept.
      referralUseReturnedAt: null,
      referralUseReturnCause: null,
      venueCancelledBasisCents: 0,
      venueFeeKeptCents: 0,
    })
    expect(item.venueDueCents).toBe(0)
    expect(item.venueCancelledQuantity).toBe(0)
    expect(ticket).toMatchObject({
      venueDueCents: 0,
      venuePaymentId: null,
      venueCancellationId: null,
    })
  })

  it('backfills seeded orders as the migration does: the gross fee is the fee charged', () => {
    const prisma = createPrismaStub({ order: [{ id: 'o1', feesCents: 335 }] })

    expect(prisma._store.order[0]).toMatchObject({
      feeGrossCents: 335,
      feeWaivedCents: 0,
      paymentMethod: 'CARD',
      venueDueCents: 0,
    })
  })

  it('holds the uniques: a code’s text, a fee decision’s sequence, a scope row', async () => {
    const prisma = createPrismaStub({})
    const text = generatedReferralText()
    const eventId = cuid()

    await prisma.referralCode.create({ data: { code: text, scope: 'ALL_EVENTS' } })
    await expect(
      prisma.referralCode.create({ data: { code: text, scope: 'ALL_EVENTS' } }),
    ).rejects.toMatchObject({ code: 'P2002' })

    await prisma.eventFeeSetting.create({
      data: { eventId, sequence: 1, source: 'SITE_DEFAULT', reason: REASON },
    })
    await expect(
      prisma.eventFeeSetting.create({
        data: { eventId, sequence: 1, source: 'SITE_DEFAULT', reason: REASON },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    const code = prisma._store.referralCode[0]

    await prisma.referralCodeEvent.create({ data: { referralCodeId: code.id, eventId } })
    await expect(
      prisma.referralCodeEvent.create({ data: { referralCodeId: code.id, eventId } }),
    ).rejects.toMatchObject({ code: 'P2002' })
    expect(prisma._store.referralCodeEvent[0].addedAt).toBeInstanceOf(Date)
    expect(prisma._store.referralCodeEvent[0].id).toBeUndefined()
  })

  it('answers a row lock with the row’s id when it exists, in every lock strength', async () => {
    const prisma = createPrismaStub({ event: [{ id: 'ev1' }], ticket: [{ id: 'tk1' }] })

    expect(
      await prisma.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${'ev1'} FOR NO KEY UPDATE`,
    ).toEqual([{ id: 'ev1' }])
    expect(await prisma.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${'tk1'} FOR UPDATE`).toEqual([
      { id: 'tk1' },
    ])
    expect(
      await prisma.$queryRaw`SELECT "id" FROM "EventSession" WHERE "id" = ${'none'} FOR KEY SHARE`,
    ).toEqual([])
    expect(
      await prisma.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'venue-booking:ev1'}, 0))`,
    ).toHaveLength(1)
  })

  it('computes the venue-booking count from its own rows (SPEC3 §6.4)', async () => {
    const eventId = 'ev1'
    const buyer = 'buyer-1'
    const prisma = createPrismaStub({
      order: [
        // PENDING: min(quantity, due) per line.
        { id: 'p1', eventId, userId: buyer, status: 'PENDING', paymentMethod: 'AT_VENUE' },
        // PAID: tickets owing, unpaid and standing.
        { id: 'p2', eventId, userId: 'someone', status: 'PAID', paymentMethod: 'AT_VENUE' },
        // Neither a card order nor a cancelled one counts.
        { id: 'p3', eventId, userId: buyer, status: 'PAID', paymentMethod: 'CARD' },
        { id: 'p4', eventId, userId: buyer, status: 'CANCELLED', paymentMethod: 'AT_VENUE' },
      ],
      orderItem: [
        { id: 'l1', orderId: 'p1', quantity: 3, venueDueCents: 2 },
        { id: 'l2', orderId: 'p2', quantity: 3, venueDueCents: 12000 },
        { id: 'l4', orderId: 'p4', quantity: 2, venueDueCents: 8000 },
      ],
      ticket: [
        { id: 't1', orderItemId: 'l2', status: 'VALID', venueDueCents: 4000 },
        {
          id: 't2',
          orderItemId: 'l2',
          status: 'CHECKED_IN',
          venueDueCents: 4000,
          venuePaymentId: 'v',
        },
        { id: 't3', orderItemId: 'l2', status: 'TRANSFER_PENDING', venueDueCents: 4000 },
      ],
    })

    const [count] = await prisma.$queryRaw`
      -- venue-booking-count
      SELECT 0::int AS "eventUnpaid" WHERE ${eventId} IS NOT NULL`

    // The event's own count, and nothing per account (open question 1): the
    // buyer's 2 pending tickets are inside the 4, never answered on their own.
    expect(count).toEqual({ eventUnpaid: 4 })
  })
})

describe('the SPEC3-XI cancellation fixture on the stub (§4.7)', () => {
  it('cancels unpaid tickets as the service does: an open offer withdrawn, the pass dead', async () => {
    const now = new Date('2026-10-09T18:00:00.000Z')
    const prisma = createPrismaStub({
      organization: [{ id: 'org1', name: 'Org' }],
      event: [{ id: 'ev1', organizationId: 'org1', status: 'ON_SALE' }],
      ticketType: [{ id: 'tt1', eventId: 'ev1', quantityTotal: 10, quantitySold: 3 }],
      order: [
        {
          id: 'o1',
          eventId: 'ev1',
          userId: 'buyer',
          status: 'PAID',
          paymentMethod: 'AT_VENUE',
          currency: 'USD',
          subtotalCents: 6_000,
          feesCents: 300,
          totalCents: 300,
          venueDueCents: 6_000,
        },
      ],
      orderItem: [
        {
          id: 'l1',
          orderId: 'o1',
          ticketTypeId: 'tt1',
          quantity: 3,
          unitPriceCents: 2_000,
          venueDueCents: 6_000,
        },
      ],
      ticket: [
        {
          id: 't1',
          orderItemId: 'l1',
          status: 'VALID',
          ownerUserId: 'buyer',
          venueDueCents: 2_000,
          credentialHash: 'pass-1',
          credentialVersion: 1,
        },
        {
          id: 't2',
          orderItemId: 'l1',
          status: 'TRANSFER_PENDING',
          ownerUserId: 'buyer',
          venueDueCents: 2_000,
          credentialHash: 'pass-2',
          credentialVersion: 1,
        },
        {
          id: 't3',
          orderItemId: 'l1',
          status: 'TRANSFER_PENDING',
          ownerUserId: 'buyer',
          venueDueCents: 2_000,
          credentialHash: 'pass-3',
          credentialVersion: 1,
        },
      ],
      ticketTransfer: [
        { id: 'offer-2', ticketId: 't2', fromUserId: 'buyer', status: 'PENDING' },
        { id: 'declined-2', ticketId: 't2', fromUserId: 'buyer', status: 'DECLINED' },
        // An offer on a ticket this cancellation leaves alone stays open.
        { id: 'offer-3', ticketId: 't3', fromUserId: 'buyer', status: 'PENDING' },
      ],
    })

    const { cancellation, order, tickets } = await cancelledUnpaidFixture(prisma, {
      order: { id: 'o1' },
      tickets: [{ id: 't1' }, { id: 't2' }],
      now,
    })

    // XU1 and SPEC3-XI §2.2 step 6: the offer outstanding on a cancelled
    // ticket is withdrawn in the same writes, never left open on a ticket
    // that no longer admits anybody.
    expect(prisma._store.ticketTransfer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'offer-2', status: 'CANCELLED', cancelledAt: now }),
        expect.objectContaining({ id: 'declined-2', status: 'DECLINED' }),
        expect.objectContaining({ id: 'offer-3', status: 'PENDING' }),
      ]),
    )
    // The pass dies with the ticket, as every withdrawal kills it: the
    // credential cleared and its version moved, so an old QR matches nothing.
    expect(tickets.map((ticket) => ticket.id).sort()).toEqual(['t1', 't2'])

    for (const ticket of tickets) {
      expect(ticket).toMatchObject({
        status: 'REVOKED',
        revokedAt: now,
        revokedReason: `${VENUE_UNPAID_REASON_PREFIX}${cancellation.id}`,
        credentialHash: null,
        credentialVersion: 2,
        venueCancellationId: cancellation.id,
      })
    }

    // 4000 of 6000 cancelled: 300 × 4000 / 6000 = 200 of the fee kept.
    expect(cancellation).toMatchObject({ ticketCount: 2, basisCents: 4_000, feeKeptCents: 200 })
    expect(order).toMatchObject({ venueCancelledBasisCents: 4_000, venueFeeKeptCents: 200 })
    expect(order.items[0].venueCancelledQuantity).toBe(2)
    expect((await prisma.ticketType.findUnique({ where: { id: 'tt1' } })).quantitySold).toBe(1)
  })
})

describe('the SPEC3 accounts fixture (§4.7)', () => {
  it('adds a finance administrator, an organisation finance member, a scoped scanner and a member administrator', async () => {
    const world = await makeWorld()
    const before = world.seed.user.length
    const accounts = paymentTermsAccountsFixture(world.ids)

    addRows(world.seed, accounts.rows)

    expect(world.seed.user).toHaveLength(before + 4)
    expect(accounts.financeAdministrator).toMatchObject({
      email: 'farah-finance@desi-event.example',
      role: 'FINANCE_ADMIN',
    })
    expect(accounts.memberAdministrator.role).toBe('ADMIN')
    expect(
      world.seed.membership.filter((row) => row.organizationId === world.ids.organization.id),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: accounts.organizationFinance.id, role: 'FINANCE' }),
        expect.objectContaining({ userId: accounts.scanner.id, role: 'SCANNER' }),
        expect.objectContaining({ userId: accounts.memberAdministrator.id }),
      ]),
    )
    expect(world.seed.scannerScope).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          membershipId: accounts.scannerMembership.id,
          eventId: world.ids.publishedEvent.id,
        }),
      ]),
    )
  })

  it('makes referral code texts at run time, in the generated codes’ pattern', () => {
    const texts = new Set(Array.from({ length: 20 }, () => generatedReferralText()))

    expect(texts.size).toBe(20)

    for (const text of texts) {
      expect(text).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/u)
    }
  })
})
