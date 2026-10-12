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

import { applyBps } from '@desi-event/pricing'

import { bearer, createTestApp, signIn } from './helpers/app.js'
import { generatedReferralText, referralCodeFixture } from './helpers/fee-orders.js'
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

/**
 * SPEC3 §6, §8.2, §11.3: what a quote says about the booking fee, a referral
 * code and paying at the venue. Additive: every case above prices a card
 * order with no code, exactly as before.
 */
describe('POST /v1/orders/quote: booking fee, referral codes and paying at the venue', () => {
  /**
   * The published event with paying at the venue switched on.
   *
   * @param {object} prisma The stub.
   * @param {object} ids World ids.
   * @param {object} [overrides] Event columns to set as well.
   * @returns {object} The event row.
   */
  function venueOn(prisma, ids, overrides = {}) {
    const event = prisma._store.event.find((row) => row.id === ids.publishedEvent.id)

    return Object.assign(event, {
      venuePaymentEnabled: true,
      venuePaymentLimit: 50,
      venuePaymentChangedAt: new Date(),
      ...overrides,
    })
  }

  /**
   * A referral code row in the stub.
   *
   * @param {object} prisma The stub.
   * @param {object} ids World ids.
   * @param {object} [overrides] Columns to set.
   * @returns {Promise<{row: object, referralCode: string}>} The code.
   */
  function code(prisma, ids, overrides = {}) {
    return referralCodeFixture(prisma, { createdById: ids.platformAdministrator.id, ...overrides })
  }

  /** One general-admission ticket of the published event. */
  const basket = (ids, extra = {}) => ({
    eventId: ids.publishedEvent.id,
    items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 2 }],
    ...extra,
  })

  it('answers a card quote with its fee, its tax and no referral, priced as before', async () => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))
    const { data } = (await quote(app, basket(ids), headers)).json()

    expect(data).toMatchObject({
      paymentMethod: 'CARD',
      feeGrossCents: data.feesCents,
      feeWaivedCents: 0,
      venueDueCents: 0,
      fee: { percentageBps: 590, flatCentsPerTicket: 99 },
      tax: { applied: true, appliedTo: 'TICKETS_AND_FEE', notAppliedReason: null },
      referral: null,
      venuePayment: { available: false },
    })
    // The buyer reads the numbers, never where they came from.
    expect(data.fee).not.toHaveProperty('source')
    expect(data.lines[0]).not.toHaveProperty('venueDueCents')

    await app.close()
  })

  it('quotes paying at the venue: the fee online, the ticket price at the door, no tax', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))

    venueOn(prisma, ids)

    const card = (await quote(app, basket(ids), headers)).json().data
    const venue = (await quote(app, basket(ids, { paymentMethod: 'AT_VENUE' }), headers)).json()
      .data

    expect(card.venuePayment).toEqual({ available: true })
    expect(card.taxCents).toBeGreaterThan(0)
    expect(venue).toMatchObject({
      paymentMethod: 'AT_VENUE',
      subtotalCents: 300_000,
      venueDueCents: 300_000,
      feesCents: card.feesCents,
      taxCents: 0,
      totalCents: card.feesCents,
      tax: { applied: false, appliedTo: 'NOTHING', notAppliedReason: 'PAID_AT_VENUE' },
      venuePayment: { available: true },
    })
    expect(venue.lines[0].venueDueCents).toBe(300_000)

    await app.close()
  })

  it('refuses paying at the venue when it is off, for an online event and with nothing to pay at the door', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))
    const atVenue = basket(ids, { paymentMethod: 'AT_VENUE' })

    const off = await quote(app, atVenue, headers)

    expect(off.statusCode).toBe(409)
    expect(off.json().error.code).toBe('VENUE_PAYMENT_OFF')

    venueOn(prisma, ids, { isOnline: true })

    const online = await quote(app, atVenue, headers)

    expect(online.statusCode).toBe(409)
    expect(online.json().error.code).toBe('VENUE_PAYMENT_UNAVAILABLE')

    venueOn(prisma, ids, { isOnline: false })
    prisma._store.promoCode.push(
      promo(ids, { code: 'FREEALL', value: 10_000, eventId: ids.publishedEvent.id }),
    )

    const nothing = await quote(app, { ...atVenue, promoCode: 'FREEALL' }, headers)

    expect(nothing.statusCode).toBe(422)
    expect(nothing.json().error.code).toBe('NOTHING_TO_PAY_AT_VENUE')

    await app.close()
  })

  it('removes the whole booking fee with an applicable referral code, and the tax it carried, and never echoes the code', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))
    const { referralCode } = await code(prisma, ids)
    const before = snapshot(prisma)
    const plain = (await quote(app, basket(ids), headers)).json().data
    const waived = (
      await quote(app, basket(ids, { referralCode: referralCode.toLowerCase() }), headers)
    ).json().data

    expect(waived).toMatchObject({
      referral: { applied: true, reason: null },
      feeGrossCents: plain.feesCents,
      feeWaivedCents: plain.feesCents,
      feesCents: 0,
    })
    // The tax base loses the fee: the tax on the tickets alone.
    expect(waived.taxCents).toBeLessThan(plain.taxCents)
    expect(waived.totalCents).toBe(plain.subtotalCents - plain.discountCents + waived.taxCents)
    expect(JSON.stringify(waived)).not.toContain(referralCode)
    // A quote writes nothing, and takes no use.
    expect(snapshot(prisma)).toBe(before)
    expect(prisma._store.referralCode[0].useCount).toBe(0)

    await app.close()
  })

  it('answers NOT_ACCEPTED, the same answer, for every code that does not apply', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))
    const admin = bearer(await signIn(app, 'anil@desi-event.example'))
    const off = (await code(prisma, ids, { active: false })).referralCode
    const expired = await code(prisma, ids, { expiresAt: new Date(Date.now() + 60_000) })
    const usedUp = (await code(prisma, ids, { maxUses: 1, useCount: 1 })).referralCode
    const outOfScope = (
      await code(prisma, ids, { scope: 'SELECTED_EVENTS', eventIds: [ids.draftEvent.id] })
    ).referralCode
    const own = (await code(prisma, ids)).referralCode

    prisma._store.referralCode.find((row) => row.id === expired.row.id).expiresAt = new Date(
      Date.now() - 1_000,
    )

    const answers = []

    for (const [who, referralCode] of [
      [headers, generatedReferralText()],
      [headers, off],
      [headers, expired.referralCode],
      [headers, usedUp],
      [headers, outOfScope],
      [admin, own],
    ]) {
      const response = await quote(app, basket(ids, { referralCode }), who)

      expect(response.statusCode).toBe(200)
      answers.push(response.json().data.referral)
    }

    expect(new Set(answers.map((answer) => JSON.stringify(answer)))).toEqual(
      new Set([JSON.stringify({ applied: false, reason: 'NOT_ACCEPTED' })]),
    )

    await app.close()
  })

  it('does not look a code up when there is no fee to remove', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))

    prisma._store.promoCode.push(
      promo(ids, { code: 'FREEALL', value: 10_000, eventId: ids.publishedEvent.id }),
    )

    let lookups = 0
    const findUnique = prisma.referralCode.findUnique.bind(prisma.referralCode)

    prisma.referralCode.findUnique = (args) => {
      lookups += 1

      return findUnique(args)
    }

    const { data } = (
      await quote(
        app,
        basket(ids, { promoCode: 'FREEALL', referralCode: generatedReferralText() }),
        headers,
      )
    ).json()

    expect(data.referral).toEqual({ applied: false, reason: 'NOTHING_TO_WAIVE' })
    expect(lookups).toBe(0)

    await app.close()
  })

  it('rations wrong referral codes only: valid ones never reach the budget, the eleventh wrong one does', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))
    const { referralCode } = await code(prisma, ids)

    for (let index = 0; index < 12; index += 1) {
      expect((await quote(app, basket(ids, { referralCode }), headers)).statusCode).toBe(200)
    }

    for (let index = 0; index < 10; index += 1) {
      const response = await quote(
        app,
        basket(ids, { referralCode: generatedReferralText() }),
        headers,
      )

      expect(response.json().data.referral.reason).toBe('NOT_ACCEPTED')
    }

    const spent = await quote(app, basket(ids, { referralCode: generatedReferralText() }), headers)

    expect(spent.statusCode).toBe(429)
    expect(spent.json().error).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Too many referral codes were tried. Wait a few minutes, then try again.',
    })
    // A request naming no code is never refused by the budget.
    expect((await quote(app, basket(ids), headers)).statusCode).toBe(200)

    await app.close()
  })

  it('counts wrong codes per visitor address, whatever the user agent, and in one shared bucket without one', async () => {
    const { app, ids } = await createTestApp({
      rateLimit: {
        global: { max: 10_000, timeWindow: '1 minute' },
        referralAttempt: { actorMax: 1_000, addressMax: 2, sharedMax: 3, timeWindow: '10 minutes' },
      },
    })
    const accounts = []

    for (const email of ['priya@example.com', 'owner@rangoli.example', 'arun@rangoli.example']) {
      accounts.push(bearer(await signIn(app, email)))
    }

    const wrong = (headers) =>
      quote(app, basket(ids, { referralCode: generatedReferralText() }), headers)

    // The web server forwards one visitor's address; the user agent changes
    // each time and buys nothing.
    for (const [index, account] of accounts.slice(0, 2).entries()) {
      const response = await wrong({
        ...account,
        'x-desi-client-address': '198.51.100.7',
        'user-agent': `Agent ${index}`,
      })

      expect(response.statusCode).toBe(200)
    }

    const sameAddress = await wrong({
      ...accounts[2],
      'x-desi-client-address': '198.51.100.7',
      'user-agent': 'Agent 9',
    })

    expect(sameAddress.statusCode).toBe(429)

    // Another address has its own bucket.
    expect(
      (await wrong({ ...accounts[2], 'x-desi-client-address': '203.0.113.9' })).statusCode,
    ).toBe(200)

    await app.close()
  })

  it('needs an account to name a referral code or to pay at the venue', async () => {
    const { app, prisma, ids } = await createTestApp()

    venueOn(prisma, ids)

    const guestOrder = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        ...basket(ids, { paymentMethod: 'AT_VENUE' }),
        buyerEmail: 'guest@example.com',
        buyerName: 'Guest Buyer',
      },
    })

    expect(guestOrder.statusCode).toBe(401)
    expect(guestOrder.json().error.code).toBe('SIGN_IN_REQUIRED')

    const guestCode = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        ...basket(ids, { referralCode: generatedReferralText() }),
        buyerEmail: 'guest@example.com',
        buyerName: 'Guest Buyer',
      },
    })

    expect(guestCode.statusCode).toBe(401)
    expect(guestCode.json().error.code).toBe('SIGN_IN_REQUIRED')
    expect(prisma._store.order).toHaveLength(0)

    await app.close()
  })

  it('taxes a card order in Ontario on tickets and fee, a waived one on tickets alone, and paying at the venue not at all', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'priya@example.com'))
    const { referralCode } = await code(prisma, ids)

    Object.assign(
      prisma._store.venue.find((row) => row.id === ids.publishedEvent.venueId),
      { country: 'CA', region: 'ON' },
    )
    venueOn(prisma, ids)

    const card = (await quote(app, basket(ids), headers)).json().data
    const waived = (await quote(app, basket(ids, { referralCode }), headers)).json().data
    const venue = (await quote(app, basket(ids, { paymentMethod: 'AT_VENUE' }), headers)).json()
      .data
    const net = card.subtotalCents - card.discountCents

    expect(card.taxCents).toBe(applyBps(net + card.feesCents, 1300))
    expect(card.taxCents).toBeGreaterThan(0)
    expect(waived.taxCents).toBe(applyBps(net, 1300))
    expect(venue).toMatchObject({
      taxCents: 0,
      tax: { applied: false, notAppliedReason: 'PAID_AT_VENUE' },
    })

    await app.close()
  })
})
