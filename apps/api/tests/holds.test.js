import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, holdHeaders, signIn } from './helpers/app.js'
import { minutesFromNow } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'
import { reservedWorld } from './helpers/reserved-world.js'

/**
 * Request a hold.
 *
 * @param {object} app The Fastify instance.
 * @param {object} payload The request body.
 * @returns {Promise<object>} The inject result.
 */
function hold(app, payload) {
  return app.inject({ method: 'POST', url: '/v1/holds', payload })
}

describe('POST /v1/holds', () => {
  it('reserves inventory and returns an expiry derived from the configured TTL', async () => {
    const { app, ids, prisma } = await createTestApp({ env: { TICKET_HOLD_TTL_SECONDS: 300 } })

    const before = Date.now()
    const response = await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 2 })

    expect(response.statusCode).toBe(201)

    const { data } = response.json()
    expect(data).toMatchObject({
      ticketTypeId: ids.generalAdmission.id,
      quantity: 2,
      unitPriceCents: 150_000,
    })

    const expiresAt = Date.parse(data.expiresAt)
    expect(expiresAt).toBeGreaterThanOrEqual(before + 300_000)
    expect(expiresAt).toBeLessThan(before + 305_000)

    expect(prisma._store.ticketHold).toHaveLength(1)
    expect(prisma._store.ticketHold[0].status).toBe('ACTIVE')

    await app.close()
  })

  it('takes a row lock on the ticket type before reading any counter', async () => {
    const { app, ids, prisma } = await createTestApp()

    await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 1 })

    expect(prisma._rawQueries).toHaveLength(1)
    expect(prisma._rawQueries[0].sql).toContain('FOR UPDATE')
    // The id travels as a bound parameter, never interpolated into the SQL.
    expect(prisma._rawQueries[0].values).toEqual([ids.generalAdmission.id])

    await app.close()
  })

  it('counts live holds against availability', async () => {
    const { app, ids } = await createTestApp()

    // VIP has four seats and a per-order maximum of two.
    expect((await hold(app, { ticketTypeId: ids.vip.id, quantity: 2 })).statusCode).toBe(201)
    expect((await hold(app, { ticketTypeId: ids.vip.id, quantity: 2 })).statusCode).toBe(201)

    const third = await hold(app, { ticketTypeId: ids.vip.id, quantity: 1 })
    expect(third.statusCode).toBe(409)
    expect(third.json().error.code).toBe('INSUFFICIENT_INVENTORY')

    await app.close()
  })

  it('ignores a lapsed hold the sweeper has not swept yet', async () => {
    const { app, ids, prisma } = await createTestApp()

    prisma._store.ticketHold.push({
      id: 'clapsedhold0000000000000z',
      ticketTypeId: ids.vip.id,
      orderId: null,
      quantity: 4,
      status: 'ACTIVE',
      expiresAt: minutesFromNow(-1),
      createdAt: minutesFromNow(-30),
      updatedAt: minutesFromNow(-30),
    })

    // All four seats look reserved by status alone; the expiry check frees them.
    expect((await hold(app, { ticketTypeId: ids.vip.id, quantity: 2 })).statusCode).toBe(201)

    await app.close()
  })

  it('subtracts tickets already sold', async () => {
    const { app, ids, prisma } = await createTestApp()

    prisma._store.ticketType.find((tier) => tier.id === ids.vip.id).quantitySold = 3

    expect((await hold(app, { ticketTypeId: ids.vip.id, quantity: 2 })).statusCode).toBe(409)
    expect((await hold(app, { ticketTypeId: ids.vip.id, quantity: 1 })).statusCode).toBe(201)

    await app.close()
  })

  it('enforces the per-order maximum with a 422', async () => {
    const { app, ids } = await createTestApp()

    const response = await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 5 })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('ABOVE_MAXIMUM')

    await app.close()
  })

  it('rejects a tier that is not on sale and an event that is not published', async () => {
    const { app, ids } = await createTestApp()

    const paused = await hold(app, { ticketTypeId: ids.pausedTier.id, quantity: 1 })
    const draft = await hold(app, { ticketTypeId: ids.draftTier.id, quantity: 1 })

    expect(paused.statusCode).toBe(422)
    expect(paused.json().error.message).toMatch(/paused/i)
    expect(draft.statusCode).toBe(422)

    await app.close()
  })

  it.each([
    ['PUBLISHED', 201],
    ['ON_SALE', 201],
    ['SALES_PAUSED', 422],
    ['SOLD_OUT', 422],
    ['CANCELLED', 422],
  ])('takes a hold on an event that is %s: %i', async (status, expected) => {
    // ON_SALE is the state an organiser's "Open sales" moves an event into, and
    // until Phase 4 it was refused here: the check was the literal PUBLISHED,
    // written before the lifecycle existed.
    const { app, prisma, ids } = await createTestApp()

    await prisma.event.update({ where: { id: ids.publishedEvent.id }, data: { status } })

    const response = await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 1 })

    expect(response.statusCode).toBe(expected)
    if (expected === 422) expect(response.json().error.message).toMatch(/not on sale/i)

    await app.close()
  })

  it('rejects a tier whose sales window has not opened or has closed', async () => {
    const { app, ids, prisma } = await createTestApp()

    /**
     * The stored tier row. Re-read each time, because a rolled-back
     * transaction replaces the row objects in the store.
     *
     * @returns {object} The live `TicketType` row.
     */
    const tier = () => prisma._store.ticketType.find((row) => row.id === ids.generalAdmission.id)

    Object.assign(tier(), { salesStartAt: minutesFromNow(60), salesEndAt: null })
    expect(
      (await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 1 })).json().error
        .message,
    ).toMatch(/not opened/i)

    Object.assign(tier(), { salesStartAt: minutesFromNow(-120), salesEndAt: minutesFromNow(-60) })
    expect(
      (await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 1 })).json().error
        .message,
    ).toMatch(/closed/i)

    await app.close()
  })

  it('answers 404 for an unknown ticket type', async () => {
    const { app } = await createTestApp()

    const response = await hold(app, { ticketTypeId: 'cnosuchtickettype0000000z', quantity: 1 })

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('rejects a malformed quantity before touching the database', async () => {
    const { app, ids, prisma } = await createTestApp()

    const response = await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 0 })

    expect(response.statusCode).toBe(400)
    expect(prisma._rawQueries).toHaveLength(0)

    await app.close()
  })

  it('cannot be raced into an oversell', async () => {
    const { app, prisma, ids } = await createTestApp()

    // One seat left: two buyers ask for it at the same instant.
    prisma._store.ticketType.find((tier) => tier.id === ids.vip.id).quantitySold = 3

    const [first, second] = await Promise.all([
      hold(app, { ticketTypeId: ids.vip.id, quantity: 1 }),
      hold(app, { ticketTypeId: ids.vip.id, quantity: 1 }),
    ])

    const statuses = [first.statusCode, second.statusCode].sort()
    expect(statuses).toEqual([201, 409])

    // Exactly one reservation exists, and it is for the one remaining seat.
    expect(prisma._store.ticketHold).toHaveLength(1)
    expect(prisma._store.ticketHold[0].quantity).toBe(1)

    await app.close()
  })

  it('serialises a burst of concurrent holds without overselling', async () => {
    const { app, prisma, ids } = await createTestApp()

    // Ten seats, ten simultaneous requests for two seats each.
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 2 }),
      ),
    )

    const granted = attempts.filter((attempt) => attempt.statusCode === 201)
    const refused = attempts.filter((attempt) => attempt.statusCode === 409)

    expect(granted).toHaveLength(5)
    expect(refused).toHaveLength(5)

    const held = prisma._store.ticketHold.reduce((sum, row) => sum + row.quantity, 0)
    expect(held).toBe(10)

    await app.close()
  })
})

