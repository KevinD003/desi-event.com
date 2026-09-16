/**
 * Turning held seats into priced order lines.
 *
 * A general-admission order is a counter: five of a tier at the tier's price.
 * A reserved-seat order is not. The buyer holds named rows, each of which may
 * carry its own price because it sits in its own zone, and the order has to
 * charge what those particular seats cost — not what the tier costs on average.
 *
 * Two consequences drive this module's shape.
 *
 * **One line per price, not one line per tier.** `OrderItem` has a single
 * `unitPriceCents`, so a selection of four seats where two are in the front
 * zone is two lines, both of the same ticket type. Anything that later has to
 * find "the line that pays for this seat" therefore cannot look it up by ticket
 * type; it has to be told. That is why {@link stampHoldItems} writes
 * `HoldItem.orderItemId` at checkout and settlement reads it back.
 *
 * **Coherence is checked here, once, against rows read inside the checkout
 * transaction.** A hold is a claim about seats; the claim can be stale by the
 * time it is spent, and it can be wrong in ways the hold route could not have
 * seen — a seat re-assigned to another tier, a hold pointing at a seat from a
 * different session. Each of those is refused by name rather than by a generic
 * failure, because "your seats are gone" and "that seat is not for sale at this
 * session" call for different things from the buyer.
 *
 * Nothing here trusts the request body for a price, a seat's state, or which
 * tier a seat belongs to. All three come from the database.
 *
 * @module @desi-event/api/lib/seated-checkout
 */

import { conflict, unprocessable } from './errors.js'

/**
 * Load every seat a set of holds reserves, with the rows needed to price it.
 *
 * Read inside the checkout transaction, after the tier row locks have been
 * taken, so the seat states seen here cannot change under the order being
 * built.
 *
 * Two queries rather than an `include`, because `HoldItem.eventSeatId` is a
 * plain column and not a declared relation: an `EventSeat` row is deleted and
 * rebuilt whenever a session's inventory is re-prepared, and a foreign key
 * would make that rebuild fail against holds nobody cares about any more. The
 * cost is this join, done here once; the alternative is a constraint that
 * breaks an organiser's evening.
 *
 * A hold item whose seat no longer exists comes back with `eventSeat: null`,
 * which {@link assertSeatsCoherent} refuses by name.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {string[]} holdIds The holds being spent.
 * @returns {Promise<object[]>} `HoldItem` rows that name a seat, each with `eventSeat` attached.
 */
export async function loadSeatedHoldItems(tx, holdIds) {
  if (!holdIds || holdIds.length === 0) return []

  const items = await tx.holdItem.findMany({
    where: { holdId: { in: holdIds }, eventSeatId: { not: null } },
  })

  if (items.length === 0) return []

  const seats = await tx.eventSeat.findMany({
    where: { id: { in: items.map((item) => item.eventSeatId) } },
  })
  const seatById = new Map(seats.map((seat) => [seat.id, seat]))

  return items.map((item) => ({ ...item, eventSeat: seatById.get(item.eventSeatId) ?? null }))
}

/**
 * Refuse a selection whose seats do not belong where the hold says they do.
 *
 * Four distinct failures, kept distinct:
 *
 *   1. The seat row has vanished. Treated as a lapsed hold, because from the
 *      buyer's side that is what it is.
 *   2. The seat is no longer `HELD` by this hold. Either it expired and was
 *      swept, or somebody released it. A 409, and the buyer re-picks.
 *   3. The seat belongs to a different session than the hold. That is a bug or
 *      a forged hold, never a race, so it is refused as unprocessable rather
 *      than reported as somebody else having taken the seat.
 *   4. The seat's ticket type is not the one the hold recorded. Same reasoning:
 *      a seat whose tier moved after the hold was taken must not be sold at the
 *      tier the buyer happened to catch it in.
 *
 * @param {object[]} seatedItems Rows from {@link loadSeatedHoldItems}.
 * @param {Map<string, object>} holdsById The holds those items belong to.
 * @param {string|null} [eventSessionId] The session the order is for, when the order names one.
 * @returns {void} Nothing. Throws on the first incoherence.
 * @throws {Error} 409 for a lapsed seat, 422 for a seat that is not this hold's to sell.
 */
export function assertSeatsCoherent(seatedItems, holdsById, eventSessionId = null) {
  for (const item of seatedItems) {
    const hold = holdsById.get(item.holdId)
    const seat = item.eventSeat

    if (!seat) {
      throw conflict('One of your seats is no longer available. Please choose again.', {
        holdId: item.holdId,
      })
    }

    if (seat.status !== 'HELD' || seat.holdId !== item.holdId) {
      throw conflict('Your seat reservation has lapsed. Nothing has been charged.', {
        holdId: item.holdId,
        seatStatus: seat.status,
      })
    }

    const expectedSession = eventSessionId ?? hold?.eventSessionId ?? null

    if (expectedSession && seat.eventSessionId !== expectedSession) {
      throw unprocessable('Those seats are not on sale at this session.', {
        expectedSession,
        seatSession: seat.eventSessionId,
      })
    }

    if (hold && seat.eventSessionId !== hold.eventSessionId) {
      throw unprocessable('Those seats are not on sale at this session.', {
        holdSession: hold.eventSessionId,
        seatSession: seat.eventSessionId,
      })
    }

    if (seat.ticketTypeId !== item.ticketTypeId) {
      throw unprocessable('One of those seats is no longer sold at that ticket type.', {
        holdTicketTypeId: item.ticketTypeId,
        seatTicketTypeId: seat.ticketTypeId,
      })
    }
  }
}

