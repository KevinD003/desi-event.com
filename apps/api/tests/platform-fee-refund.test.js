/**
 * Refunding one order's booking fee by hand (SPEC3 §7.4, §14.2):
 * `platformFees.preview` and `platformFees.refund`, through the routes against
 * the stub database and the in-memory payment provider.
 *
 * What is refunded is what is left of the order's booking fee and the tax that
 * fee carried — on a card order taxed in Ontario, the fee's share of the tax;
 * on a pay-at-the-venue order, which is taxed on its fee alone, all of it —
 * and nothing else: no ticket is withdrawn, the order's status does not
 * change, and a refund that happens to take everything left is still a refund
 * of the fee, never of the whole order.
 */

import { describe, expect, it } from 'vitest'

import { createInMemoryProviderRegistry } from '@desi-event/providers'

import { AUDIT_ACTIONS } from '../src/lib/audit.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { addRows, makeWorld, paymentTermsAccountsFixture } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

const ADMIN = 'anil@desi-event.example'
const SUPER_ADMIN = 'ops@desi-event.example'
const MODERATOR = 'maya@desi-event.example'
const OWNER = 'owner@rangoli.example'
const BUYER = 'priya@example.com'

const PRICE = 4_000
const FEE = 300

/**
 * A paid order of two $40 tickets with its captured payment.
 *
 * - `card`: paid by card in Ontario, 13 % on the tickets and the fee
 *   (N = 8,000, F = 600, T = applyBps(8,600, 1,300) = 1,118).
 * - `venue`: booked to pay at the door; online, the $6 booking fee only.
 *
 * @param {object} ids `makeWorld().ids`.
 * @param {object} providers The provider registry.
 * @param {object} options Options.
 * @param {'card'|'venue'} options.kind Which.
 * @param {string} options.reference The order's reference.
 * @param {string|null} [options.buyerId] The buyer's account; null for a guest order.
 * @param {string} [options.buyerEmail] The address the order was placed with.
 * @returns {object} `{ rows, order, payment, tickets }`.
 */
function paidOrder(
  ids,
  providers,
  { kind, reference, buyerId = ids.attendee.id, buyerEmail = BUYER },
) {
  const paidAt = new Date('2026-09-01T12:00:00.000Z')
  const subtotal = 2 * PRICE
  const fees = 2 * FEE
  const venue = kind === 'venue'
  const tax = venue ? 0 : 1_118
  const total = venue ? fees : subtotal + fees + tax
  const intent = providers.payments.createIntent({ amountCents: total, currency: 'USD' })

  providers.payments.capture(intent.id)

  const order = {
    id: cuid(),
    reference,
    idempotencyKey: null,
    eventId: ids.publishedEvent.id,
    eventSessionId: null,
    userId: buyerId,
    buyerEmail,
    buyerName: 'Priya Sharma',
    status: 'PAID',
    currency: 'USD',
    subtotalCents: subtotal,
    discountCents: 0,
    feesCents: fees,
    taxCents: tax,
    totalCents: total,
    promoCodeId: null,
    refundedCents: 0,
    refundPendingCents: 0,
    expiresAt: null,
    paidAt,
    cancelledAt: null,
    createdAt: paidAt,
    updatedAt: paidAt,
    paymentMethod: venue ? 'AT_VENUE' : 'CARD',
    feeGrossCents: fees,
    venueDueCents: venue ? subtotal : 0,
  }
  const item = {
    id: cuid(),
    orderId: order.id,
    ticketTypeId: ids.generalAdmission.id,
    quantity: 2,
    unitPriceCents: PRICE,
    subtotalCents: subtotal,
    refundedQuantity: 0,
    refundedCents: 0,
    attendeeNames: [],
    venueDueCents: venue ? subtotal : 0,
    venueCancelledQuantity: 0,
  }
  const payment = {
    id: cuid(),
    orderId: order.id,
    provider: 'in-memory-payments',
    providerRef: intent.id,
    status: 'SUCCEEDED',
    amountCents: total,
    currency: 'USD',
    createdAt: paidAt,
    updatedAt: paidAt,
  }
  const tickets = [0, 1].map((index) => ({
    id: cuid(),
    orderItemId: item.id,
    code: `${reference}-${index + 1}`,
    credentialHash: `${reference.toLowerCase()}-pass-${index + 1}`,
    credentialVersion: 1,
    credentialIssuedAt: paidAt,
    attendeeName: null,
    ownerUserId: buyerId,
    eventSeatId: null,
    status: 'VALID',
    checkedInAt: null,
    revokedAt: null,
    revokedReason: null,
    supersedesTicketId: null,
    venueDueCents: venue ? PRICE : 0,
    venuePaymentId: null,
    venueCancellationId: null,
    createdAt: paidAt,
    updatedAt: paidAt,
  }))

  return {
    rows: { order: [order], orderItem: [item], payment: [payment], ticket: tickets },
    order,
    payment,
    tickets,
  }
}

