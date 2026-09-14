/**
 * Mint `Ticket` rows for a paid order.
 *
 * ## Idempotency, and why it is not optional
 *
 * This job will run more than once for the same order. BullMQ retries on
 * failure, a payment webhook can be delivered twice, a stalled job is
 * reclaimed by another worker, and an operator can replay a failed job by
 * hand. If any of those mints a second set of tickets, the buyer has twice the
 * tickets they paid for and the door staff have no way to tell which are real.
 *
 * Three things make re-running a no-op:
 *
 *  1. **The row lock comes first.** The transaction opens with
 *     `SELECT id FROM "Order" ... FOR UPDATE`, so two concurrent runs for the
 *     same order take turns instead of both reading "zero tickets exist".
 *  2. **The count is read inside the lock.** Each order item mints
 *     `quantity - tickets.length` tickets, recomputed from live rows after the
 *     lock is held — never from a count carried in from before it.
 *  3. **Only paid orders are touched at all**, so a refunded or cancelled
 *     order cannot acquire tickets by way of a stale retry.
 *
 * The same argument as `apps/api/src/lib/inventory.js` makes about overselling,
 * applied to ticket minting.
 *
 * @module @desi-event/worker/processors/issue-tickets
 */

import { JOB_NAMES, issueTicketsJobSchema } from '@desi-event/schemas'

import {
  PermanentJobError,
  RetryableJobError,
  WORKER_ERROR_CODES,
  parseJobPayload,
} from '../errors.js'
import { generateTicketCodes } from '../ticket-codes.js'

/** `OrderStatus.PAID`. */
const PAID = 'PAID'

/**
 * Order statuses from which an order can still become `PAID`, so a job that
 * arrives before the payment is recorded is worth retrying rather than failing.
 *
 * @type {string[]}
 */
export const PENDING_ORDER_STATUSES = Object.freeze(['PENDING'])

/**
 * @typedef {object} IssueTicketsResult
 * @property {string} orderId The order that was processed.
 * @property {number} issued Tickets minted by this run; `0` on every re-run.
 * @property {number} existing Tickets that already existed before this run.
 * @property {number} total Tickets the order now has.
 * @property {number} expected Tickets the order's items say it should have.
 * @property {boolean} complete Whether `total` has reached `expected`.
 * @property {string[]} ticketIds Ids minted by this run.
 */

/**
 * Decide what to mint for one order item.
 *
 * @param {object} item An `OrderItem` row with its `tickets` loaded.
 * @returns {{orderItemId: string, needed: number, existing: number}} The shortfall for this item.
 */
function shortfallFor(item) {
  const existing = Array.isArray(item.tickets) ? item.tickets.length : 0
  const quantity = Number.isInteger(item.quantity) ? item.quantity : 0
  return { orderItemId: item.id, needed: Math.max(0, quantity - existing), existing }
}

/**
 * Build the `issue-tickets` processor.
 *
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma A Prisma client exposing `$transaction`, `$queryRaw`, `order.findUnique` and `ticket.createMany`.
 * @param {object} [deps.logger] Logger for the per-order summary.
 * @param {function(number): string[]} [deps.generateCodes] Ticket code factory; injected by tests for determinism.
 * @returns {function(object): Promise<IssueTicketsResult>} An async BullMQ processor.
 * @throws {TypeError} When `prisma` is missing.
 */
export function createIssueTicketsProcessor({
  prisma,
  logger,
  generateCodes = generateTicketCodes,
}) {
  if (!prisma) throw new TypeError('createIssueTicketsProcessor requires a prisma client')

  /**
   * Issue every missing ticket for one order.
   *
   * @param {object} job The BullMQ job; only `job.data` is read.
   * @returns {Promise<IssueTicketsResult>} What the run minted, and what was already there.
   * @throws {PermanentJobError} When the payload is invalid, the order does not exist, or its status can never become `PAID`.
   * @throws {RetryableJobError} When the order exists but is not paid yet.
   */
  return async function issueTickets(job) {
    const payload = parseJobPayload(issueTicketsJobSchema, job?.data ?? {}, JOB_NAMES.ISSUE_TICKETS)
    const { orderId } = payload

    const result = await prisma.$transaction(async (tx) => {
      // FIRST statement: serialise concurrent runs for this order before any
      // ticket count is read. Reading first and locking afterwards would
      // serialise the writes but not the decision, which is the bug.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { tickets: true } } },
      })

      if (!order) {
        throw new PermanentJobError(`No order with id "${orderId}"`, {
          code: WORKER_ERROR_CODES.ENTITY_NOT_FOUND,
          jobName: JOB_NAMES.ISSUE_TICKETS,
          details: { orderId },
        })
      }

      if (order.status !== PAID) {
        if (PENDING_ORDER_STATUSES.includes(order.status)) {
          throw new RetryableJobError(
            `Order "${orderId}" is ${order.status}; tickets are issued once payment is recorded`,
            {
              code: WORKER_ERROR_CODES.NOT_READY,
              jobName: JOB_NAMES.ISSUE_TICKETS,
              details: { orderId, status: order.status },
            },
          )
        }

        throw new PermanentJobError(
          `Order "${orderId}" is ${order.status}; tickets are never issued from that state`,
          {
            code: WORKER_ERROR_CODES.INVALID_STATE,
            jobName: JOB_NAMES.ISSUE_TICKETS,
            details: { orderId, status: order.status },
          },
        )
      }

      const items = Array.isArray(order.items) ? order.items : []
      const shortfalls = items.map(shortfallFor)
      const existing = shortfalls.reduce((total, entry) => total + entry.existing, 0)
      const expected = items.reduce(
        (total, item) => total + (Number.isInteger(item.quantity) ? item.quantity : 0),
        0,
      )
      const needed = shortfalls.reduce((total, entry) => total + entry.needed, 0)

      if (needed === 0) {
        return { order, issued: 0, existing, expected, ticketIds: [] }
      }

      // Codes are drawn for the whole batch at once so uniqueness is checked
      // across items, not just within one.
      const codes = generateCodes(needed)
      /** @type {Array<{orderItemId: string, code: string, status: string, attendeeName: null}>} */
      const rows = []
      let cursor = 0

      for (const shortfall of shortfalls) {
        for (let index = 0; index < shortfall.needed; index += 1) {
          rows.push({
            orderItemId: shortfall.orderItemId,
            code: codes[cursor],
            status: 'VALID',
            // Attendee names are collected later, per ticket, by the buyer.
            attendeeName: null,
          })
          cursor += 1
        }
      }

      const created = await tx.ticket.createMany({ data: rows })
      const issued = Number.isInteger(created?.count) ? created.count : rows.length

      return {
        order,
        issued,
        existing,
        expected,
        ticketIds: Array.isArray(created?.ids) ? created.ids : [],
      }
    })

    const total = result.existing + result.issued

    logger?.info?.(
      {
        orderId,
        reference: result.order?.reference,
        issued: result.issued,
        existing: result.existing,
        expected: result.expected,
      },
      result.issued === 0 ? 'tickets already issued; nothing to do' : 'tickets issued',
    )

    // Ticket codes are bearer tokens and a job result is stored in Redis and
    // shown in dashboards, so the codes themselves never leave this function.
    return {
      orderId,
      issued: result.issued,
      existing: result.existing,
      total,
      expected: result.expected,
      complete: total >= result.expected,
      ticketIds: result.ticketIds,
    }
  }
}
