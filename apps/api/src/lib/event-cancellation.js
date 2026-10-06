/**
 * What a cancellation or postponement owes, and how it is recorded.
 *
 * Cancelling an event is a financial act. Every paid order against it becomes
 * money somebody is owed, and every order — paid or not — becomes a person who
 * needs telling. Both obligations are created here, in the same transaction as
 * the status change, because an event that is cancelled with no refund work
 * owed is worse than an event that is not cancelled at all.
 *
 * ## What this does not do
 *
 * **It does not send a refund.** For each paid order it asks for one through
 * the refund service (`requestRefund` in `./refunds.js`), for everything the
 * order has left: the row is `REQUESTED`, the amount is reserved against the
 * order in this transaction, and its lines and its split across face value,
 * fee and tax are written with it — so finance approves and submits it like
 * any other refund, and it can settle. Nothing here calls a provider, and
 * nothing here claims money has moved.
 *
 * That distinction is the point. A cancellation that silently marked refunds
 * complete would be a lie told to an organiser reading a dashboard, and the
 * attendee would find out first.
 *
 * Two kinds of paid order get no refund here, and are counted instead: one
 * with nothing left to refund (a free order, or one already refunded), and one
 * whose payment is disputed — the dispute decides where that money goes, and
 * a refund beside it would pay the buyer twice. The counts, and which orders
 * were disputed, go back to the caller for the cancellation's audit record,
 * and each disputed order gets a `PROVIDER_MISMATCH` reconciliation task: if
 * the dispute is won, the buyer of a cancelled event is still owed their money,
 * and nothing else would bring the order back to anybody's attention.
 *
 * ## Its budget
 *
 * The work grows with the event: a refund is reserved for every paid order,
 * each under that order's row lock, in the same transaction as the status
 * change. Prisma's default of five seconds covers a few hundred orders, so the
 * transaction is given a budget sized to the orders it will touch
 * ({@link cancellationTransactionOptions}); one that still runs out is rolled
 * back whole and refused as a 503, and the event stays as it was.
 *
 * **It makes no provider call.** It runs inside a database transaction, and a
 * network call inside a transaction holds a connection open across somebody
 * else's outage. The worker performs the sending, after the commit.
 *
 * ## Idempotence
 *
 * Both tables carry a unique key, and both keys are derived from the event and
 * the order rather than generated. Cancelling twice — a double-clicked button,
 * a retried job, a replayed request — produces the same keys and the second
 * write is skipped rather than duplicated. That is what "exactly once" means
 * here: not that the code runs once, but that running it twice leaves the same
 * rows.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath (it is how JSDoc names an event), so a path segment spelled
 * exactly that fails `jsdoc/valid-types`. The same limitation is why
 * `apps/web/src/app/organizer/venues/new/page.jsx` uses `@file` too.
 *
 * @file @desi-event/api/lib/event-cancellation
 */

import { isSuppressible } from '@desi-event/notifications'

import { recordChangeNotice } from './event-change-notices.js'
import { REFUND_BLOCKING_DISPUTE_STATES, refundableCents, requestRefund } from './refunds.js'
import { openReconciliation } from './webhook-handlers.js'

/**
 * The transaction budget for a cancellation or postponement.
 *
 * `baseMs` covers the status change and the audit; `perOrderMs` covers one
 * order's notice and refund reservation with a wide margin (about 15 ms each
 * on a local database, measured on 2026-09-30, and more across a network).
 * `maxWaitMs` is how long to wait for a connection to start the transaction.
 *
 * @type {Readonly<{baseMs: number, perOrderMs: number, maxWaitMs: number}>}
 */
export const CANCELLATION_BUDGET = Object.freeze({
  baseMs: 10_000,
  perOrderMs: 100,
  maxWaitMs: 5_000,
})

/**
 * The transaction options a cancellation or postponement of this event needs.
 *
 * Counted before the transaction starts, from the orders the work will touch.
 * An order placed in between is covered by the base.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} eventId Which event.
 * @returns {Promise<{timeout: number, maxWait: number}>} For `prisma.$transaction`.
 */
