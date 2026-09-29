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

import { AUDIT_ACTIONS, recordAudit } from './audit.js'

/** Hold states that no longer own their seats, though the seats may still say HELD. */
const FINISHED_HOLD_STATES = new Set(['EXPIRED', 'RELEASED'])

/**
 * Whether a hold has stopped owning its seats.
 *
 * An active hold past its expiry, or one already expired or released whose
 * seats were never given back (the leak `holds.release` and the expiry sweep
 * used to leave). A converted hold is never lapsed: its seats were sold.
 *
 * Nor is a hold an order is waiting on. Once `orders.create` has attached a
 * hold to a PENDING order, the seats belong to that order until it is paid or
 * cancelled, however long the payment takes to confirm (a capture that timed
 * out waits for reconciliation). Taking them back would let settlement find
 * no seats to sell and let somebody else buy them.
 *
 * Lock order, for everything that touches a seat hold: the paths that give
 * seats back (this reclaim, `holds.release`, the expiry sweep) lock the
 * `TicketHold` row and then its `EventSeat` rows; settlement locks the
 * `EventSeat` rows and then the `TicketHold`. The two never meet on one hold,
 * because settlement only touches the holds of the PENDING order it settles
 * and the other three leave exactly those alone.
 *
 * @param {{status: string, expiresAt: Date|string, orderId?: string|null}} hold The hold.
 * @param {Date} now The moment in question.
 * @param {Set<string>} [pendingOrderIds] Orders still waiting on their payment.
 * @returns {boolean} True when its seats may be taken back.
 */
export function holdHasLapsed(hold, now, pendingOrderIds = new Set()) {
  if (hold.orderId && pendingOrderIds.has(hold.orderId)) return false
  if (FINISHED_HOLD_STATES.has(hold.status)) return true

  return hold.status === 'ACTIVE' && new Date(hold.expiresAt).getTime() <= now.getTime()
}

/**
 * The orders among some holds' that are still waiting on their payment.
 *
 * @param {object} client A Prisma client or transaction client.
 * @param {Array<{orderId?: string|null}>} holds The holds.
 * @returns {Promise<Set<string>>} The ids of the PENDING orders.
 */
export async function pendingOrdersOf(client, holds) {
  const orderIds = [...new Set(holds.map((hold) => hold.orderId).filter(Boolean))]

  if (orderIds.length === 0) return new Set()

  const pending = await client.order.findMany({
    where: { id: { in: orderIds }, status: 'PENDING' },
    select: { id: true },
  })

  return new Set(pending.map((order) => order.id))
}

/**
 * Take back the seats of lapsed holds, before claiming them.
 *
 * The expiry sweep runs every so often; a buyer choosing a seat whose hold
 * lapsed a minute ago should not be told it is gone. So, inside the claim
 * transaction, each lapsed hold among the chosen seats is expired (conditional
 * on it still being ACTIVE and past its time, so a hold converted meanwhile is
 * untouched) and its seats released (conditional on HELD by that hold, so a
 * sold seat is never moved). Audited as a system action.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {string[]} options.eventSeatIds The seats about to be claimed.
 * @param {string} options.eventSessionId The session, for the audit row.
 * @param {Date} options.now The moment.
 * @returns {Promise<Array<{holdId: string, seatsReleased: number}>>} What was taken back.
 */
