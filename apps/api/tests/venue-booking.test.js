/**
 * Booking to pay at the venue, through checkout, against the stub (SPEC3 §6,
 * §9.2, §14.2; SPEC3-XI §1.2, §6.4): what the order records, how settlement
 * splits the door price across the tickets, the fee-only ledger batch, the
 * zero-online path a referral code makes, the one limit (the event's — there
 * is none per account), and what the buyer's order and wallet then say.
 *
 * @module @desi-event/api/tests/venue-booking
 */

import { describe, expect, it } from 'vitest'

import { splitAcrossTickets } from '@desi-event/pricing'

import { bearer, createTestApp, signIn } from './helpers/app.js'
import { referralCodeFixture } from './helpers/fee-orders.js'

/** Face value of the fixture's General Admission tier (INR paise). */
const GA_PRICE = 150_000

/**
 * The published event with paying at the venue on, and its General Admission
 * tier roomy enough for the limits under test.
 *
 * @param {object} prisma The stub.
 * @param {object} ids World ids.
 * @param {number} [limit] The event's limit.
 * @returns {void}
 */
function venueOn(prisma, ids, limit = 50) {
  Object.assign(
    prisma._store.event.find((row) => row.id === ids.publishedEvent.id),
    {
      venuePaymentEnabled: true,
      venuePaymentLimit: limit,
      venuePaymentChangedAt: new Date(),
    },
  )
  Object.assign(
    prisma._store.ticketType.find((row) => row.id === ids.generalAdmission.id),
    { quantityTotal: 500, maxPerOrder: 50 },
  )
}

/**
 * Place an order to pay at the venue.
 *
 * @param {object} app The app.
 * @param {object} ids World ids.
 * @param {object} headers Whose request.
 * @param {number} quantity How many General Admission tickets.
 * @param {object} [extra] More of the body.
 * @returns {Promise<object>} The response.
 */
function book(app, ids, headers, quantity, extra = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/orders',
    headers,
    payload: {
      eventId: ids.publishedEvent.id,
      buyerEmail: 'priya@example.com',
      buyerName: 'Priya Sharma',
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity }],
      paymentMethod: 'AT_VENUE',
      ...extra,
    },
  })
}

/**
 * The batch posted for an order, by account code.
 *
 * @param {object} prisma The stub.
 * @param {string} orderId The order.
 * @returns {Promise<Map<string, object>|null>} Entries by account code.
 */
async function ledgerFor(prisma, orderId) {
  const batch = await prisma.ledgerBatch.findFirst({
    where: { sourceType: 'ORDER', sourceId: orderId },
    include: { entries: true },
  })

  if (!batch) return null

  const accounts = await prisma.ledgerAccount.findMany({})
  const codeById = new Map(accounts.map((row) => [row.id, row.code]))

  return {
    batch,
    byAccount: new Map(batch.entries.map((line) => [codeById.get(line.accountId), line])),
  }
}

