/**
 * Argument coercion shared by the public inventory functions.
 *
 * Nothing here is re-exported from the package entry point; it exists so the
 * public functions can fail loudly and identically on malformed input.
 *
 * @module @desi-event/inventory/internal
 */

import { InventoryError, INVENTORY_ERROR_CODES } from './errors.js'

/**
 * Convert an instant to epoch milliseconds.
 *
 * `Date`, epoch-millisecond numbers and ISO strings are all accepted because
 * inventory data arrives from Prisma (`Date`), from JSON request bodies
 * (string) and from job payloads (number).
 *
 * @param {Date|number|string} value The instant to convert.
 * @param {string} label Argument name, used in the error message.
 * @returns {number} Epoch milliseconds.
 * @throws {InventoryError} Code `INVALID_DATE` if the value is absent or unparseable.
 */
export function toTimestamp(value, label) {
  if (value instanceof Date) {
    const ms = value.getTime()
    if (Number.isNaN(ms)) {
      throw new InventoryError(INVENTORY_ERROR_CODES.INVALID_DATE, `${label} is an invalid Date`, {
        details: { argument: label },
      })
    }
    return ms
  }

  if (typeof value === 'number' && Number.isFinite(value)) return value

  if (typeof value === 'string') {
    const ms = Date.parse(value)
    if (!Number.isNaN(ms)) return ms
  }

  throw new InventoryError(
    INVENTORY_ERROR_CODES.INVALID_DATE,
    `${label} must be a Date, epoch milliseconds or an ISO date-time string`,
    { details: { argument: label, received: describe(value) } },
  )
}

/**
 * Assert that a value is a whole, non-negative, exactly representable count.
 *
 * Ticket counters are never fractional and never negative; a value that is
 * either means the caller's data is corrupt, and silently coercing it is how
 * oversells happen.
 *
 * @param {number} value The count to check.
 * @param {string} label Argument name, used in the error message.
 * @param {string} [code] Error code to raise. Defaults to `INVALID_INVENTORY`.
 * @returns {number} The value itself, unchanged.
 * @throws {InventoryError} If the value is not a non-negative safe integer.
 */
export function assertCount(value, label, code = INVENTORY_ERROR_CODES.INVALID_INVENTORY) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InventoryError(code, `${label} must be a non-negative integer`, {
      details: { argument: label, received: describe(value) },
    })
  }
  return value
}

/**
 * Assert that a value is an array of hold-like objects.
 *
 * @param {unknown} holds The candidate hold list.
 * @returns {Array<object>} The same array.
 * @throws {InventoryError} Code `INVALID_HOLD` if it is not an array of objects.
 */
export function assertHoldList(holds) {
  if (!Array.isArray(holds)) {
    throw new InventoryError(INVENTORY_ERROR_CODES.INVALID_HOLD, 'holds must be an array', {
      details: { received: describe(holds) },
    })
  }

  for (const hold of holds) assertHold(hold)
  return holds
}

/**
 * Assert that a value is a hold-like object.
 *
 * @param {unknown} hold The candidate hold.
 * @returns {object} The same object.
 * @throws {InventoryError} Code `INVALID_HOLD` if it is not a non-null object.
 */
export function assertHold(hold) {
  if (hold === null || typeof hold !== 'object' || Array.isArray(hold)) {
    throw new InventoryError(
      INVENTORY_ERROR_CODES.INVALID_HOLD,
      'hold must be an object with { status, quantity, expiresAt }',
      { details: { received: describe(hold) } },
    )
  }
  return hold
}

/**
 * Render a value for an error payload without risking a circular-JSON throw.
 *
 * @param {unknown} value Anything.
 * @returns {string} A short, safe description.
 */
function describe(value) {
  if (value === null) return 'null'
  if (value instanceof Date) return 'Date'
  if (typeof value === 'object') return Array.isArray(value) ? 'array' : 'object'
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}
