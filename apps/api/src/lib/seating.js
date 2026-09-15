/**
 * Taking a seat, atomically.
 *
 * This module is one idea repeated: **the database decides who gets the seat, in
 * a single statement, and the application finds out afterwards.**
 *
 * The obvious implementation is to read the seats, check they are available, and
 * write. That is a check-then-act race with a window in the middle wide enough
 * to drive a sell-out through, and no amount of care in the reading closes it. So
 * every transition here is a conditional `updateMany` whose `where` carries the
 * status the seat must currently be in, and whose `count` is then compared with
 * what was asked for. If the count is short, somebody else won the race, and the
 * transaction rolls back rather than producing a half-taken selection.
 *
 * Three consequences worth stating, because each one is a thing somebody will
 * later be tempted to "simplify":
 *
 *   - **`validateSeatSelection` is advisory.** It runs first so that a buyer gets
 *     a useful message naming the seat, and it cannot prevent a double-booking.
 *     Deleting the conditional update because "we already checked" reintroduces
 *     the race.
 *   - **The count comparison is the check.** Not a returned row, not a re-read: a
 *     re-read inside the same transaction would see our own write and agree with
 *     us regardless.
 *   - **Releasing is conditional too.** An expiry sweep that runs late must not
 *     move a seat that has since been sold, so the release filters on
 *     `status: HELD` and on the hold id, and a seat that moved on is simply not
 *     matched.
 *
 * @module @desi-event/api/lib/seating
 */

import {
  InventoryError,
  INVENTORY_ERROR_CODES,
  SEAT_STATUS,
  validateSeatSelection,
} from '@desi-event/inventory'

/**
 * The longest a hold may last, whatever anybody configures.
 *
 * A hold is inventory taken away from everybody else, so its lifetime is a
 * server-side maximum rather than a client preference. Thirty minutes is longer
 * than a checkout and shorter than "I left the tab open at lunch".
 *
 * @type {number}
 */
export const MAX_HOLD_TTL_SECONDS = 30 * 60

/**
 * The hold lifetime this deployment uses, clamped.
 *
 * @param {object} env The parsed API environment.
 * @returns {number} Seconds, never above {@link MAX_HOLD_TTL_SECONDS}.
 */
export function holdTtlSeconds(env) {
  const configured = Number(env?.TICKET_HOLD_TTL_SECONDS ?? 600)

  return Math.min(Math.max(30, configured), MAX_HOLD_TTL_SECONDS)
}

/**
 * Everything needed to render or validate a session's seating.
 *
 * One query set rather than one per seat: a seat map is a thousand rows and a
 * naive implementation issues a thousand queries. The `EventSeat` rows carry
 * their `Seat`, and the sections and rows come along so the map can be grouped
 * without a second round trip.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {string} eventSessionId The session.
 * @returns {Promise<{session: object|null, sections: object[], rows: object[], seats: object[], eventSeats: object[]}>} The plan.
 */
export async function loadSeatingPlan(prisma, eventSessionId) {
  const session = await prisma.eventSession.findUnique({ where: { id: eventSessionId } })

  if (!session?.venueMapVersionId) {
    return { session, sections: [], rows: [], seats: [], eventSeats: [] }
  }

  const [sections, rows, eventSeats] = await Promise.all([
    prisma.section.findMany({ where: { venueMapVersionId: session.venueMapVersionId } }),
    prisma.seatRow.findMany({ where: { venueMapVersionId: session.venueMapVersionId } }),
    prisma.eventSeat.findMany({ where: { eventSessionId }, include: { seat: true } }),
  ])

  return {
    session,
    sections,
    rows,
    seats: eventSeats.map((eventSeat) => eventSeat.seat).filter(Boolean),
    eventSeats,
  }
}

/**
 * Take a set of seats for a hold, or take none of them.
 *
 * The whole point of this function is its last three lines. Everything before
 * them is preparation; the `count !== eventSeatIds.length` comparison is what
 * makes concurrent selection safe, and the throw inside the transaction is what
 * makes it all-or-nothing.
 *
 * @param {object} tx A Prisma transaction client. Must be a transaction: a partial failure has to roll back.
 * @param {object} options Options.
 * @param {string[]} options.eventSeatIds The `EventSeat` rows to take.
 * @param {string} options.holdId The hold taking them.
 * @returns {Promise<number>} How many seats were taken, which is always all of them.
 * @throws {InventoryError} When any seat was taken by somebody else first.
 */
