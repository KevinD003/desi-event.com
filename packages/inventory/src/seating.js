/**
 * Reserved seating: which seats a buyer may take, and what a seat map looks like
 * to somebody choosing from it.
 *
 * Pure, like the rest of this package. Nothing here reads the clock, touches the
 * database or mutates its input — which matters more for seating than for general
 * admission, because the rules are fiddly and the failures are embarrassing
 * rather than merely wrong. Selling the only wheelchair space to somebody who did
 * not need it, or stranding a single seat in the middle of a row, are both
 * decisions made in a function like this one.
 *
 * The **atomicity** of taking a seat is deliberately not here. That is a
 * conditional `UPDATE` in one statement, and it belongs next to the database —
 * see `apps/api/src/lib/seating.js`. Splitting it that way is the point: this
 * module decides what *should* happen, and a single SQL statement decides whether
 * it *did*, with no window between the two for somebody else to take the seat.
 *
 * @module @desi-event/inventory/seating
 */

import { InventoryError, INVENTORY_ERROR_CODES } from './errors.js'

/**
 * What a seat can be at a session.
 *
 * Mirrors the `EventSeatStatus` enum. Four of the six are ways a seat is *not*
 * for sale, and they are distinct because the reasons differ and an operator
 * needs to tell them apart: `BLOCKED` is production holding it back, `KILLED` is
 * a seat that physically cannot be used, `COMPLIMENTARY` is given away, `SOLD` is
 * money.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SEAT_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  HELD: 'HELD',
  SOLD: 'SOLD',
  BLOCKED: 'BLOCKED',
  KILLED: 'KILLED',
  COMPLIMENTARY: 'COMPLIMENTARY',
})

/**
 * Statuses a buyer may move a seat *from* when taking it.
 *
 * Exactly one. Everything else is somebody else's seat, or not a seat anybody can
 * have, and the difference between "held by another buyer" and "blocked by
 * production" is not the buyer's business.
 *
 * @type {Set<string>}
 */
export const TAKEABLE_FROM = new Set([SEAT_STATUS.AVAILABLE])

/**
 * Statuses that mean the seat is spoken for, for availability counting.
 *
 * @type {Set<string>}
 */
export const OCCUPIED = new Set([SEAT_STATUS.HELD, SEAT_STATUS.SOLD, SEAT_STATUS.COMPLIMENTARY])

/**
 * The most seats one order may take.
 *
 * A ceiling above whatever a tier configures, so that a misconfigured
 * `maxPerOrder` cannot become a way to reserve a section. Ten is the number a
 * consumer ticketing site converges on: more than a family, fewer than a block
 * booking, which is a different product with a different conversation.
 *
 * @type {number}
 */
export const MAX_SEATS_PER_ORDER = 10

/**
 * How a seat appears to somebody choosing from a map.
 *
 * Deliberately lossy. A buyer is told `available` or not, and never *why* not:
 * "held by another buyer" tells them to keep refreshing, and "blocked" tells them
 * something about the production they have no business knowing. An organiser
 * looking at the same map gets the full status, which is a different call with a
 * capability behind it.
 *
 * The accessibility attributes are the exception and go out to everyone, because
 * somebody who needs an accessible seat has to be able to find one. What does
 * *not* go out is who bought it: `accessible` describes the seat, never the
 * person in it.
 *
 * @param {object} eventSeat An `EventSeat` row joined to its `Seat`.
 * @param {object} [options] Options.
 * @param {boolean} [options.organiser] Whether the viewer may see the real status.
 * @returns {object} The seat as the viewer should see it.
 */
export function toPublicSeat(eventSeat, { organiser = false } = {}) {
  const seat = eventSeat.seat ?? eventSeat

  return {
    id: eventSeat.id,
    seatId: seat.id,
    label: seat.label,
    sectionId: seat.sectionId,
    rowId: seat.rowId ?? null,
    priceZoneId: seat.priceZoneId ?? null,
    sortOrder: seat.sortOrder ?? 0,
    available: eventSeat.status === SEAT_STATUS.AVAILABLE,
    accessible: seat.accessible === true,
    companionOfSeatId: seat.companionOfSeatId ?? null,
    obstructedView: seat.obstructedView === true,
    restricted: seat.restricted === true,
    restrictionNote: seat.restrictionNote ?? null,
    priceCents: eventSeat.priceCentsOverride ?? null,
    ticketTypeId: eventSeat.ticketTypeId ?? null,
    ...(organiser
      ? { status: eventSeat.status, blockedReason: eventSeat.blockedReason ?? null }
      : {}),
  }
}

/**
 * How many seats at a session are still for sale.
 *
 * @param {object[]} eventSeats `EventSeat` rows.
 * @returns {{total: number, available: number, held: number, sold: number, unavailable: number}} The counts.
 */