describe('booking to pay at the venue', () => {
  it('records the terms, takes only the booking fee online and gives each ticket its share of the door price', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))

    venueOn(prisma, ids)

    const response = await book(app, ids, headers, 3)

    expect(response.statusCode).toBe(201)

    const order = prisma._store.order[0]
    const due = GA_PRICE * 3

    expect(order).toMatchObject({
      status: 'PAID',
      paymentMethod: 'AT_VENUE',
      feeSource: 'SITE_DEFAULT',
      feePercentageBps: 590,
      feeFlatCentsPerTicket: 99,
      feeWaivedCents: 0,
      referralCodeId: null,
      subtotalCents: due,
      venueDueCents: due,
      taxCents: 0,
    })
    expect(order.feeGrossCents).toBe(order.feesCents)
    expect(order.totalCents).toBe(order.feesCents + order.taxCents)
    expect(order.pricingSnapshot).toMatchObject({
      snapshotVersion: 2,
      paymentMethod: 'AT_VENUE',
      fee: { source: 'SITE_DEFAULT', settingId: null, chargedCents: order.feesCents },
      tax: { applied: false, appliedTo: 'NOTHING', notAppliedReason: 'PAID_AT_VENUE' },
    })

    const line = prisma._store.orderItem.find((row) => row.orderId === order.id)
    const tickets = prisma._store.ticket.filter((row) => row.orderItemId === line.id)

    expect(line.venueDueCents).toBe(due)
    expect(tickets.map((ticket) => ticket.venueDueCents)).toEqual(splitAcrossTickets(due, 3))
    expect(tickets.reduce((sum, ticket) => sum + ticket.venueDueCents, 0)).toBe(due)
    expect(tickets.every((ticket) => ticket.venuePaymentId === null)).toBe(true)

    // The fee-only batch: Desi-Event's fee against the clearing account, and
    // no organiser share (the door price is not platform money).
    const { batch, byAccount } = await ledgerFor(prisma, order.id)

    expect(batch.debitCents).toBe(order.totalCents)
    expect(batch.creditCents).toBe(order.totalCents)
    expect(byAccount.get('platform_fee_revenue').amountCents).toBe(order.feesCents)
    expect(byAccount.has('organizer_payable')).toBe(false)

    // The buyer's order says where it stands at the door; the fee's source
    // is not theirs to read.
    const read = response.json().data

    expect(read).toMatchObject({
      paymentMethod: 'AT_VENUE',
      referralApplied: false,
      fee: { percentageBps: 590, flatCentsPerTicket: 99 },
      tax: { applied: false, appliedTo: 'NOTHING' },
      venuePayment: {
        dueCents: due,
        paidCents: 0,
        unpaidTickets: 3,
        unpaidCents: due,
        cancelledTickets: 0,
        feeKeptCents: 0,
        state: 'TO_PAY',
      },
      venueCancellations: [],
    })
    expect(read).not.toHaveProperty('feeSource')
    expect(read).not.toHaveProperty('referralCodeId')
    expect(read.tickets.map((ticket) => ticket.venuePayment)).toEqual(
      splitAcrossTickets(due, 3).map((share) => ({
        dueCents: share,
        paid: false,
        currency: 'INR',
        cancelled: null,
        paidAtDoorByYou: false,
      })),
    )

    // The audit row says how it was paid and what the fee came to.
    expect(
      prisma._store.auditLog.find((row) => row.action === 'order.paid').metadata,
    ).toMatchObject({
      paymentMethod: 'AT_VENUE',
      feeSource: 'SITE_DEFAULT',
      feeGrossCents: order.feesCents,
      feeWaivedCents: 0,
      referralCodeId: null,
      venueDueCents: due,
    })

    await app.close()
  })

  it('shows each ticket’s door price in the wallet', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))

    venueOn(prisma, ids)
    await book(app, ids, headers, 2)

    const wallet = await app.inject({ method: 'GET', url: '/v1/tickets', headers })

    expect(wallet.statusCode).toBe(200)
    expect(wallet.json().data.map((ticket) => ticket.venuePayment)).toEqual(
      splitAcrossTickets(GA_PRICE * 2, 2).map((share) => ({
        dueCents: share,
        paid: false,
        currency: 'INR',
        cancelled: null,
        paidAtDoorByYou: false,
      })),
    )

    await app.close()
  })

  it('books a booking whose fee a referral code waived on the zero-total path: no payment, the use taken', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))
    const { row, referralCode } = await referralCodeFixture(prisma, {
      createdById: ids.platformAdministrator.id,
    })

    venueOn(prisma, ids)

    const response = await book(app, ids, headers, 2, { referralCode })

    expect(response.statusCode).toBe(201)

    const order = prisma._store.order[0]

    expect(order).toMatchObject({
      status: 'PAID',
      paymentMethod: 'AT_VENUE',
      feesCents: 0,
      totalCents: 0,
      referralCodeId: row.id,
      venueDueCents: GA_PRICE * 2,
    })
    expect(order.feeWaivedCents).toBe(order.feeGrossCents)
    expect(order.feeGrossCents).toBeGreaterThan(0)
    expect(prisma._store.payment).toHaveLength(0)
    expect(prisma._store.referralCode[0].useCount).toBe(1)
    expect(response.json().data.referralApplied).toBe(true)
    expect(JSON.stringify(response.json())).not.toContain(referralCode)
    // Nothing moved online, so nothing is posted.
    expect(await ledgerFor(prisma, order.id)).toBeNull()

    await app.close()
  })

  it('holds the door figure the buyer saw: PRICE_CHANGED on expectedVenueDueCents, nothing written', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))

    venueOn(prisma, ids)

    const refused = await book(app, ids, headers, 2, { expectedVenueDueCents: GA_PRICE })

    expect(refused.statusCode).toBe(409)
    expect(refused.json().error).toMatchObject({
      code: 'PRICE_CHANGED',
      details: { venueDueCents: GA_PRICE * 2 },
    })
    expect(prisma._store.order).toHaveLength(0)

    await app.close()
  })
})

