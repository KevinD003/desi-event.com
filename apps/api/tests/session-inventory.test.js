/**
 * A night's own rules for general admission, and hidden tiers at checkout.
 *
 * `lib/session-inventory.js` is tested twice: directly, for every branch of its
 * window and capacity rules, and through the routes that depend on it, because
 * a rule that holds in a unit test and is not called by the route is no rule.
 *
 * @module @desi-event/api/tests/session-inventory
 */

import { describe, expect, it } from 'vitest'

import {
  assertSessionCapacity,
  assertSessionOnSale,
  lockEventSessions,
  mayBookHiddenTier,
  readSessionUsage,
  sessionWindowState,
} from '../src/lib/session-inventory.js'
import { bearer, createTestApp, signIn } from './helpers/app.js'
import { makeWorld } from './helpers/fixtures.js'
import { createPrismaStub, cuid } from './helpers/prisma-stub.js'

/** A moment to judge windows at. */
const NOW = new Date('2027-03-01T12:00:00.000Z')

/**
 * A night row.
 *
 * @param {object} [overrides] Fields to set.
 * @returns {object} An `EventSession`-shaped row.
 */
function night(overrides = {}) {
  return {
    id: cuid(),
    status: 'SCHEDULED',
    salesStartAt: null,
    salesEndAt: null,
    startsAt: new Date('2027-03-02T13:00:00.000Z'),
    endsAt: new Date('2027-03-02T18:00:00.000Z'),
    capacity: 10,
    ...overrides,
  }
}

describe('sessionWindowState', () => {
  it('sells a scheduled night and a night marked on sale', () => {
    expect(sessionWindowState(night(), NOW)).toBe('ON_SALE')
    expect(sessionWindowState(night({ status: 'ON_SALE' }), NOW)).toBe('ON_SALE')
  })

  it('reads a paused night as paused, and every other status as closed', () => {
    expect(sessionWindowState(night({ status: 'SALES_PAUSED' }), NOW)).toBe('PAUSED')

    for (const status of ['SOLD_OUT', 'CANCELLED', 'COMPLETED', 'SOMETHING_NEW']) {
      expect(sessionWindowState(night({ status }), NOW), status).toBe('CLOSED')
    }
  })

  it('applies the night’s own window, start inclusive', () => {
    expect(sessionWindowState(night({ salesStartAt: new Date(NOW.getTime() + 1) }), NOW)).toBe(
      'NOT_STARTED',
    )
    expect(sessionWindowState(night({ salesStartAt: NOW }), NOW)).toBe('ON_SALE')
    expect(sessionWindowState(night({ salesEndAt: new Date(NOW.getTime() - 1) }), NOW)).toBe(
      'ENDED',
    )
  })

  it('stops selling a night when it ends, when no sales end was set', () => {
    const over = night({
      startsAt: new Date(NOW.getTime() - 5 * 3_600_000),
      endsAt: new Date(NOW.getTime() - 60_000),
    })

    expect(sessionWindowState(over, NOW)).toBe('ENDED')
    // A sales end set later than the night's end is the organiser's to choose.
    expect(sessionWindowState({ ...over, salesEndAt: new Date(NOW.getTime() + 60_000) }, NOW)).toBe(
      'ON_SALE',
    )
  })

  it('reads a window it cannot parse as closed rather than failing the request', () => {
    expect(sessionWindowState(night({ salesStartAt: 'not a date' }), NOW)).toBe('CLOSED')
  })
})

describe('assertSessionOnSale', () => {
  it('passes a night that is selling', () => {
    expect(() => assertSessionOnSale(night(), NOW)).not.toThrow()
  })

  it('refuses one that is not, with a sentence about the night and the state for a client', () => {
    const paused = night({ status: 'SALES_PAUSED' })

    try {
      assertSessionOnSale(paused, NOW)
      expect.unreachable('a paused night must be refused')
    } catch (error) {
      expect(error.statusCode).toBe(422)
      expect(error.message).toBe('Sales for this night are paused.')
      expect(error.details).toEqual({ windowState: 'PAUSED', eventSessionId: paused.id })
    }

    expect(() => assertSessionOnSale(night({ status: 'CANCELLED' }), NOW)).toThrow(
      'This night is not on sale.',
    )
    expect(() =>
      assertSessionOnSale(night({ salesStartAt: new Date(NOW.getTime() + 60_000) }), NOW),
    ).toThrow('Tickets for this night are not on sale now.')
    expect(() =>
      assertSessionOnSale(night({ salesEndAt: new Date(NOW.getTime() - 60_000) }), NOW),
    ).toThrow('Sales for this night have closed.')
  })
})

