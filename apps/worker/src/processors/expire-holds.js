/**
 * The hold sweeper: what stops abandoned checkouts from permanently eating
 * ticket stock.
 *
 * A checkout takes a `TicketHold` row before the buyer pays. Most buyers close
 * the tab. Nothing in the request path ever runs again for those rows, so
 * without this job every abandoned checkout would leave an `ACTIVE` hold behind
 * and a popular event would show "sold out" with seats nobody paid for.
 *
 * ## Why the query does not filter on `expiresAt`
 *
 * It would be easy to write `where: { status: 'ACTIVE', expiresAt: { lte: now } }`
 * and skip this package entirely. That is exactly the duplication worth
 * avoiding: expiry is defined once, in `partitionExpiredHolds`, and read paths
 * (`activeHeldQuantity`) already depend on that definition. Two copies of the
 * rule — one in SQL, one in JavaScript — is how a boundary condition like
 * `expiresAt === now` ends up being decided differently by the sweeper and by
 * the availability calculation.
 *
 * So the query selects `ACTIVE` holds **oldest first** — which uses the
 * `@@index([status, expiresAt])` just as well — and the decision about which of
 * them have actually lapsed is made by the inventory package.
 *
 * ## What "releasing inventory" means here
 *
 * Holds never increment `TicketType.quantitySold`; availability is
 * `quantityTotal - quantitySold - activeHeldQuantity(holds, now)`. So there is
 * no counter to decrement for general admission, and releasing a hold is
 * flipping its status: once it is `EXPIRED` it stops being counted. The
 * quantity freed is reported per ticket type so the effect is observable.
 *
 * A reserved seat is different: it is a row marked `HELD` with the hold's id,
 * and flipping the hold alone left it marked `HELD` with nobody holding it —
 * off sale for good. So the seats of the holds just expired are released in
 * the same transaction, conditional on still being `HELD` by a hold that is now
 * `EXPIRED`: a seat whose hold another writer converted meanwhile is sold, not
 * held, and is never touched.
 *
 * A hold an order is waiting on is not swept at all. `orders.create` attaches
 * the buyer's holds to a PENDING order before it calls the payment provider,
 * and the order can stay PENDING past the hold's time — a capture that timed
 * out waits for reconciliation. Expiring that hold would put its seats back on
 * sale while settlement still expects to sell them to the buyer who paid. So
 * the sweep reads, and writes, only holds with no order or whose order is no
 * longer PENDING (a declined card cancels it and leaves the hold to lapse).
 *
 * @module @desi-event/worker/processors/expire-holds
 */

import { partitionExpiredHolds } from '@desi-event/inventory'
import { JOB_NAMES, expireHoldsJobSchema } from '@desi-event/schemas/jobs'

import { parseJobPayload } from '../errors.js'

/** `HoldStatus.ACTIVE`, inlined to keep this module free of a database import. */
const ACTIVE = 'ACTIVE'

/** `HoldStatus.EXPIRED`. */
const EXPIRED = 'EXPIRED'

/**
 * Holds nobody's payment is waiting on: no order, or an order that is no
 * longer PENDING. Spelled as an `OR` rather than a `NOT` on the relation, so a
 * hold with no order is plainly included instead of depending on how a
 * negated join treats a null.
 */
const NOT_AWAITING_PAYMENT = Object.freeze([
  Object.freeze({ orderId: null }),
  Object.freeze({ order: { is: { status: { not: 'PENDING' } } } }),
])

/**
 * @typedef {object} ExpireHoldsResult
 * @property {string} now The instant the sweep was evaluated against, ISO-8601.
 * @property {number} scanned `ACTIVE` holds examined.
 * @property {number} expired Holds the inventory rules judged lapsed.
 * @property {number} updated Rows actually flipped to `EXPIRED`; lower than `expired` when another process released one first.
 * @property {number} releasedQuantity Tickets returned to availability.
 * @property {number} seatsReleased Reserved seats put back on sale.
 * @property {Array<{ticketTypeId: string, quantity: number, holds: number}>} byTicketType Freed stock per ticket type.
 * @property {boolean} sawFullBatch Whether the batch filled, meaning more holds are likely waiting.
 */

/**
 * Group the swept holds by ticket type, so the log line says which events got
 * their stock back rather than only how many rows changed.
 *
 * @param {Array<object>} holds The expired holds.
 * @returns {Array<{ticketTypeId: string, quantity: number, holds: number}>} One entry per ticket type, largest release first.
 */
