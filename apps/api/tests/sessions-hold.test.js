/**
 * The seat map and the seat hold, for seats sold the way an organiser authors
 * them: one reserved tier per price zone, and a seat bound to its zone's tier.
 *
 * What these pin down:
 *
 *   - The seat map names the night, its zones and its tiers with their prices,
 *     and a seat is available to a buyer only when a tier they may buy sells it
 *     and that tier is on sale. The organiser still sees the real state.
 *   - A hold may span zones and tiers. Every hold item is stamped with its own
 *     seat's tier, and a companion seat from another zone is sold under its own.
 *   - A seat no tier sells, a draft tier, a hidden tier and another night's tier
 *     are all refused, and a night marked ON_SALE sells like a scheduled one.
 *   - Seats still held by a hold that has lapsed are taken back first, audited
 *     as a system action.
 *
 * @module @desi-event/api/tests/sessions-hold
 */

import { describe, expect, it } from 'vitest'

import { bearer, signIn } from './helpers/app.js'
import { minutesFromNow } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'
import { BACK_CENTS, FRONT_CENTS, reservedWorld } from './helpers/reserved-world.js'

/**
 * Read the seat map.
 *
 * @param {object} app The Fastify instance.
 * @param {string} sessionId The night.
 * @param {object} [headers] Request headers.
 * @returns {Promise<object>} The inject result.
 */
function seatMap(app, sessionId, headers = {}) {
  return app.inject({ method: 'GET', url: `/v1/sessions/${sessionId}/seats`, headers })
}

/**
 * Hold seats.
 *
 * @param {object} app The Fastify instance.
 * @param {string} sessionId The night.
 * @param {string[]} seatIds The chosen `Seat` ids.
 * @param {object} [headers] Request headers.
 * @returns {Promise<object>} The inject result.
 */
function hold(app, sessionId, seatIds, headers = {}) {
  return app.inject({
    method: 'POST',
    url: `/v1/sessions/${sessionId}/holds`,
    headers,
    payload: { seatIds },
  })
}

/**
 * Every seat of a seat-map payload, flattened.
 *
 * @param {object} data The map's `data`.
 * @returns {object[]} The seats.
 */
function seatsOf(data) {
  return data.sections.flatMap((section) => [
    ...section.rows.flatMap((row) => row.seats),
    ...(section.seats ?? []),
  ])
}

describe('GET /v1/sessions/:id/seats, for a night sold by zone', () => {
  it('names the night, its zones by name and its tiers with their prices', async () => {
    const world = await reservedWorld()

    const response = await seatMap(world.app, world.sessionId)
    expect(response.statusCode).toBe(200)

    const { data } = response.json()
    expect(data).toMatchObject({
      label: 'Night 2',
      status: 'SCHEDULED',
      salesStartAt: null,
      salesEndAt: null,
      maxSeatsPerOrder: 6,
    })
    expect(data.doorsOpenAt).toBe(world.reservedSession.doorsOpenAt.toISOString())
    expect(data.zones).toEqual([
      { id: world.frontZone.id, name: 'Front', sortOrder: 1 },
      { id: world.backZone.id, name: 'Back', sortOrder: 2 },
    ])
    expect(data.tiers).toEqual([
      {
        id: world.frontTier.id,
        name: 'Front stalls',
        priceCents: FRONT_CENTS,
        currency: 'INR',
        priceZoneId: world.frontZone.id,
        minPerOrder: 1,
        maxPerOrder: 6,
        onSale: true,
      },
      {
        id: world.backTier.id,
        name: 'Back stalls',
        priceCents: BACK_CENTS,
        currency: 'INR',
        priceZoneId: world.backZone.id,
        minPerOrder: 1,
        maxPerOrder: 6,
        onSale: true,
      },
    ])

    // Each seat names the tier it is sold under.
    const byLabel = Object.fromEntries(seatsOf(data).map((seat) => [seat.label, seat]))
    expect(byLabel.A2.ticketTypeId).toBe(world.frontTier.id)
    expect(byLabel.B2.ticketTypeId).toBe(world.backTier.id)
    expect(Object.values(byLabel).every((seat) => seat.available)).toBe(true)

    await world.app.close()
  })

  it('shows a buyer a seat as unavailable when no tier sells it, or its tier is a draft', async () => {
    const world = await reservedWorld({ unbound: ['A3'], back: { status: 'DRAFT' } })

    const visitor = (await seatMap(world.app, world.sessionId)).json().data
    const byLabel = Object.fromEntries(seatsOf(visitor).map((seat) => [seat.label, seat]))

    expect(byLabel.A2.available).toBe(true)
    expect(byLabel.A3.available).toBe(false)
    expect(byLabel.B2.available).toBe(false)
    // A draft tier is not named to a stranger, and nor is it on a seat.
    expect(visitor.tiers.map((tier) => tier.id)).toEqual([world.frontTier.id])
    expect(byLabel.B2.ticketTypeId).toBeNull()
    // The counts agree with the seats.
    expect(visitor.counts.available).toBe(2)
    expect(JSON.stringify(visitor)).not.toContain('DRAFT')

    // The organiser sees the real state, draft tier included.
    const headers = bearer(await signIn(world.app, 'arun@rangoli.example'))
    const organiser = (await seatMap(world.app, world.sessionId, headers)).json().data
    const inside = Object.fromEntries(seatsOf(organiser).map((seat) => [seat.label, seat]))

    expect(organiser.tiers.map((tier) => tier.id)).toEqual([world.frontTier.id, world.backTier.id])
    expect(inside.B2).toMatchObject({ available: true, status: 'AVAILABLE' })
    expect(organiser.tiers.find((tier) => tier.id === world.backTier.id).onSale).toBe(false)

    await world.app.close()
  })

  it('hides a hidden tier and its seats from a buyer', async () => {
    const world = await reservedWorld({ back: { visibility: 'HIDDEN' } })

    const visitor = (await seatMap(world.app, world.sessionId)).json().data
    const byLabel = Object.fromEntries(seatsOf(visitor).map((seat) => [seat.label, seat]))

    expect(visitor.tiers.map((tier) => tier.id)).toEqual([world.frontTier.id])
    expect(byLabel.B2.available).toBe(false)

    await world.app.close()
  })

  it('reads a tier outside its own sales window as not on sale', async () => {
    const world = await reservedWorld({ back: { salesStartAt: minutesFromNow(60) } })

    const visitor = (await seatMap(world.app, world.sessionId)).json().data
    const byLabel = Object.fromEntries(seatsOf(visitor).map((seat) => [seat.label, seat]))

    expect(visitor.tiers.find((tier) => tier.id === world.backTier.id).onSale).toBe(false)
    expect(byLabel.B2.available).toBe(false)
    expect(byLabel.A2.available).toBe(true)

    await world.app.close()
  })
})

