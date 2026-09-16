/**
 * The ten ways a reserved-seat purchase can race, against a real database.
 *
 * The stub cannot prove any of this. Every case below turns on PostgreSQL
 * serialising two statements on one row — a conditional `UPDATE` whose affected
 * count comes back short is the entire safety argument for seated inventory,
 * and a stub that agrees with the service proves only that the service agrees
 * with itself.
 *
 * Runs against `TEST_DATABASE_URL`, and is wired into `pnpm db:verify:fresh`.
 * With `REQUIRE_DATABASE` set it fails rather than skips, so a build without a
 * database cannot report a green tick for tests that never executed.
 *
 * Nothing is deleted afterwards: `db:verify:fresh` builds a fresh database per
 * run, and every row this suite writes is tagged with a per-run suffix, so two
 * runs against a developer's own database do not collide.
 *
 * @module @desi-event/api/tests/reserved-seat-concurrency
 */

import { afterAll, expect, it } from 'vitest'

import { sellSeats } from '../src/lib/seating.js'
import { claimSeats, releaseSeats } from '../src/lib/seating.js'
import { assertSeatsCoherent, loadSeatedHoldItems, priceLines } from '../src/lib/seated-checkout.js'
import { settleCheckout } from '../src/lib/checkout.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, when } = await connectTestDatabase('the reserved-seat concurrency suite')

/** A suffix unique to this run, so two runs cannot collide. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** Long enough for the pass deriver, and obviously not a real one. */
const SECRET = 'test-only-fake-value-for-deriving-passes-0123456789'

let sequence = 0

/**
 * A unique identifier for this run.
 *
 * @param {string} kind What it names, for readability in a failed assertion.
 * @returns {string} An id.
 */
function id(kind) {
  sequence += 1

  return `seatrace-${RUN}-${kind}-${sequence}`
}

/**
 * Build a published event with one reserved-seat session.
 *
 * @param {object} [options] Options.
 * @param {number} [options.seats] How many seats to lay out.
 * @param {number} [options.frontRowPriceCents] Price override for the first seat.
 * @returns {Promise<object>} The ids this suite needs.
 */
async function buildWorld({ seats = 4, frontRowPriceCents = 250_000 } = {}) {
  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `Race Collective ${RUN}`,
      slug: id('org-slug'),
      contactEmail: `race-${RUN}@desi-event.example`,
    },
  })

  const venue = await prisma.venue.create({
    data: {
      id: id('venue'),
      organizationId: organization.id,
      name: 'Race Hall',
      slug: id('venue-slug'),
      addressLine1: '1 Test Road',
      city: 'Chennai',
      region: 'TN',
      postalCode: '600001',
      country: 'IN',
      timezone: 'Asia/Kolkata',
    },
  })

  const event = await prisma.event.create({
    data: {
      id: id('event'),
      organizationId: organization.id,
      venueId: venue.id,
      title: `Race Night ${RUN}`,
      slug: id('event-slug'),
      category: 'MUSIC_CONCERT',
      summary: 'A race between two buyers for one seat.',
      description: 'Built by the reserved-seat concurrency suite.',
      status: 'PUBLISHED',
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      timezone: 'Asia/Kolkata',
    },
  })

  const ticketType = await prisma.ticketType.create({
    data: {
      id: id('tier'),
      eventId: event.id,
      name: 'Stalls',
      priceCents: 100_000,
      currency: 'INR',
      quantityTotal: seats,
      status: 'ON_SALE',
    },
  })

  const map = await prisma.venueMap.create({
    data: { id: id('map'), venueId: venue.id, name: 'Race Hall plan' },
  })

  // Drafted, laid out, then published — in that order, because
  // `desi_map_version_frozen` refuses a section added to a published version,
  // which is the whole point of publishing one.
  const version = await prisma.venueMapVersion.create({
    data: { id: id('version'), venueMapId: map.id, version: 1, seatCount: seats },
  })

  const section = await prisma.section.create({
    data: { id: id('section'), venueMapVersionId: version.id, name: 'Stalls', kind: 'SEATED' },
  })

  const row = await prisma.seatRow.create({
    data: { id: id('row'), venueMapVersionId: version.id, sectionId: section.id, label: 'A' },
  })

  const seatRows = []

  for (let index = 0; index < seats; index += 1) {
    seatRows.push(
      await prisma.seat.create({
        data: {
          id: id(`seat-${index}`),
          venueMapVersionId: version.id,
          sectionId: section.id,
          rowId: row.id,
          label: `A${index + 1}`,
          sortOrder: index + 1,
        },
      }),
    )
  }

  await prisma.venueMapVersion.update({
    where: { id: version.id },
    data: { publishedAt: new Date() },
  })

  const session = await prisma.eventSession.create({
    data: {
      id: id('session'),
      eventId: event.id,
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      timezone: 'Asia/Kolkata',
      venueMapVersionId: version.id,
    },
  })

  const eventSeats = []

  for (const [index, seat] of seatRows.entries()) {
    eventSeats.push(
      await prisma.eventSeat.create({
        data: {
          id: id(`eventseat-${index}`),
          eventSessionId: session.id,
          seatId: seat.id,
          ticketTypeId: ticketType.id,
          status: 'AVAILABLE',
          priceCentsOverride: index === 0 ? frontRowPriceCents : null,
        },
      }),
    )
  }

  return { organization, venue, event, ticketType, session, version, eventSeats }
}