describe('DELETE /v1/holds/:id', () => {
  /**
   * Take a hold and return its id.
   *
   * @param {object} app The Fastify instance.
   * @param {string} ticketTypeId The tier to hold against.
   * @returns {Promise<string>} The new hold's id.
   */
  async function take(app, ticketTypeId) {
    const response = await hold(app, { ticketTypeId, quantity: 1 })
    expect(response.statusCode).toBe(201)
    return response.json().data
  }

  /**
   * Release a hold, presenting whatever ownership proof it came with.
   *
   * @param {object} app The Fastify instance.
   * @param {object} taken The `data` object returned when the hold was taken.
   * @returns {Promise<object>} The inject result.
   */
  function release(app, taken) {
    return app.inject({
      method: 'DELETE',
      url: `/v1/holds/${taken.id}`,
      headers: holdHeaders(taken),
    })
  }

  it('returns the inventory to the pool', async () => {
    const { app, prisma, ids } = await createTestApp()

    prisma._store.ticketType.find((tier) => tier.id === ids.vip.id).quantitySold = 3
    const taken = await take(app, ids.vip.id)

    expect((await hold(app, { ticketTypeId: ids.vip.id, quantity: 1 })).statusCode).toBe(409)

    const released = await release(app, taken)
    expect(released.statusCode).toBe(200)
    expect(released.json()).toEqual({ ok: true })

    expect((await hold(app, { ticketTypeId: ids.vip.id, quantity: 1 })).statusCode).toBe(201)

    await app.close()
  })

  it('is idempotent for a hold that was already released', async () => {
    const { app, ids } = await createTestApp()
    const taken = await take(app, ids.generalAdmission.id)

    expect((await release(app, taken)).statusCode).toBe(200)
    expect((await release(app, taken)).statusCode).toBe(200)

    await app.close()
  })

  it('records a lapsed hold as EXPIRED rather than RELEASED', async () => {
    const { app, prisma, ids } = await createTestApp()
    const taken = await take(app, ids.generalAdmission.id)

    prisma._store.ticketHold.find((row) => row.id === taken.id).expiresAt = minutesFromNow(-1)

    await release(app, taken)

    expect(prisma._store.ticketHold.find((row) => row.id === taken.id).status).toBe('EXPIRED')

    await app.close()
  })

  it('refuses to release a hold that has become a paid order', async () => {
    const { app, prisma, ids } = await createTestApp()
    const taken = await take(app, ids.generalAdmission.id)

    prisma._store.ticketHold.find((row) => row.id === taken.id).status = 'CONVERTED'

    const response = await release(app, taken)

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('CONFLICT')

    await app.close()
  })

  it('answers 404 for an unknown hold', async () => {
    const { app } = await createTestApp()

    expect(
      (await app.inject({ method: 'DELETE', url: '/v1/holds/cnosuchhold00000000000zz' }))
        .statusCode,
    ).toBe(404)

    await app.close()
  })
})

