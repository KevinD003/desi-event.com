/**
 * The checkout hold lifecycle: when a hold expires, and how much stock the
 * live ones are keeping off sale.
 *
 * @module @desi-event/inventory/holds
 */

import { InventoryError, INVENTORY_ERROR_CODES } from './errors.js'
import { HOLD_STATUS } from './constants.js'
import { assertCount, assertHold, assertHoldList, toTimestamp } from './internal.js'

/**
 * @typedef {object} Hold
 * @property {string} [id] The `TicketHold` id.
 * @property {string} status A `HoldStatus` value: `ACTIVE`, `CONVERTED`, `RELEASED` or `EXPIRED`.
 * @property {number} [quantity] Tickets this hold reserves.
 * @property {Date|number|string|null} [expiresAt] When the reservation lapses. `null` means it never lapses on its own.
 */

/**
 * @typedef {object} HoldPartition
 * @property {Array<Hold>} expired `ACTIVE` holds whose clock has run out — the sweeper's work list.
 * @property {Array<Hold>} active `ACTIVE` holds still within their window; these are the only holds that reserve stock.
 * @property {Array<Hold>} inactive Every hold in a terminal status (`CONVERTED`, `RELEASED`, `EXPIRED`); they reserve nothing and need no sweeping.
 */

/**
 * Compute the instant a hold created now should lapse.
 *
 * @param {Date|number|string} now Creation instant.
 * @param {number} ttlSeconds Lifetime in seconds; fractional values are rounded to the nearest millisecond.
 * @returns {Date} The expiry instant.
 * @throws {InventoryError} Code `INVALID_DATE` for an unusable `now`, `INVALID_TTL` if the TTL is not a positive finite number.
 */
export function holdExpiresAt(now, ttlSeconds) {
  const nowMs = toTimestamp(now, 'now')

  if (typeof ttlSeconds !== 'number' || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new InventoryError(
      INVENTORY_ERROR_CODES.INVALID_TTL,
      'ttlSeconds must be a positive, finite number of seconds',
      { details: { ttlSeconds: typeof ttlSeconds === 'number' ? ttlSeconds : String(ttlSeconds) } },
    )
  }

  return new Date(nowMs + Math.round(ttlSeconds * 1000))
}

/**
 * Has this hold's expiry instant passed?
 *
 * Expiry is `expiresAt <= now`, so a hold is dead at the exact instant it was
 * due to die — the same half-open convention the sales window uses.
 *
 * A hold already recorded as `EXPIRED` reports expired whatever its timestamp
 * says, and a hold with no `expiresAt` never expires on the clock. The second
 * rule fails safe: an unbounded hold keeps reserving its stock rather than
 * silently releasing tickets that someone may be paying for.
 *
 * This is purely a clock question. It says nothing about whether the hold is
 * reserving inventory — a `CONVERTED` hold from last week is "expired" here
 * and still holds nothing. Use {@link activeHeldQuantity} for that.
 *
 * @param {Hold} hold The hold to test.
 * @param {Date|number|string} now The instant to compare against.
 * @returns {boolean} `true` when the hold's window has closed.
 * @throws {InventoryError} Code `INVALID_HOLD` if `hold` is not an object, `INVALID_DATE` for an unusable instant.
 */
export function isHoldExpired(hold, now) {
  const nowMs = toTimestamp(now, 'now')
  assertHold(hold)

  if (hold.status === HOLD_STATUS.EXPIRED) return true
  if (hold.expiresAt == null) return false

  return toTimestamp(hold.expiresAt, 'hold.expiresAt') <= nowMs
}

/**
 * Split holds into the ones to sweep, the ones still reserving stock, and the
 * ones already finished with.
 *
 * Only `ACTIVE` holds can be swept. A `CONVERTED` hold belongs to a paid
 * order and a `RELEASED` one was abandoned deliberately; expiring either would
 * rewrite settled history, so both land in `inactive` regardless of their
 * timestamps.
 *
 * @param {Array<Hold>} holds The holds to split. An empty array is valid and yields three empty arrays.
 * @param {Date|number|string} now The instant to evaluate against.
 * @returns {HoldPartition} The three buckets.
 * @throws {InventoryError} Code `INVALID_HOLD` if `holds` is not an array of objects, `INVALID_DATE` for an unusable instant.
 */
export function partitionExpiredHolds(holds, now) {
  const nowMs = toTimestamp(now, 'now')
  assertHoldList(holds)

  /** @type {HoldPartition} */
  const partition = { expired: [], active: [], inactive: [] }

  for (const hold of holds) {
    if (hold.status !== HOLD_STATUS.ACTIVE) {
      partition.inactive.push(hold)
      continue
    }

    if (isHoldExpired(hold, nowMs)) partition.expired.push(hold)
    else partition.active.push(hold)
  }

  return partition
}

/**
 * Sum the tickets that live holds are keeping off sale.
 *
 * This is the number to subtract in
 * {@link module:@desi-event/inventory/availability.computeAvailability}, and
 * the reason this package exists. A hold row stays `ACTIVE` until a sweeper
 * updates it, so between a hold lapsing and the job running there are rows
 * that look like reservations but are not. Counting those would strand
 * inventory — an event showing "sold out" with seats nobody paid for — so the
 * expiry check happens here, at read time, against the injected `now`, and
 * never trusts the status column alone.
 *
 * @param {Array<Hold>} holds Holds for a single ticket type. Empty is valid and yields `0`.
 * @param {Date|number|string} now The instant to evaluate against.
 * @returns {number} Tickets reserved by `ACTIVE`, unexpired holds.
 * @throws {InventoryError} Code `INVALID_HOLD` if a hold is malformed or its quantity is not a non-negative integer, `INVALID_DATE` for an unusable instant.
 */
export function activeHeldQuantity(holds, now) {
  const nowMs = toTimestamp(now, 'now')
  const { active } = partitionExpiredHolds(holds, nowMs)

  let total = 0
  for (const hold of active) {
    total += assertCount(hold.quantity, 'hold.quantity', INVENTORY_ERROR_CODES.INVALID_HOLD)
  }

  return total
}
