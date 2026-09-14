/**
 * Inventory reads that must be correct under concurrency.
 *
 * ## How the oversell race is prevented
 *
 * Two buyers can request the last ticket at the same millisecond. Reading the
 * counters, deciding there is room, and then inserting a hold is a classic
 * check-then-act race: both reads see one ticket left, both inserts succeed,
 * and the event is oversold.
 *
 * The fix is to make the two requests take turns at the database level. Every
 * checkout path opens a transaction and, as its *first* statement, runs
 * `SELECT id FROM "TicketType" WHERE id = $1 FOR UPDATE`. PostgreSQL grants
 * that row lock to exactly one transaction; the second blocks inside the
 * `SELECT` until the first commits or rolls back. Only then does it read the
 * hold rows — so it sees the hold the winner just inserted, recomputes
 * availability including it, and is refused with `INSUFFICIENT_INVENTORY`.
 *
 * Three properties make this sound:
 *
 *  * The lock is taken **before** any counter is read. Locking after the read
 *    would serialise the writes but not the decision, which is the bug.
 *  * Availability is always recomputed from live rows inside the transaction —
 *    `quantityTotal - quantitySold - activeHeldQuantity(holds, now)` — never
 *    from a value carried in from before the lock was held.
 *  * When several ticket types are involved (an order), the ids are locked in
 *    sorted order, so two transactions touching the same pair can never each
 *    hold half of what the other needs and deadlock.
 *
 * Expired holds are filtered at read time by `activeHeldQuantity` rather than
 * trusted from the `status` column, so a lapsed reservation the sweeper has
 * not yet swept does not keep seats off sale.
 *
 * @module @desi-event/api/lib/inventory
 */

import { activeHeldQuantity, computeAvailability } from '@desi-event/inventory'

/** `HoldStatus.ACTIVE`, inlined to keep this module free of a database import. */
const ACTIVE = 'ACTIVE'

/**
 * Take a PostgreSQL row lock on each ticket type, in a deadlock-free order.
 *
 * Must be the first statement of the transaction; see the module comment.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {string[]} ticketTypeIds Ticket type ids to lock. Duplicates are collapsed.
 * @returns {Promise<void>} Resolves once every row is locked.
 */
export async function lockTicketTypes(tx, ticketTypeIds) {
  const ids = [...new Set(ticketTypeIds)].sort()

  for (const id of ids) {
    // A tagged template keeps the id a bound parameter rather than string
    // concatenation, so this cannot become an injection point.
    await tx.$queryRaw`SELECT id FROM "TicketType" WHERE id = ${id} FOR UPDATE`
  }
}

/**
 * Recompute a ticket type's live availability from the database.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {object} ticketType The `TicketType` row.
 * @param {object} [options] Behaviour switches.
 * @param {Date} [options.now] Instant used to decide which holds are still live. Defaults to the current time.
 * @param {string[]} [options.ignoreHoldIds] Holds belonging to this caller, excluded so their own reservation is not double-counted.
 * @returns {Promise<{availableQuantity: number, isSoldOut: boolean, heldQuantity: number}>} The availability snapshot.
 */
export async function readAvailability(tx, ticketType, options = {}) {
  const { now = new Date(), ignoreHoldIds = [] } = options
  const ignored = new Set(ignoreHoldIds)

  const holds = await tx.ticketHold.findMany({
    where: { ticketTypeId: ticketType.id, status: ACTIVE },
  })

  const counted = holds.filter((hold) => !ignored.has(hold.id))

  return computeAvailability({
    quantityTotal: ticketType.quantityTotal,
    quantitySold: ticketType.quantitySold,
    heldQuantity: activeHeldQuantity(counted, now),
  })
}

/**
 * Availability for a batch of ticket types, keyed by ticket type id.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {object[]} ticketTypes The `TicketType` rows.
 * @param {object} [options] Same options as {@link readAvailability}.
 * @returns {Promise<Map<string, {availableQuantity: number, isSoldOut: boolean, heldQuantity: number}>>} Availability per ticket type id.
 */
export async function readAvailabilityMap(tx, ticketTypes, options = {}) {
  const entries = await Promise.all(
    ticketTypes.map(async (ticketType) => [
      ticketType.id,
      await readAvailability(tx, ticketType, options),
    ]),
  )

  return new Map(/** @type {Array<Array<*>>} */ (entries))
}