export async function reclaimLapsedSeats(tx, { eventSeatIds, eventSessionId, now }) {
  if (eventSeatIds.length === 0) return []

  const held = await tx.eventSeat.findMany({
    where: { id: { in: eventSeatIds }, status: SEAT_STATUS.HELD, holdId: { not: null } },
    select: { holdId: true },
  })
  const holdIds = [...new Set(held.map((seat) => seat.holdId))]

  if (holdIds.length === 0) return []

  const holds = await tx.ticketHold.findMany({ where: { id: { in: holdIds } } })
  const pendingOrderIds = await pendingOrdersOf(tx, holds)
  const reclaimed = []

  for (const hold of holds.filter((candidate) => holdHasLapsed(candidate, now, pendingOrderIds))) {
    if (hold.status === 'ACTIVE') {
      // Conditional on the order it was read with, too: a hold an order
      // attached meanwhile is that order's now, and is left alone.
      const { count } = await tx.ticketHold.updateMany({
        where: {
          id: hold.id,
          status: 'ACTIVE',
          expiresAt: { lte: now },
          orderId: hold.orderId ?? null,
        },
        data: { status: 'EXPIRED', releasedAt: now, releaseReason: 'EXPIRED_ON_RECLAIM' },
      })

      if (count === 0) continue
    }

    const seatsReleased = await releaseSeats(tx, hold.id)

    if (seatsReleased === 0) continue

    reclaimed.push({ holdId: hold.id, seatsReleased })

    await recordAudit(tx, {
      action: AUDIT_ACTIONS.HOLD_RECLAIMED,
      entityType: 'TicketHold',
      entityId: hold.id,
      actorId: null,
      metadata: {
        eventSessionId,
        previousStatus: hold.status,
        // A hold already expired or released keeps its status; only its
        // leftover seats come back.
        newStatus: hold.status === 'ACTIVE' ? 'EXPIRED' : hold.status,
        seatsReleased,
        reason: 'EXPIRED_ON_RECLAIM',
        at: now.toISOString(),
      },
    })
  }

  return reclaimed
}

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
      // `holdId` is cleared in the same statement, because
      // `event_seat_status_coherent` reads "a seat says it is held exactly when
      // it names a hold". Leaving the hold on a SOLD seat breaks that, and the
      // database refuses the row. The link is not lost: `HoldItem` keeps which
      // hold reserved which seat, which is where that history belongs.
      data: {
        status: SEAT_STATUS.SOLD,
        holdId: null,
        orderItemId: orderItemBySeat[eventSeatId],
      },
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
 * message, then open a short transaction that takes back any lapsed holds on
 * the chosen seats, creates the hold and claims the seats conditionally. The
 * transaction holds row locks for as little time as possible, which is what
 * keeps a busy on-sale from serialising on one function.
 *
 * Each hold item is stamped with its own seat's tier (`tierByEventSeatId`): a
 * selection spanning two zones, or a companion seat in another zone, is sold
 * seat by seat under the tier pricing each seat. `TicketHold.ticketTypeId` is
 * required, so it names the first seat's tier; nothing prices from it.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {string} options.eventSessionId The session.
 * @param {string[]} options.seatIds The seats the buyer chose.
 * @param {object} options.hold Fields for the `TicketHold` row; `quantity` is set here, from the seats taken.
 * @param {number} [options.maxPerOrder] The smallest per-order limit of the tiers involved.
 * @param {Map<string, string>} [options.tierByEventSeatId] Each `EventSeat`'s tier, when known; otherwise `hold.ticketTypeId`.
 * @param {object} [options.plan] The seating plan, when the caller already loaded it.
 * @param {Date} [options.now] The moment, for deciding which holds have lapsed.
 * @returns {Promise<{hold: object, seatIds: string[], eventSeatIds: string[], reclaimed: object[]}>} The hold and what it holds.
 * @throws {InventoryError} When the selection is invalid or lost a race.
 */
export async function holdSeats(
  prisma,
  {
    eventSessionId,
    seatIds,
    hold,
    maxPerOrder,
    tierByEventSeatId = new Map(),
    plan: loaded = null,
    now = new Date(),
  },
) {
  const plan = loaded ?? (await loadSeatingPlan(prisma, eventSessionId))

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

  // A seat still marked HELD by a hold that has lapsed is about to be taken
  // back, so the advisory check below treats it as free.
  const heldBy = [
    ...new Set(
      plan.eventSeats
        .filter((eventSeat) => eventSeat.status === SEAT_STATUS.HELD && eventSeat.holdId)
        .map((eventSeat) => eventSeat.holdId),
    ),
  ]
  const holders =
    heldBy.length === 0
      ? []
      : await prisma.ticketHold.findMany({
          where: { id: { in: heldBy } },
          select: { id: true, status: true, expiresAt: true, orderId: true },
        })
  const waiting = await pendingOrdersOf(prisma, holders)
  const lapsed = new Set(
    holders
      .filter((candidate) => holdHasLapsed(candidate, now, waiting))
      .map((candidate) => candidate.id),
  )
  const eventSeats = plan.eventSeats.map((eventSeat) =>
    eventSeat.status === SEAT_STATUS.HELD && lapsed.has(eventSeat.holdId)
      ? { ...eventSeat, status: SEAT_STATUS.AVAILABLE, holdId: null }
      : eventSeat,
  )

  // Advisory: this is where a buyer gets "seat A12 has gone" rather than a
  // generic failure. It does not prevent the race — see the module header.
  const selection = validateSeatSelection({
    seatIds,
    seats: plan.seats,
    eventSeats,
    maxPerOrder,
  })

  return prisma.$transaction(async (tx) => {
    const reclaimed = await reclaimLapsedSeats(tx, {
      eventSeatIds: selection.eventSeatIds,
      eventSessionId,
      now,
    })

    const created = await tx.ticketHold.create({
      data: { ...hold, quantity: selection.eventSeatIds.length, eventSessionId },
    })

    await claimSeats(tx, { eventSeatIds: selection.eventSeatIds, holdId: created.id })

    for (const eventSeatId of selection.eventSeatIds) {
      await tx.holdItem.create({
        data: {
          holdId: created.id,
          ticketTypeId: tierByEventSeatId.get(eventSeatId) ?? hold.ticketTypeId,
          eventSeatId,
          quantity: 1,
        },
      })
    }

    return { hold: created, ...selection, reclaimed }
  })
}
