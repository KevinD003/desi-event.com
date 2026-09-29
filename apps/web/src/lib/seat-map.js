/**
 * The seat map, as the picker reads it.
 *
 * The map has no coordinates, so the picker is a grid: a section, its rows in
 * order, and each row's seats in order, with loose seats (tables, boxes) as a
 * row of their own. Everything here is pure, so the grid's keyboard model, its
 * accessible names and its companion rule are tested without a browser.
 *
 * Two ids name a seat, and they are not interchangeable:
 *
 *   - `seatId` is the `Seat` of the map. A hold names these, and a companion
 *     points at one (`companionOfSeatId`).
 *   - `id` is the `EventSeat`: that seat at this night. A name for a seat's
 *     ticket names this one, as the hold's response does.
 *
 * The companion rule comes from `@desi-event/inventory/seating`, the same
 * function the server uses, through its browser-safe subpath; never the
 * package barrel, which carries server-only code.
 *
 * @module lib/seat-map
 */

import { MAX_SEATS_PER_ORDER, withCompanions } from '@desi-event/inventory/seating'

import { formatPrice } from './pricing.js'

export { MAX_SEATS_PER_ORDER }

/** What the picker says about its drawing, wherever it draws one. */
export const NOT_TO_SCALE = 'Seats are shown by section and row, not to scale.'

/**
 * The grid of one section: its rows, each a list of seats, in order.
 *
 * @param {object} section A section of `seatMapResponseSchema`.
 * @returns {Array<{key: string, label: string|null, seats: object[]}>} The rows; loose seats last, as their own row.
 */
export function sectionRows(section) {
  const rows = (section?.rows ?? []).map((row) => ({
    key: row.id,
    label: row.label,
    seats: row.seats ?? [],
  }))

  if ((section?.seats ?? []).length > 0) {
    rows.push({ key: `${section.id}-loose`, label: null, seats: section.seats })
  }

  return rows.filter((row) => row.seats.length > 0)
}

/**
 * Every seat of the map, each with its section and row named.
 *
 * @param {object} map The map's `data`.
 * @returns {object[]} Seats with `sectionName` and `rowLabel`.
 */
export function flattenSeats(map) {
  return (map?.sections ?? []).flatMap((section) =>
    sectionRows(section).flatMap((row) =>
      row.seats.map((seat) => ({ ...seat, sectionName: section.name, rowLabel: row.label })),
    ),
  )
}

/**
 * What a seat costs: its own price when it has one, else its tier's.
 *
 * @param {object} seat A public seat.
 * @param {Map<string, object>} tiersById The map's tiers, by id.
 * @returns {number|null} Minor units, or null when no tier sells it.
 */
export function effectiveSeatPrice(seat, tiersById) {
  if (Number.isInteger(seat?.priceCents)) return seat.priceCents

  const tier = seat?.ticketTypeId ? tiersById.get(seat.ticketTypeId) : null

  return tier ? tier.priceCents : null
}

/**
 * A selection with every companion it implies: choosing a wheelchair space
 * takes its companion seat and the other way round, exactly as the server does.
 *
 * @param {string[]} selectedSeatIds `Seat` ids.
 * @param {object[]} seats Public seats (with `seatId` and `companionOfSeatId`).
 * @returns {string[]} `Seat` ids, the chosen ones first.
 */
export function expandCompanions(selectedSeatIds, seats) {
  const plan = seats.map((seat) => ({
    id: seat.seatId,
    companionOfSeatId: seat.companionOfSeatId ?? null,
  }))

  return withCompanions(selectedSeatIds, plan)
}

/**
 * The seats bound to one seat by the companion rule, itself included.
 *
 * @param {string} seatId A `Seat` id.
 * @param {object[]} seats Public seats.
 * @returns {string[]} `Seat` ids.
 */
export function companionGroup(seatId, seats) {
  return expandCompanions([seatId], seats)
}

/**
 * The tiers a selection's seats are sold under, each once, in first-seen order.
 *
 * @param {string[]} seatIds `Seat` ids.
 * @param {Map<string, object>} seatsById Public seats by `Seat` id.
 * @param {Map<string, object>} tiersById The map's tiers, by id.
 * @returns {object[]} The tiers.
 */
function tiersOf(seatIds, seatsById, tiersById) {
  const ids = [...new Set(seatIds.map((id) => seatsById.get(id)?.ticketTypeId).filter(Boolean))]

  return ids.map((id) => tiersById.get(id)).filter(Boolean)
}

/**
 * The tier whose per-order limit binds a selection: the smallest among the
 * tiers its seats are sold under, as `sessions.hold` applies it.
 *
 * @param {string[]} seatIds `Seat` ids.
 * @param {Map<string, object>} seatsById Public seats by `Seat` id.
 * @param {Map<string, object>} tiersById The map's tiers, by id.
 * @returns {object|null} The tier, or null when none of them sets a limit.
 */
