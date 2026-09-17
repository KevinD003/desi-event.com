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
 * **It does not refund anybody.** No refund service exists in this repository.
 * The rows it writes are `REQUESTED` — the first state of `RefundStatus`,
 * meaning somebody has asked and nothing has been sent to a provider — and they
 * stay that way until a refund workflow exists to move them. Nothing here
 * touches Stripe, and nothing here claims money has moved.
 *
 * That distinction is the point. A cancellation that silently marked refunds
 * complete would be a lie told to an organiser reading a dashboard, and the
 * attendee would find out first.
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
 * @returns {Promise<object>} Counts of what was created, for the audit record.
 */
export async function cancellationWork(tx, options) {
  const { event, kind, reasonCode, reason, actorId = null } = options

  const orders = await tx.order.findMany({
    where: { eventId: event.id, status: { in: ['PENDING', 'PAID'] } },
    include: { payments: true },
  })

  let notifications = 0
  let refunds = 0

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

    const payment = order.payments?.find((candidate) => candidate.status === 'SUCCEEDED')

    // A paid order with no succeeded payment is a reconciliation problem, not a
    // refund one, and inventing a refund against a payment that cannot be
    // found would be worse than leaving it visible.
    if (!payment) continue

    const created = await tx.refund.createMany({
      data: [
        {
          orderId: order.id,
          paymentId: payment.id,
          provider: payment.provider,
          amountCents: order.totalCents,
          currency: order.currency,
          reason: REFUND_REASONS[kind],
          reasonNote: reason,
          // REQUESTED, not SUCCEEDED and not even APPROVED. Nothing has been
          // sent anywhere. See the module docstring.
          status: 'REQUESTED',
          requestedById: actorId,
          idempotencyKey: `event-${kind.toLowerCase()}:${event.id}:${order.id}`,
        },
      ],
      skipDuplicates: true,
    })

    refunds += created.count
  }

  return { orders: orders.length, notifications, refunds }
}
