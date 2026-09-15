/**
 * Ticket inventory: availability maths and the checkout hold lifecycle.
 *
 * Every function here is pure and takes `now` as an argument. Nothing reads
 * the clock, touches the database or mutates its input, so the oversell rules
 * can be tested exhaustively against fixed instants instead of being inferred
 * from integration runs.
 *
 * The one rule the rest of the system depends on: availability is
 * `quantityTotal - quantitySold - activeHeldQuantity(holds, now)`, floored at
 * zero, and `activeHeldQuantity` counts only holds that are both `ACTIVE` and
 * not yet past their `expiresAt`.
 *
 * @module @desi-event/inventory
 */

export { InventoryError, INVENTORY_ERROR_CODES } from './errors.js'
export { HOLD_STATUS, TICKET_TYPE_STATUS, SALES_WINDOW_STATE } from './constants.js'
export { computeAvailability } from './availability.js'
export { salesWindowState } from './sales-window.js'
export { validateQuantityRequest } from './quantity.js'
export { holdExpiresAt, isHoldExpired, partitionExpiredHolds, activeHeldQuantity } from './holds.js'

export {
  MAX_SEATS_PER_ORDER,
  OCCUPIED,
  SEAT_STATUS,
  SEAT_TRANSITIONS,
  TAKEABLE_FROM,
  canTransition,
  groupSeatMap,
  seatCounts,
  toPublicSeat,
  validateSeatSelection,
  withCompanions,
  wouldStrandCompanion,
} from './seating.js'

export {
  HOLD_RELEASE_MODES,
  authorizeHoldRelease,
  createGuestHoldToken,
  digestsMatch,
  hashGuestHoldToken,
  resolveHoldOwnership,
} from './ownership.js'