describe('lockEventSessions', () => {
  it('locks each night once, in sorted order, by bound parameter', async () => {
    const prisma = createPrismaStub({})

    const locked = await lockEventSessions(prisma, ['c-b', null, 'c-a', 'c-b', undefined])

    expect(locked).toEqual(['c-a', 'c-b'])
    expect(prisma._rawQueries.map((query) => query.values)).toEqual([['c-a'], ['c-b']])
    expect(prisma._rawQueries.every((query) => query.sql.includes('FOR UPDATE'))).toBe(true)
    expect(prisma._rawQueries.every((query) => !query.sql.includes('c-a'))).toBe(true)
  })
})

describe('readSessionUsage and assertSessionCapacity', () => {
  /**
   * A stub with one night, two general-admission tiers on it and one reserved.
   *
   * @returns {{prisma: object, session: object, tiers: object[]}} The pieces.
   */
  function usageWorld() {
    const session = night({ capacity: 10 })
    const tier = (overrides) => ({
      id: cuid(),
      eventSessionId: session.id,
      reserved: false,
      quantitySold: 0,
      ...overrides,
    })
    const tiers = [
      tier({ quantitySold: 3 }),
      tier({ quantitySold: 1 }),
      // Seats are counted by the seat map, not against the night's capacity.
      tier({ quantitySold: 50, reserved: true }),
      // Another night's tier is another night's business.
      { ...tier({ quantitySold: 7 }), eventSessionId: cuid() },
    ]
    const hold = (ticketTypeId, quantity, overrides = {}) => ({
      id: cuid(),
      ticketTypeId,
      quantity,
      status: 'ACTIVE',
      expiresAt: new Date(NOW.getTime() + 600_000),
      ...overrides,
    })

    const prisma = createPrismaStub({
      eventSession: [session],
      ticketType: tiers,
      ticketHold: [
        hold(tiers[0].id, 2),
        hold(tiers[1].id, 1, { id: 'c-own-hold' }),
        // Lapsed but not yet swept: judged by the clock, not by its status.
        hold(tiers[0].id, 4, { expiresAt: new Date(NOW.getTime() - 1) }),
        hold(tiers[1].id, 5, { status: 'RELEASED' }),
      ],
    })

    return { prisma, session, tiers }
  }

  it('counts what is sold and what is live-held on the night’s general-admission tiers', async () => {
    const { prisma, session } = usageWorld()

    await expect(readSessionUsage(prisma, session, { now: NOW })).resolves.toEqual({
      sold: 4,
      held: 3,
      capacity: 10,
      available: 3,
    })
  })

  it('leaves the caller’s own holds out, so a reservation does not count against itself', async () => {
    const { prisma, session } = usageWorld()

    const usage = await readSessionUsage(prisma, session, {
      now: NOW,
      ignoreHoldIds: ['c-own-hold'],
    })

    expect(usage).toMatchObject({ held: 2, available: 4 })
  })

  it('has no ceiling for a night with no capacity, and never goes below zero', async () => {
    const { prisma, session } = usageWorld()

    await expect(
      readSessionUsage(prisma, { ...session, capacity: null }, { now: NOW }),
    ).resolves.toMatchObject({ capacity: null, available: null })
    await expect(
      readSessionUsage(prisma, { ...session, capacity: 2 }, { now: NOW }),
    ).resolves.toMatchObject({ available: 0 })
  })

  it('counts nothing for a night with no general-admission tier', async () => {
    const prisma = createPrismaStub({})

    await expect(readSessionUsage(prisma, night({ capacity: 5 }), { now: NOW })).resolves.toEqual({
      sold: 0,
      held: 0,
      capacity: 5,
      available: 5,
    })
  })

  it('refuses a request past the night’s capacity with the night and what is left', async () => {
    const { prisma, session } = usageWorld()

    await expect(
      assertSessionCapacity(prisma, { session, requested: 3, now: NOW }),
    ).resolves.toMatchObject({ available: 3 })

    const refusal = await assertSessionCapacity(prisma, { session, requested: 4, now: NOW }).catch(
      (error) => error,
    )

    expect(refusal).toMatchObject({
      name: 'InventoryError',
      code: 'INSUFFICIENT_INVENTORY',
      statusCode: 409,
      message: 'Only 3 tickets left for this night.',
      details: { eventSessionId: session.id, available: 3 },
    })

    const full = await assertSessionCapacity(prisma, {
      session: { ...session, capacity: 7 },
      requested: 1,
      now: NOW,
    }).catch((error) => error)

    expect(full.message).toBe('This night is sold out.')

    const one = await assertSessionCapacity(prisma, {
      session: { ...session, capacity: 8 },
      requested: 2,
      now: NOW,
    }).catch((error) => error)

    expect(one.message).toBe('Only 1 ticket left for this night.')
  })
})

