/**
 * A night's own rules for general admission: its sales window and its capacity.
 *
 * A tier can be for one night (`TicketType.eventSessionId`), and a night can
 * have a capacity of its own (`EventSession.capacity`) shared by every
 * general-admission tier sold for it — a hall holds 300 people whether they
 * bought the early-bird or the standard ticket. Each tier's own quantity is
 * checked by `readAvailability`; this module checks the night's.
 *
 * ## Lock order
 *
 * The session capacity is a counter several tiers draw on, so it has the same
 * check-then-act race the tier counter has, and the same cure: a row lock
 * taken before anything is read. The order every checkout path takes locks in
 * is fixed, and it is what makes the scheme deadlock-free:
 *
 *   1. every `TicketType` row involved, sorted by id (`lockTicketTypes`);
 *   2. every `EventSession` row involved, sorted by id ({@link lockEventSessions});
 *   3. a promo code row, when there is one (`lockPromoCode`);
 *   4. then, and only then, reads.
 *
 * Authoring writes take the `Event` row first (`FOR NO KEY UPDATE`, through the
 * revision compare-and-set) and then a tier or a session. Checkout never waits
 * on the `Event` row — an order insert takes `FOR KEY SHARE` on it, which does
 * not conflict with `NO KEY UPDATE` — so the two orders cannot form a cycle.
 * Settlement turns holds into sales without changing a night's total, so it
 * needs no session lock.
 *
 * A path that locked a session before a tier could deadlock against one that
 * did the reverse. Keep to the order above.
 *
 * @module @desi-event/api/lib/session-inventory
 */

import {
  activeHeldQuantity,
  InventoryError,
  INVENTORY_ERROR_CODES,
  salesWindowState,
} from '@desi-event/inventory'
import { CAPABILITIES, can } from '@desi-event/permissions'

import { unprocessable } from './errors.js'

/** `HoldStatus.ACTIVE`, inlined to keep this module free of a database import. */
const ACTIVE = 'ACTIVE'

/** A night's window states and what a buyer is told for each. */
export const SESSION_WINDOW_MESSAGE = Object.freeze({
  NOT_STARTED: 'Tickets for this night are not on sale now.',
  ENDED: 'Sales for this night have closed.',
  PAUSED: 'Sales for this night are paused.',
  CLOSED: 'This night is not on sale.',
  DRAFT: 'This night is not on sale.',
})

/**
 * How a session's own status reads as a sales state.
 *
 * `SCHEDULED` and `ON_SALE` both sell: a scheduled night is one the organiser
 * has not paused or closed. Sold out, cancelled and finished nights do not.
 *
 * @type {Readonly<Record<string, string>>}
 */
const SESSION_STATUS_AS_SALES = Object.freeze({
  SCHEDULED: 'ON_SALE',
  ON_SALE: 'ON_SALE',
  SALES_PAUSED: 'PAUSED',
})

/**
 * Take a row lock on each session, in a deadlock-free order.
 *
 * Called after `lockTicketTypes` and before any read; see the module comment.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {Array<string|null|undefined>} sessionIds Session ids. Nulls and duplicates are dropped.
 * @returns {Promise<string[]>} The ids locked, in the order they were locked.
 */
export async function lockEventSessions(tx, sessionIds) {
  const ids = [...new Set(sessionIds.filter(Boolean))].sort()

  for (const id of ids) {
    // A bound parameter, never string concatenation.
    await tx.$queryRaw`SELECT id FROM "EventSession" WHERE id = ${id} FOR UPDATE`
  }

  return ids
}

/**
 * Whether a night is selling now.
 *
 * The session's status is read as a tier's would be (see
 * `SESSION_STATUS_AS_SALES`), then its own window applies. A night with no
 * `salesEndAt` stops selling when it ends: nobody buys a ticket for a night
 * that is over. A window the helper cannot read counts as closed rather than
 * failing the request.
 *
 * @param {object} session An `EventSession` row.
 * @param {Date} now The moment in question.
 * @returns {string} One of `ON_SALE`, `NOT_STARTED`, `ENDED`, `PAUSED`, `CLOSED`.
 */
export function sessionWindowState(session, now) {
  const status = SESSION_STATUS_AS_SALES[session.status] ?? 'CLOSED'

  try {
    return salesWindowState({
      status,
      salesStartAt: session.salesStartAt ?? null,
      salesEndAt: session.salesEndAt ?? session.endsAt ?? null,
      now,
    })
  } catch {
    return 'CLOSED'
  }
}