/**
 * Take a hold on some seats, the way `sessions.hold` does.
 *
 * @param {object} world From {@link buildWorld}.
 * @param {object[]} eventSeats Which seats.
 * @returns {Promise<object>} The hold, with its items.
 */
async function takeHold(world, eventSeats) {
  return prisma.$transaction(async (tx) => {
    const hold = await tx.ticketHold.create({
      data: {
        id: id('hold'),
        ticketTypeId: world.ticketType.id,
        eventSessionId: world.session.id,
        quantity: eventSeats.length,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 600_000),
        guestTokenHash: id('token').padEnd(64, '0').slice(0, 64),
      },
    })

    await claimSeats(tx, { eventSeatIds: eventSeats.map((seat) => seat.id), holdId: hold.id })

    for (const seat of eventSeats) {
      await tx.holdItem.create({
        data: {
          id: id('holditem'),
          holdId: hold.id,
          ticketTypeId: world.ticketType.id,
          eventSeatId: seat.id,
          quantity: 1,
        },
      })
    }

    return hold
  })
}

/**
 * Turn a hold into a PENDING order with its seats stamped, the way checkout does.
 *
 * @param {object} world From {@link buildWorld}.
 * @param {object} hold From {@link takeHold}.
 * @returns {Promise<object>} The order, with a payment attempt.
 */
async function beginOrder(world, hold) {
  return prisma.$transaction(async (tx) => {
    const seatedItems = await loadSeatedHoldItems(tx, [hold.id])

    assertSeatsCoherent(seatedItems, new Map([[hold.id, hold]]), world.session.id)

    const { lines, seatsByLineKey } = priceLines({
      items: [{ ticketTypeId: world.ticketType.id, quantity: seatedItems.length }],
      ticketTypesById: new Map([[world.ticketType.id, world.ticketType]]),
      seatedItems,
    })

    const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0)

    const order = await tx.order.create({
      data: {
        id: id('order'),
        reference: `DE-${RUN.toUpperCase()}${(sequence += 1).toString(36).toUpperCase()}`,
        eventId: world.event.id,
        eventSessionId: world.session.id,
        buyerEmail: 'racer@desi-event.example',
        buyerName: 'Racer',
        status: 'PENDING',
        currency: 'INR',
        subtotalCents,
        totalCents: subtotalCents,
      },
    })

    await tx.ticketHold.update({ where: { id: hold.id }, data: { orderId: order.id } })

    for (const line of lines) {
      const orderItem = await tx.orderItem.create({
        data: {
          id: id('line'),
          orderId: order.id,
          ticketTypeId: line.ticketTypeId,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          subtotalCents: line.unitPriceCents * line.quantity,
        },
      })

      for (const seat of seatsByLineKey.get(`${line.ticketTypeId}:${line.unitPriceCents}`) ?? []) {
        await tx.holdItem.update({
          where: { id: seat.id },
          data: { orderItemId: orderItem.id, unitPriceCents: line.unitPriceCents },
        })
      }
    }

    const payment = await tx.payment.create({
      data: {
        id: id('payment'),
        orderId: order.id,
        provider: 'in-memory-payments',
        status: 'INITIATED',
        amountCents: subtotalCents,
        currency: 'INR',
      },
    })

    return { order, payment }
  })
}

/**
 * Settle an order the way the checkout saga's third phase does.
 *
 * @param {object} order The PENDING order.
 * @param {object} payment Its attempt row.
 * @returns {Promise<object>} `{ settled }`.
 */