describe('DELETE /v1/holds/:id, for a seat hold', () => {
  /**
   * Hold two seats as a guest.
   *
   * @param {object} world From `reservedWorld`.
   * @returns {Promise<object>} The hold payload, with its guest token.
   */
  async function seatHold(world) {
    const response = await world.app.inject({
      method: 'POST',
      url: `/v1/sessions/${world.sessionId}/holds`,
      payload: { seatIds: [world.seatIdByLabel.A2, world.seatIdByLabel.B2] },
    })

    expect(response.statusCode).toBe(201)

    return response.json().data
  }

  it('puts the seats back on sale in the same commit as the release', async () => {
    const world = await reservedWorld()
    const held = await seatHold(world)
    const mine = () => world.prisma._store.eventSeat.filter((row) => row.holdId === held.id)

    expect(mine()).toHaveLength(2)

    const response = await world.app.inject({
      method: 'DELETE',
      url: `/v1/holds/${held.id}`,
      headers: holdHeaders(held),
    })

    expect(response.statusCode).toBe(200)
    expect(mine()).toHaveLength(0)

    for (const label of ['A2', 'B2']) {
      const seat = world.prisma._store.eventSeat.find(
        (row) => row.id === world.eventSeatIdByLabel[label],
      )
      expect(seat).toMatchObject({ status: 'AVAILABLE', holdId: null })
    }

    const audit = world.prisma._store.auditLog.find((row) => row.action === 'hold.released')
    expect(audit.metadata.seatsReleased).toBe(2)

    // Somebody else can have them now.
    const next = await world.app.inject({
      method: 'POST',
      url: `/v1/sessions/${world.sessionId}/holds`,
      payload: { seatIds: [world.seatIdByLabel.A2] },
    })
    expect(next.statusCode).toBe(201)

    await world.app.close()
  })

  it('releases nothing more the second time', async () => {
    const world = await reservedWorld()
    const held = await seatHold(world)
    const release = () =>
      world.app.inject({
        method: 'DELETE',
        url: `/v1/holds/${held.id}`,
        headers: holdHeaders(held),
      })

    expect((await release()).statusCode).toBe(200)

    // Another buyer takes one of the seats in between.
    const other = await world.app.inject({
      method: 'POST',
      url: `/v1/sessions/${world.sessionId}/holds`,
      payload: { seatIds: [world.seatIdByLabel.A2] },
    })
    expect(other.statusCode).toBe(201)

    expect((await release()).statusCode).toBe(200)

    const a2 = world.prisma._store.eventSeat.find((row) => row.id === world.eventSeatIdByLabel.A2)
    expect(a2).toMatchObject({ status: 'HELD', holdId: other.json().data.id })
    expect(
      world.prisma._store.auditLog.filter((row) => row.action === 'hold.released'),
    ).toHaveLength(1)

    await world.app.close()
  })

  it('keeps the seats of a hold whose order is still waiting on its payment', async () => {
    const world = await reservedWorld()
    const held = await seatHold(world)
    const orderId = cuid()

    // The order a timed-out capture left PENDING, with the hold attached.
    world.prisma._store.order.push({
      id: orderId,
      eventId: world.ids.publishedEvent.id,
      status: 'PENDING',
      reference: 'DE-WAITING',
      currency: 'INR',
      subtotalCents: 0,
      totalCents: 0,
    })
    world.prisma._store.ticketHold.find((row) => row.id === held.id).orderId = orderId

    const release = () =>
      world.app.inject({
        method: 'DELETE',
        url: `/v1/holds/${held.id}`,
        headers: holdHeaders(held),
      })

    const refused = await release()

    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.message).toBe(
      'This hold belongs to an order whose payment is still being confirmed. It stays with that order until the payment is settled or refused.',
    )
    expect(world.prisma._store.ticketHold.find((row) => row.id === held.id).status).toBe('ACTIVE')
    expect(world.prisma._store.eventSeat.filter((row) => row.holdId === held.id)).toHaveLength(2)

    // A declined card cancels the order; then the hold is the buyer's to give back.
    world.prisma._store.order.find((row) => row.id === orderId).status = 'CANCELLED'

    expect((await release()).statusCode).toBe(200)
    expect(world.prisma._store.eventSeat.filter((row) => row.holdId === held.id)).toHaveLength(0)

    await world.app.close()
  })
})

