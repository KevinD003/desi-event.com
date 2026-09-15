/**
 * The seating routes, from the outside.
 *
 * Two properties are worth a request rather than a unit test, because they are
 * about what crosses the wire:
 *
 *   - A buyer is told a seat is unavailable and never why. The unit tests check
 *     that `toPublicSeat` omits the status; these check that no layer between it
 *     and the response puts it back.
 *   - A selection is all or nothing. A partially satisfied hold is the failure
 *     that produces an order for seats the buyer does not have, and the only way
 *     to see it is to ask for two seats where one is gone.
 *
 * @module @desi-event/api/tests/seating
 */

import { describe, expect, it } from 'vitest'

import { makeWorld, minutesFromNow } from './helpers/fixtures.js'
import { bearer, createTestApp, signIn } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

/**
 * A world with a published seat map on sale at one session.
 *
 * Six seats in one row: A1 is accessible and A2 is its companion, so the
 * companion rules have something to act on, and A6 has an obstructed view.
 *
 * @param {object} [options] Options.
 * @param {Record<string, string>} [options.statuses] Seat label to `EventSeatStatus`.
 * @returns {Promise<object>} The harness plus the seating ids.
 */
async function createSeatedApp({ statuses = {} } = {}) {
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
    accessible: index === 0,
    companionOfSeatId: null,
    obstructedView: index === 5,
    restricted: false,
    restrictionNote: null,
    priceZoneId: null,
  }))
  seats[1].companionOfSeatId = seats[0].id

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
  seed.eventSeat = seats.map((seat) => ({
    id: cuid(),
    eventSessionId: sessionId,
    seatId: seat.id,
    ticketTypeId: ids.generalAdmission.id,
    status: statuses[seat.label] ?? 'AVAILABLE',
    holdId: null,
    orderItemId: null,
    priceCentsOverride: null,
    blockedReason: statuses[seat.label] === 'BLOCKED' ? 'production hold' : null,
  }))

  const harness = await createTestApp({ seed, ids })

  return {
    ...harness,
    sessionId,
    seats,
    byLabel: Object.fromEntries(seats.map((seat) => [seat.label, seat.id])),
  }
}

describe('GET /v1/sessions/:id/seats', () => {
  it('returns the map grouped into sections and rows, in order', async () => {
    const { app, sessionId } = await createSeatedApp()

    const response = await app.inject({ method: 'GET', url: `/v1/sessions/${sessionId}/seats` })

    expect(response.statusCode).toBe(200)

    const { data } = response.json()
    expect(data.counts).toMatchObject({ total: 6, available: 6, held: 0, sold: 0 })
    expect(data.sections).toHaveLength(1)
    expect(data.sections[0].rows[0].seats.map((seat) => seat.label)).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'A5',
      'A6',
    ])

    await app.close()
  })

  it('tells an anonymous buyer availability and never the reason', async () => {
    const { app, sessionId } = await createSeatedApp({
      statuses: { A3: 'HELD', A4: 'BLOCKED', A5: 'SOLD' },
    })

    const response = await app.inject({ method: 'GET', url: `/v1/sessions/${sessionId}/seats` })
    const seats = response.json().data.sections[0].rows[0].seats

    for (const label of ['A3', 'A4', 'A5']) {
      const seat = seats.find((candidate) => candidate.label === label)

      expect(seat.available).toBe(false)
      expect(seat).not.toHaveProperty('status')
    }

    // And nothing anywhere in the payload names a status or a reason.
    expect(response.body).not.toContain('BLOCKED')
    expect(response.body).not.toContain('production hold')
    expect(response.body).not.toContain('holdId')

    await app.close()
  })

  it('tells an organiser the real status', async () => {
    const { app, sessionId } = await createSeatedApp({ statuses: { A4: 'BLOCKED' } })
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionId}/seats`,
      headers: bearer(token),
    })

    const seat = response
      .json()
      .data.sections[0].rows[0].seats.find((candidate) => candidate.label === 'A4')

    expect(seat.status).toBe('BLOCKED')
    expect(seat.blockedReason).toBe('production hold')

    await app.close()
  })

  it('does not show another organisation an inside view', async () => {
    const { app, sessionId } = await createSeatedApp({ statuses: { A4: 'BLOCKED' } })
    const token = await signIn(app, 'rival@dhol.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionId}/seats`,
      headers: bearer(token),
    })

    expect(response.json().data.sections[0].rows[0].seats[3]).not.toHaveProperty('status')

    await app.close()
  })

  it('publishes accessibility attributes to everybody', async () => {
    const { app, sessionId } = await createSeatedApp()

    const response = await app.inject({ method: 'GET', url: `/v1/sessions/${sessionId}/seats` })
    const seats = response.json().data.sections[0].rows[0].seats

    expect(seats[0].accessible).toBe(true)
    expect(seats[1].companionOfSeatId).toBe(seats[0].seatId)
    expect(seats[5].obstructedView).toBe(true)

    await app.close()
  })

  it('answers 404 for a session that does not exist', async () => {
    const { app } = await createSeatedApp()

    const response = await app.inject({ method: 'GET', url: `/v1/sessions/${cuid()}/seats` })

    expect(response.statusCode).toBe(404)

    await app.close()
  })
})