/**
 * The world with a card order, a pay-at-the-venue order, an order bought by a
 * platform administrator signed in and one they bought as a guest with their
 * own address, and the staff accounts SPEC3 adds.
 *
 * @param {object} [options] Options.
 * @param {object} [options.rateLimit] Rate-limit overrides.
 * @returns {Promise<object>} The harness and the orders.
 */
async function withOrders({ rateLimit } = {}) {
  const world = await makeWorld()
  const providers = createInMemoryProviderRegistry()
  const accounts = paymentTermsAccountsFixture(world.ids)

  world.ids.generalAdmission.currency = 'USD'

  const card = paidOrder(world.ids, providers, { kind: 'card', reference: 'DE-FEECARD' })
  const venue = paidOrder(world.ids, providers, { kind: 'venue', reference: 'DE-FEEVENUE' })
  const own = paidOrder(world.ids, providers, {
    kind: 'card',
    reference: 'DE-FEEOWN',
    buyerId: world.ids.platformAdministrator.id,
  })
  // Bought signed out, with the administrator's own address in another case:
  // the order the rest of the API reads back to them as its buyer.
  const ownGuest = paidOrder(world.ids, providers, {
    kind: 'card',
    reference: 'DE-FEEOWNGUEST',
    buyerId: null,
    buyerEmail: ADMIN.toUpperCase(),
  })

  addRows(world.seed, accounts.rows)

  for (const bought of [card, venue, own, ownGuest]) addRows(world.seed, bought.rows)

  const harness = await createTestApp({
    seed: world.seed,
    ids: world.ids,
    providers,
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' }, ...rateLimit },
  })

  return { ...harness, accounts, card, venue, own, ownGuest }
}

/**
 * Signed-in, stepped-up headers.
 *
 * @param {object} app The application.
 * @param {string} email Who.
 * @returns {Promise<object>} The headers.
 */
async function as(app, email) {
  const headers = bearer(await signIn(app, email))

  await stepUp(app, email, headers)

  return headers
}

/**
 * Read an order's booking-fee figures.
 *
 * @param {object} app The application.
 * @param {object} headers Who asks.
 * @param {string} reference The order.
 * @returns {Promise<object>} The response.
 */
function preview(app, headers, reference) {
  return app.inject({ method: 'GET', url: `/v1/platform/orders/${reference}/fee`, headers })
}

/**
 * Refund an order's booking fee.
 *
 * @param {object} app The application.
 * @param {object} headers Who asks.
 * @param {string} reference The order.
 * @param {number} expectedRefundableCents The amount they were shown.
 * @returns {Promise<object>} The response.
 */
function refund(app, headers, reference, expectedRefundableCents) {
  return app.inject({
    method: 'POST',
    url: `/v1/platform/orders/${reference}/fee-refund`,
    headers,
    payload: { reason: 'Charged twice for the same booking.', expectedRefundableCents },
  })
}

/**
 * A stored row.
 *
 * @param {object} prisma The stub.
 * @param {string} model The model.
 * @param {string} id The id.
 * @returns {object} The row.
 */
function stored(prisma, model, id) {
  return prisma._store[model].find((row) => row.id === id)
}