describe('POST /v1/holds, and the tiers it does not sell', () => {
  it('refuses a reserved-seating tier: it is bought by seat', async () => {
    const world = await reservedWorld()

    const response = await hold(world.app, { ticketTypeId: world.frontTier.id, quantity: 1 })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('SEATED_TIER')
    expect(response.json().error.message).toMatch(/choose your seats on the seat map/i)
    expect(world.prisma._store.ticketHold).toHaveLength(0)

    await world.app.close()
  })

  it('answers a hidden tier exactly as an unknown one, unless the caller manages tiers', async () => {
    const { app, prisma, ids } = await createTestApp()

    await prisma.ticketType.update({
      where: { id: ids.vip.id },
      data: { visibility: 'HIDDEN' },
    })

    const stranger = await hold(app, { ticketTypeId: ids.vip.id, quantity: 1 })
    const unknown = await hold(app, { ticketTypeId: 'ckzzzzzzzzzzzzzzzzzzzzzzz', quantity: 1 })

    expect(stranger.statusCode).toBe(404)
    expect(stranger.json().error).toMatchObject({
      code: unknown.json().error.code,
      message: unknown.json().error.message,
    })

    const buyer = await app.inject({
      method: 'POST',
      url: '/v1/holds',
      headers: bearer(await signIn(app, 'priya@example.com')),
      payload: { ticketTypeId: ids.vip.id, quantity: 1 },
    })
    expect(buyer.statusCode).toBe(404)

    // The team books its guest list through the ordinary checkout.
    const team = await app.inject({
      method: 'POST',
      url: '/v1/holds',
      headers: bearer(await signIn(app, 'arun@rangoli.example')),
      payload: { ticketTypeId: ids.vip.id, quantity: 1 },
    })
    expect(team.statusCode).toBe(201)

    await app.close()
  })
})

