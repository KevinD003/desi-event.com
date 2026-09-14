/**
 * Availability arithmetic for a single ticket type.
 *
 * @module @desi-event/inventory/availability
 */

import { assertCount } from './internal.js'

/**
 * @typedef {object} AvailabilityInput
 * @property {number} quantityTotal Total tickets ever offered for this ticket type.
 * @property {number} [quantitySold] Tickets already issued. Defaults to `0`.
 * @property {number} [heldQuantity] Tickets currently reserved by live checkout holds — use {@link module:@desi-event/inventory/holds.activeHeldQuantity} to compute it. Defaults to `0`.
 */

/**
 * @typedef {object} Availability
 * @property {number} availableQuantity Tickets a buyer may take right now, never below zero.
 * @property {boolean} isSoldOut `true` when `availableQuantity` is zero.
 * @property {number} heldQuantity The held quantity that was subtracted, echoed back for callers that render "N in other carts".
 */

/**
 * Compute how many tickets are purchasable right now.
 *
 * `available = quantityTotal - quantitySold - heldQuantity`, floored at zero.
 *
 * The floor matters: an oversell caused by a race elsewhere (two workers
 * issuing the last ticket) leaves the subtraction negative, and a negative
 * "available" would read as truthy inventory to a careless caller. Clamping to
 * zero means the worst outcome of upstream corruption is refusing sales rather
 * than selling seats that do not exist.
 *
 * Only live holds belong in `heldQuantity`. Passing the raw sum of every
 * `ACTIVE` hold row — including ones whose `expiresAt` has passed but that the
 * sweeper has not yet marked `EXPIRED` — would strand inventory that should be
 * back on sale.
 *
 * @param {AvailabilityInput} input Ticket-type counters.
 * @returns {Availability} The availability snapshot.
 * @throws {InventoryError} Code `INVALID_INVENTORY` if any counter is not a non-negative integer.
 */
export function computeAvailability({ quantityTotal, quantitySold = 0, heldQuantity = 0 } = {}) {
  const total = assertCount(quantityTotal, 'quantityTotal')
  const sold = assertCount(quantitySold, 'quantitySold')
  const held = assertCount(heldQuantity, 'heldQuantity')

  const availableQuantity = Math.max(0, total - sold - held)

  return { availableQuantity, isSoldOut: availableQuantity === 0, heldQuantity: held }
}