describe('platformFees.preview', () => {
  it('gives an order’s booking-fee figures, with no buyer name or address, never cached', async () => {
    const { app, card } = await withOrders()
    const response = await preview(app, await as(app, ADMIN), card.order.reference)

    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.json().data).toEqual({
      reference: card.order.reference,
      eventId: card.order.eventId,
      eventTitle: 'Navratri Garba Night',
      status: 'PAID',
      paymentMethod: 'CARD',
      currency: 'USD',
      feesCents: 2 * FEE,
      feeWaivedCents: 0,
      feeRefundedCents: 0,
      refundableFeeCents: 2 * FEE,
      // The fee's share of the 13 % charged on tickets and fee together.
      taxOnFeeCents: Math.floor((1_118 * 600) / 8_600),
      feeKeptCents: 0,
      disputed: false,
    })
    expect(response.body).not.toContain(BUYER)
    expect(response.body).not.toContain('Priya')

    await app.close()
  })

  it('answers 404 for an order that does not exist, and 403 to a moderator', async () => {
    const { app, card } = await withOrders()

    expect((await preview(app, await as(app, ADMIN), 'DE-NOSUCH1')).statusCode).toBe(404)
    expect((await preview(app, await as(app, MODERATOR), card.order.reference)).statusCode).toBe(
      403,
    )

    await app.close()
  })
})