describe('POST /v1/holds, for a tier sold for one night', () => {
  /**
   * Put the fixture's two on-sale tiers on the published event's night.
   *
   * @param {object} prisma The stub.
   * @param {object} ids Fixture ids.
   * @param {object} [night] Fields to set on the night.
   * @returns {Promise<object>} The night.
   */
  async function onOneNight(prisma, ids, night = {}) {
    const session = prisma._store.eventSession.find((row) => row.eventId === ids.publishedEvent.id)

    Object.assign(session, night)

    for (const tier of [ids.generalAdmission, ids.vip]) {
      await prisma.ticketType.update({
        where: { id: tier.id },
        data: { eventSessionId: session.id },
      })
    }

    return session
  }

  it('shares the night’s capacity across its tiers', async () => {
    const { app, prisma, ids } = await createTestApp()
    const night = await onOneNight(prisma, ids, { capacity: 3 })

    const first = await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 2 })
    expect(first.statusCode).toBe(201)

    // VIP has four of its own left, but the night has one.
    const second = await hold(app, { ticketTypeId: ids.vip.id, quantity: 2 })
    expect(second.statusCode).toBe(409)
    expect(second.json().error).toMatchObject({
      code: 'INSUFFICIENT_INVENTORY',
      message: 'Only 1 ticket left for this night.',
    })

    const third = await hold(app, { ticketTypeId: ids.vip.id, quantity: 1 })
    expect(third.statusCode).toBe(201)

    const full = await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 1 })
    expect(full.statusCode).toBe(409)
    expect(full.json().error.message).toBe('This night is sold out.')

    expect(night.capacity).toBe(3)

    await app.close()
  })

  it('locks the night after the tier, and before reading either', async () => {
    const { app, prisma, ids } = await createTestApp()
    const night = await onOneNight(prisma, ids)

    const response = await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 1 })
    expect(response.statusCode).toBe(201)

    const sql = prisma._rawQueries.map((query) => query.sql)
    const tierLock = sql.findIndex((text) => text.includes('"TicketType"'))
    const nightLock = sql.findIndex((text) => text.includes('"EventSession"'))

    expect(tierLock).toBeGreaterThanOrEqual(0)
    expect(nightLock).toBeGreaterThan(tierLock)
    expect(prisma._rawQueries[nightLock].values).toEqual([night.id])

    await app.close()
  })

  it('holds a tier to its night’s sales window', async () => {
    const { app, prisma, ids } = await createTestApp()
    await onOneNight(prisma, ids, { salesStartAt: minutesFromNow(60) })

    const early = await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 1 })
    expect(early.statusCode).toBe(422)
    expect(early.json().error.message).toBe('Tickets for this night are not on sale now.')

    const session = prisma._store.eventSession.find((row) => row.eventId === ids.publishedEvent.id)
    session.salesStartAt = null
    session.status = 'SALES_PAUSED'

    const paused = await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 1 })
    expect(paused.statusCode).toBe(422)
    expect(paused.json().error.message).toBe('Sales for this night are paused.')

    session.status = 'CANCELLED'
    const cancelled = await hold(app, { ticketTypeId: ids.generalAdmission.id, quantity: 1 })
    expect(cancelled.statusCode).toBe(422)

    expect(prisma._store.ticketHold).toHaveLength(0)

    await app.close()
  })
})
