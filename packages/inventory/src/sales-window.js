/**
 * Resolving a ticket type's status and sales window into one purchasable state.
 *
 * @module @desi-event/inventory/sales-window
 */

import { InventoryError, INVENTORY_ERROR_CODES } from './errors.js'
import { SALES_WINDOW_STATE, TICKET_TYPE_STATUS } from './constants.js'
import { toTimestamp } from './internal.js'

/**
 * @typedef {object} SalesWindowInput
 * @property {string} status A `TicketTypeStatus` value: `DRAFT`, `ON_SALE`, `PAUSED`, `SOLD_OUT` or `CLOSED`.
 * @property {Date|number|string|null} [salesStartAt] When sales open. `null` means "open from the start".
 * @property {Date|number|string|null} [salesEndAt] When sales close. `null` means "no closing time".
 * @property {Date|number|string} now The instant to evaluate against. Required — this module never reads the clock itself.
 */

/**
 * Resolve the effective sales state of a ticket type.
 *
 * Precedence: an explicit status wins over the date window. An organiser who
 * hits pause expects sales to stop immediately even though the window is still
 * open, and a `DRAFT` ticket type must never leak a "starts in 3 days" teaser.
 * Only `ON_SALE` defers to the clock.
 *
 * `SOLD_OUT` collapses to `CLOSED`: the six states in the contract carry no
 * sold-out member, and both mean "not purchasable, not because of the clock".
 * Callers that need to distinguish them should read
 * {@link module:@desi-event/inventory/availability.computeAvailability}'s
 * `isSoldOut`, which is derived from live counters rather than from a
 * denormalised status column that may lag.
 *
 * The window is half-open, `[salesStartAt, salesEndAt)`: sales are live at the
 * exact start instant and over at the exact end instant, so back-to-back
 * windows never both claim the same millisecond.
 *
 * @param {SalesWindowInput} input Status, window and the injected clock.
 * @returns {string} One of `ON_SALE`, `NOT_STARTED`, `ENDED`, `PAUSED`, `CLOSED`, `DRAFT`.
 * @throws {InventoryError} Code `INVALID_STATUS` for an unknown status, `INVALID_DATE` for an unusable instant or a window that ends before it starts.
 */
export function salesWindowState({ status, salesStartAt = null, salesEndAt = null, now } = {}) {
  const nowMs = toTimestamp(now, 'now')

  switch (status) {
    case TICKET_TYPE_STATUS.DRAFT:
      return SALES_WINDOW_STATE.DRAFT
    case TICKET_TYPE_STATUS.PAUSED:
      return SALES_WINDOW_STATE.PAUSED
    case TICKET_TYPE_STATUS.CLOSED:
    case TICKET_TYPE_STATUS.SOLD_OUT:
      return SALES_WINDOW_STATE.CLOSED
    case TICKET_TYPE_STATUS.ON_SALE:
      break
    default:
      throw new InventoryError(
        INVENTORY_ERROR_CODES.INVALID_STATUS,
        `Unknown ticket type status: ${String(status)}`,
        { details: { status: String(status) } },
      )
  }

  const startMs = salesStartAt == null ? null : toTimestamp(salesStartAt, 'salesStartAt')
  const endMs = salesEndAt == null ? null : toTimestamp(salesEndAt, 'salesEndAt')

  if (startMs !== null && endMs !== null && endMs < startMs) {
    throw new InventoryError(
      INVENTORY_ERROR_CODES.INVALID_DATE,
      'salesEndAt is before salesStartAt',
      {
        details: {
          salesStartAt: new Date(startMs).toISOString(),
          salesEndAt: new Date(endMs).toISOString(),
        },
      },
    )
  }

  if (startMs !== null && nowMs < startMs) return SALES_WINDOW_STATE.NOT_STARTED
  if (endMs !== null && nowMs >= endMs) return SALES_WINDOW_STATE.ENDED

  return SALES_WINDOW_STATE.ON_SALE
}