function summariseByTicketType(holds) {
  /** @type {Map<string, {ticketTypeId: string, quantity: number, holds: number}>} */
  const byType = new Map()

  for (const hold of holds) {
    const entry = byType.get(hold.ticketTypeId) ?? {
      ticketTypeId: hold.ticketTypeId,
      quantity: 0,
      holds: 0,
    }
    entry.quantity += Number.isInteger(hold.quantity) ? hold.quantity : 0
    entry.holds += 1
    byType.set(hold.ticketTypeId, entry)
  }

  return [...byType.values()].sort((a, b) => b.quantity - a.quantity)
}

/**
 * Build the `expire-holds` processor.
 *
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma A Prisma client (or any object exposing `ticketHold.findMany`/`updateMany`).
 * @param {object} [deps.logger] Logger for the per-run summary.
 * @param {function(): Date} [deps.clock] Source of the current time; injected by tests.
 * @returns {function(object): Promise<ExpireHoldsResult>} An async BullMQ processor.
 * @throws {TypeError} When `prisma` is missing.
 */
export function createExpireHoldsProcessor({ prisma, logger, clock = () => new Date() }) {
  if (!prisma) throw new TypeError('createExpireHoldsProcessor requires a prisma client')

  /**
   * Sweep one batch of lapsed holds.
   *
   * @param {object} job The BullMQ job; only `job.data` is read.
   * @returns {Promise<ExpireHoldsResult>} What the sweep found and freed.
   * @throws {PermanentJobError} When the payload does not satisfy `expireHoldsJobSchema`.
   */
  return async function expireHolds(job) {
    const payload = parseJobPayload(expireHoldsJobSchema, job?.data ?? {}, JOB_NAMES.EXPIRE_HOLDS)
    const now = payload.now ? new Date(payload.now) : clock()

    /** @type {Record<string, unknown>} */
    const where = { status: ACTIVE, OR: NOT_AWAITING_PAYMENT }
    if (payload.ticketTypeId) where.ticketTypeId = payload.ticketTypeId

    const candidates = await prisma.ticketHold.findMany({
      where,
      orderBy: { expiresAt: 'asc' },
      take: payload.batchSize,
    })

    const { expired } = partitionExpiredHolds(candidates, now)

    if (expired.length === 0) {
      logger?.debug?.(
        { scanned: candidates.length, now: now.toISOString() },
        'hold sweep found nothing to expire',
      )
      return {
        now: now.toISOString(),
        scanned: candidates.length,
        expired: 0,
        updated: 0,
        releasedQuantity: 0,
        seatsReleased: 0,
        byTicketType: [],
        sawFullBatch: candidates.length >= payload.batchSize,
      }
    }

    const byTicketType = summariseByTicketType(expired)
    const releasedQuantity = byTicketType.reduce((total, entry) => total + entry.quantity, 0)

    // The `status: ACTIVE` guard makes the write idempotent and safe to run
    // concurrently with the API's own release endpoint: whoever gets there
    // first wins, and the loser updates nothing rather than resurrecting a
    // hold the buyer deliberately released.
    const expiredIds = expired.map((hold) => hold.id)
    const { count, seatsReleased } = await prisma.$transaction(async (tx) => {
      // Guarded on the order as well: a hold an order attached after the read
      // is that order's, and is left alone.
      const flipped = await tx.ticketHold.updateMany({
        where: { id: { in: expiredIds }, status: ACTIVE, OR: NOT_AWAITING_PAYMENT },
        data: { status: EXPIRED },
      })

      // The seats of the holds that are now EXPIRED, and only while they are
      // still HELD by them. One transaction with the status flip, so a hold is
      // never expired with its seats still off sale.
      const released = await tx.eventSeat.updateMany({
        where: { holdId: { in: expiredIds }, status: 'HELD', hold: { status: EXPIRED } },
        data: { status: 'AVAILABLE', holdId: null },
      })

      return { count: flipped.count, seatsReleased: released.count }
    })

    logger?.info?.(
      {
        scanned: candidates.length,
        expired: expired.length,
        updated: count,
        releasedQuantity,
        seatsReleased,
        ticketTypes: byTicketType.length,
      },
      'expired holds released back to availability',
    )

    return {
      now: now.toISOString(),
      scanned: candidates.length,
      expired: expired.length,
      updated: count,
      releasedQuantity,
      seatsReleased,
      byTicketType,
      sawFullBatch: candidates.length >= payload.batchSize,
    }
  }
}
