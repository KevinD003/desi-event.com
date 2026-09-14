import { describe, expect, it } from 'vitest'

import { computeOrderTotals } from '@desi-event/pricing'
import { createInMemoryProviderRegistry } from '@desi-event/providers'

import { bearer, createTestApp, feeConfig, signIn, taxRateBps } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'
import { makeWorld, minutesFromNow } from './helpers/fixtures.js'

/** Face value of the General Admission tier in the fixtures. */
const GA_PRICE = 150_000

/**
 * The totals a General Admission order comes to, derived rather than written
 * out by hand.
 *
 * These were hardcoded, and when the API began applying sales tax the figures
 * silently stopped describing what the server charges — including the amount
 * the declined-payment test uses as its trigger, which quietly stopped
 * declining anything. Computing them from the same functions the route uses
 * keeps the expectations honest without making them tautological: the
 * assertions below still pin down the individual columns.
 *
 * @param {number} quantity How many tickets.
 * @param {object} [promoCode] An optional promo row.
 * @returns {object} The totals for that order.
 */
function expectedTotals(quantity, promoCode = null) {
  return computeOrderTotals({
    items: [{ ticketTypeId: 'ga', quantity, unitPriceCents: GA_PRICE, name: 'General' }],
    promoCode,
    feeConfig: feeConfig('INR'),
    taxRateBps: taxRateBps('INR'),
    currency: 'INR',
    now: new Date(),
  })
}

/** The total a one-ticket General Admission order comes to. */
const ONE_TICKET_TOTAL = expectedTotals(1).totalCents

/**
 * Build a checkout payload.
 *
 * @param {object} ids Fixture ids.
 * @param {object} [overrides] Fields to override.
 * @returns {object} A `createOrderRequestSchema` payload.
 */
function checkout(ids, overrides = {}) {
  return {
    eventId: ids.publishedEvent.id,
    buyerEmail: 'priya@example.com',
    buyerName: 'Priya Sharma',
    items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
    ...overrides,
  }
}

/**
 * Place an order.
 *
 * @param {object} app The Fastify instance.
 * @param {object} payload The request body.
 * @param {object} [headers] Request headers.
 * @returns {Promise<object>} The inject result.
 */
function order(app, payload, headers = {}) {
  return app.inject({ method: 'POST', url: '/v1/orders', payload, headers })
}

/**
 * Take a hold and return its id.
 *
 * @param {object} app The Fastify instance.
 * @param {string} ticketTypeId The tier.
 * @param {number} quantity How many seats.
 * @returns {Promise<string>} The hold id.
 */
async function takeHold(app, ticketTypeId, quantity) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/holds',
    payload: { ticketTypeId, quantity },
  })
  expect(response.statusCode).toBe(201)
  return response.json().data.id
}

