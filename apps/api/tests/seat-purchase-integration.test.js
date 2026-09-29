/**
 * Buying reserved seats against a real database, from prepared inventory to
 * a ticket with a name on it.
 *
 * The stub serialises writes and models none of the partial indexes, CHECKs or
 * row locks this path depends on, so the properties that matter are proven
 * here: seats are bound to the reserved tier of their price zone; two buyers
 * racing for a wheelchair space and its companion cannot split the pair; a
 * released or lapsed seat hold puts its seats back on sale (the leak this area
 * fixed); and the database itself refuses a second reserved tier on a zone and
 * a staged name that does not fit.
 *
 * Collected by the API suite and run with `REQUIRE_DATABASE=1` in CI, where an
 * unreachable database is a failure rather than a skip.
 *
 * @module @desi-event/api/tests/seat-purchase-integration
 */

import { createHash } from 'node:crypto'

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { createExpireHoldsProcessor } from '../../worker/src/processors/expire-holds.js'
import { buildApp } from '../src/app.js'
import { prepareInventory } from '../src/lib/event-authoring.js'
import { startSession } from '../src/lib/sessions.js'
import { testEnv } from './helpers/app.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, reachable, when } = await connectTestDatabase('the seat purchase suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

let sequence = 0

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256')
    .update(`seat-purchase-${RUN}-${kind}-${sequence}`)
    .digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

let app
let world

/**
 * Bearer headers for a real session.
 *
 * @param {object} who The user.
 * @returns {Promise<object>} The headers.
 */
