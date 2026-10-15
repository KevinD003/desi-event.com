import { describe, expect, it } from 'vitest'

import { computeOrderTotals } from '@desi-event/pricing'
import { createInMemoryProviderRegistry } from '@desi-event/providers'

import { bearer, createTestApp, feeConfig, holdHeaders, signIn, taxRateBps } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'
import { atVenueOrder, cancelledUnpaidFixture } from './helpers/fee-orders.js'
import { TEST_AUTH_SECRET, makeWorld, minutesFromNow } from './helpers/fixtures.js'
import { seedPicture } from './helpers/media-world.js'

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
    taxRateBps: taxRateBps('IN'),
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
async function takeHold(app, ticketTypeId, quantity, headers = {}) {
  const response = await app.inject({
    headers,
    method: 'POST',
    url: '/v1/holds',
    payload: { ticketTypeId, quantity },
  })
  expect(response.statusCode).toBe(201)
  return response.json().data
}

describe('POST /v1/orders', () => {
  it('sells tickets for an event whose sales an organiser has opened', async () => {
    // The lifecycle's ON_SALE, which the order path refused until Phase 4.
    const { app, prisma, ids } = await createTestApp()

    await prisma.event.update({ where: { id: ids.publishedEvent.id }, data: { status: 'ON_SALE' } })

    const held = await takeHold(app, ids.generalAdmission.id, 1)
    const response = await order(app, checkout(ids, { holdIds: [held.id] }), holdHeaders(held))

    expect(response.statusCode).toBe(201)
    expect(response.json().data).toMatchObject({ status: 'PAID', totalCents: ONE_TICKET_TOTAL })
  })

  it('refuses an order for an event whose sales are paused', async () => {
    const { app, prisma, ids } = await createTestApp()
    const held = await takeHold(app, ids.generalAdmission.id, 1)

    await prisma.event.update({
      where: { id: ids.publishedEvent.id },
      data: { status: 'SALES_PAUSED' },
    })

    const response = await order(app, checkout(ids, { holdIds: [held.id] }), holdHeaders(held))

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toMatch(/not on sale/i)
  })

  it('prices the order server-side, issues tickets and converts the hold', async () => {
    const { app, prisma, ids } = await createTestApp()
    const hold = await takeHold(app, ids.generalAdmission.id, 2)

    const response = await order(
      app,
      checkout(ids, {
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 2 }],
        holdIds: [hold.id],
      }),
      holdHeaders(hold),
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
    expect(data.items[0]).toMatchObject({
      quantity: 2,
      unitPriceCents: GA_PRICE,
      subtotalCents: 300_000,
    })

    expect(data.tickets).toHaveLength(2)
    expect(new Set(data.tickets.map((ticket) => ticket.code)).size).toBe(2)
    expect(data.tickets.every((ticket) => ticket.status === 'VALID')).toBe(true)

    expect(
      prisma._store.ticketType.find((tier) => tier.id === ids.generalAdmission.id).quantitySold,
    ).toBe(2)
    expect(prisma._store.ticketHold.find((row) => row.id === hold.id)).toMatchObject({
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

  describe('a promo code is the organiser’s own, for the events it names', () => {
    /**
     * A promo row.
     *
     * @param {object} fields What differs from a plain 50%-off code.
     * @returns {object} The row.
     */
    function promoRow(fields) {
      return {
        id: cuid(),
        type: 'PERCENTAGE',
        value: 5000,
        maxRedemptions: null,
        redemptionCount: 0,
        startsAt: null,
        endsAt: null,
        active: true,
        createdAt: new Date('2025-02-01T00:00:00.000Z'),
        updatedAt: new Date('2025-02-01T00:00:00.000Z'),
        ...fields,
      }
    }

    it('prices a code shared by two organisations on the event’s own organisation’s terms', async () => {
      // Codes are unique only within an organisation. Another organiser's
      // code with the same letters, listed first, must neither discount this
      // order nor lose a use to it.
      const world = await makeWorld()
      const theirs = promoRow({
        organizationId: world.ids.otherOrganization.id,
        eventId: null,
        code: 'DIWALI20',
        value: 5000,
      })
      const ours = promoRow({
        organizationId: world.ids.organization.id,
        eventId: null,
        code: 'DIWALI20',
        value: 2000,
      })
      world.seed.promoCode.unshift(theirs, ours)

      const { app, prisma, ids } = await createTestApp({ seed: world.seed, ids: world.ids })

      const response = await order(app, checkout(ids, { promoCode: 'DIWALI20' }))

      expect(response.statusCode).toBe(201)
      expect(response.json().data.discountCents).toBe(expectedTotals(1, ours).discountCents)
      expect(response.json().data.discountCents).toBe(GA_PRICE * 0.2)
      expect(prisma._store.order[0].promoCodeId).toBe(ours.id)
      expect(prisma._store.promoCode.find((row) => row.id === ours.id).redemptionCount).toBe(1)
      expect(prisma._store.promoCode.find((row) => row.id === theirs.id).redemptionCount).toBe(0)

      await app.close()
    })

    it('does not know another organisation’s code, at the charge or in the quote', async () => {
      const world = await makeWorld()
      const theirs = promoRow({
        organizationId: world.ids.otherOrganization.id,
        eventId: null,
        code: 'ONLYTHEIRS',
      })
      world.seed.promoCode.unshift(theirs)

      const { app, prisma, ids } = await createTestApp({ seed: world.seed, ids: world.ids })

      const charged = await order(app, checkout(ids, { promoCode: 'ONLYTHEIRS' }))
      expect(charged.statusCode).toBe(422)
      expect(charged.json().error.message).toBe(
        'Promo code "ONLYTHEIRS" is not valid for this event.',
      )

      const quoted = await app.inject({
        method: 'POST',
        url: '/v1/orders/quote',
        headers: bearer(await signIn(app, 'priya@example.com')),
        payload: {
          eventId: ids.publishedEvent.id,
          items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
          promoCode: 'ONLYTHEIRS',
        },
      })
      expect(quoted.statusCode).toBe(200)
      expect(quoted.json().data.promo).toMatchObject({ applied: false, reason: 'UNKNOWN' })

      expect(prisma._store.order).toHaveLength(0)
      expect(prisma._store.promoCode.find((row) => row.id === theirs.id).redemptionCount).toBe(0)

      await app.close()
    })

    it('refuses a code limited to one event on the organisation’s other events, as if it did not exist', async () => {
      const world = await makeWorld()
      const elsewhere = promoRow({
        organizationId: world.ids.organization.id,
        eventId: world.ids.approvedEvent.id,
        code: 'THATNIGHT',
      })
      world.seed.promoCode.unshift(elsewhere)

      const { app, prisma, ids } = await createTestApp({ seed: world.seed, ids: world.ids })

      const charged = await order(app, checkout(ids, { promoCode: 'THATNIGHT' }))
      expect(charged.statusCode).toBe(422)
      expect(charged.json().error.message).toBe(
        'Promo code "THATNIGHT" is not valid for this event.',
      )

      const quoted = await app.inject({
        method: 'POST',
        url: '/v1/orders/quote',
        headers: bearer(await signIn(app, 'priya@example.com')),
        payload: {
          eventId: ids.publishedEvent.id,
          items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
          promoCode: 'THATNIGHT',
        },
      })
      expect(quoted.json().data.promo).toMatchObject({ applied: false, reason: 'UNKNOWN' })
      expect(prisma._store.promoCode.find((row) => row.id === elsewhere.id).redemptionCount).toBe(0)

      await app.close()
    })
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

  it('rations promo-code attempts at checkout like the quote, for a guest too, and never a checkout without one', async () => {
    const { app, prisma, ids } = await createTestApp({
      rateLimit: {
        global: { max: 10_000, timeWindow: '1 minute' },
        quote: { max: 2, timeWindow: '1 minute' },
      },
    })

    // A guest with no account telling codes apart: an unknown one is refused,
    // a real one moves the total against a deliberately wrong figure. Both
    // before anything is written, so without a budget it was a free oracle.
    const unknown = await order(app, checkout(ids, { promoCode: 'WELCOME10' }))
    const known = await order(app, checkout(ids, { promoCode: 'GARBA10', expectedTotalCents: 1 }))

    expect(unknown.statusCode).toBe(422)
    expect(known.statusCode).toBe(409)
    expect(known.json().error.code).toBe('PRICE_CHANGED')

    const third = await order(app, checkout(ids, { promoCode: 'DIWALI20', expectedTotalCents: 1 }))
    expect(third.statusCode).toBe(429)
    expect(third.json().error.code).toBe('RATE_LIMITED')
    expect(prisma._store.order).toHaveLength(0)

    // Buying without a code is never counted against it.
    const plain = await order(app, checkout(ids))
    expect(plain.statusCode).toBe(201)

    // A signed-in buyer has a budget of their own.
    const headers = bearer(await signIn(app, 'priya@example.com'))
    const mine = await order(app, checkout(ids, { promoCode: 'WELCOME10' }), headers)
    expect(mine.statusCode).toBe(422)

    await app.close()
  })

  it('records a cancelled order and a failed attempt when the payment is declined', async () => {
    const providers = createInMemoryProviderRegistry({
      payments: { declineAmountCents: ONE_TICKET_TOTAL },
    })
    const { app, prisma, ids } = await createTestApp({ providers })
    const hold = await takeHold(app, ids.generalAdmission.id, 1)

    const response = await order(app, checkout(ids, { holdIds: [hold.id] }), holdHeaders(hold))

    expect(response.statusCode).toBe(402)
    expect(response.json().error.code).toBe('PAYMENT_DECLINED')

    // The order and the attempt survive on purpose. Rolling them away would
    // erase the evidence that a charge was attempted at all, which is exactly
    // what makes a provider-side charge impossible to reconcile later.
    expect(prisma._store.order).toHaveLength(1)
    expect(prisma._store.order[0].status).toBe('CANCELLED')
    expect(prisma._store.order[0].cancelledAt).toBeInstanceOf(Date)
    expect(prisma._store.payment).toHaveLength(1)
    expect(prisma._store.payment[0].status).toBe('FAILED')
    expect(prisma._store.payment[0].failureCode).toEqual(expect.any(String))

    // Nothing was fulfilled: no tickets, no inventory consumed.
    expect(prisma._store.ticket).toHaveLength(0)
    expect(
      prisma._store.ticketType.find((tier) => tier.id === ids.generalAdmission.id).quantitySold,
    ).toBe(0)
    // The buyer keeps their reservation and can retry with another card.
    expect(prisma._store.ticketHold.find((row) => row.id === hold.id).status).toBe('ACTIVE')

    await app.close()
  })

  it('fulfils nothing when the capture fails after authorisation', async () => {
    const base = createInMemoryProviderRegistry()
    const providers = {
      ...base,
      payments: {
        ...base.payments,
        capture: () => {
          const error = new Error('Issuer timed out during capture')
          Object.assign(error, {
            name: 'ProviderError',
            code: 'PAYMENT_DECLINED',
            statusCode: 402,
            issues: [],
          })
          throw error
        },
      },
    }

    const { app, prisma, ids } = await createTestApp({ providers })

    const response = await order(app, checkout(ids))

    expect(response.statusCode).toBe(402)
    expect(prisma._store.order[0].status).toBe('CANCELLED')
    expect(prisma._store.ticket).toHaveLength(0)

    await app.close()
  })

  it('does not count the buyer own hold against their own order', async () => {
    const { app, prisma, ids } = await createTestApp()

    // One seat left, and the buyer is holding it.
    prisma._store.ticketType.find((tier) => tier.id === ids.vip.id).quantitySold = 3
    const hold = await takeHold(app, ids.vip.id, 1)

    const response = await order(
      app,
      checkout(ids, { items: [{ ticketTypeId: ids.vip.id, quantity: 1 }], holdIds: [hold.id] }),
      holdHeaders(hold),
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
    const hold = await takeHold(app, ids.generalAdmission.id, 1)

    prisma._store.ticketHold.find((row) => row.id === hold.id).expiresAt = minutesFromNow(-1)

    const response = await order(app, checkout(ids, { holdIds: [hold.id] }), holdHeaders(hold))

    expect(response.statusCode).toBe(410)
    expect(response.json().error.code).toBe('HOLD_EXPIRED')
    expect(prisma._store.order).toHaveLength(0)

    await app.close()
  })

  it('refuses a hold that has already paid for another order', async () => {
    const { app, prisma, ids } = await createTestApp()
    const hold = await takeHold(app, ids.generalAdmission.id, 1)
    prisma._store.ticketHold.find((row) => row.id === hold.id).status = 'CONVERTED'

    const response = await order(app, checkout(ids, { holdIds: [hold.id] }), holdHeaders(hold))

    expect(response.statusCode).toBe(409)

    await app.close()
  })

  it('refuses an unknown hold and a hold for a tier outside the order', async () => {
    const { app, ids } = await createTestApp()
    const otherHold = await takeHold(app, ids.vip.id, 1)

    const unknown = await order(app, checkout(ids, { holdIds: ['cnosuchhold00000000000zz'] }))
    const mismatched = await order(
      app,
      checkout(ids, { holdIds: [otherHold.id] }),
      holdHeaders(otherHold),
    )

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

  it('carries the event’s approved cover, and no picture still waiting for review', async () => {
    const { app, ids, prisma } = await createTestApp()
    const reference = await place(app, ids)
    const token = await signIn(app, 'priya@example.com')
    const read = async () =>
      (
        await app.inject({ method: 'GET', url: `/v1/orders/${reference}`, headers: bearer(token) })
      ).json().data.event.coverImage

    const cover = seedPicture(prisma, { event: ids.publishedEvent, moderationStatus: 'PENDING' })

    expect(await read()).toBeNull()

    prisma._store.mediaAsset.find((row) => row.id === cover.id).moderationStatus = 'APPROVED'

    expect(await read()).toMatchObject({ id: cover.id, url: `/v1/media/${cover.id}` })

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

describe('POST /v1/orders: the total a buyer was shown, names on tickets, and the night', () => {
  /**
   * The published event's one night, from the fixture.
   *
   * @param {object} prisma The stub.
   * @param {object} ids Fixture ids.
   * @returns {object} The `EventSession` row.
   */
  function nightOf(prisma, ids) {
    return prisma._store.eventSession.find((row) => row.eventId === ids.publishedEvent.id)
  }

  it('refuses with PRICE_CHANGED, before anything is written, when the total moved', async () => {
    const { app, prisma, ids } = await createTestApp()
    const hold = await takeHold(app, ids.generalAdmission.id, 1)
    const auditsBefore = prisma._store.auditLog.length

    const response = await order(
      app,
      checkout(ids, {
        holdIds: [hold.id],
        promoCode: 'GARBA10',
        // The full price: what the buyer saw before the code applied.
        expectedTotalCents: ONE_TICKET_TOTAL,
      }),
      holdHeaders(hold),
    )

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('PRICE_CHANGED')
    expect(response.json().error.message).toMatch(/nothing has been charged/i)

    // Nothing: no order, no redemption, the hold still the buyer's and free.
    expect(prisma._store.order).toHaveLength(0)
    expect(prisma._store.payment).toHaveLength(0)
    expect(prisma._store.promoCode[0].redemptionCount).toBe(0)
    expect(prisma._store.ticketHold.find((row) => row.id === hold.id)).toMatchObject({
      status: 'ACTIVE',
      orderId: null,
    })
    expect(prisma._store.auditLog).toHaveLength(auditsBefore)

    await app.close()
  })

  it('charges when the expected total is the total', async () => {
    const { app, ids } = await createTestApp()

    const response = await order(app, checkout(ids, { expectedTotalCents: ONE_TICKET_TOTAL }))

    expect(response.statusCode).toBe(201)
    expect(response.json().data.totalCents).toBe(ONE_TICKET_TOTAL)

    await app.close()
  })

  it('puts each name on a ticket, and the buyer’s on a ticket nobody named', async () => {
    const { app, prisma, ids } = await createTestApp()

    const response = await order(
      app,
      checkout(ids, {
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 3 }],
        attendees: [
          { ticketTypeId: ids.generalAdmission.id, name: 'Asha Patel' },
          { ticketTypeId: ids.generalAdmission.id, name: 'Ravi Patel' },
        ],
      }),
    )

    expect(response.statusCode).toBe(201)

    const names = prisma._store.ticket.map((ticket) => ticket.attendeeName).sort()
    expect(names).toEqual(['Asha Patel', 'Priya Sharma', 'Ravi Patel'])

    // The staging copy is gone once the tickets carry the names.
    expect(prisma._store.orderItem.every((item) => item.attendeeNames.length === 0)).toBe(true)

    await app.close()
  })

  it('refuses more names than tickets, and a seat for a general-admission line', async () => {
    const { app, prisma, ids } = await createTestApp()

    const tooMany = await order(
      app,
      checkout(ids, {
        attendees: [
          { ticketTypeId: ids.generalAdmission.id, name: 'One' },
          { ticketTypeId: ids.generalAdmission.id, name: 'Two' },
        ],
      }),
    )

    // Refused by the request schema before the route runs.
    expect(tooMany.statusCode).toBe(400)

    const seatOnGeneral = await order(
      app,
      checkout(ids, {
        attendees: [{ ticketTypeId: ids.generalAdmission.id, eventSeatId: cuid(), name: 'Zara' }],
      }),
    )

    expect(seatOnGeneral.statusCode).toBe(422)
    expect(seatOnGeneral.json().error.problems).toEqual([
      'Name 1: that seat is not one this order holds.',
    ])
    // The refusal names positions, never the names themselves.
    expect(seatOnGeneral.body).not.toContain('Zara')
    expect(prisma._store.order).toHaveLength(0)

    await app.close()
  })

  it('refuses an address typed as a name', async () => {
    const { app, prisma, ids } = await createTestApp()

    const response = await order(
      app,
      checkout(ids, {
        attendees: [{ ticketTypeId: ids.generalAdmission.id, name: 'guest@example.com' }],
      }),
    )

    expect(response.statusCode).toBe(400)
    expect(prisma._store.order).toHaveLength(0)

    await app.close()
  })

  it('gives a limited code its use back when the card is declined', async () => {
    const world = await makeWorld()
    const promo = world.ids.promoCode
    promo.maxRedemptions = 1

    const discounted = expectedTotals(1, promo).totalCents
    const providers = createInMemoryProviderRegistry({
      payments: { declineAmountCents: discounted },
    })
    const { app, prisma, ids } = await createTestApp({
      seed: world.seed,
      ids: world.ids,
      providers,
    })

    const declined = await order(app, checkout(ids, { promoCode: 'GARBA10' }))

    expect(declined.statusCode).toBe(402)
    expect(prisma._store.promoCode[0].redemptionCount).toBe(0)

    const cancelled = prisma._store.auditLog.find((row) => row.action === 'order.cancelled')
    expect(cancelled.metadata.promoRedemptionReturned).toBe(true)
    // Never the code's text in an audit row.
    expect(JSON.stringify(cancelled.metadata)).not.toContain('GARBA10')

    // The use came back, so the next buyer still gets the discount.
    const second = await order(
      app,
      checkout(ids, { promoCode: 'GARBA10', buyerEmail: 'ravi@example.com' }),
    )
    expect(second.statusCode).toBe(402)

    await app.close()
  })

  it('names the night when every line is for one, and none when a line is for every night', async () => {
    const { app, prisma, ids } = await createTestApp()
    const night = nightOf(prisma, ids)

    await prisma.ticketType.update({
      where: { id: ids.vip.id },
      data: { eventSessionId: night.id },
    })

    const single = await order(
      app,
      checkout(ids, { items: [{ ticketTypeId: ids.vip.id, quantity: 1 }] }),
    )

    expect(single.statusCode).toBe(201)
    expect(prisma._store.order.at(-1).eventSessionId).toBe(night.id)

    const mixed = await order(
      app,
      checkout(ids, {
        items: [
          { ticketTypeId: ids.vip.id, quantity: 1 },
          { ticketTypeId: ids.generalAdmission.id, quantity: 1 },
        ],
      }),
    )

    expect(mixed.statusCode).toBe(201)
    expect(prisma._store.order.at(-1).eventSessionId).toBeNull()

    await app.close()
  })

  it('locks the promo code after the tier rows, so the two can never deadlock', async () => {
    const { app, prisma, ids } = await createTestApp()

    const response = await order(app, checkout(ids, { promoCode: 'GARBA10' }))

    expect(response.statusCode).toBe(201)

    const locks = prisma._rawQueries.map((query) => query.sql)
    const tier = locks.findIndex((sql) => sql.includes('"TicketType"'))
    const promo = locks.findIndex((sql) => sql.includes('"PromoCode"'))

    expect(tier).toBeGreaterThanOrEqual(0)
    expect(promo).toBeGreaterThan(tier)
    expect(prisma._rawQueries[promo].values).toEqual([ids.promoCode.id])

    await app.close()
  })

  it('lists each line’s tier and night, and gives the joining link to nobody for a venue event', async () => {
    const { app, prisma, ids } = await createTestApp()
    const night = nightOf(prisma, ids)

    await prisma.eventSession.update({ where: { id: night.id }, data: { label: 'Night 1' } })
    await prisma.ticketType.update({
      where: { id: ids.generalAdmission.id },
      data: { eventSessionId: night.id },
    })

    const response = await order(app, checkout(ids))

    expect(response.statusCode).toBe(201)

    const [item] = response.json().data.items
    expect(item).toMatchObject({
      ticketTypeName: 'General Admission',
      session: { id: night.id, label: 'Night 1', timezone: night.timezone },
    })
    expect(item).not.toHaveProperty('attendeeNames')
    expect(response.json().data.onlineJoinUrl).toBeNull()

    await app.close()
  })
})

/**
 * SPEC3 §11.3 and SPEC3-XI §11.2–§11.3, against the stub: what an order and a
 * wallet say about a booking to pay at the venue — where it stands at the
 * door, tickets passed on and paid by their new holders (XT7), unpaid tickets
 * cancelled and the booking fee kept for them, and who is named to whom.
 * Bookings are written with the helpers checkout's suites share
 * (`atVenueOrder`, `cancelledUnpaidFixture`), so nothing here waits on the
 * cancellation service.
 */
describe('a booking to pay at the venue, as its readers read it', () => {
  /**
   * A world and a PAID booking of three general-admission tickets.
   *
   * @param {function(object): object} [optionsFor] More `atVenueOrder` options, from the world's ids.
   * @returns {Promise<object>} The harness and the booking.
   */
  async function booking(optionsFor = () => ({})) {
    const harness = await createTestApp()
    const { prisma, providers, ids } = harness
    const session = prisma._store.eventSession.find((row) => row.eventId === ids.publishedEvent.id)
    const placed = await atVenueOrder(
      prisma,
      {
        event: ids.publishedEvent,
        session,
        tiers: { floor: ids.generalAdmission, balcony: ids.vip },
        promoCode: null,
      },
      {
        tag: 'readers',
        payments: providers.payments,
        credentialSecret: TEST_AUTH_SECRET,
        userId: ids.attendee.id,
        lines: [{ ticketTypeId: ids.generalAdmission.id, quantity: 3, unitPriceCents: 4_000 }],
        ...optionsFor(ids),
      },
    )

    return { ...harness, ...placed }
  }

  /**
   * Read an order as somebody.
   *
   * @param {object} app The app.
   * @param {string} reference The order.
   * @param {string} email Who.
   * @returns {Promise<object>} The order payload.
   */
  async function readAs(app, reference, email) {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/orders/${reference}`,
      headers: bearer(await signIn(app, email)),
    })

    expect(response.statusCode, email).toBe(200)

    return response.json().data
  }

  it('says what the buyer owes at the door, and gives the fee’s source only to the organisation', async () => {
    const { app, order } = await booking()
    const buyer = await readAs(app, order.reference, 'priya@example.com')

    expect(buyer.venuePayment).toEqual({
      dueCents: 12_000,
      paidCents: 0,
      unpaidTickets: 3,
      unpaidCents: 12_000,
      paidTickets: 0,
      paidByOthersTickets: 0,
      paidByOthersCents: 0,
      passedOnUnpaidTickets: 0,
      passedOnUnpaidCents: 0,
      cancelledTickets: 0,
      cancelledCents: 0,
      feeKeptCents: 0,
      state: 'TO_PAY',
    })
    expect(buyer).not.toHaveProperty('feeSource')

    const organiser = await readAs(app, order.reference, 'owner@rangoli.example')

    expect(organiser.feeSource).toBe('SITE_DEFAULT')

    for (const read of [buyer, organiser]) {
      expect(read).not.toHaveProperty('referralCodeId')
      expect(read).not.toHaveProperty('referralUseReturnedAt')
      expect(read).not.toHaveProperty('feeSettingId')
    }

    await app.close()
  })

  it('shows unpaid tickets cancelled by The Desi Events: the kept fee to the buyer, the administrator’s name to the organisation only', async () => {
    const { app, prisma, ids, order, tickets } = await booking()
    const reason = 'Not paid for at the door by the end of the night.'

    await cancelledUnpaidFixture(prisma, {
      order,
      tickets: [tickets[0]],
      reason,
      actor: { id: ids.platformAdministrator.id },
      authority: 'PLATFORM_ROLE',
      role: 'ADMIN',
    })

    const kept = prisma._store.order.find((row) => row.id === order.id).venueFeeKeptCents

    expect(kept).toBeGreaterThan(0)

    const buyer = await readAs(app, order.reference, 'priya@example.com')

    expect(buyer.venuePayment).toMatchObject({
      unpaidTickets: 2,
      unpaidCents: 12_000 - tickets[0].venueDueCents,
      cancelledTickets: 1,
      cancelledCents: tickets[0].venueDueCents,
      feeKeptCents: kept,
      state: 'TO_PAY',
    })
    expect(buyer.venueCancellations).toEqual([
      {
        at: expect.any(String),
        by: 'DESI_EVENT',
        ticketCount: 1,
        basisCents: tickets[0].venueDueCents,
        // The buyer's own ticket: none of it was passed on (XT7).
        passedOnTickets: 0,
        passedOnBasisCents: 0,
        feeKeptCents: kept,
        reason,
      },
    ])
    expect(buyer.tickets.find((ticket) => ticket.id === tickets[0].id).venuePayment).toMatchObject({
      paid: false,
      cancelled: { at: expect.any(String), by: 'DESI_EVENT' },
    })

    const organiser = await readAs(app, order.reference, 'owner@rangoli.example')

    expect(organiser.venueCancellations[0].byName).toBe('Anil Administrator')

    // The Desi Events team's own read names nobody (SPEC3-XI §4.6).
    const platform = await readAs(app, order.reference, 'ops@desi-event.example')

    expect(platform.venueCancellations[0]).not.toHaveProperty('byName')

    await app.close()
  })

  it('reads CANCELLED once every unpaid ticket is cancelled, and the wallet says so ticket by ticket', async () => {
    const { app, prisma, ids, order, tickets } = await booking()

    await cancelledUnpaidFixture(prisma, {
      order,
      tickets,
      actor: { id: ids.owner.id },
      authority: 'ORGANIZATION_ROLE',
      role: 'OWNER',
    })

    const buyer = await readAs(app, order.reference, 'priya@example.com')

    expect(buyer.venuePayment).toMatchObject({
      unpaidTickets: 0,
      cancelledTickets: 3,
      cancelledCents: 12_000,
      state: 'CANCELLED',
    })
    expect(buyer.venueCancellations).toEqual([expect.objectContaining({ by: 'ORGANISER' })])

    const wallet = await app.inject({
      method: 'GET',
      url: '/v1/tickets',
      headers: bearer(await signIn(app, 'priya@example.com')),
    })

    expect(wallet.statusCode).toBe(200)

    const mine = wallet.json().data.filter((row) => tickets.some((ticket) => ticket.id === row.id))

    expect(mine).toHaveLength(3)

    for (const row of mine) {
      expect(row.status).toBe('REVOKED')
      expect(row.venuePayment).toMatchObject({
        paid: false,
        cancelled: { at: expect.any(String), by: 'ORGANISER' },
        paidAtDoorByYou: false,
      })
    }

    await app.close()
  })

  it('tells the holder a ticket was passed to why it was cancelled, on their wallet and their ticket, and never who by name', async () => {
    // Ticket 2 passed on to another account, then cancelled unpaid. That
    // holder has no order page: their wallet and their ticket are where they
    // read why (SPEC3-XI XU10, §9.11: the reason is shown to the buyer and to
    // the tickets' holders).
    const { app, prisma, ids, order, tickets } = await booking((world) => ({
      holders: [null, world.owner.id],
    }))
    const passed = tickets[1]
    const reason = 'Not paid for at the door by the end of the night.'

    await cancelledUnpaidFixture(prisma, {
      order,
      tickets: [passed],
      reason,
      actor: { id: ids.platformAdministrator.id },
      authority: 'PLATFORM_ROLE',
      role: 'ADMIN',
    })

    const headers = bearer(await signIn(app, 'owner@rangoli.example'))
    const wallet = await app.inject({ method: 'GET', url: '/v1/tickets', headers })
    const one = await app.inject({ method: 'GET', url: `/v1/tickets/${passed.id}`, headers })

    expect(wallet.statusCode).toBe(200)
    expect(one.statusCode).toBe(200)

    const expected = { at: expect.any(String), by: 'DESI_EVENT', reason }

    const row = wallet.json().data.find((candidate) => candidate.id === passed.id)

    expect(row.venuePayment.cancelled).toEqual(expected)
    expect(one.json().data.ticket.venuePayment.cancelled).toEqual(expected)
    // The cancellation's marker is not a reason anybody gave: the wallet
    // printed it after "Reason given:". The ticket's own read never carries
    // the column (`ticketSchema`).
    expect(row.revokedReason).toBeNull()
    expect(one.json().data.ticket).not.toHaveProperty('revokedReason')

    await app.close()
  })

  it('says on each ticket the buyer passed on what its holder owes now, and where the event is', async () => {
    const { app, order, tickets } = await booking((ids) => ({
      // Ticket 2 passed on and still owing; ticket 3 passed on, then paid at
      // the door by its new holder.
      holders: [null, ids.owner.id],
      paidBy: [{ index: 2, holderId: ids.owner.id }],
    }))
    const buyer = await readAs(app, order.reference, 'priya@example.com')
    const [, passed] = tickets
    const away = buyer.tickets.filter((row) => row.purchaserHolding === 'TRANSFERRED_AWAY')

    expect(away).toHaveLength(2)
    expect(
      away.map((row) => row.passedOn).sort((left, right) => (left.state < right.state ? -1 : 1)),
    ).toEqual([
      { state: 'OWES', dueCents: passed.venueDueCents },
      { state: 'PAID', dueCents: 0 },
    ])
    expect(
      buyer.tickets
        .filter((row) => row.purchaserHolding === 'HELD')
        .every((row) => row.passedOn === null),
    ).toBe(true)

    // The place the event's tax is named for: its venue's country and region.
    expect(buyer.event).toMatchObject({ country: 'IN', region: 'Maharashtra' })

    await app.close()
  })

  it('counts tickets passed on apart from the buyer’s, and door money by whoever paid it (XT7)', async () => {
    const { app, order, tickets } = await booking((ids) => ({
      // Ticket 2 passed on and still owing; ticket 3 passed on, then paid at
      // the door by its new holder.
      holders: [null, ids.owner.id],
      paidBy: [{ index: 2, holderId: ids.owner.id }],
    }))
    const buyer = await readAs(app, order.reference, 'priya@example.com')
    const [own, passed, paid] = tickets

    expect(buyer.venuePayment).toMatchObject({
      unpaidTickets: 1,
      unpaidCents: own.venueDueCents,
      passedOnUnpaidTickets: 1,
      passedOnUnpaidCents: passed.venueDueCents,
      paidTickets: 0,
      paidCents: 0,
      paidByOthersTickets: 1,
      paidByOthersCents: paid.venueDueCents,
      state: 'TO_PAY',
    })

    // The new holder's wallet: the ticket they paid for says so.
    const wallet = await app.inject({
      method: 'GET',
      url: '/v1/tickets',
      headers: bearer(await signIn(app, 'owner@rangoli.example')),
    })
    const theirs = wallet.json().data.find((row) => row.id === paid.id)

    expect(theirs.venuePayment).toMatchObject({ paid: true, paidAtDoorByYou: true })
    expect(wallet.json().data.find((row) => row.id === passed.id).venuePayment).toMatchObject({
      paid: false,
      paidAtDoorByYou: false,
    })

    await app.close()
  })
})