describe('POST /v1/orders', () => {
  it('prices the order server-side, issues tickets and converts the hold', async () => {
    const { app, prisma, ids } = await createTestApp()
    const holdId = await takeHold(app, ids.generalAdmission.id, 2)

    const response = await order(
      app,
      checkout(ids, {
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 2 }],
        holdIds: [holdId],
      }),
    )

    expect(response.statusCode).toBe(201)

    const { data } = response.json()
    const totals = expectedTotals(2)

    // Face value is pinned explicitly; the derived columns are checked against
    // the pricing package so the two cannot drift apart unnoticed.
    expect(totals.subtotalCents).toBe(300_000)
    expect(data).toMatchObject({
      status: 'PAID',
      currency: 'INR',
      subtotalCents: 300_000,
      discountCents: 0,
      feesCents: totals.feesCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
    })
    expect(data.reference).toMatch(/^DE-[0-9A-Z]+$/)
    expect(data.paidAt).toEqual(expect.any(String))

    expect(data.items).toHaveLength(1)
    expect(data.items[0]).toMatchObject({ quantity: 2, unitPriceCents: GA_PRICE, subtotalCents: 300_000 })

    expect(data.tickets).toHaveLength(2)
    expect(new Set(data.tickets.map((ticket) => ticket.code)).size).toBe(2)
    expect(data.tickets.every((ticket) => ticket.status === 'VALID')).toBe(true)

    expect(prisma._store.ticketType.find((tier) => tier.id === ids.generalAdmission.id).quantitySold).toBe(2)
    expect(prisma._store.ticketHold.find((row) => row.id === holdId)).toMatchObject({
      status: 'CONVERTED',
      orderId: data.id,
    })
    expect(prisma._store.payment).toHaveLength(1)
    expect(prisma._store.payment[0]).toMatchObject({
      status: 'SUCCEEDED',
      amountCents: totals.totalCents,
    })

    await app.close()
  })

  it('attributes the order to the signed-in buyer', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')

    const response = await order(app, checkout(ids), bearer(token))

    expect(response.statusCode).toBe(201)
    expect(response.json().data.userId).toEqual(expect.any(String))

    await app.close()
  })

  it('applies a promo code and records the redemption', async () => {
    const { app, prisma, ids } = await createTestApp()

    const response = await order(app, checkout(ids, { promoCode: 'garba10' }))

    expect(response.statusCode).toBe(201)

    const { data } = response.json()
    expect(data.discountCents).toBe(15_000)
    // The fee is charged on the discounted subtotal, not the list price.
    expect(data.feesCents).toBe(Math.round((GA_PRICE - 15_000) * 0.059) + 99)
    expect(data.totalCents).toBe(GA_PRICE - 15_000 + data.feesCents + data.taxCents)

    expect(prisma._store.promoCode[0].redemptionCount).toBe(1)

    await app.close()
  })

  it('does not consume a redemption for a promo code that gave no discount', async () => {
    // Regression guard. `computeDiscount` correctly returns zero for a code
    // that has expired or been switched off, but the route used to increment
    // the counter and stamp the order regardless. Quoting a paused campaign
    // enough times burned it to its cap, so real buyers got nothing, and
    // full-price revenue was attributed to a promo that never applied.
    const world = await makeWorld()
    world.seed.promoCode.push({
      id: cuid(),
      organizationId: world.ids.organization.id,
      eventId: world.ids.publishedEvent.id,
      code: 'OLDCODE',
      type: 'PERCENTAGE',
      value: 2000,
      maxRedemptions: 2,
      redemptionCount: 0,
      startsAt: null,
      endsAt: new Date('2020-02-01T00:00:00.000Z'),
      active: true,
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
    })

    const { app, prisma, ids } = await createTestApp({ seed: world.seed, ids: world.ids })

    const response = await order(app, checkout(ids, { promoCode: 'OLDCODE' }))

    expect(response.statusCode).toBe(201)

    const { data } = response.json()
    expect(data.discountCents).toBe(0)
    expect(data.promoCodeId ?? null).toBeNull()

    const stored = prisma._store.promoCode.find((row) => row.code === 'OLDCODE')
    expect(stored.redemptionCount).toBe(0)

    await app.close()
  })

  it('ignores a userId in the body and attributes the order to the caller', async () => {
    // Regression guard: the route used `body.userId ?? actor.id`, so an
    // anonymous request could attach its order to anyone's account.
    const { app, prisma, ids } = await createTestApp()

    const response = await order(app, checkout(ids, { userId: ids.attendee.id }))

    expect(response.statusCode).toBe(201)
    expect(prisma._store.order[0].userId).toBeNull()

    await app.close()
  })

  it('skips the payment provider entirely when the total is zero', async () => {
    const { app, prisma, ids } = await createTestApp()

    prisma._store.promoCode.push({
      id: cuid(),
      organizationId: ids.organization.id,
      eventId: null,
      code: 'FREEFORALL',
      type: 'PERCENTAGE',
      value: 10_000,
      redemptionCount: 0,
      maxRedemptions: null,
      startsAt: null,
      endsAt: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const response = await order(app, checkout(ids, { promoCode: 'FREEFORALL' }))

    expect(response.statusCode).toBe(201)
    expect(response.json().data.totalCents).toBe(0)
    expect(response.json().data.tickets).toHaveLength(1)
    expect(prisma._store.payment).toHaveLength(0)

    await app.close()
  })

  it('rejects an unknown promo code without charging anything', async () => {
    const { app, prisma, ids } = await createTestApp()

    const response = await order(app, checkout(ids, { promoCode: 'NOPE99' }))

    expect(response.statusCode).toBe(422)
    expect(prisma._store.order).toHaveLength(0)

    await app.close()
  })

  it('leaves nothing behind when the payment is declined', async () => {
    const providers = createInMemoryProviderRegistry({
      payments: { declineAmountCents: ONE_TICKET_TOTAL },
    })
    const { app, prisma, ids } = await createTestApp({ providers })
    const holdId = await takeHold(app, ids.generalAdmission.id, 1)

    const response = await order(app, checkout(ids, { holdIds: [holdId] }))

    expect(response.statusCode).toBe(402)
    expect(response.json().error.code).toBe('PAYMENT_DECLINED')

    // Every write inside the transaction is gone.
    expect(prisma._store.order).toHaveLength(0)
    expect(prisma._store.orderItem).toHaveLength(0)
    expect(prisma._store.ticket).toHaveLength(0)
    expect(prisma._store.payment).toHaveLength(0)
    expect(prisma._store.ticketType.find((tier) => tier.id === ids.generalAdmission.id).quantitySold).toBe(0)
    // The buyer keeps their reservation and can retry with another card.
    expect(prisma._store.ticketHold.find((row) => row.id === holdId).status).toBe('ACTIVE')

    await app.close()
  })

  it('leaves nothing behind when the capture fails after authorisation', async () => {
    const base = createInMemoryProviderRegistry()
    const providers = {
      ...base,
      payments: {
        ...base.payments,
        capture: () => {
          const error = new Error('Issuer timed out during capture')
          Object.assign(error, { name: 'ProviderError', code: 'PAYMENT_DECLINED', statusCode: 402, issues: [] })
          throw error
        },
      },
    }

    const { app, prisma, ids } = await createTestApp({ providers })

    const response = await order(app, checkout(ids))

    expect(response.statusCode).toBe(402)
    expect(prisma._store.order).toHaveLength(0)
    expect(prisma._store.ticket).toHaveLength(0)

    await app.close()
  })

  it('does not count the buyer own hold against their own order', async () => {
    const { app, prisma, ids } = await createTestApp()

    // One seat left, and the buyer is holding it.
    prisma._store.ticketType.find((tier) => tier.id === ids.vip.id).quantitySold = 3
    const holdId = await takeHold(app, ids.vip.id, 1)

    const response = await order(
      app,
      checkout(ids, { items: [{ ticketTypeId: ids.vip.id, quantity: 1 }], holdIds: [holdId] }),
    )

    expect(response.statusCode).toBe(201)

    await app.close()
  })

  it('refuses an order for stock that somebody else is holding', async () => {
    const { app, prisma, ids } = await createTestApp()

    prisma._store.ticketType.find((tier) => tier.id === ids.vip.id).quantitySold = 3
    await takeHold(app, ids.vip.id, 1)

    const response = await order(
      app,
      checkout(ids, { items: [{ ticketTypeId: ids.vip.id, quantity: 1 }] }),
    )

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('INSUFFICIENT_INVENTORY')

    await app.close()
  })

  it('cannot be raced into an oversell', async () => {
    const { app, prisma, ids } = await createTestApp()

    prisma._store.ticketType.find((tier) => tier.id === ids.vip.id).quantitySold = 3

    const payload = checkout(ids, { items: [{ ticketTypeId: ids.vip.id, quantity: 1 }] })
    const [first, second] = await Promise.all([order(app, payload), order(app, payload)])

    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409])
    expect(prisma._store.ticket).toHaveLength(1)
    expect(prisma._store.ticketType.find((tier) => tier.id === ids.vip.id).quantitySold).toBe(4)

    await app.close()
  })

  it('answers 410 for a hold that lapsed between the cart and the card', async () => {
    const { app, prisma, ids } = await createTestApp()
    const holdId = await takeHold(app, ids.generalAdmission.id, 1)

    prisma._store.ticketHold.find((row) => row.id === holdId).expiresAt = minutesFromNow(-1)

    const response = await order(app, checkout(ids, { holdIds: [holdId] }))

    expect(response.statusCode).toBe(410)
    expect(response.json().error.code).toBe('HOLD_EXPIRED')
    expect(prisma._store.order).toHaveLength(0)

    await app.close()
  })

  it('refuses a hold that has already paid for another order', async () => {
    const { app, prisma, ids } = await createTestApp()
    const holdId = await takeHold(app, ids.generalAdmission.id, 1)
    prisma._store.ticketHold.find((row) => row.id === holdId).status = 'CONVERTED'

    const response = await order(app, checkout(ids, { holdIds: [holdId] }))

    expect(response.statusCode).toBe(409)

    await app.close()
  })

  it('refuses an unknown hold and a hold for a tier outside the order', async () => {
    const { app, ids } = await createTestApp()
    const otherHold = await takeHold(app, ids.vip.id, 1)

    const unknown = await order(app, checkout(ids, { holdIds: ['cnosuchhold00000000000zz'] }))
    const mismatched = await order(app, checkout(ids, { holdIds: [otherHold] }))

    expect(unknown.statusCode).toBe(404)
    expect(mismatched.statusCode).toBe(409)

    await app.close()
  })

  it('refuses a tier that belongs to a different event', async () => {
    const { app, ids } = await createTestApp()

    const response = await order(
      app,
      checkout(ids, { items: [{ ticketTypeId: ids.draftTier.id, quantity: 1 }] }),
    )

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('refuses an event that is not published and a tier that is paused', async () => {
    const { app, ids } = await createTestApp()

    const draft = await order(
      app,
      checkout(ids, {
        eventId: ids.draftEvent.id,
        items: [{ ticketTypeId: ids.draftTier.id, quantity: 1 }],
      }),
    )
    const paused = await order(
      app,
      checkout(ids, { items: [{ ticketTypeId: ids.pausedTier.id, quantity: 1 }] }),
    )

    expect(draft.statusCode).toBe(422)
    expect(paused.statusCode).toBe(422)

    await app.close()
  })

  it('rejects the same tier listed twice instead of silently combining it', async () => {
    const { app, ids } = await createTestApp()

    const response = await order(
      app,
      checkout(ids, {
        items: [
          { ticketTypeId: ids.generalAdmission.id, quantity: 3 },
          { ticketTypeId: ids.generalAdmission.id, quantity: 3 },
        ],
      }),
    )

    expect(response.statusCode).toBe(400)
    expect(response.json().error.issues[0].path).toBe('items[1].ticketTypeId')

    await app.close()
  })
})