export async function cancellationTransactionOptions(prisma, eventId) {
  const orders = await prisma.order.count({
    where: { eventId, status: { in: ['PENDING', 'PAID'] } },
  })

  return {
    timeout: CANCELLATION_BUDGET.baseMs + CANCELLATION_BUDGET.perOrderMs * orders,
    maxWait: CANCELLATION_BUDGET.maxWaitMs,
  }
}

/**
 * Order statuses that represent money actually taken.
 *
 * A `PENDING` order never charged anybody, so it is cancelled rather than
 * refunded. An already-`REFUNDED` one has been dealt with.
 *
 * @type {ReadonlySet<string>}
 */
const PAID_STATUSES = Object.freeze(new Set(['PAID']))

/**
 * The refund reason a lifecycle change implies.
 *
 * @type {Readonly<Record<string, string>>}
 */
const REFUND_REASONS = Object.freeze({
  CANCELLED: 'EVENT_CANCELLED',
  POSTPONED: 'EVENT_POSTPONED',
})

/**
 * The notification template a lifecycle change implies.
 *
 * @type {Readonly<Record<string, string>>}
 */
const TEMPLATES = Object.freeze({
  CANCELLED: 'event.cancelled',
  POSTPONED: 'event.postponed',
})

/**
 * Raise the notification and refund work a cancellation or postponement owes.
 *
 * @param {object} tx A Prisma transaction client. Never the bare client: this
 *   must commit with the status change or not at all.
 * @param {object} options Options.
 * @param {object} options.event The event, already moved to its new status.
 * @param {'CANCELLED'|'POSTPONED'} options.kind Which change this is.
 * @param {string} options.reasonCode The machine-readable reason.
 * @param {string} options.reason The prose an attendee reads.
 * @param {string|null} [options.actorId] Who did it.
 * @param {string|null} [options.requestId] For the audit trail.
 * @param {Date} [options.now] The instant.
 * @param {boolean} [options.byPlatform] Whether the Desi-Event team made the change
 *   (a SUPER_ADMIN under Rule L, or a deletion): the notices say so, never who.
 * @param {string|null} [options.via] What made it, when not the command itself
 *   (`event_deletion`), carried on the refunds' audit rows.
 * @returns {Promise<{orders: number, notifications: number, refunds: number, skippedZeroValue: number, skippedDisputed: number, disputedOrderIds: string[]}>} Counts of what was created and what was not, and which orders were left to their disputes, for the audit record.
 */