export async function claimSeats(tx, { eventSeatIds, holdId }) {
  if (eventSeatIds.length === 0) return 0

  const { count } = await tx.eventSeat.updateMany({
    where: {
      id: { in: eventSeatIds },
      // The condition that decides the race. Two requests for the same seat both
      // issue this statement; PostgreSQL serialises them on the row, the second
      // one matches nothing, and its count comes back short.
      status: SEAT_STATUS.AVAILABLE,
      holdId: null,
    },
    data: { status: SEAT_STATUS.HELD, holdId },
  })

  if (count !== eventSeatIds.length) {
    throw new InventoryError(
      INVENTORY_ERROR_CODES.SEAT_UNAVAILABLE,
      'Somebody took one of those seats while you were choosing. Your selection has not been reserved — please choose again.',
      { requested: eventSeatIds.length, taken: count },
    )
  }

  return count
}

/**
 * Give a hold's seats back.
 *
 * Conditional on the hold id *and* on the seat still being `HELD`, so a sweep
 * that runs after the hold became an order moves nothing. That is the specific
 * failure this shape prevents: an expiry job releasing seats somebody has already
 * paid for.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {string} holdId The hold being released.
 * @returns {Promise<number>} How many seats went back.
 */
export async function releaseSeats(tx, holdId) {
  const { count } = await tx.eventSeat.updateMany({
    where: { holdId, status: SEAT_STATUS.HELD },
    data: { status: SEAT_STATUS.AVAILABLE, holdId: null },
  })

  return count
}

/**
 * Turn a hold's seats into sold seats.
 *
 * Conditional on `HELD` and on the hold id for the same reason as the release:
 * a seat that expired out from under a slow checkout must not be sold by the
 * checkout that follows. A short count means the hold lapsed, and the caller
 * gets a specific error rather than a silently under-filled order.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {string} options.holdId The hold being converted.
 * @param {Record<string, string>} options.orderItemBySeat `EventSeat` id to `OrderItem` id.
 * @returns {Promise<number>} How many seats were sold.
 * @throws {InventoryError} When the hold no longer owns every seat.
 */
export async function sellSeats(tx, { holdId, orderItemBySeat }) {
  const eventSeatIds = Object.keys(orderItemBySeat)

  if (eventSeatIds.length === 0) return 0

  let sold = 0

  for (const eventSeatId of eventSeatIds) {
    const { count } = await tx.eventSeat.updateMany({
      where: { id: eventSeatId, holdId, status: SEAT_STATUS.HELD },
      data: { status: SEAT_STATUS.SOLD, orderItemId: orderItemBySeat[eventSeatId] },
    })

    sold += count
  }

  if (sold !== eventSeatIds.length) {
    throw new InventoryError(
      INVENTORY_ERROR_CODES.SEAT_UNAVAILABLE,
      'This reservation expired before checkout completed. Nothing has been charged — please choose your seats again.',
      { requested: eventSeatIds.length, sold },
    )
  }

  return sold
}

/**
 * Validate a selection and take it, in one transaction.
 *
 * The ordering is deliberate and is the whole design: read the plan *outside* the
 * transaction (it is large and read-only), validate against it for a useful error
 * message, then open a short transaction that creates the hold and claims the
 * seats conditionally. The transaction holds row locks for as little time as
 * possible, which is what keeps a busy on-sale from serialising on one function.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {string} options.eventSessionId The session.
 * @param {string[]} options.seatIds The seats the buyer chose.
 * @param {object} options.hold Fields for the `TicketHold` row.
 * @param {number} [options.maxPerOrder] The tier's own limit.
 * @returns {Promise<{hold: object, seatIds: string[], eventSeatIds: string[]}>} The hold and what it holds.
 * @throws {InventoryError} When the selection is invalid or lost a race.
 */
export async function holdSeats(prisma, { eventSessionId, seatIds, hold, maxPerOrder }) {
  const plan = await loadSeatingPlan(prisma, eventSessionId)

  if (!plan.session) {
    throw new InventoryError(INVENTORY_ERROR_CODES.NOT_FOUND, 'No such session.', {
      eventSessionId,
    })
  }

  if (!plan.session.venueMapVersionId) {
    throw new InventoryError(
      INVENTORY_ERROR_CODES.NOT_FOUND,
      'This session does not have reserved seating.',
      { eventSessionId },
    )
  }

  // Advisory: this is where a buyer gets "seat A12 has gone" rather than a
  // generic failure. It does not prevent the race — see the module header.
  const selection = validateSeatSelection({
    seatIds,
    seats: plan.seats,
    eventSeats: plan.eventSeats,
    maxPerOrder,
  })

  return prisma.$transaction(async (tx) => {
    const created = await tx.ticketHold.create({
      data: { ...hold, eventSessionId },
    })

    await claimSeats(tx, { eventSeatIds: selection.eventSeatIds, holdId: created.id })

    for (const eventSeatId of selection.eventSeatIds) {
      await tx.holdItem.create({
        data: { holdId: created.id, ticketTypeId: hold.ticketTypeId, eventSeatId, quantity: 1 },
      })
    }

    return { hold: created, ...selection }
  })
}
