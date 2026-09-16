/**
 * One complete reserved-seat purchase, from an empty hold to a ticket.
 *
 * This is the whole path in one file, deliberately. Each of the seventeen
 * properties below can be argued about in isolation and none of them is worth
 * much alone: what matters is that a single purchase satisfies all of them at
 * once, because that is the only shape a real one comes in.
 *
 * The seats are priced in two zones on purpose. A selection that spans zones is
 * two order lines of one ticket type, which is the case that used to be priced
 * and settled wrongly, and a test where every seat costs the same would not
 * notice.
 *
 * @module @desi-event/api/tests/reserved-seat-checkout
 */

import { describe, expect, it } from 'vitest'

import { computeOrderTotals } from '@desi-event/pricing'
import { createInMemoryProviderRegistry } from '@desi-event/providers'

import { bearer, createTestApp, feeConfig, signIn, taxRateBps } from './helpers/app.js'
import { TEST_AUTH_SECRET, makeWorld, minutesFromNow } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'
import { credentialDigest, mintTicketCredential } from '../src/lib/ticket-credentials.js'

/** The front zone costs more than the tier; the back zone costs less. */
const FRONT_CENTS = 250_000
const BACK_CENTS = 90_000

/**
 * What one seat at that face value comes to once fees and tax are added.
 *
 * The mock provider is told to fail on a specific *total*, so this has to be
 * derived from the same functions the route uses. Hard-coding the magic amount
 * as a seat price instead would mean the trigger quietly stopped firing the
 * next time the fee schedule moved, and the test would pass by not testing.
 *
 * @param {number} faceValueCents The seat's price.
 * @returns {number} The order total in minor units.
 */
function oneSeatTotal(faceValueCents) {
  return computeOrderTotals({
    items: [{ ticketTypeId: 'seat', quantity: 1, unitPriceCents: faceValueCents, name: 'Stalls' }],
    promoCode: null,
    feeConfig: feeConfig('INR'),
    taxRateBps: taxRateBps('IN'),
    currency: 'INR',
    now: new Date(),
  }).totalCents
}

/**
 * A published event with one reserved-seat session and six seats in two zones.
 *
 * A1–A3 are front zone, A4–A6 back zone. Their prices are overrides on the
 * event seats, which is where a price zone ends up once a session is prepared.
 *
 * @param {object} [options] Options.
 * @param {Record<string, string>} [options.statuses] Seat label to `EventSeatStatus`.
 * @param {Record<string, number|null>} [options.prices] Seat label to price override.
 * @param {object} [options.payments] Mock payment provider options, to force a failure.
 * @returns {Promise<object>} The harness plus seating ids.
 */
async function seatedWorld({ statuses = {}, prices = {}, payments } = {}) {
  const providers = payments ? createInMemoryProviderRegistry({ payments }) : undefined
  const world = await makeWorld()
  const { seed, ids } = world

  const venueMapId = cuid()
  const versionId = cuid()
  const sectionId = cuid()
  const rowId = cuid()
  const sessionId = cuid()

  seed.venueMap = [{ id: venueMapId, venueId: ids.venue.id, name: 'Main hall' }]
  seed.venueMapVersion = [
    {
      id: versionId,
      venueMapId,
      version: 1,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      seatCount: 6,
    },
  ]
  seed.section = [
    { id: sectionId, venueMapVersionId: versionId, name: 'Stalls', kind: 'SEATED', sortOrder: 1 },
  ]
  seed.seatRow = [{ id: rowId, venueMapVersionId: versionId, sectionId, label: 'A', sortOrder: 1 }]

  const seats = Array.from({ length: 6 }, (_, index) => ({
    id: cuid(),
    venueMapVersionId: versionId,
    sectionId,
    rowId,
    label: `A${index + 1}`,
    sortOrder: index + 1,
    accessible: false,
    companionOfSeatId: null,
    obstructedView: false,
    restricted: false,
    restrictionNote: null,
    priceZoneId: null,
  }))

  seed.seat = seats
  seed.eventSession = [
    {
      id: sessionId,
      eventId: ids.publishedEvent.id,
      startsAt: minutesFromNow(60 * 24),
      endsAt: minutesFromNow(60 * 26),
      timezone: 'Asia/Kolkata',
      status: 'SCHEDULED',
      venueMapVersionId: versionId,
    },
  ]

  const eventSeatIdByLabel = {}

  seed.eventSeat = seats.map((seat, index) => {
    const id = cuid()
    eventSeatIdByLabel[seat.label] = id

    const override =
      seat.label in prices ? prices[seat.label] : index < 3 ? FRONT_CENTS : BACK_CENTS

    return {
      id,
      eventSessionId: sessionId,
      seatId: seat.id,
      ticketTypeId: ids.generalAdmission.id,
      status: statuses[seat.label] ?? 'AVAILABLE',
      holdId: null,
      orderItemId: null,
      priceCentsOverride: override,
      blockedReason: null,
    }
  })

  const harness = await createTestApp({ seed, ids, providers })

  return {
    ...harness,
    sessionId,
    seats,
    seatIdByLabel: Object.fromEntries(seats.map((seat) => [seat.label, seat.id])),
    eventSeatIdByLabel,
  }
}

