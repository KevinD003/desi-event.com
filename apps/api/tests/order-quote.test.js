/**
 * `POST /v1/orders/quote`: what the server would charge, computed by the same
 * function as the charge, and writing nothing.
 *
 * The property that matters is equality: the figure a buyer is shown is the
 * figure `POST /v1/orders` then takes. Each test that prices something quotes
 * it and buys it, and compares the two.
 *
 * @module @desi-event/api/tests/order-quote
 */

import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn } from './helpers/app.js'
import { makeWorld, minutesFromNow } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/** The tables a quote must leave exactly as it found them. */
const UNTOUCHED = [
  'order',
  'orderItem',
  'payment',
  'ticket',
  'ticketHold',
  'holdItem',
  'eventSeat',
  'promoCode',
  'auditLog',
  'ledgerBatch',
]

/**
 * A copy of the tables a quote must not write.
 *
 * @param {object} prisma The stub.
 * @returns {string} A serialisation to compare.
 */
function snapshot(prisma) {
  return JSON.stringify(UNTOUCHED.map((table) => prisma._store[table] ?? []))
}

/**
 * Quote a basket as a signed-in caller.
 *
 * @param {object} app The Fastify instance.
 * @param {object} payload The request body.
 * @param {object} [headers] Request headers.
 * @returns {Promise<object>} The inject result.
 */
function quote(app, payload, headers = {}) {
  return app.inject({ method: 'POST', url: '/v1/orders/quote', payload, headers })
}

/**
 * A promo code row for the fixture organisation.
 *
 * @param {object} ids World ids.
 * @param {object} overrides Fields to set.
 * @returns {object} A `PromoCode` row.
 */