describe('GET /v1/orders/:reference', () => {
  /**
   * Place an order and return its reference.
   *
   * @param {object} app The Fastify instance.
   * @param {object} ids Fixture ids.
   * @returns {Promise<string>} The order reference.
   */
  async function place(app, ids) {
    const response = await order(app, checkout(ids))
    expect(response.statusCode).toBe(201)
    return response.json().data.reference
  }

  it('lets the buyer read their own order by email match', async () => {
    const { app, ids } = await createTestApp()
    const reference = await place(app, ids)
    const token = await signIn(app, 'priya@example.com')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/orders/${reference}`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.reference).toBe(reference)
    expect(response.json().data.event.slug).toBe('navratri-garba-night')

    await app.close()
  })

  it('lets an organisation member with order:view read it', async () => {
    const { app, ids } = await createTestApp()
    const reference = await place(app, ids)
    const token = await signIn(app, 'finance@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/orders/${reference}`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)

    await app.close()
  })

  it('refuses a caller from another organisation and an anonymous caller', async () => {
    const { app, ids } = await createTestApp()
    const reference = await place(app, ids)
    const outsiderToken = await signIn(app, 'rival@dhol.example')

    const outsider = await app.inject({
      method: 'GET',
      url: `/v1/orders/${reference}`,
      headers: bearer(outsiderToken),
    })
    const anonymous = await app.inject({ method: 'GET', url: `/v1/orders/${reference}` })

    expect(outsider.statusCode).toBe(403)
    expect(anonymous.statusCode).toBe(401)

    await app.close()
  })

  it('answers 404 for an unknown reference', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/orders/DE-NOSUCH',
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })
})

describe('GET /v1/orders', () => {
  it('lists only the caller own orders, newest first', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')

    await order(app, checkout(ids), bearer(token))
    await order(app, checkout(ids), bearer(token))
    await order(app, checkout(ids, { buyerEmail: 'someone-else@example.com' }))

    const response = await app.inject({
      method: 'GET',
      url: '/v1/orders?perPage=10',
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toHaveLength(2)
    expect(response.json().pagination.total).toBe(2)

    await app.close()
  })

  it('rejects an anonymous caller', async () => {
    const { app } = await createTestApp()

    expect((await app.inject({ method: 'GET', url: '/v1/orders' })).statusCode).toBe(401)

    await app.close()
  })
})
