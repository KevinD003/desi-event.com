/**
 * The per-order quantity guard that stands between a cart and an oversell.
 *
 * @module @desi-event/inventory/quantity
 */

import { InventoryError, INVENTORY_ERROR_CODES } from './errors.js'
import { assertCount } from './internal.js'

/**
 * @typedef {object} QuantityRequest
 * @property {number} quantity Tickets the buyer is asking for.
 * @property {number} [minPerOrder] Smallest permitted quantity. Defaults to `1`.
 * @property {number|null} [maxPerOrder] Largest permitted quantity. `null` means unlimited.
 * @property {number} availableQuantity Tickets currently purchasable, from {@link module:@desi-event/inventory/availability.computeAvailability}.
 */

/**
 * Validate a requested quantity against the ticket type's rules and stock.
 *
 * Checks run cheapest-and-most-specific first so the buyer sees the most
 * actionable message: shape, then the per-order floor, then the per-order
 * ceiling, then remaining stock. Quantity is checked before the limits because
 * `0` or `2.5` is a client bug, not a "you must buy at least 2" situation.
 *
 * This is a guard, not a gate: it proves a request is *permissible*, and the
 * caller must still claim the stock atomically (a conditional `UPDATE` or a
 * hold row created inside the same transaction). Two callers can both pass
 * this check against the same last ticket.
 *
 * @param {QuantityRequest} request The requested quantity and the rules to test it against.
 * @returns {void} Nothing; it either returns or throws.
 * @throws {InventoryError} Code `INVALID_QUANTITY` (not a positive integer), `BELOW_MINIMUM`, `ABOVE_MAXIMUM`, or `INSUFFICIENT_INVENTORY`.
 */
export function validateQuantityRequest({
  quantity,
  minPerOrder = 1,
  maxPerOrder = null,
  availableQuantity,
} = {}) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new InventoryError(
      INVENTORY_ERROR_CODES.INVALID_QUANTITY,
      'quantity must be a whole number of at least 1',
      { details: { quantity: typeof quantity === 'number' ? quantity : String(quantity) } },
    )
  }

  const min = minPerOrder == null ? 1 : assertCount(minPerOrder, 'minPerOrder')
  const max = maxPerOrder == null ? null : assertCount(maxPerOrder, 'maxPerOrder')
  const available = assertCount(availableQuantity, 'availableQuantity')

  if (max !== null && min > max) {
    throw new InventoryError(
      INVENTORY_ERROR_CODES.INVALID_INVENTORY,
      'minPerOrder is greater than maxPerOrder',
      { details: { minPerOrder: min, maxPerOrder: max } },
    )
  }

  // Reaching here means `min >= 2`: quantity is already known to be at least 1,
  // so a minimum of 0 or 1 can never be breached. Hence the unconditional plural.
  if (quantity < min) {
    throw new InventoryError(
      INVENTORY_ERROR_CODES.BELOW_MINIMUM,
      `At least ${min} tickets must be bought at a time`,
      { details: { quantity, minPerOrder: min } },
    )
  }

  if (max !== null && quantity > max) {
    throw new InventoryError(
      INVENTORY_ERROR_CODES.ABOVE_MAXIMUM,
      `At most ${max} ticket${max === 1 ? '' : 's'} may be bought at a time`,
      { details: { quantity, maxPerOrder: max } },
    )
  }

  if (quantity > available) {
    throw new InventoryError(
      INVENTORY_ERROR_CODES.INSUFFICIENT_INVENTORY,
      available === 0
        ? 'These tickets are sold out'
        : `Only ${available} ticket${available === 1 ? '' : 's'} left`,
      { details: { quantity, availableQuantity: available } },
    )
  }
}