export async function cancellationWork(tx, options) {
  const {
    event,
    kind,
    reasonCode,
    reason,
    actorId = null,
    requestId = null,
    byPlatform = false,
    via = 'event_cancellation',
  } = options
  const now = options.now ?? new Date()

  const orders = await tx.order.findMany({
    where: { eventId: event.id, status: { in: ['PENDING', 'PAID'] } },
    include: { payments: true },
  })

  let notifications = 0
  let refunds = 0
  let skippedZeroValue = 0
  /** @type {string[]} */
  const disputedOrderIds = []

  for (const order of orders) {
    // One notice per order per kind of change. Keyed on the event and the
    // order, so a second cancellation of the same event writes nothing.
    const dedupeKey = `${TEMPLATES[kind]}:${event.id}:${order.id}`
    const recipient = order.buyerEmail

    if (recipient) {
      // `buyerEmail` is required on an order, so this is belt and braces
      // against a fixture or a migration that ever made it optional.
      const created = await tx.notificationOutbox.createMany({
        data: [
          {
            template: TEMPLATES[kind],
            channel: 'EMAIL',
            recipient,
            userId: order.userId ?? null,
            // Stamped so a privacy redaction can find this row. The column
            // has existed since the Phase 2 commerce migration and no writer
            // ever set it, so every outbox row carried `organizationId: null`
            // — and an organisation-scoped scrub of delivery evidence matched
            // nothing at all while the recipient's address sat in the row.
            // Delivery is unaffected: the dispatcher never reads this column.
            organizationId: event.organizationId,
            // Ids and prose only. No token, no secret, no payment detail: the
            // outbox row is read by a worker and by anybody debugging it.
            payload: {
              eventId: event.id,
              eventTitle: event.title,
              orderId: order.id,
              orderReference: order.reference ?? null,
              reasonCode,
              reason,
              previousStartsAt: event.previousStartsAt?.toISOString() ?? null,
              startsAt: event.startsAt?.toISOString() ?? null,
              byPlatform: Boolean(byPlatform),
            },
            dedupeKey,
            // Being told the event you bought a ticket for is cancelled is not
            // marketing, and a preference must not suppress it. Asked of the
            // one list rather than answered here, so a new call site cannot
            // answer it differently.
            suppressible: isSuppressible(TEMPLATES[kind]),
          },
        ],
        skipDuplicates: true,
      })

      notifications += created.count
    }

    if (kind !== 'CANCELLED') continue
    if (!PAID_STATUSES.has(order.status)) continue

    // The order's row lock before its counters are read, so the reservation
    // below is made against the counters as they stand and a refund finance
    // is asking for at the same moment waits rather than racing it. Checkout
    // never locks an event, so taking the order after the event's status write
    // makes no cycle.
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`

    const current = await tx.order.findUnique({
      where: { id: order.id },
      include: { items: true, payments: { include: { disputes: true } } },
    })

    // Nothing left to give back: a free order, or one already refunded. Asked
    // before the payment is looked for, because a free order has none.
    if (refundableCents(current) <= 0) {
      skippedZeroValue += 1
      continue
    }

    const payment = current?.payments?.find((candidate) => candidate.status === 'SUCCEEDED')

    // A paid order with no succeeded payment is a reconciliation problem, not a
    // refund one, and inventing a refund against a payment that cannot be
    // found would be worse than leaving it visible.
    if (!payment) continue

    // The dispute decides where this money goes. Left to the finance team, and
    // put in front of them: if the dispute is won, this buyer is still owed a
    // refund for an event that will not happen.
    const dispute = (payment.disputes ?? []).find((candidate) =>
      REFUND_BLOCKING_DISPUTE_STATES.includes(candidate.status),
    )

    if (dispute) {
      disputedOrderIds.push(order.id)

      await openReconciliation(tx, {
        kind: 'PROVIDER_MISMATCH',
        paymentId: payment.id,
        orderId: order.id,
        providerRef: payment.providerRef ?? null,
        organizationId: event.organizationId,
        localState: {
          orderStatus: current.status,
          paymentStatus: payment.status,
          disputeStatus: dispute.status,
          eventStatus: kind,
          refundableCents: refundableCents(current),
          currency: current.currency,
        },
        lastError:
          'The event was cancelled while this payment was disputed, so no refund was asked for. If the dispute is won, refund what is left of the order, then note this task.',
      })

      continue
    }

    // REQUESTED, not SUCCEEDED and not even APPROVED: nothing has been sent
    // anywhere. Reserved, with its lines and its split, so it can settle. The
    // key is derived from the event and the order, so doing this twice asks
    // once.
    const { created } = await requestRefund(tx, {
      order: current,
      payment,
      whole: true,
      reason: REFUND_REASONS[kind],
      reasonNote: reason,
      idempotencyKey: `event-${kind.toLowerCase()}:${event.id}:${order.id}`,
      actorId,
      requestId,
      via,
      now,
    })

    if (created) refunds += 1
  }

  // What holders are shown on their order and ticket pages: one notice for the
  // change, written here and nowhere else for these two kinds (SPEC2-XI X-C).
  await recordChangeNotice(tx, {
    event,
    kind,
    fields: kind === 'POSTPONED' ? ['startsAt'] : [],
    changed: kind === 'POSTPONED' ? ['the date'] : [],
    before:
      kind === 'POSTPONED' && event.previousStartsAt
        ? { startsAt: event.previousStartsAt.toISOString() }
        : null,
    after: null,
    reason,
    byPlatform,
  })

  return {
    orders: orders.length,
    notifications,
    refunds,
    skippedZeroValue,
    skippedDisputed: disputedOrderIds.length,
    disputedOrderIds,
  }
}