describe('mayBookHiddenTier', () => {
  const event = { organizationId: 'org_1' }

  it('lets a member who manages tiers book a hidden one', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'EVENT_MANAGER']) {
      const actor = { id: 'u', role: 'USER', memberships: [{ organizationId: 'org_1', role }] }
      expect(mayBookHiddenTier(actor, event), role).toBe(true)
    }
  })

  it('refuses everybody else, including members of other organisations', () => {
    expect(mayBookHiddenTier(null, event)).toBe(false)
    expect(
      mayBookHiddenTier(
        { id: 'u', role: 'USER', memberships: [{ organizationId: 'org_1', role: 'SCANNER' }] },
        event,
      ),
    ).toBe(false)
    expect(
      mayBookHiddenTier(
        { id: 'u', role: 'USER', memberships: [{ organizationId: 'org_2', role: 'OWNER' }] },
        event,
      ),
    ).toBe(false)
  })
})

describe('POST /v1/orders, for a tier sold for one night', () => {
  /**
   * The published event's night, with the fixture's tiers moved onto it.
   *
   * @param {object} prisma The stub.
   * @param {object} ids Fixture ids.
   * @param {object} [fields] Fields to set on the night.
   * @returns {Promise<object>} The night.
   */
  async function onOneNight(prisma, ids, fields = {}) {
    const session = prisma._store.eventSession.find((row) => row.eventId === ids.publishedEvent.id)
    Object.assign(session, fields)

    for (const tier of [ids.generalAdmission, ids.vip]) {
      await prisma.ticketType.update({
        where: { id: tier.id },
        data: { eventSessionId: session.id },
      })
    }

    return session
  }

  /**
   * Place an order as a guest buyer.
   *
   * @param {object} app The Fastify instance.
   * @param {object} ids Fixture ids.
   * @param {Array<object>} items The lines.
   * @param {object} [headers] Request headers.
   * @returns {Promise<object>} The inject result.
   */
  function buy(app, ids, items, headers = {}) {
    return app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers,
      payload: {
        eventId: ids.publishedEvent.id,
        buyerEmail: 'priya@example.com',
        buyerName: 'Priya Sharma',
        items,
      },
    })
  }

  it('counts every line of the night together against its capacity', async () => {
    const { app, prisma, ids } = await createTestApp()
    await onOneNight(prisma, ids, { capacity: 3 })

    // Each tier alone would fit; together they do not.
    const response = await buy(app, ids, [
      { ticketTypeId: ids.generalAdmission.id, quantity: 2 },
      { ticketTypeId: ids.vip.id, quantity: 2 },
    ])

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toBe('Only 3 tickets left for this night.')
    expect(prisma._store.order).toHaveLength(0)

    const fits = await buy(app, ids, [
      { ticketTypeId: ids.generalAdmission.id, quantity: 2 },
      { ticketTypeId: ids.vip.id, quantity: 1 },
    ])
    expect(fits.statusCode).toBe(201)
    expect(prisma._store.order[0].eventSessionId).toBe(
      prisma._store.eventSession.find((row) => row.eventId === ids.publishedEvent.id).id,
    )

    await app.close()
  })

  it('refuses a night that is not selling, before anything is written', async () => {
    const { app, prisma, ids } = await createTestApp()
    await onOneNight(prisma, ids, { status: 'SALES_PAUSED' })

    const response = await buy(app, ids, [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }])

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toBe('Sales for this night are paused.')
    expect(prisma._store.order).toHaveLength(0)

    await app.close()
  })

  it('locks tiers, then nights, then the promo code', async () => {
    const { app, prisma, ids } = await createTestApp()
    const session = await onOneNight(prisma, ids)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        eventId: ids.publishedEvent.id,
        buyerEmail: 'priya@example.com',
        buyerName: 'Priya Sharma',
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
        promoCode: 'GARBA10',
      },
    })

    expect(response.statusCode).toBe(201)

    const sql = prisma._rawQueries.map((query) => query.sql)
    const tier = sql.findIndex((text) => text.includes('"TicketType"'))
    const nightLock = sql.findIndex((text) => text.includes('"EventSession"'))
    const promo = sql.findIndex((text) => text.includes('"PromoCode"'))

    expect(tier).toBeGreaterThanOrEqual(0)
    expect(nightLock).toBeGreaterThan(tier)
    expect(promo).toBeGreaterThan(nightLock)
    expect(prisma._rawQueries[nightLock].values).toEqual([session.id])

    await app.close()
  })

  it('answers a hidden tier as an unknown one, and lets the team book it', async () => {
    const { app, prisma, ids } = await createTestApp()

    await prisma.ticketType.update({ where: { id: ids.vip.id }, data: { visibility: 'HIDDEN' } })

    const stranger = await buy(app, ids, [{ ticketTypeId: ids.vip.id, quantity: 1 }])
    expect(stranger.statusCode).toBe(404)
    expect(stranger.json().error.message).toBe(`No such ticket type for this event: ${ids.vip.id}.`)

    const team = await buy(
      app,
      ids,
      [{ ticketTypeId: ids.vip.id, quantity: 1 }],
      bearer(await signIn(app, 'arun@rangoli.example')),
    )
    expect(team.statusCode).toBe(201)

    await app.close()
  })
})