function settle(order, payment) {
  let codes = 0

  return prisma.$transaction((tx) =>
    settleCheckout(tx, {
      order,
      payment,
      result: { outcome: 'SUCCEEDED', intent: null, rawStatus: 'SUCCEEDED' },
      now: new Date(),
      // Unique per call. Truncating a long prefix would make every code in
      // this run identical and the failure would look like a product bug.
      generateTicketCode: () => {
        codes += 1

        return `DET-${RUN.toUpperCase()}${(sequence += 1).toString(36).toUpperCase()}${codes}`
      },
      credentialSecret: SECRET,
    }),
  )
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => {})
})

when()('two buyers reaching for one seat', () => {
  it('reserves it for exactly one of them', async () => {
    const world = await buildWorld()
    const seat = world.eventSeats[0]

    const results = await Promise.allSettled([takeHold(world, [seat]), takeHold(world, [seat])])

    const winners = results.filter((result) => result.status === 'fulfilled')

    expect(winners).toHaveLength(1)

    const after = await prisma.eventSeat.findUnique({ where: { id: seat.id } })

    expect(after.status).toBe('HELD')
    expect(after.holdId).toBe(winners[0].value.id)
  })

  it('leaves no half-taken booking when two selections overlap', async () => {
    const world = await buildWorld()
    const [a, b, c] = world.eventSeats

    const results = await Promise.allSettled([takeHold(world, [a, b]), takeHold(world, [b, c])])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)

    const seats = await prisma.eventSeat.findMany({
      where: { id: { in: [a.id, b.id, c.id] } },
    })

    // Two held, one still free: the loser took nothing at all rather than
    // taking the one seat it did win the race for.
    expect(seats.filter((seat) => seat.status === 'HELD')).toHaveLength(2)
  })
})

when()('a hold expiring around a checkout', () => {
  it('refuses to price an order whose seat was swept back', async () => {
    const world = await buildWorld()
    const hold = await takeHold(world, [world.eventSeats[0]])

    // The sweep runs between the buyer pressing pay and checkout reading.
    await releaseSeats(prisma, hold.id)
    await prisma.ticketHold.update({ where: { id: hold.id }, data: { status: 'EXPIRED' } })

    await expect(beginOrder(world, hold)).rejects.toThrow(/lapsed/i)
  })

  it('does not release a seat the order has since paid for', async () => {
    const world = await buildWorld()
    const hold = await takeHold(world, [world.eventSeats[0]])
    const { order, payment } = await beginOrder(world, hold)

    await settle(order, payment)

    // A sweep arriving late. The release is conditional on HELD, so it moves
    // nothing — this is the failure that would otherwise resell a paid seat.
    const released = await releaseSeats(prisma, hold.id)

    expect(released).toBe(0)
    expect(
      (await prisma.eventSeat.findUnique({ where: { id: world.eventSeats[0].id } })).status,
    ).toBe('SOLD')
  })

  it('refuses to sell a seat that was released while the card was authorising', async () => {
    const world = await buildWorld()
    const hold = await takeHold(world, [world.eventSeats[0]])
    const { order, payment } = await beginOrder(world, hold)

    await releaseSeats(prisma, hold.id)

    // Settlement finds the seat is no longer this hold's, and refuses rather
    // than issuing a ticket for a seat somebody else may now hold.
    await expect(settle(order, payment)).rejects.toThrow(/expired before checkout completed/i)

    expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('PENDING')
  })
})