export function limitingTier(seatIds, seatsById, tiersById) {
  return tiersOf(seatIds, seatsById, tiersById)
    .filter((tier) => Number.isInteger(tier.maxPerOrder))
    .reduce(
      (strictest, tier) => (strictest?.maxPerOrder <= tier.maxPerOrder ? strictest : tier),
      null,
    )
}

/**
 * The most seats a selection may hold: the smallest per-order limit among the
 * tiers its seats are sold under, never above the map's ceiling or the
 * platform's. The same rule `sessions.hold` applies, so the picker refuses a
 * seat the server would.
 *
 * @param {string[]} seatIds `Seat` ids.
 * @param {Map<string, object>} seatsById Public seats by `Seat` id.
 * @param {Map<string, object>} tiersById The map's tiers, by id.
 * @param {number} [ceiling] The map's `maxSeatsPerOrder`.
 * @returns {number} The limit.
 */
export function selectionLimit(seatIds, seatsById, tiersById, ceiling = MAX_SEATS_PER_ORDER) {
  const tier = limitingTier(seatIds, seatsById, tiersById)

  return Math.min(ceiling, MAX_SEATS_PER_ORDER, tier ? tier.maxPerOrder : MAX_SEATS_PER_ORDER)
}

/**
 * The tiers a selection has fewer seats of than they sell at a time.
 *
 * Counted over the selection as it is, companions included, since each seat
 * is sold under its own tier: the server refuses a hold, and an order, below a
 * tier's minimum.
 *
 * @param {string[]} seatIds `Seat` ids.
 * @param {Map<string, object>} seatsById Public seats by `Seat` id.
 * @param {Map<string, object>} tiersById The map's tiers, by id.
 * @returns {Array<{tier: object, count: number, minimum: number}>} The shortfalls, in first-seen order.
 */
export function selectionShortfalls(seatIds, seatsById, tiersById) {
  const counts = new Map()

  for (const id of seatIds) {
    const tierId = seatsById.get(id)?.ticketTypeId

    if (tierId) counts.set(tierId, (counts.get(tierId) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([tierId, count]) => ({ tier: tiersById.get(tierId), count }))
    .filter(({ tier }) => tier && Number.isInteger(tier.minPerOrder))
    .map(({ tier, count }) => ({ tier, count, minimum: tier.minPerOrder }))
    .filter(({ count, minimum }) => count < minimum)
}

/**
 * Toggle a seat in a selection, keeping companions together.
 *
 * Adding a seat adds its companion; removing either removes both. A seat that
 * is not available cannot be added, and adding past the per-order limit is
 * refused rather than trimmed, so the buyer is told instead of surprised. The
 * limit may be a number, or a function of the selection it would make — the
 * smallest limit among that selection's tiers, as the server reads it.
 *
 * @param {string[]} selected The selection, as `Seat` ids.
 * @param {string} seatId The seat pressed.
 * @param {object[]} seats Public seats.
 * @param {number|function(string[]): number} [max] The most seats one hold may take.
 * @returns {{selected: string[], refused: null|'unavailable'|'limit', limit?: number}} The new selection, why it did not change, and the limit that refused it.
 */
export function toggleSeat(selected, seatId, seats, max = MAX_SEATS_PER_ORDER) {
  const group = companionGroup(seatId, seats)

  if (selected.includes(seatId)) {
    return { selected: selected.filter((id) => !group.includes(id)), refused: null }
  }

  const bySeat = new Map(seats.map((seat) => [seat.seatId, seat]))

  if (group.some((id) => !bySeat.get(id)?.available)) {
    return { selected, refused: 'unavailable' }
  }

  const next = [...new Set([...selected, ...group])]
  const limit = typeof max === 'function' ? max(next) : max

  if (next.length > limit) {
    return typeof max === 'function'
      ? { selected, refused: 'limit', limit }
      : { selected, refused: 'limit' }
  }

  return { selected: next, refused: null }
}

/**
 * A seat's accessible name: everything a sighted buyer reads off the grid.
 *
 * For example `Seat A12, row A, Stalls, Front zone, $45.00, wheelchair space,
 * available`. The seat's state comes last, so a screen reader moving along a
 * row hears the seat before its state.
 *
 * @param {object} seat A public seat.
 * @param {object} context Context.
 * @param {string} [context.section] The section's name.
 * @param {string|null} [context.row] The row's label.
 * @param {string|null} [context.zone] The price zone's name.
 * @param {number|null} [context.price] Minor units.
 * @param {string} [context.currency] The price's currency.
 * @param {boolean} [context.selected] Whether it is in the selection.
 * @returns {string} The name.
 */
export function seatAccessibleName(
  seat,
  { section, row, zone, price, currency = 'USD', selected = false } = {},
) {
  const parts = [`Seat ${seat.label}`]

  if (row) parts.push(`row ${row}`)
  if (section) parts.push(section)
  if (zone) parts.push(`${zone} zone`)
  if (Number.isInteger(price)) parts.push(formatPrice(price, currency))
  if (seat.accessible) parts.push('wheelchair space')
  if (seat.companionOfSeatId) parts.push('companion seat')
  if (seat.obstructedView) parts.push('obstructed view')
  if (seat.restricted) parts.push('restricted')

  parts.push(selected ? 'selected' : seat.available ? 'available' : 'unavailable')

  return parts.join(', ')
}

/**
 * Where the focus goes in a section's grid for a key.
 *
 * Arrows move one seat (left and right along a row; up and down to the same
 * position in the neighbouring row, or its end when it is shorter), Home and
 * End go to the ends of the row, PageUp and PageDown to the first and last row.
 * Unavailable seats are stops too, so a screen reader user hears why a seat
 * cannot be had.
 *
 * @param {Array<{seats: object[]}>} grid The section's rows.
 * @param {{row: number, column: number}} position Where the focus is.
 * @param {string} key The `KeyboardEvent.key`.
 * @returns {{row: number, column: number}|null} Where it goes, or null for a key the grid does not handle.
 */
export function nextCell(grid, position, key) {
  if (grid.length === 0) return null

  const { row, column } = position
  const width = (index) => grid[index]?.seats.length ?? 0
  const clamp = (index, value) => Math.max(0, Math.min(value, width(index) - 1))

  switch (key) {
    case 'ArrowRight':
      return { row, column: clamp(row, column + 1) }
    case 'ArrowLeft':
      return { row, column: clamp(row, column - 1) }
    case 'ArrowDown': {
      const next = Math.min(grid.length - 1, row + 1)
      return { row: next, column: clamp(next, column) }
    }
    case 'ArrowUp': {
      const next = Math.max(0, row - 1)
      return { row: next, column: clamp(next, column) }
    }
    case 'Home':
      return { row, column: 0 }
    case 'End':
      return { row, column: width(row) - 1 }
    case 'PageUp':
      return { row: 0, column: clamp(0, column) }
    case 'PageDown': {
      const last = grid.length - 1
      return { row: last, column: clamp(last, column) }
    }
    default:
      return null
  }
}

/**
 * The order lines a seat hold becomes: one per tier, counting its seats.
 *
 * Built from the hold's own seats, companions included, so the order names
 * exactly what is held — the server refuses a hold whose seats are not all
 * paid for.
 *
 * @param {Array<{ticketTypeId: string}>} heldSeats The hold response's `seats`.
 * @returns {Array<{ticketTypeId: string, quantity: number}>} The lines, in first-seen order.
 */
export function groupSelectionIntoItems(heldSeats = []) {
  const counts = new Map()

  for (const seat of heldSeats) {
    if (!seat?.ticketTypeId) continue
    counts.set(seat.ticketTypeId, (counts.get(seat.ticketTypeId) ?? 0) + 1)
  }

  return [...counts.entries()].map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }))
}