/**
 * What one seat costs on this order.
 *
 * The zone override when there is one, the tier price otherwise. Read from the
 * seat row rather than the request, because a price a buyer can name is a price
 * a buyer can choose.
 *
 * @param {object} eventSeat The `EventSeat` row.
 * @param {object} ticketType The tier it is sold under.
 * @returns {number} Integer cents.
 */
export function seatUnitPrice(eventSeat, ticketType) {
  const override = eventSeat?.priceCentsOverride

  return Number.isInteger(override) ? override : ticketType.priceCents
}

/**
 * Build the order's priced lines, splitting seated tiers by price.
 *
 * Returns lines in a stable order — by ticket type as requested, then ascending
 * price — so that two identical requests produce identical orders and a test
 * can assert on the second line without guessing.
 *
 * @param {object} options Options.
 * @param {Array<{ticketTypeId: string, quantity: number}>} options.items The requested lines.
 * @param {Map<string, object>} options.ticketTypesById Tier rows, by id.
 * @param {object[]} options.seatedItems Rows from {@link loadSeatedHoldItems}, already checked.
 * @returns {{lines: Array<object>, seatsByLineKey: Map<string, object[]>}} Priced lines and the seats behind each.
 * @throws {Error} 422 when a seated tier's requested quantity is not the number of seats held.
 */
export function priceLines({ items, ticketTypesById, seatedItems }) {
  /** @type {Map<string, object[]>} */
  const seatsByType = new Map()

  for (const item of seatedItems) {
    const bucket = seatsByType.get(item.ticketTypeId) ?? []
    bucket.push(item)
    seatsByType.set(item.ticketTypeId, bucket)
  }

  /** @type {Array<object>} */
  const lines = []
  /** @type {Map<string, object[]>} */
  const seatsByLineKey = new Map()

  for (const item of items) {
    const ticketType = ticketTypesById.get(item.ticketTypeId)
    const seats = seatsByType.get(item.ticketTypeId) ?? []

    if (seats.length === 0) {
      lines.push({
        ticketTypeId: item.ticketTypeId,
        quantity: item.quantity,
        unitPriceCents: ticketType.priceCents,
        name: ticketType.name,
      })
      continue
    }

    // A seated line buys exactly the seats it holds. Buying fewer would leave
    // seats reserved and paid for by nobody; buying more would be a quantity
    // with no seat behind it, and reserved seating has no such thing.
    if (item.quantity !== seats.length) {
      throw unprocessable(
        `"${ticketType.name}" is reserved seating: you hold ${seats.length} seat(s), so the order must be for ${seats.length}.`,
        { ticketTypeId: item.ticketTypeId, held: seats.length, requested: item.quantity },
      )
    }

    /** @type {Map<number, object[]>} */
    const byPrice = new Map()

    for (const seat of seats) {
      const price = seatUnitPrice(seat.eventSeat, ticketType)
      const bucket = byPrice.get(price) ?? []
      bucket.push(seat)
      byPrice.set(price, bucket)
    }

    for (const price of [...byPrice.keys()].sort((left, right) => left - right)) {
      const bucket = byPrice.get(price)
      const key = `${item.ticketTypeId}:${price}`

      lines.push({
        ticketTypeId: item.ticketTypeId,
        quantity: bucket.length,
        unitPriceCents: price,
        name: ticketType.name,
      })
      seatsByLineKey.set(key, bucket)
    }
  }

  return { lines, seatsByLineKey }
}

/**
 * The key a line and its seats agree on.
 *
 * @param {string} ticketTypeId The tier.
 * @param {number} unitPriceCents The price the line charges.
 * @returns {string} A key for {@link priceLines}'s `seatsByLineKey`.
 */
export function lineKey(ticketTypeId, unitPriceCents) {
  return `${ticketTypeId}:${unitPriceCents}`
}

/**
 * Point each held seat at the order line that pays for it.
 *
 * This is the write that makes settlement possible without re-deriving
 * anything: after it, "which line pays for seat 12?" is a column, not a
 * reconstruction from prices that may since have moved. The frozen
 * `unitPriceCents` is stored alongside for the same reason — it is what the
 * buyer was actually charged, and a refund has to agree with it.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {Map<string, object[]>} options.seatsByLineKey From {@link priceLines}.
 * @param {Array<object>} options.orderItems The created `OrderItem` rows.
 * @returns {Promise<number>} How many hold items were stamped.
 */
export async function stampHoldItems(tx, { seatsByLineKey, orderItems }) {
  let stamped = 0

  for (const orderItem of orderItems) {
    const seats = seatsByLineKey.get(lineKey(orderItem.ticketTypeId, orderItem.unitPriceCents))

    if (!seats) continue

    for (const seat of seats) {
      await tx.holdItem.update({
        where: { id: seat.id },
        data: { orderItemId: orderItem.id, unitPriceCents: orderItem.unitPriceCents },
      })
      stamped += 1
    }
  }

  return stamped
}