export function seatCounts(eventSeats) {
  const counts = { total: 0, available: 0, held: 0, sold: 0, unavailable: 0 }

  for (const seat of eventSeats) {
    counts.total += 1

    if (seat.status === SEAT_STATUS.AVAILABLE) counts.available += 1
    else if (seat.status === SEAT_STATUS.HELD) counts.held += 1
    else if (seat.status === SEAT_STATUS.SOLD || seat.status === SEAT_STATUS.COMPLIMENTARY) {
      counts.sold += 1
    } else counts.unavailable += 1
  }

  return counts
}

/**
 * Whether a seat transition is one this system performs.
 *
 * An explicit table rather than a set of `if`s, because the interesting property
 * is what is *absent*. There is no edge from `SOLD` to `AVAILABLE`: a sold seat
 * is released by refunding the order, which is a different operation with money
 * in it, and a late-running expiry job must not be able to take that path. There
 * is no edge out of `KILLED` at all — a seat that physically cannot be used does
 * not become usable because a job ran.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const SEAT_TRANSITIONS = Object.freeze({
  AVAILABLE: Object.freeze(['HELD', 'BLOCKED', 'KILLED', 'COMPLIMENTARY']),
  // A hold ends in exactly two ways: it becomes a sale, or it goes back.
  HELD: Object.freeze(['SOLD', 'AVAILABLE']),
  // Refunding a sold seat is the only way back, and it is the refund path that
  // performs it — never an expiry sweep.
  SOLD: Object.freeze(['AVAILABLE']),
  BLOCKED: Object.freeze(['AVAILABLE', 'KILLED']),
  COMPLIMENTARY: Object.freeze(['AVAILABLE']),
  KILLED: Object.freeze([]),
})

/**
 * Whether a seat may move from one status to another.
 *
 * @param {string} from The current status.
 * @param {string} to The proposed status.
 * @returns {boolean} True when the transition is permitted.
 */
export function canTransition(from, to) {
  return (SEAT_TRANSITIONS[from] ?? []).includes(to)
}

/**
 * The seats a selection implies, including companions.
 *
 * An accessible seat usually has a companion seat beside it, and the two are sold
 * together: selling the accessible space without the companion leaves somebody's
 * carer standing, and selling the companion alone to somebody else strands the
 * accessible space. So a selection that names one pulls in the other.
 *
 * This runs before availability is checked, so a companion that somebody else has
 * already taken fails the selection rather than producing a half-booking.
 *
 * @param {string[]} seatIds The seats the buyer chose, by `Seat` id.
 * @param {object[]} seats The `Seat` rows for the session's map.
 * @returns {string[]} The seats to take, in the order they were implied.
 */
export function withCompanions(seatIds, seats) {
  const byId = new Map(seats.map((seat) => [seat.id, seat]))
  const chosen = []
  const seen = new Set()

  /**
   * Add a seat and anything bound to it.
   *
   * @param {string} id The seat id.
   * @returns {void}
   */
  const add = (id) => {
    if (seen.has(id)) return

    seen.add(id)
    chosen.push(id)

    const seat = byId.get(id)
    if (!seat) return

    // Both directions: choosing the accessible seat pulls in its companion, and
    // choosing the companion pulls in the accessible seat.
    if (seat.companionOfSeatId) add(seat.companionOfSeatId)

    const companion = seats.find((candidate) => candidate.companionOfSeatId === id)
    if (companion) add(companion.id)
  }

  for (const id of seatIds) add(id)

  return chosen
}

/**
 * Check a seat selection before anything is written.
 *
 * Every refusal here is one the database would also catch, or one it could not:
 * the count limits and the duplicate check are this module's, and the
 * availability check is advisory — the authoritative one is the conditional
 * `UPDATE` that follows, because between this function returning and that
 * statement running, somebody else can take the seat.
 *
 * Saying that plainly matters. A reader who thinks this function prevents
 * double-booking will eventually remove the conditional update as redundant.
 *
 * @param {object} selection The request.
 * @param {string[]} selection.seatIds Seats the buyer chose.
 * @param {object[]} selection.seats The `Seat` rows for the session's map.
 * @param {object[]} selection.eventSeats The `EventSeat` rows for the session.
 * @param {number} [selection.maxPerOrder] The tier's own limit.
 * @returns {{seatIds: string[], eventSeatIds: string[]}} The seats to take, companions included.
 * @throws {InventoryError} When the selection cannot be satisfied.
 */