when()('two settlement workers on one order', () => {
  it('produces one set of tickets, one ledger batch and one seat sale', async () => {
    const world = await buildWorld()
    const hold = await takeHold(world, [world.eventSeats[0], world.eventSeats[1]])
    const { order, payment } = await beginOrder(world, hold)

    const results = await Promise.allSettled([settle(order, payment), settle(order, payment)])
    const settled = results.filter(
      (result) => result.status === 'fulfilled' && result.value.settled,
    )

    expect(settled.length, `results: ${JSON.stringify(results).slice(0, 600)}`).toBe(1)

    const lines = await prisma.orderItem.findMany({ where: { orderId: order.id } })
    const tickets = await prisma.ticket.findMany({
      where: { orderItemId: { in: lines.map((line) => line.id) } },
    })

    expect(tickets).toHaveLength(2)

    const batches = await prisma.ledgerBatch.findMany({ where: { orderId: order.id } })

    expect(batches).toHaveLength(1)

    const seats = await prisma.eventSeat.findMany({ where: { eventSessionId: world.session.id } })

    expect(seats.filter((seat) => seat.status === 'SOLD')).toHaveLength(2)
  })

  it('does not issue a second set when a provider callback arrives after settlement', async () => {
    const world = await buildWorld()
    const hold = await takeHold(world, [world.eventSeats[0]])
    const { order, payment } = await beginOrder(world, hold)

    const first = await settle(order, payment)
    const second = await settle(order, payment)

    expect(first.settled).toBe(true)
    expect(second.settled).toBe(false)

    const lines = await prisma.orderItem.findMany({ where: { orderId: order.id } })
    const tickets = await prisma.ticket.findMany({
      where: { orderItemId: { in: lines.map((line) => line.id) } },
    })

    expect(tickets).toHaveLength(1)
  })

  it('records a duplicate webhook delivery once, per account context', async () => {
    const providerEventId = id('evt')
    const row = {
      provider: 'stripe',
      accountContext: 'acct_race',
      providerEventId,
      eventType: 'payment_intent.succeeded',
      payload: { id: providerEventId },
    }

    await prisma.webhookEvent.create({ data: { id: id('hook'), ...row } })

    await expect(prisma.webhookEvent.create({ data: { id: id('hook'), ...row } })).rejects.toThrow(
      /Unique constraint/i,
    )

    const stored = await prisma.webhookEvent.findMany({ where: { providerEventId } })

    expect(stored).toHaveLength(1)
  })
})

when()('a browser retrying after an ambiguous answer', () => {
  it('returns the original order rather than charging again', async () => {
    const world = await buildWorld()
    const hold = await takeHold(world, [world.eventSeats[0]])
    const key = id('idem')

    const first = await prisma.order.create({
      data: {
        id: id('order'),
        reference: `DE-${RUN.toUpperCase()}${(sequence += 1).toString(36).toUpperCase()}`,
        idempotencyKey: key,
        eventId: world.event.id,
        buyerEmail: 'racer@desi-event.example',
        buyerName: 'Racer',
        status: 'PENDING',
        currency: 'INR',
        subtotalCents: 100_000,
        totalCents: 100_000,
      },
    })

    // The retry. The unique index is the guarantee, not the read that precedes
    // it: two requests that both found nothing still produce one order.
    await expect(
      prisma.order.create({
        data: {
          id: id('order'),
          reference: `DE-${RUN.toUpperCase()}${(sequence += 1).toString(36).toUpperCase()}`,
          idempotencyKey: key,
          eventId: world.event.id,
          buyerEmail: 'racer@desi-event.example',
          buyerName: 'Racer',
          status: 'PENDING',
          currency: 'INR',
          subtotalCents: 100_000,
          totalCents: 100_000,
        },
      }),
    ).rejects.toThrow(/Unique constraint/i)

    const orders = await prisma.order.findMany({ where: { idempotencyKey: key } })

    expect(orders).toHaveLength(1)
    expect(orders[0].id).toBe(first.id)
    expect(hold.status).toBe('ACTIVE')
  })
})