function promo(ids, overrides) {
  return {
    id: cuid(),
    organizationId: ids.organization.id,
    eventId: null,
    type: 'PERCENTAGE',
    value: 1000,
    currency: null,
    maxRedemptions: null,
    redemptionCount: 0,
    startsAt: null,
    endsAt: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('POST /v1/orders/quote', () => {
  it('quotes exactly what the order then charges, and writes nothing', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))
    const basket = {
      eventId: ids.publishedEvent.id,
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 2 }],
      promoCode: 'garba10',
    }

    const before = snapshot(prisma)
    const quoted = await quote(app, basket, headers)
    expect(snapshot(prisma)).toBe(before)

    expect(quoted.statusCode).toBe(200)

    const { data } = quoted.json()
    expect(data).toMatchObject({
      currency: 'INR',
      subtotalCents: 300_000,
      discountCents: 30_000,
      promo: {
        code: 'GARBA10',
        applied: true,
        reason: null,
        type: 'PERCENTAGE',
        percentBps: 1000,
        amountCents: null,
      },
    })
    expect(data.lines).toEqual([
      {
        ticketTypeId: ids.generalAdmission.id,
        name: 'General Admission',
        sessionId: null,
        quantity: 2,
        unitPriceCents: 150_000,
        subtotalCents: 300_000,
        discountCents: 30_000,
      },
    ])

    const placed = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers,
      payload: {
        ...basket,
        buyerEmail: 'priya@example.com',
        buyerName: 'Priya Sharma',
        expectedTotalCents: data.totalCents,
      },
    })

    expect(placed.statusCode).toBe(201)
    expect(placed.json().data).toMatchObject({
      subtotalCents: data.subtotalCents,
      discountCents: data.discountCents,
      feesCents: data.feesCents,
      taxCents: data.taxCents,
      totalCents: data.totalCents,
    })

    await app.close()
  })

  it('answers 200 for a code the organiser does not have, so a typo can be corrected', async () => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))

    const response = await quote(
      app,
      {
        eventId: ids.publishedEvent.id,
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
        promoCode: 'NOSUCHCODE',
      },
      headers,
    )

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({
      discountCents: 0,
      promo: { code: 'NOSUCHCODE', applied: false, reason: 'UNKNOWN', type: null },
    })

    await app.close()
  })

  it('says why a known code gave nothing, and never what it would have given', async () => {
    const world = await makeWorld()
    const { ids } = world
    const past = new Date(Date.now() - 60_000)

    world.seed.promoCode.push(
      promo(ids, { code: 'PAUSEDONE', active: false }),
      promo(ids, { code: 'LATERON', startsAt: minutesFromNow(60) }),
      promo(ids, { code: 'OVERNOW', startsAt: new Date(Date.now() - 120_000), endsAt: past }),
      promo(ids, { code: 'ALLGONE', maxRedemptions: 1, redemptionCount: 1 }),
      promo(ids, { code: 'DOLLARS', type: 'FIXED_AMOUNT', value: 500, currency: 'USD' }),
    )

    const { app } = await createTestApp({ seed: world.seed, ids })
    const headers = bearer(await signIn(app, 'priya@example.com'))

    const reasons = {}

    for (const code of ['PAUSEDONE', 'LATERON', 'OVERNOW', 'ALLGONE', 'DOLLARS']) {
      const response = await quote(
        app,
        {
          eventId: ids.publishedEvent.id,
          items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
          promoCode: code,
        },
        headers,
      )

      expect(response.statusCode, code).toBe(200)
      expect(response.json().data.promo).toMatchObject({
        applied: false,
        type: null,
        percentBps: null,
        amountCents: null,
      })
      reasons[code] = response.json().data.promo.reason
    }

    expect(reasons).toEqual({
      PAUSEDONE: 'INACTIVE',
      LATERON: 'NOT_STARTED',
      OVERNOW: 'EXPIRED',
      ALLGONE: 'EXHAUSTED',
      DOLLARS: 'CURRENCY_MISMATCH',
    })

    await app.close()
  })

  it('is for signed-in buyers only', async () => {
    const { app, ids } = await createTestApp()

    const response = await quote(app, {
      eventId: ids.publishedEvent.id,
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('prices only the caller’s own holds: another buyer’s is not there, and a lapsed one is gone', async () => {
    const { app, prisma, ids } = await createTestApp()
    const mine = bearer(await signIn(app, 'priya@example.com'))
    const theirs = bearer(await signIn(app, 'rival@dhol.example'))

    const held = await app.inject({
      method: 'POST',
      url: '/v1/holds',
      headers: theirs,
      payload: { ticketTypeId: ids.generalAdmission.id, quantity: 1 },
    })
    expect(held.statusCode).toBe(201)

    const basket = {
      eventId: ids.publishedEvent.id,
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
      holdIds: [held.json().data.id],
    }

    expect((await quote(app, basket, mine)).statusCode).toBe(404)

    const own = await app.inject({
      method: 'POST',
      url: '/v1/holds',
      headers: mine,
      payload: { ticketTypeId: ids.generalAdmission.id, quantity: 1 },
    })
    const ownId = own.json().data.id
    prisma._store.ticketHold.find((row) => row.id === ownId).expiresAt = new Date(Date.now() - 1000)

    const lapsed = await quote(app, { ...basket, holdIds: [ownId] }, mine)
    expect(lapsed.statusCode).toBe(410)

    await app.close()
  })

  it('refuses a hidden tier to a buyer exactly as it refuses one that does not exist', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))

    await prisma.ticketType.update({ where: { id: ids.vip.id }, data: { visibility: 'HIDDEN' } })

    const hidden = await quote(
      app,
      { eventId: ids.publishedEvent.id, items: [{ ticketTypeId: ids.vip.id, quantity: 1 }] },
      headers,
    )
    const missing = await quote(
      app,
      { eventId: ids.publishedEvent.id, items: [{ ticketTypeId: cuid(), quantity: 1 }] },
      headers,
    )

    expect(hidden.statusCode).toBe(404)
    expect(missing.statusCode).toBe(404)

    await app.close()
  })

  it('is rate-limited per account, so codes cannot be tried at speed', async () => {
    const { app, ids } = await createTestApp({
      rateLimit: {
        global: { max: 10_000, timeWindow: '1 minute' },
        quote: { max: 2, timeWindow: '1 minute' },
      },
    })
    const headers = bearer(await signIn(app, 'priya@example.com'))
    const basket = {
      eventId: ids.publishedEvent.id,
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
      promoCode: 'TRYONE',
    }

    expect((await quote(app, basket, headers)).statusCode).toBe(200)
    expect((await quote(app, basket, headers)).statusCode).toBe(200)

    const third = await quote(app, basket, headers)
    expect(third.statusCode).toBe(429)
    expect(third.json().error.code).toBe('RATE_LIMITED')

    await app.close()
  })
})
