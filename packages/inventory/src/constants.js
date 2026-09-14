/**
 * Frozen enum mirrors used by the inventory maths.
 *
 * The values match the Prisma enums in `@desi-event/db` exactly, but are
 * duplicated here on purpose: this package is pure arithmetic with zero
 * runtime dependencies, so it must not pull in the database client (and the
 * Prisma client cannot be loaded in environments that have no generated
 * client, such as a browser bundle or a cold CI job).
 *
 * @module @desi-event/inventory/constants
 */

/**
 * Lifecycle of a {@link https://www.prisma.io Prisma} `TicketHold`.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const HOLD_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  CONVERTED: 'CONVERTED',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED',
})

/**
 * Lifecycle of a `TicketType`.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const TICKET_TYPE_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ON_SALE: 'ON_SALE',
  PAUSED: 'PAUSED',
  SOLD_OUT: 'SOLD_OUT',
  CLOSED: 'CLOSED',
})

/**
 * The six states {@link module:@desi-event/inventory/sales-window.salesWindowState}
 * can return.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SALES_WINDOW_STATE = Object.freeze({
  ON_SALE: 'ON_SALE',
  NOT_STARTED: 'NOT_STARTED',
  ENDED: 'ENDED',
  PAUSED: 'PAUSED',
  CLOSED: 'CLOSED',
  DRAFT: 'DRAFT',
})