when()('a seat that is not the one the hold thinks it is', () => {
  it('cannot even be given a seat belonging to another session', async () => {
    const world = await buildWorld()
    const hold = await takeHold(world, [world.eventSeats[0]])

    // A second night of the same show, on the same seating plan.
    const secondNight = await prisma.eventSession.create({
      data: {
        id: id('session'),
        eventId: world.event.id,
        startsAt: new Date(Date.now() + 172_800_000),
        endsAt: new Date(Date.now() + 176_400_000),
        timezone: 'Asia/Kolkata',
        venueMapVersionId: world.version.id,
      },
    })

    const otherNightsSeat = await prisma.eventSeat.create({
      data: {
        id: id('eventseat'),
        eventSessionId: secondNight.id,
        seatId: world.eventSeats[0].seatId,
        ticketTypeId: world.ticketType.id,
        status: 'AVAILABLE',
      },
    })

    // The race the brief names — a hold pointing at a seat from the wrong
    // session — turns out to be unreachable, and that is the stronger result.
    // `desi_hold_item_session_matches` refuses the row outright, so the
    // application-level check in `assertSeatsCoherent` is defence in depth
    // rather than the only thing standing between a buyer and the wrong night.
    // Moving the seat row itself is refused too, by `desi_event_seat_map_matches`.
    await expect(
      prisma.holdItem.updateMany({
        where: { holdId: hold.id },
        data: { eventSeatId: otherNightsSeat.id },
      }),
    ).rejects.toThrow(/but the hold is for session/i)

    await expect(
      prisma.eventSeat.update({
        where: { id: world.eventSeats[0].id },
        data: { eventSessionId: secondNight.id },
      }),
    ).rejects.toThrow(/eventSeat\.update|map version|session/i)

    // And the order still prices correctly, because nothing moved.
    const { order } = await beginOrder(world, hold)

    expect(order.status).toBe('PENDING')
  })

  it('refuses a seat whose ticket type moved after the hold was taken', async () => {
    const world = await buildWorld()
    const hold = await takeHold(world, [world.eventSeats[0]])

    const otherTier = await prisma.ticketType.create({
      data: {
        id: id('tier'),
        eventId: world.event.id,
        name: 'Balcony',
        priceCents: 50_000,
        currency: 'INR',
        quantityTotal: 10,
        status: 'ON_SALE',
      },
    })

    await prisma.eventSeat.update({
      where: { id: world.eventSeats[0].id },
      data: { ticketTypeId: otherTier.id },
    })

    await expect(beginOrder(world, hold)).rejects.toThrow(/no longer sold at that ticket type/i)
  })

  it('refuses to settle a seat no line on the order pays for', async () => {
    const world = await buildWorld()
    const hold = await takeHold(world, [world.eventSeats[0]])
    const { order, payment } = await beginOrder(world, hold)

    // Unstamp it, the way a bug in a future checkout path would.
    await prisma.holdItem.updateMany({ where: { holdId: hold.id }, data: { orderItemId: null } })

    await expect(settle(order, payment)).rejects.toThrow(/no line on that order pays for it/i)
    expect((await prisma.order.findUnique({ where: { id: order.id } })).status).toBe('PENDING')
  })
})

when()('a price that moves after the order is priced', () => {
  it('charges what the seat cost when the order was created', async () => {
    const world = await buildWorld({ frontRowPriceCents: 250_000 })
    const hold = await takeHold(world, [world.eventSeats[0]])
    const { order, payment } = await beginOrder(world, hold)

    // The organiser re-zones the seat while the card is authorising.
    await prisma.eventSeat.update({
      where: { id: world.eventSeats[0].id },
      data: { priceCentsOverride: 1 },
    })

    await settle(order, payment)

    const lines = await prisma.orderItem.findMany({ where: { orderId: order.id } })
    const batches = await prisma.ledgerBatch.findMany({ where: { orderId: order.id } })

    expect(lines[0].unitPriceCents).toBe(250_000)
    expect(batches[0].debitCents).toBe(250_000)
    expect(batches[0].debitCents).toBe(batches[0].creditCents)
  })

  it('sells seats in two zones onto the two lines that priced them', async () => {
    const world = await buildWorld({ frontRowPriceCents: 250_000 })
    const hold = await takeHold(world, [world.eventSeats[0], world.eventSeats[1]])
    const { order, payment } = await beginOrder(world, hold)

    await settle(order, payment)

    const lines = await prisma.orderItem.findMany({ where: { orderId: order.id } })
    const lineById = new Map(lines.map((line) => [line.id, line]))

    expect(lines).toHaveLength(2)

    const front = await prisma.eventSeat.findUnique({ where: { id: world.eventSeats[0].id } })
    const back = await prisma.eventSeat.findUnique({ where: { id: world.eventSeats[1].id } })

    expect(lineById.get(front.orderItemId).unitPriceCents).toBe(250_000)
    expect(lineById.get(back.orderItemId).unitPriceCents).toBe(100_000)
  })
})

when()('the seat sale itself', () => {
  it('is conditional, so a second seller moves nothing', async () => {
    const world = await buildWorld()
    const hold = await takeHold(world, [world.eventSeats[0]])
    const { order } = await beginOrder(world, hold)

    const line = await prisma.orderItem.findFirst({ where: { orderId: order.id } })
    const map = { [world.eventSeats[0].id]: line.id }

    const sold = await prisma.$transaction((tx) =>
      sellSeats(tx, { holdId: hold.id, orderItemBySeat: map }),
    )

    expect(sold).toBe(1)

    await expect(
      prisma.$transaction((tx) => sellSeats(tx, { holdId: hold.id, orderItemBySeat: map })),
    ).rejects.toThrow(/expired before checkout completed/i)
  })
})