describe('platformFees.refund', () => {
  it('refunds a card order’s booking fee with its tax share, and nothing else', async () => {
    const { app, prisma, card, ids } = await withOrders()
    const headers = await as(app, ADMIN)
    const taxShare = Math.floor((1_118 * 600) / 8_600)
    const response = await refund(app, headers, card.order.reference, 2 * FEE + taxShare)

    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()

    expect(data.refund).toMatchObject({
      status: 'SUCCEEDED',
      amountCents: 2 * FEE + taxShare,
      reason: 'BOOKING_FEE',
    })
    expect(data.fee).toMatchObject({
      feeRefundedCents: 2 * FEE,
      refundableFeeCents: 0,
      taxOnFeeCents: 0,
    })

    const row = stored(prisma, 'refund', data.refund.id)

    // One administrator asked for it and approved it, as the form `fee`.
    expect(row.requestedById).toBe(ids.platformAdministrator.id)
    expect(row.approvedById).toBe(ids.platformAdministrator.id)
    expect(row.allocation).toMatchObject({
      form: 'fee',
      faceValueCents: 0,
      feeCents: 2 * FEE,
      taxCents: taxShare,
      basisCents: 0,
    })
    expect(prisma._store.refundItem.filter((item) => item.refundId === row.id)).toHaveLength(0)

    // The tickets stand and the order is still paid.
    for (const ticket of card.tickets)
      expect(stored(prisma, 'ticket', ticket.id).status).toBe('VALID')

    expect(stored(prisma, 'order', card.order.id)).toMatchObject({
      status: 'PAID',
      refundedCents: 2 * FEE + taxShare,
      refundPendingCents: 0,
    })

    // Audited as the refund's own steps, with the form and the route.
    const approved = prisma._store.auditLog.filter(
      (entry) => entry.action === AUDIT_ACTIONS.REFUND_APPROVED && entry.entityId === row.id,
    )

    expect(approved).toHaveLength(1)
    expect(approved[0].metadata).toMatchObject({ form: 'fee', via: 'platform_fee_refund' })

    // Nothing left: a second refund is refused, and refunds nothing twice.
    const again = await refund(app, headers, card.order.reference, 0)

    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('NO_FEE_TO_REFUND')

    await app.close()
  })

  it('refunds a pay-at-the-venue order’s booking fee — all it paid online — and the order stays PAID, its tickets standing', async () => {
    const { app, prisma, venue } = await withOrders()
    const response = await refund(app, await as(app, ADMIN), venue.order.reference, 2 * FEE)

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.refund).toMatchObject({
      status: 'SUCCEEDED',
      amountCents: 2 * FEE,
      paymentMethod: 'AT_VENUE',
      paidAtDoorCents: 0,
    })

    const row = stored(prisma, 'refund', response.json().data.refund.id)

    // Everything left on the order, and still the booking fee's refund: never
    // promoted to a refund of the whole order.
    expect(row.allocation).toMatchObject({ form: 'fee', basisCents: 0 })
    expect(row.allocation.whole).not.toBe(true)
    expect(stored(prisma, 'order', venue.order.id)).toMatchObject({
      status: 'PAID',
      refundedCents: 2 * FEE,
    })

    for (const ticket of venue.tickets) {
      expect(stored(prisma, 'ticket', ticket.id)).toMatchObject({
        status: 'VALID',
        venueDueCents: PRICE,
      })
    }

    await app.close()
  })

  it('records and answers that the booking fee’s refund withdrew no ticket and returned no place', async () => {
    const { app, prisma, card, venue } = await withOrders()
    const headers = await as(app, ADMIN)
    const taxShare = Math.floor((1_118 * 600) / 8_600)

    for (const [order, amount] of [
      [card.order, 2 * FEE + taxShare],
      [venue.order, 2 * FEE],
    ]) {
      const response = await refund(app, headers, order.reference, amount)

      expect(response.statusCode, response.body).toBe(200)

      const answered = response.json().data.refund

      expect(answered).toMatchObject({ ticketsRevoked: false, inventoryReturned: false })
      expect(stored(prisma, 'refund', answered.id)).toMatchObject({
        status: 'SUCCEEDED',
        ticketsRevoked: false,
        inventoryReturned: false,
      })
    }

    await app.close()
  })

  it('names how a card order was paid only when it was paid at the venue', async () => {
    const { app, card } = await withOrders()
    const taxShare = Math.floor((1_118 * 600) / 8_600)
    const response = await refund(
      app,
      await as(app, ADMIN),
      card.order.reference,
      2 * FEE + taxShare,
    )

    expect(response.statusCode, response.body).toBe(200)

    const answered = response.json().data.refund

    expect(answered).not.toHaveProperty('paymentMethod')
    expect(answered).not.toHaveProperty('paidAtDoorCents')

    await app.close()
  })

  it('is open to a finance administrator', async () => {
    const { app, accounts, venue } = await withOrders()
    const response = await refund(
      app,
      await as(app, accounts.financeAdministrator.email),
      venue.order.reference,
      2 * FEE,
    )

    expect(response.statusCode, response.body).toBe(200)

    await app.close()
  })

  it('refuses a moderator and an organisation owner', async () => {
    const { app, prisma, venue } = await withOrders()

    for (const email of [MODERATOR, OWNER]) {
      const response = await refund(app, await as(app, email), venue.order.reference, 2 * FEE)

      expect(response.statusCode, email).toBe(403)
    }

    expect(prisma._store.refund ?? []).toHaveLength(0)

    await app.close()
  })

  it('refuses the order’s own buyer, and an administrator who belongs to the event’s organisation, with CONFLICT_OF_INTEREST', async () => {
    const { app, prisma, accounts, own, venue } = await withOrders()
    const buyer = await refund(app, await as(app, ADMIN), own.order.reference, 2 * FEE)

    expect(buyer.statusCode).toBe(403)
    expect(buyer.json().error.code).toBe('CONFLICT_OF_INTEREST')

    const member = await refund(
      app,
      await as(app, accounts.memberAdministrator.email),
      venue.order.reference,
      2 * FEE,
    )

    expect(member.statusCode).toBe(403)
    expect(member.json().error.code).toBe('CONFLICT_OF_INTEREST')
    expect(prisma._store.refund ?? []).toHaveLength(0)

    await app.close()
  })

  it('refuses an administrator the fee of an order they bought as a guest with their own address, with CONFLICT_OF_INTEREST', async () => {
    const { app, prisma, ownGuest } = await withOrders()
    const headers = await as(app, ADMIN)
    const taxShare = Math.floor((1_118 * 600) / 8_600)

    // The rest of the API reads this order back to them as its buyer.
    const read = await app.inject({
      method: 'GET',
      url: `/v1/orders/${ownGuest.order.reference}`,
      headers,
    })

    expect(read.statusCode, read.body).toBe(200)

    const response = await refund(app, headers, ownGuest.order.reference, 2 * FEE + taxShare)

    expect(response.statusCode, response.body).toBe(403)
    expect(response.json().error).toMatchObject({
      code: 'CONFLICT_OF_INTEREST',
      message: 'This is your own order, so another administrator has to refund its booking fee.',
    })
    expect(prisma._store.refund ?? []).toHaveLength(0)
    expect(stored(prisma, 'order', ownGuest.order.id)).toMatchObject({
      status: 'PAID',
      refundedCents: 0,
      refundPendingCents: 0,
    })

    // Another administrator, who did not buy it, may.
    const other = await refund(
      app,
      await as(app, SUPER_ADMIN),
      ownGuest.order.reference,
      2 * FEE + taxShare,
    )

    expect(other.statusCode, other.body).toBe(200)

    await app.close()
  })

  it('refuses an amount other than the one shown with PRICE_CHANGED, and a disputed payment with PAYMENT_DISPUTED', async () => {
    const { app, prisma, venue } = await withOrders()
    const headers = await as(app, SUPER_ADMIN)
    const changed = await refund(app, headers, venue.order.reference, 2 * FEE - 1)

    expect(changed.statusCode).toBe(409)
    expect(changed.json().error.code).toBe('PRICE_CHANGED')

    prisma._store.dispute = [
      {
        id: cuid(),
        paymentId: venue.payment.id,
        provider: 'in-memory-payments',
        providerDisputeId: 'dp_fee_test',
        amountCents: 2 * FEE,
        currency: 'USD',
        reason: null,
        status: 'NEEDS_RESPONSE',
        evidenceDueAt: null,
        rawProviderStatus: null,
        fundsWithheld: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        closedAt: null,
      },
    ]

    expect((await preview(app, headers, venue.order.reference)).json().data.disputed).toBe(true)

    const disputed = await refund(app, headers, venue.order.reference, 2 * FEE)

    expect(disputed.statusCode).toBe(409)
    expect(disputed.json().error.code).toBe('PAYMENT_DISPUTED')
    expect(prisma._store.refund ?? []).toHaveLength(0)

    await app.close()
  })

  it('refuses an order that paid nothing online with NO_FEE_TO_REFUND', async () => {
    const { app, prisma, venue } = await withOrders()

    // The booking fee waived: nothing paid online, no payment taken.
    prisma._store.payment = prisma._store.payment.filter((row) => row.orderId !== venue.order.id)
    Object.assign(stored(prisma, 'order', venue.order.id), {
      feesCents: 0,
      feeWaivedCents: 2 * FEE,
      totalCents: 0,
    })

    const headers = await as(app, ADMIN)

    expect((await preview(app, headers, venue.order.reference)).json().data).toMatchObject({
      refundableFeeCents: 0,
      feeWaivedCents: 2 * FEE,
    })

    const response = await refund(app, headers, venue.order.reference, 0)

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('NO_FEE_TO_REFUND')

    await app.close()
  })

  it('asks for a second factor, and is limited per administrator', async () => {
    const { app, card, venue } = await withOrders({ rateLimit: { feeRefund: { max: 1 } } })
    const headers = bearer(await signIn(app, ADMIN))

    for (const session of app.testPrisma._store.session) {
      session.mfaSatisfiedAt = new Date(Date.now() - 60 * 60_000)
    }

    const stale = await refund(app, headers, venue.order.reference, 2 * FEE)

    expect(stale.statusCode).toBe(403)
    expect(stale.json().error.code).toBe('STEP_UP_REQUIRED')

    await stepUp(app, ADMIN, headers)

    expect((await refund(app, headers, venue.order.reference, 2 * FEE)).statusCode).toBe(200)

    const limited = await refund(app, headers, card.order.reference, 2 * FEE)

    expect(limited.statusCode).toBe(429)

    await app.close()
  })
})