export function validateSeatSelection({ seatIds, seats, eventSeats, maxPerOrder }) {
  if (!Array.isArray(seatIds) || seatIds.length === 0) {
    throw new InventoryError(INVENTORY_ERROR_CODES.INVALID_QUANTITY, 'Choose at least one seat.', {
      requested: 0,
    })
  }

  if (new Set(seatIds).size !== seatIds.length) {
    throw new InventoryError(
      INVENTORY_ERROR_CODES.INVALID_QUANTITY,
      'The same seat was chosen twice.',
      { requested: seatIds.length },
    )
  }

  const resolved = withCompanions(seatIds, seats)
  const limit = Math.min(maxPerOrder ?? MAX_SEATS_PER_ORDER, MAX_SEATS_PER_ORDER)

  if (resolved.length > limit) {
    throw new InventoryError(
      INVENTORY_ERROR_CODES.INVALID_QUANTITY,
      resolved.length > seatIds.length
        ? `That selection needs ${resolved.length} seats once companion seats are included, and the limit is ${limit}.`
        : `You can take at most ${limit} seats in one order.`,
      { requested: resolved.length, max: limit },
    )
  }

  const byId = new Map(seats.map((seat) => [seat.id, seat]))
  const stateBySeat = new Map(eventSeats.map((eventSeat) => [eventSeat.seatId, eventSeat]))
  const eventSeatIds = []

  for (const id of resolved) {
    const seat = byId.get(id)

    if (!seat) {
      throw new InventoryError(
        INVENTORY_ERROR_CODES.NOT_FOUND,
        'One of those seats is not part of this seating plan.',
        { seatId: id },
      )
    }

    const state = stateBySeat.get(id)

    if (!state) {
      throw new InventoryError(
        INVENTORY_ERROR_CODES.NOT_FOUND,
        'One of those seats is not on sale for this session.',
        { seatId: id },
      )
    }

    if (!TAKEABLE_FROM.has(state.status)) {
      // One message for every unavailable status. "Held by another buyer" versus
      // "blocked" is information about somebody else's order or about the
      // production, and the remedy is the same: choose another seat.
      throw new InventoryError(
        INVENTORY_ERROR_CODES.SEAT_UNAVAILABLE,
        seat.label
          ? `Seat ${seat.label} is no longer available. Choose another.`
          : 'One of those seats is no longer available.',
        { seatId: id },
      )
    }

    eventSeatIds.push(state.id)
  }

  return { seatIds: resolved, eventSeatIds }
}

/**
 * Whether releasing a seat would strand its companion.
 *
 * Used when a buyer removes one seat from a selection rather than abandoning the
 * whole hold: dropping the accessible seat and keeping the companion leaves a
 * companion seat nobody can use, which is worse than not selling either.
 *
 * @param {string[]} releasing Seat ids being released.
 * @param {string[]} keeping Seat ids being kept.
 * @param {object[]} seats The `Seat` rows.
 * @returns {boolean} True when the release would leave a stranded companion.
 */
export function wouldStrandCompanion(releasing, keeping, seats) {
  const byId = new Map(seats.map((seat) => [seat.id, seat]))

  for (const id of keeping) {
    const seat = byId.get(id)
    if (!seat) continue

    if (seat.companionOfSeatId && releasing.includes(seat.companionOfSeatId)) return true

    const companion = seats.find((candidate) => candidate.companionOfSeatId === id)
    if (companion && releasing.includes(companion.id)) return true
  }

  return false
}

/**
 * Group a session's seats into the shape a seat map renders from.
 *
 * Sections, then rows, then seats, each in its configured order — which is the
 * order somebody reading a ticket expects, not alphabetical. Seats with no row
 * (a table, a box, a standing pen) hang off the section directly.
 *
 * @param {object} plan The plan.
 * @param {object[]} plan.sections `Section` rows.
 * @param {object[]} plan.rows `SeatRow` rows.
 * @param {object[]} plan.seats Public seats from {@link toPublicSeat}.
 * @returns {object[]} Sections, each with rows and loose seats.
 */
export function groupSeatMap({ sections, rows, seats }) {
  const byRow = new Map()
  const looseBySection = new Map()

  for (const seat of seats) {
    if (seat.rowId) {
      if (!byRow.has(seat.rowId)) byRow.set(seat.rowId, [])
      byRow.get(seat.rowId).push(seat)
      continue
    }

    if (!looseBySection.has(seat.sectionId)) looseBySection.set(seat.sectionId, [])
    looseBySection.get(seat.sectionId).push(seat)
  }

  /**
   * Sort by configured order, then by label, so two seats with the same
   * `sortOrder` still come out in a stable order rather than in whatever order
   * the database returned them.
   *
   * @param {object[]} list Items with `sortOrder` and `label`.
   * @returns {object[]} The same array, sorted in place.
   */
  const ordered = (list) =>
    list.sort(
      (left, right) =>
        (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
        String(left.label ?? '').localeCompare(String(right.label ?? ''), 'en'),
    )

  return ordered([...sections]).map((section) => ({
    id: section.id,
    name: section.name,
    kind: section.kind,
    sortOrder: section.sortOrder ?? 0,
    standingCapacity: section.standingCapacity ?? null,
    rows: ordered(rows.filter((row) => row.sectionId === section.id)).map((row) => ({
      id: row.id,
      label: row.label,
      sortOrder: row.sortOrder ?? 0,
      seats: ordered(byRow.get(row.id) ?? []),
    })),
    seats: ordered(looseBySection.get(section.id) ?? []),
  }))
}