/**
 * Hold some seats as an anonymous buyer.
 *
 * @param {object} app The Fastify instance.
 * @param {string} sessionId The session.
 * @param {string[]} seatIds The seats.
 * @returns {Promise<object>} The hold payload: `{ id, guestToken, seats, ... }`.
 */
async function holdSeats(app, sessionId, seatIds) {
  const response = await app.inject({
    method: 'POST',
    url: `/v1/sessions/${sessionId}/holds`,
    payload: { seatIds },
  })

  expect(response.statusCode).toBe(201)

  return response.json().data
}

/**
 * Buy the held seats.
 *
 * @param {object} app The Fastify instance.
 * @param {object} options Options.
 * @param {object} options.ids World ids.
 * @param {object} options.held The hold payload from {@link holdSeats}.
 * @param {number} options.quantity How many seats the order claims.
 * @param {string} [options.idempotencyKey] A checkout key, to test replay.
 * @returns {Promise<object>} The raw inject response.
 */
function buy(app, { ids, held, quantity, idempotencyKey }) {
  const headers = {}
  if (held.guestToken) headers['x-hold-token'] = held.guestToken
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey

  return app.inject({
    method: 'POST',
    url: '/v1/orders',
    headers,
    payload: {
      eventId: ids.publishedEvent.id,
      buyerEmail: 'priya@example.com',
      buyerName: 'Priya Sharma',
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity }],
      holdIds: [held.id],
    },
  })
}