/**
 * What changed in a selection, in a sentence for the polite status.
 *
 * @param {string[]} before `Seat` ids before.
 * @param {string[]} after `Seat` ids after.
 * @param {Map<string, object>} seatsById Public seats by `Seat` id.
 * @returns {string} The sentence, or empty when nothing changed.
 */
export function selectionAnnouncement(before, after, seatsById) {
  const added = after.filter((id) => !before.includes(id))
  const removed = before.filter((id) => !after.includes(id))
  const name = (id) => seatsById.get(id)?.label ?? 'a seat'
  const list = (ids) => ids.map(name).join(' and ')
  const total = `${after.length} ${after.length === 1 ? 'seat' : 'seats'} selected.`

  if (added.length > 0) {
    const companions = added.slice(1)

    return companions.length > 0
      ? `Seat ${name(added[0])} added, with companion seat ${list(companions)}. ${total}`
      : `Seat ${name(added[0])} added. ${total}`
  }

  if (removed.length > 0) {
    return removed.length > 1
      ? `Seats ${list(removed)} removed together. ${total}`
      : `Seat ${name(removed[0])} removed. ${total}`
  }

  return ''
}

/**
 * Price a selection before it is held, the way the server will: each seat at
 * its own price, grouped into one line per tier and price.
 *
 * @param {string[]} selected `Seat` ids.
 * @param {Map<string, object>} seatsById Public seats by `Seat` id.
 * @param {Map<string, object>} tiersById The map's tiers, by id.
 * @returns {Array<{ticketTypeId: string, name: string, quantity: number, unitPriceCents: number}>} Lines for `priceSelection`.
 */
export function selectionLines(selected, seatsById, tiersById) {
  const lines = new Map()

  for (const seatId of selected) {
    const seat = seatsById.get(seatId)
    const tier = seat?.ticketTypeId ? tiersById.get(seat.ticketTypeId) : null
    const price = seat ? effectiveSeatPrice(seat, tiersById) : null

    if (!tier || !Number.isInteger(price)) continue

    const key = `${tier.id}:${price}`
    const line = lines.get(key) ?? {
      ticketTypeId: `${tier.id}:${price}`,
      name: tier.name,
      quantity: 0,
      unitPriceCents: price,
    }

    line.quantity += 1
    lines.set(key, line)
  }

  return [...lines.values()]
}