async function sessionFor(who) {
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { secret } = await startSession(prisma, {
    actor: { id: who.id, role: who.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'seat-purchase-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { authorization: `Bearer ${secret}` }
}

/**
 * A user row.
 *
 * @param {string} label Distinguishes it.
 * @param {string} role The platform role.
 * @returns {Promise<object>} The user.
 */
function user(label, role = 'ATTENDEE') {
  return prisma.user.create({
    data: {
      id: id(`user-${label}`),
      email: `${label}-${RUN}@seat-purchase.example`,
      displayName: `${label} ${RUN}`,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role,
      emailVerified: true,
    },
  })
}

/**
 * A published event with one seated night on a published two-zone map, two
 * reserved tiers, and its inventory prepared.
 *
 * Stalls row A: A1 (Front, wheelchair space), A2, A3 (Front)
 * Stalls row B: B1 (Back, companion of A1), B2, B3 (Back)
 *
 * @param {string} label Distinguishes it.
 * @returns {Promise<object>} The rows, and the seat ids by label.
 */
async function seatedEvent(label) {
  const startsAt = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000)
  const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1000)

  const map = await prisma.venueMap.create({
    data: { id: id('map'), venueId: world.venue.id, name: `Plan ${label} ${RUN}` },
  })
  const version = await prisma.venueMapVersion.create({
    data: { id: id('version'), venueMapId: map.id, version: 1, seatCount: 6 },
  })
  const section = await prisma.section.create({
    data: { id: id('section'), venueMapVersionId: version.id, name: 'Stalls', kind: 'SEATED' },
  })
  const rows = {}
  for (const [index, row] of ['A', 'B'].entries()) {
    rows[row] = await prisma.seatRow.create({
      data: {
        id: id(`row-${row}`),
        venueMapVersionId: version.id,
        sectionId: section.id,
        label: row,
        sortOrder: index + 1,
      },
    })
  }
  const zones = {
    front: await prisma.priceZone.create({
      data: { id: id('zone-front'), venueMapVersionId: version.id, name: 'Front', sortOrder: 1 },
    }),
    back: await prisma.priceZone.create({
      data: { id: id('zone-back'), venueMapVersionId: version.id, name: 'Back', sortOrder: 2 },
    }),
  }

  const seatIdByLabel = {}
  const seat = async (seatLabel, row, zone, sortOrder, extra = {}) => {
    const created = await prisma.seat.create({
      data: {
        id: id(`seat-${seatLabel}`),
        venueMapVersionId: version.id,
        sectionId: section.id,
        rowId: rows[row].id,
        label: seatLabel,
        sortOrder,
        priceZoneId: zone.id,
        ...extra,
      },
    })

    seatIdByLabel[seatLabel] = created.id

    return created
  }

  const a1 = await seat('A1', 'A', zones.front, 1, { accessible: true })
  await seat('A2', 'A', zones.front, 2)
  await seat('A3', 'A', zones.front, 3)
  await seat('B1', 'B', zones.back, 1, { companionOfSeatId: a1.id })
  await seat('B2', 'B', zones.back, 2)
  await seat('B3', 'B', zones.back, 3)

  await prisma.venueMapVersion.update({
    where: { id: version.id },
    data: { publishedAt: new Date() },
  })

  const event = await prisma.event.create({
    data: {
      id: id('event'),
      organizationId: world.organization.id,
      venueId: world.venue.id,
      title: `Seated ${label} ${RUN}`,
      slug: `seated-${label}-${RUN}`,
      summary: 'Seeded for the seat purchase suite.',
      description: 'Seeded for the seat purchase suite, long enough to be plausible.',
      category: 'MUSIC_CONCERT',
      status: 'ON_SALE',
      startsAt,
      endsAt,
      timezone: 'America/Chicago',
      publishedAt: new Date(),
      salesOpenedAt: new Date(),
      policies: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours before.' },
    },
  })
  const session = await prisma.eventSession.create({
    data: {
      id: id('session'),
      eventId: event.id,
      startsAt,
      endsAt,
      timezone: 'America/Chicago',
      label: 'Night 1',
      venueMapVersionId: version.id,
    },
  })
  const tier = (name, zone, priceCents) =>
    prisma.ticketType.create({
      data: {
        id: id(`tier-${name}`),
        eventId: event.id,
        name: `${name} ${label}`,
        priceCents,
        currency: 'USD',
        quantityTotal: 0,
        maxPerOrder: 6,
        status: 'ON_SALE',
        reserved: true,
        eventSessionId: session.id,
        priceZoneId: zone.id,
      },
    })
  const front = await tier('Front', zones.front, 6000)
  const back = await tier('Back', zones.back, 3500)

  const prepared = await prepareInventory(prisma, {
    event: { ...event, sessions: [session] },
    sessionId: session.id,
    actor: world.owner,
  })

  const eventSeats = await prisma.eventSeat.findMany({ where: { eventSessionId: session.id } })
  const eventSeatIdByLabel = Object.fromEntries(
    Object.entries(seatIdByLabel).map(([seatLabel, seatId]) => [
      seatLabel,
      eventSeats.find((row) => row.seatId === seatId).id,
    ]),
  )

  return {
    event,
    session,
    zones,
    front,
    back,
    prepared,
    seatIdByLabel,
    eventSeatIdByLabel,
  }
}

/**
 * Hold seats as a buyer.
 *
 * @param {object} seated From {@link seatedEvent}.
 * @param {string[]} labels Seat labels.
 * @param {object} headers The buyer's headers.
 * @returns {Promise<object>} The inject result.
 */
function holdSeats(seated, labels, headers) {
  return app.inject({
    method: 'POST',
    url: `/v1/sessions/${seated.session.id}/holds`,
    headers,
    payload: { seatIds: labels.map((seatLabel) => seated.seatIdByLabel[seatLabel]) },
  })
}

/**
 * The seats of a night, by label.
 *
 * @param {object} seated From {@link seatedEvent}.
 * @returns {Promise<Record<string, object>>} `EventSeat` rows by seat label.
 */
async function seatsByLabel(seated) {
  const rows = await prisma.eventSeat.findMany({ where: { eventSessionId: seated.session.id } })

  return Object.fromEntries(
    Object.entries(seated.eventSeatIdByLabel).map(([seatLabel, eventSeatId]) => [
      seatLabel,
      rows.find((row) => row.id === eventSeatId),
    ]),
  )
}

beforeAll(async () => {
  if (!reachable) return

  app = await buildApp({
    prisma,
    // Payment ids carry the run: \`Payment.provider + providerRef\` is unique,
    // and other suites on this database mint ids from the same counter.
    providers: createInMemoryProviderRegistry({ payments: { idPrefix: `piseat${RUN}` } }),
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' } },
  })
  await app.ready()

  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `Seat purchase ${RUN}`,
      slug: `seat-purchase-${RUN}`,
      contactEmail: `hello-${RUN}@seat-purchase.example`,
      verified: true,
      verificationStatus: 'VERIFIED',
    },
  })
  const venue = await prisma.venue.create({
    data: {
      id: id('venue'),
      name: `Seat Hall ${RUN}`,
      slug: `seat-hall-${RUN}`,
      addressLine1: '1 Test Road',
      city: 'Chicago',
      region: 'IL',
      postalCode: '60601',
      country: 'US',
      organizationId: organization.id,
    },
  })
  const owner = await user('owner', 'ORGANIZER')

  await prisma.membership.create({
    data: {
      id: id('membership'),
      userId: owner.id,
      organizationId: organization.id,
      role: 'OWNER',
    },
  })

  const asha = await user('asha')
  const ravi = await user('ravi')

  world = { organization, venue, owner }
  world.asha = { user: asha, headers: await sessionFor(asha) }
  world.ravi = { user: ravi, headers: await sessionFor(ravi) }
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

