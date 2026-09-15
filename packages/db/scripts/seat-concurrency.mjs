#!/usr/bin/env node
/**
 * Seat and hold concurrency, against a real PostgreSQL.
 *
 * A stub can be made to serialise however the person writing it expects, so a
 * concurrency test against one proves that the stub agrees with its author. These
 * probes run real transactions against a real disposable database, concurrently,
 * and check what actually happened afterwards.
 *
 * Each probe states the race it is running and the invariant it is checking, and
 * then *runs the race* — many clients issuing the same statement at the same
 * moment — rather than asserting that a guard was called. That distinction is the
 * whole value: `claimSeats` is a conditional `UPDATE` whose correctness is a
 * property of PostgreSQL's row-level locking, and nothing but PostgreSQL can
 * demonstrate it.
 *
 * The probes commit. They run against a database `verify-fresh-database.mjs`
 * created and will destroy, so there is nothing to clean up and nothing that
 * could reach real data.
 *
 * @module @desi-event/db/scripts/seat-concurrency
 */

/** How many clients contend for the same seat. */
const CONTENDERS = 12

/**
 * Fixtures: a published seat map with one row of seats on sale at one session.
 *
 * @param {object} prisma A client connected to the disposable database.
 * @returns {Promise<object|null>} The ids, or null when the seed did not provide what is needed.
 */
async function createFixtures(prisma) {
  const [event, ticketType, venue, user] = await Promise.all([
    prisma.event.findFirst({ orderBy: { slug: 'asc' } }),
    prisma.ticketType.findFirst(),
    prisma.venue.findFirst(),
    prisma.user.findFirst(),
  ])

  if (!event || !ticketType || !venue || !user) return null

  const tier = await prisma.ticketType.findFirst({ where: { eventId: event.id } })
  if (!tier) return null

  const map = await prisma.venueMap.create({
    data: { venueId: venue.id, name: `concurrency-map-${Date.now()}` },
  })
  const version = await prisma.venueMapVersion.create({
    data: { venueMapId: map.id, version: 1 },
  })
  const section = await prisma.section.create({
    data: { venueMapVersionId: version.id, name: 'Stalls', kind: 'SEATED' },
  })
  const row = await prisma.seatRow.create({
    data: { venueMapVersionId: version.id, sectionId: section.id, label: 'A' },
  })

  const seats = []
  for (let index = 1; index <= 20; index += 1) {
    seats.push(
      await prisma.seat.create({
        data: {
          venueMapVersionId: version.id,
          sectionId: section.id,
          rowId: row.id,
          label: `A${index}`,
          sortOrder: index,
        },
      }),
    )
  }

  // Freeze the map only once its seats exist: a published version cannot be
  // edited, which is what the Phase 2 triggers enforce.
  await prisma.venueMapVersion.update({
    where: { id: version.id },
    data: { publishedAt: new Date(), seatCount: seats.length },
  })

  const session = await prisma.eventSession.create({
    data: {
      eventId: event.id,
      startsAt: new Date(Date.now() + 86_400_000),
      endsAt: new Date(Date.now() + 90_000_000),
      venueMapVersionId: version.id,
    },
  })

  const eventSeats = []
  for (const seat of seats) {
    eventSeats.push(
      await prisma.eventSeat.create({
        data: {
          eventSessionId: session.id,
          seatId: seat.id,
          ticketTypeId: tier.id,
          status: 'AVAILABLE',
        },
      }),
    )
  }

  return { event, tier, user, session, seats, eventSeats }
}

/**
 * Claim seats the way the API does: one conditional `UPDATE`, then compare the
 * count.
 *
 * Deliberately a copy of the shape in `apps/api/src/lib/seating.js` rather than
 * an import — `packages/db` does not depend on the API, and the thing under test
 * is the SQL, not the JavaScript around it. If the two ever diverge, the API's
 * own tests and these probes will disagree, which is the failure mode worth
 * having.
 *
 * @param {object} prisma A client connected to the disposable database.
 * @param {object} options Options.
 * @param {string[]} options.eventSeatIds The seats to take.
 * @param {object} options.hold Fields for the hold row.
 * @returns {Promise<{won: boolean, holdId: string|null}>} Whether this client got them.
 */
async function attemptClaim(prisma, { eventSeatIds, hold }) {
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.ticketHold.create({ data: hold })

      const { count } = await tx.eventSeat.updateMany({
        where: { id: { in: eventSeatIds }, status: 'AVAILABLE', holdId: null },
        data: { status: 'HELD', holdId: created.id },
      })

      if (count !== eventSeatIds.length) {
        throw new Error(`lost the race: took ${count} of ${eventSeatIds.length}`)
      }

      return { won: true, holdId: created.id }
    })
  } catch {
    return { won: false, holdId: null }
  }
}