describe('POST /v1/sessions/:id/holds', () => {
  it('reserves the chosen seats and returns a guest token', async () => {
    const { app, sessionId, byLabel, prisma } = await createSeatedApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/holds`,
      payload: { seatIds: [byLabel.A3, byLabel.A4] },
    })

    expect(response.statusCode).toBe(201)

    const { data } = response.json()
    expect(data.seats.map((seat) => seat.label).sort()).toEqual(['A3', 'A4'])
    expect(data.guestToken).toBeTruthy()

    const held = prisma._store.eventSeat.filter((seat) => seat.status === 'HELD')
    expect(held).toHaveLength(2)
    expect(new Set(held.map((seat) => seat.holdId)).size).toBe(1)

    await app.close()
  })

  it('owns the hold with the account when the buyer is signed in', async () => {
    const { app, sessionId, byLabel, prisma } = await createSeatedApp()
    const token = await signIn(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/holds`,
      headers: bearer(token),
      payload: { seatIds: [byLabel.A3] },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data.guestToken).toBeNull()

    const hold = prisma._store.ticketHold.at(-1)
    expect(hold.userId).toBeTruthy()
    expect(hold.guestTokenHash).toBeNull()

    await app.close()
  })

  it('takes the companion seat when the accessible seat is chosen', async () => {
    const { app, sessionId, byLabel } = await createSeatedApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/holds`,
      payload: { seatIds: [byLabel.A1] },
    })

    expect(response.statusCode).toBe(201)
    expect(
      response
        .json()
        .data.seats.map((seat) => seat.label)
        .sort(),
    ).toEqual(['A1', 'A2'])

    await app.close()
  })

  it('reserves nothing when one of the seats has gone', async () => {
    const { app, sessionId, byLabel, prisma } = await createSeatedApp({ statuses: { A4: 'SOLD' } })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/holds`,
      payload: { seatIds: [byLabel.A3, byLabel.A4] },
    })

    expect(response.statusCode).toBe(422)
    // All or nothing: A3 is still available, not stranded in a half-made hold.
    expect(prisma._store.eventSeat.filter((seat) => seat.status === 'HELD')).toHaveLength(0)

    await app.close()
  })

  it('names the seat that went, so the buyer knows which to replace', async () => {
    const { app, sessionId, byLabel } = await createSeatedApp({ statuses: { A4: 'HELD' } })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/holds`,
      payload: { seatIds: [byLabel.A3, byLabel.A4] },
    })

    expect(response.json().error.message).toContain('A4')

    await app.close()
  })

  it('does not say why the seat went', async () => {
    const { app, sessionId, byLabel } = await createSeatedApp({ statuses: { A4: 'BLOCKED' } })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/holds`,
      payload: { seatIds: [byLabel.A4] },
    })

    expect(response.body).not.toContain('BLOCKED')
    expect(response.body).not.toContain('production hold')

    await app.close()
  })

  it('refuses a second hold on a seat it already holds', async () => {
    const { app, sessionId, byLabel, prisma } = await createSeatedApp()
    const payload = { seatIds: [byLabel.A3] }

    const first = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/holds`,
      payload,
    })
    const second = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/holds`,
      payload,
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(422)
    expect(prisma._store.eventSeat.filter((seat) => seat.status === 'HELD')).toHaveLength(1)

    await app.close()
  })

  it('refuses a seat from another session', async () => {
    const { app, sessionId } = await createSeatedApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/holds`,
      payload: { seatIds: [cuid()] },
    })

    expect([404, 422]).toContain(response.statusCode)

    await app.close()
  })

  it.each([
    ['an empty list', []],
    ['more seats than the schema allows', Array.from({ length: 21 }, () => cuid())],
  ])('refuses %s by schema', async (_label, seatIds) => {
    const { app, sessionId } = await createSeatedApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/holds`,
      payload: { seatIds },
    })

    expect(response.statusCode).toBe(400)

    await app.close()
  })

  it('ignores a price the browser supplies', async () => {
    const { app, sessionId, byLabel, ids } = await createSeatedApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/holds`,
      payload: { seatIds: [byLabel.A3], subtotalCents: 1, priceCents: 1, ttlSeconds: 999_999 },
    })

    expect(response.statusCode).toBe(201)

    const { data } = response.json()
    // The tier's price, not the browser's.
    expect(data.subtotalCents).toBe(ids.generalAdmission.priceCents)

    await app.close()
  })

  it('clamps the hold lifetime server-side', async () => {
    const { app, sessionId, byLabel } = await createSeatedApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/holds`,
      payload: { seatIds: [byLabel.A3] },
    })

    const expiresAt = new Date(response.json().data.expiresAt).getTime()

    // At most thirty minutes out, whatever anybody asks for: a hold is inventory
    // taken away from everybody else.
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000 + 1000)
    expect(expiresAt).toBeGreaterThan(Date.now())

    await app.close()
  })

  it('records who took the seats, without recording the guest token', async () => {
    const { app, sessionId, byLabel, prisma } = await createSeatedApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/holds`,
      payload: { seatIds: [byLabel.A3] },
    })

    const entry = prisma._store.auditLog.find((row) => row.action === 'hold.seats_held')

    expect(entry).toMatchObject({ entityType: 'TicketHold', metadata: { mode: 'guest', seats: 1 } })
    expect(JSON.stringify(entry)).not.toContain(response.json().data.guestToken)

    await app.close()
  })
})