describe('the one limit: the event’s, across all buyers (SPEC3-XI §1.2)', () => {
  it('lets one account book 11 and then 30 unpaid tickets under a limit of 50', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))

    venueOn(prisma, ids, 50)

    expect((await book(app, ids, headers, 11)).statusCode).toBe(201)
    expect((await book(app, ids, headers, 30)).statusCode).toBe(201)
    expect(prisma._store.order.filter((row) => row.status === 'PAID')).toHaveLength(2)

    await app.close()
  })

  it('refuses the order that would pass the event’s limit with VENUE_PAYMENT_FULL, disclosing no count', async () => {
    const { app, prisma, ids } = await createTestApp()
    const priya = bearer(await signIn(app, 'priya@example.com'))
    const owner = bearer(await signIn(app, 'owner@rangoli.example'))

    venueOn(prisma, ids, 5)

    expect((await book(app, ids, priya, 3)).statusCode).toBe(201)

    const full = await book(app, ids, owner, 3)

    expect(full.statusCode).toBe(409)
    expect(full.json().error).toEqual({
      code: 'VENUE_PAYMENT_FULL',
      message: 'Paying at the venue is full for this event. You can still pay by card.',
      statusCode: 409,
      requestId: expect.any(String),
    })
    // Up to the limit is allowed; a card order is never counted.
    expect((await book(app, ids, owner, 2)).statusCode).toBe(201)
    expect((await book(app, ids, owner, 3, { paymentMethod: 'CARD' })).statusCode).toBe(201)

    for (const response of prisma._store.auditLog) {
      expect(JSON.stringify(response)).not.toContain('VENUE_PAYMENT_LIMIT')
    }

    await app.close()
  })

  it('counts with the event’s id as the statement’s only value', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))
    const counts = []
    const queryRaw = prisma.$queryRaw.bind(prisma)

    venueOn(prisma, ids)

    prisma.$queryRaw = (strings, ...values) => {
      if (strings.join('?').includes('venue-booking-count')) counts.push(values)

      return queryRaw(strings, ...values)
    }

    expect((await book(app, ids, headers, 1)).statusCode).toBe(201)
    expect(counts).toEqual([[ids.publishedEvent.id]])

    await app.close()
  })

  it('refuses to count a booking the quote alone prices, and no answer names a per-account limit', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))

    venueOn(prisma, ids, 1)

    // The quote takes no lock and counts nothing: it never refuses for the limit.
    const quote = await app.inject({
      method: 'POST',
      url: '/v1/orders/quote',
      headers,
      payload: {
        eventId: ids.publishedEvent.id,
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 4 }],
        paymentMethod: 'AT_VENUE',
      },
    })

    expect(quote.statusCode).toBe(200)

    const full = await book(app, ids, headers, 4)

    expect(full.json().error.code).toBe('VENUE_PAYMENT_FULL')
    expect(full.body).not.toContain('VENUE_PAYMENT_LIMIT')
    expect(quote.body).not.toContain('VENUE_PAYMENT_LIMIT')

    await app.close()
  })
})
