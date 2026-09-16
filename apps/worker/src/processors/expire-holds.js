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
 * no counter to decrement, and releasing a hold *is* flipping its status: once
 * it is `EXPIRED` it stops being counted, and the seats are back on sale. The
 * quantity freed is reported per ticket type so the effect is observable.
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
 * @typedef {object} ExpireHoldsResult
 * @property {string} now The instant the sweep was evaluated against, ISO-8601.
 * @property {number} scanned `ACTIVE` holds examined.
 * @property {number} expired Holds the inventory rules judged lapsed.
 * @property {number} updated Rows actually flipped to `EXPIRED`; lower than `expired` when another process released one first.
 * @property {number} releasedQuantity Tickets returned to availability.
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
    const where = { status: ACTIVE }
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
    const { count } = await prisma.ticketHold.updateMany({
      where: { id: { in: expired.map((hold) => hold.id) }, status: ACTIVE },
      data: { status: EXPIRED },
    })

    logger?.info?.(
      {
        scanned: candidates.length,
        expired: expired.length,
        updated: count,
        releasedQuantity,
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
      byTicketType,
      sawFullBatch: candidates.length >= payload.batchSize,
    }
  }
}