describe('POST /v1/sessions/:id/holds, for a night sold by zone', () => {
  it('holds seats from two zones at once, each under its own tier', async () => {
    const world = await reservedWorld()
    const { app, prisma } = world

    const response = await hold(app, world.sessionId, [
      world.seatIdByLabel.A2,
      world.seatIdByLabel.B2,
    ])

    expect(response.statusCode).toBe(201)

    const { data } = response.json()
    expect(data.subtotalCents).toBe(FRONT_CENTS + BACK_CENTS)
    expect(data.currency).toBe('INR')
    expect(Object.fromEntries(data.seats.map((seat) => [seat.label, seat.ticketTypeId]))).toEqual({
      A2: world.frontTier.id,
      B2: world.backTier.id,
    })

    // Each hold item is its own seat's tier: that is what is priced and sold.
    const items = prisma._store.holdItem.filter((item) => item.holdId === data.id)
    const tierBySeat = Object.fromEntries(
      items.map((item) => [item.eventSeatId, item.ticketTypeId]),
    )
    expect(tierBySeat).toEqual({
      [world.eventSeatIdByLabel.A2]: world.frontTier.id,
      [world.eventSeatIdByLabel.B2]: world.backTier.id,
    })

    const row = prisma._store.ticketHold.find((candidate) => candidate.id === data.id)
    expect(row.quantity).toBe(2)

    await app.close()
  })

  it('takes a companion seat from the other zone, sold under that zone’s tier', async () => {
    const world = await reservedWorld()
    const { app, prisma } = world

    const response = await hold(app, world.sessionId, [world.seatIdByLabel.A1])

    expect(response.statusCode).toBe(201)

    const { data } = response.json()
    expect(data.seats.map((seat) => seat.label).sort()).toEqual(['A1', 'B1'])
    expect(data.subtotalCents).toBe(FRONT_CENTS + BACK_CENTS)

    const companion = prisma._store.holdItem.find(
      (item) => item.holdId === data.id && item.eventSeatId === world.eventSeatIdByLabel.B1,
    )
    expect(companion.ticketTypeId).toBe(world.backTier.id)

    await app.close()
  })

  it('refuses a seat no tier sells', async () => {
    const world = await reservedWorld({ unbound: ['A3'] })

    const response = await hold(world.app, world.sessionId, [world.seatIdByLabel.A3])

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toBe('Those seats are not on sale at this session.')
    expect(world.prisma._store.ticketHold).toHaveLength(0)

    await world.app.close()
  })

  it('refuses a seat whose tier is a draft, naming the tier', async () => {
    const world = await reservedWorld({ back: { status: 'DRAFT' } })

    const response = await hold(world.app, world.sessionId, [
      world.seatIdByLabel.A2,
      world.seatIdByLabel.B2,
    ])

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toBe('Seats sold as "Back stalls" are not on sale now.')
    // All or nothing: the Front seat was not held either.
    expect(world.prisma._store.ticketHold).toHaveLength(0)
    expect(world.prisma._store.eventSeat.every((seat) => seat.status === 'AVAILABLE')).toBe(true)

    await world.app.close()
  })

  it('refuses a hidden tier’s seat to a buyer as it refuses a seat nobody sells', async () => {
    const world = await reservedWorld({ back: { visibility: 'HIDDEN' } })

    const response = await hold(world.app, world.sessionId, [world.seatIdByLabel.B2])

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toBe('Those seats are not on sale at this session.')

    await world.app.close()
  })

  it('refuses a seat bound to another night’s tier', async () => {
    const world = await reservedWorld()
    const other = world.prisma._store.eventSession.find(
      (row) => row.eventId === world.ids.publishedEvent.id && row.id !== world.sessionId,
    )

    await world.prisma.ticketType.update({
      where: { id: world.backTier.id },
      data: { eventSessionId: other.id },
    })

    const response = await hold(world.app, world.sessionId, [world.seatIdByLabel.B2])

    expect(response.statusCode).toBe(422)
    expect(world.prisma._store.ticketHold).toHaveLength(0)

    await world.app.close()
  })

  it('sells a night marked ON_SALE, and not one whose sales are paused', async () => {
    const onSale = await reservedWorld({ session: { status: 'ON_SALE' } })
    const accepted = await hold(onSale.app, onSale.sessionId, [onSale.seatIdByLabel.A2])
    expect(accepted.statusCode).toBe(201)
    await onSale.app.close()

    const paused = await reservedWorld({ session: { status: 'SALES_PAUSED' } })
    const refused = await hold(paused.app, paused.sessionId, [paused.seatIdByLabel.A2])
    expect(refused.statusCode).toBe(422)
    expect(refused.json().error.message).toBe('Sales for this session are paused.')
    await paused.app.close()
  })

  it('stops selling a night when it ends, when no sales end was set', async () => {
    const world = await reservedWorld({
      session: {
        startsAt: minutesFromNow(-240),
        endsAt: minutesFromNow(-10),
        doorsOpenAt: null,
      },
    })

    const response = await hold(world.app, world.sessionId, [world.seatIdByLabel.A2])

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toBe('Sales for this session have closed.')

    await world.app.close()
  })

  it('holds no more seats than the strictest tier involved allows', async () => {
    const world = await reservedWorld({ front: { maxPerOrder: 1 } })

    const response = await hold(world.app, world.sessionId, [
      world.seatIdByLabel.A2,
      world.seatIdByLabel.B2,
    ])

    expect(response.statusCode).toBe(400)
    expect(world.prisma._store.ticketHold).toHaveLength(0)

    const map = (await seatMap(world.app, world.sessionId)).json().data
    expect(map.maxSeatsPerOrder).toBe(6)

    await world.app.close()
  })

  it('refuses a hold below a tier’s own minimum, counting the companion seat it pulls in', async () => {
    const world = await reservedWorld({ back: { minPerOrder: 2 } })
    const { app, prisma } = world

    // The wheelchair space is Front; its companion is Back, whose tier sells
    // at least two at a time. The order would be refused, so the hold is.
    const refused = await hold(app, world.sessionId, [world.seatIdByLabel.A1])

    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({
      code: 'BELOW_MINIMUM',
      message:
        'Seats sold as "Back stalls" are sold at least 2 at a time, and this selection has 1, companion seats included. Choose 1 more of them, or none.',
    })
    expect(prisma._store.ticketHold).toHaveLength(0)
    expect(prisma._store.eventSeat.every((seat) => seat.status === 'AVAILABLE')).toBe(true)

    // One more Back seat meets it, and the pair is held with the extra seat.
    const accepted = await hold(app, world.sessionId, [
      world.seatIdByLabel.A1,
      world.seatIdByLabel.B2,
    ])

    expect(accepted.statusCode).toBe(201)
    expect(
      accepted
        .json()
        .data.seats.map((seat) => seat.label)
        .sort(),
    ).toEqual(['A1', 'B1', 'B2'])

    await app.close()
  })

  it('refuses one seat of a tier that sells at least two, without mentioning companions', async () => {
    const world = await reservedWorld({ front: { minPerOrder: 2 } })

    const response = await hold(world.app, world.sessionId, [world.seatIdByLabel.A2])

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toBe(
      'Seats sold as "Front stalls" are sold at least 2 at a time, and this selection has 1. Choose 1 more of them, or none.',
    )
    expect(world.prisma._store.ticketHold).toHaveLength(0)

    await world.app.close()
  })

  it('takes back the seats of a hold that lapsed, as a system action, before claiming them', async () => {
    const world = await reservedWorld()
    const { app, prisma } = world
    const lapsedId = cuid()

    prisma._store.ticketHold.push({
      id: lapsedId,
      ticketTypeId: world.frontTier.id,
      quantity: 1,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() - 60_000),
      userId: world.ids.attendee.id,
      guestTokenHash: null,
      eventSessionId: world.sessionId,
      orderId: null,
      releasedAt: null,
      releasedBy: null,
      releaseReason: null,
      createdAt: new Date(Date.now() - 20 * 60_000),
      updatedAt: new Date(Date.now() - 20 * 60_000),
    })
    const a3 = prisma._store.eventSeat.find((row) => row.id === world.eventSeatIdByLabel.A3)
    a3.status = 'HELD'
    a3.holdId = lapsedId

    const response = await hold(app, world.sessionId, [world.seatIdByLabel.A3])

    expect(response.statusCode).toBe(201)

    const old = prisma._store.ticketHold.find((row) => row.id === lapsedId)
    expect(old).toMatchObject({ status: 'EXPIRED', releaseReason: 'EXPIRED_ON_RECLAIM' })
    expect(a3).toMatchObject({ status: 'HELD', holdId: response.json().data.id })

    const reclaimed = prisma._store.auditLog.filter((row) => row.action === 'hold.reclaimed')
    expect(reclaimed).toHaveLength(1)
    expect(reclaimed[0]).toMatchObject({ actorId: null, entityId: lapsedId })
    expect(reclaimed[0].metadata).toMatchObject({
      eventSessionId: world.sessionId,
      previousStatus: 'ACTIVE',
      newStatus: 'EXPIRED',
      seatsReleased: 1,
    })

    await app.close()
  })

  it('does not take back a lapsed hold’s seats while its order is waiting on the payment', async () => {
    const world = await reservedWorld()
    const { app, prisma } = world
    const waitingId = cuid()
    const orderId = cuid()

    // A capture that timed out: the order is PENDING until reconciliation
    // settles it, and the hold is past its time.
    prisma._store.order.push({
      id: orderId,
      eventId: world.ids.publishedEvent.id,
      userId: world.ids.attendee.id,
      status: 'PENDING',
      reference: 'DE-WAITING',
      currency: 'INR',
      subtotalCents: FRONT_CENTS,
      totalCents: FRONT_CENTS,
    })
    prisma._store.ticketHold.push({
      id: waitingId,
      ticketTypeId: world.frontTier.id,
      quantity: 1,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() - 60_000),
      userId: world.ids.attendee.id,
      guestTokenHash: null,
      eventSessionId: world.sessionId,
      orderId,
      releasedAt: null,
      releasedBy: null,
      releaseReason: null,
      createdAt: new Date(Date.now() - 20 * 60_000),
      updatedAt: new Date(Date.now() - 20 * 60_000),
    })
    const a3 = prisma._store.eventSeat.find((row) => row.id === world.eventSeatIdByLabel.A3)
    a3.status = 'HELD'
    a3.holdId = waitingId

    const response = await hold(app, world.sessionId, [world.seatIdByLabel.A3])

    expect(response.statusCode).toBe(422)
    expect(prisma._store.ticketHold.find((row) => row.id === waitingId).status).toBe('ACTIVE')
    expect(a3).toMatchObject({ status: 'HELD', holdId: waitingId })
    expect(prisma._store.auditLog.some((row) => row.action === 'hold.reclaimed')).toBe(false)

    // Once the order is cancelled, the lapsed hold is fair game again.
    prisma._store.order.find((row) => row.id === orderId).status = 'CANCELLED'

    const retaken = await hold(app, world.sessionId, [world.seatIdByLabel.A3])
    expect(retaken.statusCode).toBe(201)
    expect(a3).toMatchObject({ status: 'HELD', holdId: retaken.json().data.id })

    await app.close()
  })

  it('does not take back a seat whose hold is still live', async () => {
    const world = await reservedWorld()
    const { app, prisma } = world

    const first = await hold(app, world.sessionId, [world.seatIdByLabel.A3])
    expect(first.statusCode).toBe(201)

    const second = await hold(app, world.sessionId, [world.seatIdByLabel.A3])
    expect(second.statusCode).toBe(422)
    expect(prisma._store.auditLog.some((row) => row.action === 'hold.reclaimed')).toBe(false)

    await app.close()
  })
})