/**
 * Run every concurrency probe.
 *
 * @param {object} prisma A client connected to the seeded disposable database.
 * @param {object} helpers Injected helpers from the verifier.
 * @param {Function} helpers.record Records a step's outcome.
 * @returns {Promise<boolean>} Whether every probe passed.
 */
export async function runSeatConcurrencyProbes(prisma, { record }) {
  let fixtures

  try {
    fixtures = await createFixtures(prisma)
  } catch (error) {
    return record('seat concurrency probes have the fixtures they need', false, {
      note: String(error?.message ?? error).slice(0, 200),
    })
  }

  if (!fixtures) {
    return record('seat concurrency probes have the fixtures they need', false, {
      note: 'the seed did not provide an event, a tier, a venue and a user',
    })
  }

  record('seat concurrency probes have the fixtures they need', true, {
    note: `a published 20-seat map on one session, ${CONTENDERS} contenders`,
  })

  const results = []
  const expiry = () => new Date(Date.now() + 600_000)

  /**
   * A hold row for one contender.
   *
   * @param {number} index Which contender.
   * @returns {object} A Prisma create payload.
   */
  const holdFor = (index) => ({
    ticketTypeId: fixtures.tier.id,
    eventSessionId: fixtures.session.id,
    quantity: 1,
    expiresAt: expiry(),
    guestTokenHash: `${index}`.padStart(64, 'c'),
  })

  // --- One seat, many buyers -------------------------------------------------
  {
    const target = fixtures.eventSeats[0]
    const attempts = await Promise.all(
      Array.from({ length: CONTENDERS }, (_, index) =>
        attemptClaim(prisma, { eventSeatIds: [target.id], hold: holdFor(index) }),
      ),
    )

    const winners = attempts.filter((attempt) => attempt.won)
    const seat = await prisma.eventSeat.findUnique({ where: { id: target.id } })

    results.push(
      record(
        `${CONTENDERS} buyers race for one seat and exactly one gets it`,
        winners.length === 1 && seat.status === 'HELD' && seat.holdId === winners[0]?.holdId,
        {
          note: `${winners.length} winner(s), seat is ${seat.status}`,
          winners: winners.length,
        },
      ),
    )

    // The losers' holds exist as rows — each contender created one before it
    // discovered it had lost — but none of them holds the seat. Worth checking,
    // because a hold that thinks it owns a seat it does not is how a checkout
    // charges for somebody else's seat.
    const claiming = await prisma.eventSeat.count({
      where: { id: target.id, holdId: { not: null } },
    })

    results.push(
      record('exactly one hold owns the contested seat', claiming === 1, {
        note: `${claiming} hold(s) reference it`,
      }),
    )
  }

  // --- Overlapping selections ------------------------------------------------
  {
    // Two buyers want {A2, A3} and {A3, A4}. They overlap on one seat, so at most
    // one can succeed — and the other must get *neither* of its seats, not one.
    const [, a2, a3, a4] = fixtures.eventSeats

    const [left, right] = await Promise.all([
      attemptClaim(prisma, { eventSeatIds: [a2.id, a3.id], hold: holdFor(100) }),
      attemptClaim(prisma, { eventSeatIds: [a3.id, a4.id], hold: holdFor(101) }),
    ])

    const seats = await prisma.eventSeat.findMany({
      where: { id: { in: [a2.id, a3.id, a4.id] } },
      orderBy: { id: 'asc' },
    })
    const held = seats.filter((seat) => seat.status === 'HELD')
    const winners = [left, right].filter((attempt) => attempt.won)

    results.push(
      record(
        'overlapping selections leave no half-taken booking',
        winners.length <= 1 && held.length === winners.length * 2,
        {
          note: `${winners.length} winner(s), ${held.length} seat(s) held`,
        },
      ),
    )
  }

  // --- A late expiry sweep ---------------------------------------------------
  {
    const target = fixtures.eventSeats[10]
    const claim = await attemptClaim(prisma, { eventSeatIds: [target.id], hold: holdFor(200) })

    // The seat is sold while a sweep is about to run for the hold that used to
    // own it. This is the shape of the bug where somebody pays and then loses
    // their seat to a job that was already in flight.
    //
    // Sold properly, with a real order line and no hold, because the database
    // refuses anything else: `event_seat_status_coherent` requires a SOLD seat to
    // name its order item, and requires HELD to be exactly the rows that name a
    // hold. Taking a shortcut here would have tested a state that cannot exist.
    const order = await prisma.order.create({
      data: {
        eventId: fixtures.event.id,
        reference: `CONC-${Date.now()}`,
        buyerEmail: 'concurrency@example.com',
        buyerName: 'Concurrency Probe',
        subtotalCents: 1000,
        totalCents: 1000,
      },
    })
    const orderItem = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        ticketTypeId: fixtures.tier.id,
        quantity: 1,
        unitPriceCents: 1000,
        subtotalCents: 1000,
      },
    })

    await prisma.eventSeat.update({
      where: { id: target.id },
      data: { status: 'SOLD', holdId: null, orderItemId: orderItem.id },
    })

    const { count } = await prisma.eventSeat.updateMany({
      where: { holdId: claim.holdId, status: 'HELD' },
      data: { status: 'AVAILABLE', holdId: null },
    })

    const seat = await prisma.eventSeat.findUnique({ where: { id: target.id } })

    results.push(
      record(
        'a late expiry sweep does not release a seat that has since sold',
        count === 0 && seat.status === 'SOLD',
        {
          note: `${count} seat(s) released, seat is ${seat.status}`,
        },
      ),
    )
  }

  // --- Releasing and re-taking ----------------------------------------------
  {
    const target = fixtures.eventSeats[11]
    const first = await attemptClaim(prisma, { eventSeatIds: [target.id], hold: holdFor(300) })

    await prisma.eventSeat.updateMany({
      where: { holdId: first.holdId, status: 'HELD' },
      data: { status: 'AVAILABLE', holdId: null },
    })

    const second = await attemptClaim(prisma, { eventSeatIds: [target.id], hold: holdFor(301) })
    const seat = await prisma.eventSeat.findUnique({ where: { id: target.id } })

    results.push(
      record('a released seat can be taken again', second.won && seat.holdId === second.holdId, {
        note: `seat is ${seat.status}`,
      }),
    )
  }

  // --- General admission, concurrently --------------------------------------
  {
    // The GA equivalent of the same race: many buyers incrementing one counter.
    // The conditional update carries the capacity in its `where`, so the
    // increment that would exceed it matches nothing.
    const tier = await prisma.ticketType.create({
      data: {
        eventId: fixtures.event.id,
        name: `Concurrency GA ${Date.now()}`,
        priceCents: 1000,
        quantityTotal: 5,
        quantitySold: 0,
        status: 'ON_SALE',
      },
    })

    const attempts = await Promise.all(
      Array.from({ length: CONTENDERS }, async () => {
        const { count } = await prisma.ticketType.updateMany({
          where: { id: tier.id, quantitySold: { lt: 5 } },
          data: { quantitySold: { increment: 1 } },
        })

        return count === 1
      }),
    )

    const after = await prisma.ticketType.findUnique({ where: { id: tier.id } })
    const succeeded = attempts.filter(Boolean).length

    results.push(
      record(
        'general admission cannot be oversold by concurrent buyers',
        after.quantitySold <= after.quantityTotal,
        {
          note: `${succeeded} of ${CONTENDERS} succeeded; sold ${after.quantitySold} of ${after.quantityTotal}`,
          sold: after.quantitySold,
        },
      ),
    )

    // Stated separately because it is a different claim: the counter is not
    // merely bounded, it reached the capacity. A conditional update that was too
    // strict would also satisfy the bound by selling nothing.
    results.push(
      record('and it does sell out, rather than being merely bounded', after.quantitySold === 5, {
        note: `sold ${after.quantitySold} of 5`,
      }),
    )
  }

  // --- The database's own seat uniqueness -----------------------------------
  {
    // Belt and braces: even if every conditional update above were wrong, one
    // seat cannot appear twice at one session. Proved by racing the insert.
    const seat = fixtures.seats[15]
    const inserts = await Promise.all(
      Array.from({ length: 4 }, async () => {
        try {
          await prisma.eventSeat.create({
            data: {
              eventSessionId: fixtures.session.id,
              seatId: seat.id,
              ticketTypeId: fixtures.tier.id,
            },
          })

          return true
        } catch {
          return false
        }
      }),
    )

    const rows = await prisma.eventSeat.count({
      where: { eventSessionId: fixtures.session.id, seatId: seat.id },
    })

    results.push(
      record('a seat cannot be added twice to one session, even concurrently', rows === 1, {
        note: `${inserts.filter(Boolean).length} insert(s) accepted, ${rows} row(s) exist`,
      }),
    )
  }

  return results.every(Boolean)
}