/**
 * Refuse a request for a night that is not selling.
 *
 * @param {object} session An `EventSession` row.
 * @param {Date} now The moment in question.
 * @returns {void}
 * @throws {Error} A 422 naming the window state and the night.
 */
export function assertSessionOnSale(session, now) {
  const windowState = sessionWindowState(session, now)

  if (windowState !== 'ON_SALE') {
    throw unprocessable(SESSION_WINDOW_MESSAGE[windowState] ?? SESSION_WINDOW_MESSAGE.CLOSED, {
      windowState,
      eventSessionId: session.id,
    })
  }
}

/**
 * How much of a night's general-admission capacity is used.
 *
 * Counted from live rows: the paid quantity of every general-admission tier
 * bound to the night, plus every live hold on those tiers. Expired holds the
 * sweeper has not reached yet are filtered by instant, not trusted by status.
 * A caller's own holds are left out, so a buyer's reservation is not counted
 * against the order it exists to protect.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {object} session The `EventSession` row.
 * @param {object} [options] Options.
 * @param {Date} [options.now] The moment in question.
 * @param {string[]} [options.ignoreHoldIds] The caller's own holds.
 * @returns {Promise<{sold: number, held: number, capacity: number|null, available: number|null}>} Usage; `available` is null for a night with no capacity.
 */
export async function readSessionUsage(tx, session, { now = new Date(), ignoreHoldIds = [] } = {}) {
  const ignored = new Set(ignoreHoldIds)
  // `not: true` rather than `false`: the same rows in PostgreSQL, where the
  // column is NOT NULL, and a row written before the column existed reads as
  // general admission rather than vanishing from the count.
  const tiers = await tx.ticketType.findMany({
    where: { eventSessionId: session.id, reserved: { not: true } },
    select: { id: true, quantitySold: true },
  })

  const sold = tiers.reduce((total, tier) => total + (tier.quantitySold ?? 0), 0)

  const holds =
    tiers.length === 0
      ? []
      : await tx.ticketHold.findMany({
          where: { ticketTypeId: { in: tiers.map((tier) => tier.id) }, status: ACTIVE },
        })

  const held = activeHeldQuantity(
    holds.filter((hold) => !ignored.has(hold.id)),
    now,
  )

  const capacity = Number.isInteger(session.capacity) ? session.capacity : null

  return {
    sold,
    held,
    capacity,
    available: capacity === null ? null : Math.max(0, capacity - sold - held),
  }
}

/**
 * Refuse a request that would take a night past its capacity.
 *
 * Must run after {@link lockEventSessions} has locked this session, so the
 * usage read here cannot move before the hold or order is written.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {object} options.session The `EventSession` row.
 * @param {number} options.requested The general-admission quantity asked for on this night.
 * @param {Date} options.now The moment in question.
 * @param {string[]} [options.ignoreHoldIds] The caller's own holds.
 * @returns {Promise<{sold: number, held: number, capacity: number|null, available: number|null}>} The usage it checked against.
 * @throws {InventoryError} `INSUFFICIENT_INVENTORY` (409) with `{eventSessionId, available}`.
 */
export async function assertSessionCapacity(tx, { session, requested, now, ignoreHoldIds = [] }) {
  const usage = await readSessionUsage(tx, session, { now, ignoreHoldIds })

  if (usage.available !== null && requested > usage.available) {
    throw new InventoryError(
      INVENTORY_ERROR_CODES.INSUFFICIENT_INVENTORY,
      usage.available === 0
        ? 'This night is sold out.'
        : `Only ${usage.available} ticket${usage.available === 1 ? '' : 's'} left for this night.`,
      { details: { eventSessionId: session.id, available: usage.available } },
    )
  }

  return usage
}

/**
 * Whether this caller may book a hidden tier of this event.
 *
 * A hidden tier is a guest list or a team allocation, booked by the team
 * through the ordinary checkout. Anybody else is answered as if the tier did
 * not exist, so the sale endpoints are not an oracle for which tier ids exist.
 *
 * @param {object|null} actor The request actor.
 * @param {{organizationId: string}} event The event.
 * @returns {boolean} True when the caller holds `ticketType:manage` in its organisation.
 */
export function mayBookHiddenTier(actor, event) {
  return can(actor, CAPABILITIES.TICKET_TYPE_MANAGE, { organizationId: event.organizationId })
}