describe('GET /v1/events/:eventId/ticket-types, for tiers sold for one night', () => {
  it('offers no tier more than its night has left', async () => {
    const world = await makeWorld()
    const { seed, ids } = world
    const session = seed.eventSession.find((row) => row.eventId === ids.publishedEvent.id)
    session.capacity = 5

    for (const tier of seed.ticketType) {
      if (tier.eventId === ids.publishedEvent.id) tier.eventSessionId = session.id
    }

    ids.generalAdmission.quantitySold = 3

    const { app } = await createTestApp({ seed, ids })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
    })

    expect(response.statusCode).toBe(200)

    const byId = Object.fromEntries(response.json().data.map((tier) => [tier.id, tier]))
    // GA has seven of its own left, VIP four; the night has two.
    expect(byId[ids.generalAdmission.id].availableQuantity).toBe(2)
    expect(byId[ids.vip.id].availableQuantity).toBe(2)

    await app.close()
  })

  it('reads a reserved tier’s stock from its free seats', async () => {
    const world = await makeWorld()
    const { seed, ids } = world
    const tierId = cuid()
    const sessionId = seed.eventSession.find((row) => row.eventId === ids.publishedEvent.id).id

    seed.ticketType.push({
      ...ids.generalAdmission,
      id: tierId,
      name: 'Stalls',
      reserved: true,
      quantityTotal: 0,
      eventSessionId: sessionId,
    })
    seed.eventSeat = [
      {
        id: cuid(),
        eventSessionId: sessionId,
        seatId: cuid(),
        ticketTypeId: tierId,
        status: 'AVAILABLE',
      },
      {
        id: cuid(),
        eventSessionId: sessionId,
        seatId: cuid(),
        ticketTypeId: tierId,
        status: 'AVAILABLE',
      },
      {
        id: cuid(),
        eventSessionId: sessionId,
        seatId: cuid(),
        ticketTypeId: tierId,
        status: 'SOLD',
      },
    ]

    const { app } = await createTestApp({ seed, ids })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
    })

    const stalls = response.json().data.find((tier) => tier.id === tierId)
    expect(stalls).toMatchObject({ availableQuantity: 2, isSoldOut: false })

    await app.close()
  })
})