when()('reserved seats on a real database', () => {
  it('binds every prepared seat to the reserved tier of its zone, audited', async () => {
    const seated = await seatedEvent('bind')

    expect(seated.prepared).toMatchObject({ prepared: 6 })

    const seats = await seatsByLabel(seated)
    for (const label of ['A1', 'A2', 'A3']) expect(seats[label].ticketTypeId).toBe(seated.front.id)
    for (const label of ['B1', 'B2', 'B3']) expect(seats[label].ticketTypeId).toBe(seated.back.id)

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'event.seats_bound', entityId: seated.session.id },
    })
    expect(audit.metadata).toMatchObject({ bound: 6 })
  })

  it('never splits a wheelchair space from its companion between two racing buyers', async () => {
    const seated = await seatedEvent('race')

    const [first, second] = await Promise.all([
      holdSeats(seated, ['A1'], world.asha.headers),
      holdSeats(seated, ['B1'], world.ravi.headers),
    ])

    const statuses = [first.statusCode, second.statusCode].sort()
    expect(statuses).toEqual([201, 422])

    const loser = first.statusCode === 422 ? first : second
    expect(loser.json().error.code).toBe('SEAT_UNAVAILABLE')

    const winner = first.statusCode === 201 ? first : second
    const holdId = winner.json().data.id
    const seats = await seatsByLabel(seated)

    // Both seats are the winner's; neither is the loser's.
    expect(seats.A1).toMatchObject({ status: 'HELD', holdId })
    expect(seats.B1).toMatchObject({ status: 'HELD', holdId })

    // And each is held under its own zone's tier.
    const items = await prisma.holdItem.findMany({ where: { holdId } })
    expect(Object.fromEntries(items.map((item) => [item.eventSeatId, item.ticketTypeId]))).toEqual({
      [seated.eventSeatIdByLabel.A1]: seated.front.id,
      [seated.eventSeatIdByLabel.B1]: seated.back.id,
    })
  })

  it('puts released seats back on sale in the same transaction', async () => {
    const seated = await seatedEvent('release')

    const held = await holdSeats(seated, ['A2', 'B2'], world.asha.headers)
    expect(held.statusCode).toBe(201)

    const released = await app.inject({
      method: 'DELETE',
      url: `/v1/holds/${held.json().data.id}`,
      headers: world.asha.headers,
    })
    expect(released.statusCode).toBe(200)

    const seats = await seatsByLabel(seated)
    expect(seats.A2).toMatchObject({ status: 'AVAILABLE', holdId: null })
    expect(seats.B2).toMatchObject({ status: 'AVAILABLE', holdId: null })

    // Somebody else can have them now.
    expect((await holdSeats(seated, ['A2'], world.ravi.headers)).statusCode).toBe(201)
  })

  it('has the expiry sweep put the seats of a lapsed hold back on sale', async () => {
    const seated = await seatedEvent('sweep')

    const held = await holdSeats(seated, ['A3'], world.asha.headers)
    expect(held.statusCode).toBe(201)

    const holdId = held.json().data.id
    await prisma.ticketHold.update({
      where: { id: holdId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })

    const sweep = createExpireHoldsProcessor({ prisma })
    const result = await sweep({ data: { ticketTypeId: seated.front.id } })

    expect(result.updated).toBe(1)
    expect(result.seatsReleased).toBe(1)
    expect((await prisma.ticketHold.findUnique({ where: { id: holdId } })).status).toBe('EXPIRED')
    expect((await seatsByLabel(seated)).A3).toMatchObject({ status: 'AVAILABLE', holdId: null })
  })

  it('leaves a lapsed hold alone while its order waits on the payment, then sweeps it', async () => {
    const seated = await seatedEvent('awaiting')

    const held = await holdSeats(seated, ['A2'], world.asha.headers)
    expect(held.statusCode).toBe(201)

    // A capture that timed out: the order stays PENDING for reconciliation,
    // with the hold attached, and the hold's own time runs out meanwhile.
    const holdId = held.json().data.id
    const order = await prisma.order.create({
      data: {
        id: id('order'),
        reference: `DE-AW${RUN.toUpperCase()}`,
        eventId: seated.event.id,
        userId: world.asha.user.id,
        buyerEmail: world.asha.user.email,
        buyerName: world.asha.user.displayName ?? 'Asha',
        status: 'PENDING',
        currency: 'INR',
        subtotalCents: seated.front.priceCents,
        totalCents: seated.front.priceCents,
      },
    })
    await prisma.ticketHold.update({
      where: { id: holdId },
      data: { orderId: order.id, expiresAt: new Date(Date.now() - 60_000) },
    })

    const sweep = createExpireHoldsProcessor({ prisma })
    const waiting = await sweep({ data: { ticketTypeId: seated.front.id } })

    expect(waiting.updated).toBe(0)
    expect(waiting.seatsReleased).toBe(0)
    expect((await prisma.ticketHold.findUnique({ where: { id: holdId } })).status).toBe('ACTIVE')
    expect((await seatsByLabel(seated)).A2).toMatchObject({ status: 'HELD', holdId })

    // Nor does another buyer's hold take the seat back on the way in.
    const other = await holdSeats(seated, ['A2'], world.ravi.headers)
    expect(other.statusCode).toBe(422)
    expect((await seatsByLabel(seated)).A2).toMatchObject({ status: 'HELD', holdId })
    expect(
      await prisma.auditLog.count({ where: { action: 'hold.reclaimed', entityId: holdId } }),
    ).toBe(0)

    // Once the order is cancelled, the lapsed hold is swept like any other.
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    })

    const cancelled = await sweep({ data: { ticketTypeId: seated.front.id } })

    expect(cancelled.updated).toBe(1)
    expect(cancelled.seatsReleased).toBe(1)
    expect((await seatsByLabel(seated)).A2).toMatchObject({ status: 'AVAILABLE', holdId: null })
  })

  it('takes back a lapsed hold’s seats on the way to a new hold, when the sweep has not run', async () => {
    const seated = await seatedEvent('reclaim')

    const held = await holdSeats(seated, ['B3'], world.asha.headers)
    const lapsedId = held.json().data.id
    await prisma.ticketHold.update({
      where: { id: lapsedId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })

    const again = await holdSeats(seated, ['B3'], world.ravi.headers)
    expect(again.statusCode).toBe(201)

    const lapsed = await prisma.ticketHold.findUnique({ where: { id: lapsedId } })
    expect(lapsed).toMatchObject({ status: 'EXPIRED', releaseReason: 'EXPIRED_ON_RECLAIM' })

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'hold.reclaimed', entityId: lapsedId },
    })
    expect(audit).toMatchObject({ actorId: null })
    expect(audit.metadata).toMatchObject({ seatsReleased: 1 })
  })

  it('sells seats across both zones and prints each guest’s name on their seat’s ticket', async () => {
    const seated = await seatedEvent('names')
    const headers = world.asha.headers

    const held = await holdSeats(seated, ['A2', 'B2'], headers)
    expect(held.statusCode).toBe(201)

    const basket = {
      eventId: seated.event.id,
      items: [
        { ticketTypeId: seated.front.id, quantity: 1 },
        { ticketTypeId: seated.back.id, quantity: 1 },
      ],
      holdIds: [held.json().data.id],
    }

    const quote = await app.inject({
      method: 'POST',
      url: '/v1/orders/quote',
      headers,
      payload: basket,
    })
    expect(quote.statusCode).toBe(200)
    expect(quote.json().data.subtotalCents).toBe(9500)

    const placed = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers,
      payload: {
        ...basket,
        buyerEmail: world.asha.user.email,
        buyerName: 'Asha Buyer',
        expectedTotalCents: quote.json().data.totalCents,
        attendees: [
          {
            ticketTypeId: seated.back.id,
            eventSeatId: seated.eventSeatIdByLabel.B2,
            name: 'Kavya Iyer',
          },
        ],
      },
    })

    expect(placed.statusCode, placed.body).toBe(201)
    expect(placed.json().data.totalCents).toBe(quote.json().data.totalCents)

    const orderId = placed.json().data.id
    const stored = await prisma.order.findUnique({ where: { id: orderId } })
    expect(stored.eventSessionId).toBe(seated.session.id)

    const tickets = await prisma.ticket.findMany({
      where: { orderItem: { orderId } },
      select: { eventSeatId: true, attendeeName: true },
    })
    const nameBySeat = Object.fromEntries(tickets.map((row) => [row.eventSeatId, row.attendeeName]))
    expect(nameBySeat[seated.eventSeatIdByLabel.B2]).toBe('Kavya Iyer')
    expect(nameBySeat[seated.eventSeatIdByLabel.A2]).toBe('Asha Buyer')

    // Staged until settlement, and cleared in the same commit.
    const staged = await prisma.holdItem.findMany({ where: { holdId: held.json().data.id } })
    expect(staged.every((item) => item.attendeeName === null)).toBe(true)
    const lines = await prisma.orderItem.findMany({ where: { orderId } })
    expect(lines.every((line) => line.attendeeNames.length === 0)).toBe(true)

    const seats = await seatsByLabel(seated)
    expect(seats.A2.status).toBe('SOLD')
    expect(seats.B2.status).toBe('SOLD')
  })

  it('refuses a second reserved tier on a zone at the same night', async () => {
    const seated = await seatedEvent('index')

    await expect(
      prisma.ticketType.create({
        data: {
          id: id('tier-duplicate'),
          eventId: seated.event.id,
          name: `Front again ${RUN}`,
          priceCents: 9000,
          currency: 'USD',
          quantityTotal: 0,
          status: 'ON_SALE',
          reserved: true,
          eventSessionId: seated.session.id,
          priceZoneId: seated.zones.front.id,
        },
      }),
    ).rejects.toThrow(/TicketType_reserved_session_zone_key|Unique constraint/)
  })

  it('refuses staged names that do not fit the line or the seat', async () => {
    const seated = await seatedEvent('checks')
    const order = await prisma.order.create({
      data: {
        id: id('order'),
        reference: `DE-${RUN}`.toUpperCase(),
        eventId: seated.event.id,
        buyerEmail: world.asha.user.email,
        buyerName: 'Asha Buyer',
        status: 'PENDING',
        currency: 'USD',
        subtotalCents: 6000,
        totalCents: 6000,
      },
    })

    await expect(
      prisma.orderItem.create({
        data: {
          id: id('line'),
          orderId: order.id,
          ticketTypeId: seated.front.id,
          quantity: 1,
          unitPriceCents: 6000,
          subtotalCents: 6000,
          attendeeNames: ['One', 'Two'],
        },
      }),
    ).rejects.toThrow(/order_item_attendee_names_within_quantity/)

    const hold = await prisma.ticketHold.create({
      data: {
        id: id('hold'),
        ticketTypeId: seated.front.id,
        quantity: 1,
        expiresAt: new Date(Date.now() + 600_000),
        userId: world.asha.user.id,
      },
    })

    await expect(
      prisma.holdItem.create({
        data: {
          id: id('hold-item'),
          holdId: hold.id,
          ticketTypeId: seated.front.id,
          quantity: 1,
          attendeeName: 'Nobody’s seat',
        },
      }),
    ).rejects.toThrow(/hold_item_attendee_name_seated/)
  })
})