describe('a reserved-seat purchase, end to end', () => {
  it('prices the seats that were chosen, not the tier they sit in', async () => {
    const { app, ids, sessionId, seatIdByLabel, prisma } = await seatedWorld()

    // A2 is front zone, A5 back. Two lines of one ticket type.
    const held = await holdSeats(app, sessionId, [seatIdByLabel.A2, seatIdByLabel.A5])
    const response = await buy(app, { ids, held, quantity: 2 })

    expect(response.statusCode).toBe(201)

    const order = response.json().data

    expect(order.subtotalCents).toBe(FRONT_CENTS + BACK_CENTS)

    const lines = await prisma.orderItem.findMany({ where: { orderId: order.id } })

    expect(lines).toHaveLength(2)
    expect(lines.map((line) => line.unitPriceCents).sort((a, b) => a - b)).toEqual([
      BACK_CENTS,
      FRONT_CENTS,
    ])

    await app.close()
  })

  it('sells the held seats and links each to the line that paid for it', async () => {
    const { app, ids, sessionId, seatIdByLabel, eventSeatIdByLabel, prisma } = await seatedWorld()

    const held = await holdSeats(app, sessionId, [seatIdByLabel.A2, seatIdByLabel.A5])
    const response = await buy(app, { ids, held, quantity: 2 })
    const order = response.json().data

    const front = await prisma.eventSeat.findUnique({ where: { id: eventSeatIdByLabel.A2 } })
    const back = await prisma.eventSeat.findUnique({ where: { id: eventSeatIdByLabel.A5 } })

    expect(front.status).toBe('SOLD')
    expect(back.status).toBe('SOLD')

    const lines = await prisma.orderItem.findMany({ where: { orderId: order.id } })
    const lineById = new Map(lines.map((line) => [line.id, line]))

    // The seat that cost more is on the line that charges more. Matching by
    // ticket type alone could not tell these two lines apart.
    expect(lineById.get(front.orderItemId).unitPriceCents).toBe(FRONT_CENTS)
    expect(lineById.get(back.orderItemId).unitPriceCents).toBe(BACK_CENTS)

    await app.close()
  })

  it('issues one ticket per seat, each pointing at its own seat', async () => {
    const { app, ids, sessionId, seatIdByLabel, eventSeatIdByLabel, prisma } = await seatedWorld()

    const held = await holdSeats(app, sessionId, [seatIdByLabel.A1, seatIdByLabel.A6])
    const response = await buy(app, { ids, held, quantity: 2 })
    const order = response.json().data

    const lines = await prisma.orderItem.findMany({ where: { orderId: order.id } })
    const tickets = []
    for (const line of lines) {
      tickets.push(...(await prisma.ticket.findMany({ where: { orderItemId: line.id } })))
    }

    expect(tickets).toHaveLength(2)
    expect(tickets.map((ticket) => ticket.eventSeatId).sort()).toEqual(
      [eventSeatIdByLabel.A1, eventSeatIdByLabel.A6].sort(),
    )
    expect(tickets.every((ticket) => ticket.status === 'VALID')).toBe(true)

    await app.close()
  })

  it('stores a digest of the pass and never the pass itself', async () => {
    const { app, ids, sessionId, seatIdByLabel, prisma } = await seatedWorld()

    const held = await holdSeats(app, sessionId, [seatIdByLabel.A3])
    const response = await buy(app, { ids, held, quantity: 1 })
    const order = response.json().data

    const line = await prisma.orderItem.findFirst({ where: { orderId: order.id } })
    const ticket = await prisma.ticket.findFirst({ where: { orderItemId: line.id } })

    expect(ticket.credentialHash).toMatch(/^[0-9a-f]{64}$/)
    expect(ticket.credentialIssuedAt).toBeInstanceOf(Date)

    // The stored value is a digest of the derivable credential, so the pass can
    // be shown again without anything reusable having been written down.
    const credential = mintTicketCredential({
      secret: TEST_AUTH_SECRET,
      ticketId: ticket.id,
      version: ticket.credentialVersion,
    })

    expect(ticket.credentialHash).toBe(credentialDigest(credential))

    // And nothing in the checkout response carries it.
    expect(response.body).not.toContain(credential)
    expect(response.body).not.toContain(ticket.credentialHash)

    await app.close()
  })

  it('posts one balanced ledger batch for the money that moved', async () => {
    const { app, ids, sessionId, seatIdByLabel, prisma } = await seatedWorld()

    const held = await holdSeats(app, sessionId, [seatIdByLabel.A2, seatIdByLabel.A5])
    const response = await buy(app, { ids, held, quantity: 2 })
    const order = response.json().data

    const batches = await prisma.ledgerBatch.findMany({ where: { orderId: order.id } })

    expect(batches).toHaveLength(1)
    expect(batches[0].status).toBe('POSTED')
    expect(batches[0].debitCents).toBe(batches[0].creditCents)
    expect(batches[0].debitCents).toBe(order.totalCents)

    await app.close()
  })

  it('decrements the tier’s sold counter exactly once', async () => {
    const { app, ids, sessionId, seatIdByLabel, prisma } = await seatedWorld()

    const before = await prisma.ticketType.findUnique({ where: { id: ids.generalAdmission.id } })
    const held = await holdSeats(app, sessionId, [seatIdByLabel.A2, seatIdByLabel.A5])
    await buy(app, { ids, held, quantity: 2 })

    const after = await prisma.ticketType.findUnique({ where: { id: ids.generalAdmission.id } })

    expect(after.quantitySold - before.quantitySold).toBe(2)

    await app.close()
  })

  it('converts the hold, so a later sweep cannot release a sold seat', async () => {
    const { app, ids, sessionId, seatIdByLabel, eventSeatIdByLabel, prisma } = await seatedWorld()

    const held = await holdSeats(app, sessionId, [seatIdByLabel.A2])
    await buy(app, { ids, held, quantity: 1 })

    const hold = await prisma.ticketHold.findUnique({ where: { id: held.id } })

    expect(hold.status).toBe('CONVERTED')

    // And the release path is conditional on HELD, so even a sweep that found
    // this hold would move nothing.
    const { releaseSeats } = await import('../src/lib/seating.js')
    const released = await releaseSeats(prisma, held.id)

    expect(released).toBe(0)
    expect(
      (await prisma.eventSeat.findUnique({ where: { id: eventSeatIdByLabel.A2 } })).status,
    ).toBe('SOLD')

    await app.close()
  })

  it('replays a retried checkout instead of selling the seat twice', async () => {
    const { app, ids, sessionId, seatIdByLabel, prisma } = await seatedWorld()

    const held = await holdSeats(app, sessionId, [seatIdByLabel.A2])
    const key = 'retry-after-a-dropped-connection'

    const first = await buy(app, { ids, held, quantity: 1, idempotencyKey: key })
    const second = await buy(app, { ids, held, quantity: 1, idempotencyKey: key })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(second.json().data.id).toBe(first.json().data.id)

    const orders = await prisma.order.findMany({})
    const batches = await prisma.ledgerBatch.findMany({})

    expect(orders).toHaveLength(1)
    expect(batches).toHaveLength(1)

    await app.close()
  })

  it('refuses a second buyer the seat the first one holds', async () => {
    const { app, sessionId, seatIdByLabel } = await seatedWorld()

    await holdSeats(app, sessionId, [seatIdByLabel.A2])

    const loser = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/holds`,
      payload: { seatIds: [seatIdByLabel.A2] },
    })

    expect(loser.statusCode).toBeGreaterThanOrEqual(400)
    expect(loser.json().error.message).toMatch(/gone|took|unavailable|choose/i)

    await app.close()
  })

  it('does not sell the seat when the card is declined', async () => {
    const { app, ids, sessionId, seatIdByLabel, eventSeatIdByLabel, prisma } = await seatedWorld({
      payments: { declineAmountCents: oneSeatTotal(FRONT_CENTS) },
    })

    const held = await holdSeats(app, sessionId, [seatIdByLabel.A2])
    const response = await buy(app, { ids, held, quantity: 1 })

    expect(response.statusCode).toBeGreaterThanOrEqual(400)

    const seat = await prisma.eventSeat.findUnique({ where: { id: eventSeatIdByLabel.A2 } })

    expect(seat.status).toBe('HELD')
    expect(await prisma.ticket.findMany({})).toHaveLength(0)
    expect(await prisma.ledgerBatch.findMany({})).toHaveLength(0)

    await app.close()
  })

  it('does not sell the seat when the provider does not answer', async () => {
    const { app, ids, sessionId, seatIdByLabel, eventSeatIdByLabel, prisma } = await seatedWorld({
      payments: { timeoutAmountCents: oneSeatTotal(FRONT_CENTS) },
    })

    const held = await holdSeats(app, sessionId, [seatIdByLabel.A2])
    const response = await buy(app, { ids, held, quantity: 1 })

    expect(response.statusCode).toBeGreaterThanOrEqual(400)

    const seat = await prisma.eventSeat.findUnique({ where: { id: eventSeatIdByLabel.A2 } })

    // Held, not sold and not released: the charge may have succeeded, so the
    // seat stays reserved until reconciliation says which it was.
    expect(seat.status).toBe('HELD')
    expect(await prisma.ticket.findMany({})).toHaveLength(0)

    const tasks = await prisma.reconciliationTask.findMany({})

    expect(tasks).toHaveLength(1)
    expect(tasks[0].kind).toBe('PAYMENT_TIMEOUT')

    await app.close()
  })
})

describe('a reserved-seat order that does not add up', () => {
  it('refuses a quantity that is not the number of seats held', async () => {
    const { app, ids, sessionId, seatIdByLabel } = await seatedWorld()

    const held = await holdSeats(app, sessionId, [seatIdByLabel.A2])
    const response = await buy(app, { ids, held, quantity: 3 })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toMatch(/reserved seating/i)

    await app.close()
  })

  it('refuses a hold whose seat belongs to another session', async () => {
    const { app, ids, sessionId, seatIdByLabel, eventSeatIdByLabel, prisma } = await seatedWorld()

    const held = await holdSeats(app, sessionId, [seatIdByLabel.A2])

    // Move the seat under the hold's feet, to a session of another event.
    const strandedSession = await prisma.eventSession.create({
      data: {
        id: cuid(),
        eventId: ids.draftEvent.id,
        startsAt: minutesFromNow(60 * 48),
        endsAt: minutesFromNow(60 * 50),
        timezone: 'Asia/Kolkata',
      },
    })

    await prisma.eventSeat.update({
      where: { id: eventSeatIdByLabel.A2 },
      data: { eventSessionId: strandedSession.id },
    })

    const response = await buy(app, { ids, held, quantity: 1 })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toMatch(/not on sale at this session/i)

    await app.close()
  })

  it('refuses a hold whose seat has moved to another ticket type', async () => {
    const { app, ids, sessionId, seatIdByLabel, eventSeatIdByLabel, prisma } = await seatedWorld()

    const held = await holdSeats(app, sessionId, [seatIdByLabel.A2])

    await prisma.eventSeat.update({
      where: { id: eventSeatIdByLabel.A2 },
      data: { ticketTypeId: ids.vip.id },
    })

    const response = await buy(app, { ids, held, quantity: 1 })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toMatch(/no longer sold at that ticket type/i)

    await app.close()
  })

  it('refuses a hold whose seat was released under it', async () => {
    const { app, ids, sessionId, seatIdByLabel, eventSeatIdByLabel, prisma } = await seatedWorld()

    const held = await holdSeats(app, sessionId, [seatIdByLabel.A2])

    await prisma.eventSeat.update({
      where: { id: eventSeatIdByLabel.A2 },
      data: { status: 'AVAILABLE', holdId: null },
    })

    const response = await buy(app, { ids, held, quantity: 1 })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/lapsed/i)

    await app.close()
  })

  it('charges what the seat cost when the order was priced, not what it costs now', async () => {
    const { app, ids, sessionId, seatIdByLabel, eventSeatIdByLabel, prisma } = await seatedWorld()

    const held = await holdSeats(app, sessionId, [seatIdByLabel.A2])
    const response = await buy(app, { ids, held, quantity: 1 })
    const order = response.json().data

    // The organiser re-zones the seat after the sale.
    await prisma.eventSeat.update({
      where: { id: eventSeatIdByLabel.A2 },
      data: { priceCentsOverride: 10 },
    })

    const line = await prisma.orderItem.findFirst({ where: { orderId: order.id } })
    const holdItem = await prisma.holdItem.findFirst({ where: { holdId: held.id } })

    expect(line.unitPriceCents).toBe(FRONT_CENTS)
    expect(holdItem.unitPriceCents).toBe(FRONT_CENTS)
    expect(order.totalCents).toBeGreaterThan(FRONT_CENTS - 1)

    await app.close()
  })
})

describe('what an organiser can see afterwards', () => {
  it('shows the seat as sold, with the line that bought it', async () => {
    const { app, ids, sessionId, seatIdByLabel, prisma } = await seatedWorld()

    const held = await holdSeats(app, sessionId, [seatIdByLabel.A2])
    await buy(app, { ids, held, quantity: 1 })

    const token = await signIn(app, 'arun@rangoli.example')
    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionId}/seats`,
      headers: bearer(token),
    })

    const seat = response
      .json()
      .data.sections[0].rows[0].seats.find((candidate) => candidate.label === 'A2')

    expect(seat.status).toBe('SOLD')
    expect(response.json().data.counts.sold).toBe(1)

    // And an anonymous buyer is told only that it is unavailable.
    const anonymous = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionId}/seats`,
    })

    expect(anonymous.body).not.toContain('SOLD')
    expect(await prisma.ticket.findMany({})).toHaveLength(1)

    await app.close()
  })
})
