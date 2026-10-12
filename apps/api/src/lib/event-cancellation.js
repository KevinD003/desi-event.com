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
import { settleReferralUsesIfEnded } from './referral-uses.js'
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
 * @param {boolean} [options.deferReferralReturns] For a cancellation: leave the
 *   referral uses to the caller's own batch (a deletion runs one batch for its
 *   whole transaction) and only say which orders it held. Otherwise the uses
 *   of the orders that ended are given back here, in one batch after the last
 *   order write (SPEC3-XI XR4).
 * @returns {Promise<{orders: number, notifications: number, refunds: number, skippedZeroValue: number, skippedDisputed: number, disputedOrderIds: string[], referralCandidateOrderIds: string[]}>} Counts of what was created and what was not, which orders were left to their disputes, for the audit record, and which orders a cancellation held (for a deferred referral batch).
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
    deferReferralReturns = false,
  } = options
  const now = options.now ?? new Date()

  const orders = await tx.order.findMany({
    where: { eventId: event.id, status: { in: ['PENDING', 'PAID'] } },
    include: { payments: true },
  })

  const counts = { notifications: 0, refunds: 0, skippedZeroValue: 0 }
  /** @type {string[]} */
  const disputedOrderIds = []
  /**
   * The orders this cancellation held under their row lock and found PAID:
   * the ones that may have ended without being used (SPEC3-XI XR4).
   *
   * @type {string[]}
   */
  const referralCandidateOrderIds = []

  for (const read of orders) {
    let order = read

    // A PENDING order may be settling at this moment: a zero-online booking
    // (a referral code waived its whole fee) settles with no payment, and a
    // card order's capture may be committing. Skipping it unlocked would let
    // it become PAID on a cancelled event with nothing asked for it (SPEC3-XI
    // §2.3.7). So a cancellation waits for whatever holds it and reads what
    // it became: one now PAID is handled as a paid order; one still PENDING
    // is left as today, and a settlement that starts later reads the
    // committed cancellation. No cycle: the settlement holds its tiers and its
    // own order and waits for nothing this transaction holds (it takes no
    // event lock), and no referral code is held here yet.
    if (kind === 'CANCELLED' && read.status === 'PENDING') {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${read.id} FOR UPDATE`

      order =
        (await tx.order.findUnique({ where: { id: read.id }, include: { payments: true } })) ?? read
    }

    const atVenue = order.paymentMethod === 'AT_VENUE'

    // A card order's notice is written before its refund decision, as it
    // always was. A pay-at-the-venue order's is written after it, so the
    // notice can say what became of the booking fee paid online (SPEC3 §9.9).
    if (!atVenue || kind !== 'CANCELLED') {
      counts.notifications += await writeNotice(tx, {
        event,
        order,
        kind,
        reasonCode,
        reason,
        byPlatform,
      })
    }

    if (kind !== 'CANCELLED') continue

    if (PAID_STATUSES.has(order.status)) referralCandidateOrderIds.push(order.id)

    const decision = PAID_STATUSES.has(order.status)
      ? await refundDecision(tx, {
          event,
          order,
          kind,
          reason,
          actorId,
          requestId,
          via,
          now,
          counts,
          disputedOrderIds,
        })
      : { onlineRefund: 'NONE_PAID', current: null }

    if (atVenue) {
      counts.notifications += await writeVenueNotices(tx, {
        event,
        order,
        current: decision.current,
        onlineRefund: decision.onlineRefund,
        reasonCode,
        reason,
        byPlatform,
      })
    }
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

  // The referral uses of the orders that ended: one batch, after the last
  // order write of the loop above, so the codes are the transaction's last
  // locks, ascending (XR6). Returning them order by order inside the loop
  // would hold one code while locking the next order. A deletion runs its
  // own batch for the whole transaction instead.
  if (kind === 'CANCELLED' && !deferReferralReturns && referralCandidateOrderIds.length > 0) {
    await settleReferralUsesIfEnded(tx, {
      entries: referralCandidateOrderIds.map((orderId) => ({ orderId, cause: 'EVENT_CANCELLED' })),
      actorId,
      requestId,
      now,
    })
  }

  return {
    orders: orders.length,
    notifications: counts.notifications,
    refunds: counts.refunds,
    skippedZeroValue: counts.skippedZeroValue,
    skippedDisputed: disputedOrderIds.length,
    disputedOrderIds,
    referralCandidateOrderIds,
  }
}

/**
 * The one notice an order's buyer is sent about a cancellation or a
 * postponement. Keyed on the event and the order, so a second cancellation of
 * the same event writes nothing.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {object} options.event The event.
 * @param {object} options.order The order.
 * @param {'CANCELLED'|'POSTPONED'} options.kind Which change this is.
 * @param {string} options.reasonCode The machine-readable reason.
 * @param {string} options.reason The prose an attendee reads.
 * @param {boolean} options.byPlatform Whether the Desi-Event team made the change.
 * @param {object} [options.extra] More payload, for a pay-at-the-venue booking.
 * @returns {Promise<number>} How many rows were written (0 on a repeat).
 */
async function writeNotice(tx, { event, order, kind, reasonCode, reason, byPlatform, extra = {} }) {
  const recipient = order.buyerEmail

  // `buyerEmail` is required on an order, so this is belt and braces against
  // a fixture or a migration that ever made it optional.
  if (!recipient) return 0

  const created = await tx.notificationOutbox.createMany({
    data: [
      {
        template: TEMPLATES[kind],
        channel: 'EMAIL',
        recipient,
        userId: order.userId ?? null,
        // Stamped so a privacy redaction can find this row. The column has
        // existed since the Phase 2 commerce migration and no writer ever set
        // it, so every outbox row carried `organizationId: null` — and an
        // organisation-scoped scrub of delivery evidence matched nothing at
        // all while the recipient's address sat in the row. Delivery is
        // unaffected: the dispatcher never reads this column.
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
          ...extra,
        },
        dedupeKey: `${TEMPLATES[kind]}:${event.id}:${order.id}`,
        // Being told the event you bought a ticket for is cancelled is not
        // marketing, and a preference must not suppress it. Asked of the one
        // list rather than answered here, so a new call site cannot answer it
        // differently.
        suppressible: isSuppressible(TEMPLATES[kind]),
      },
    ],
    skipDuplicates: true,
  })

  return created.count
}

/**
 * Ask for a paid order's refund of everything it has left, under its row
 * lock, and say what became of the booking fee paid online for a
 * pay-at-the-venue order (SPEC3 §9.9's `onlineRefund`).
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {object} options.event The event.
 * @param {object} options.order The order as read.
 * @param {'CANCELLED'} options.kind The change.
 * @param {string} options.reason The prose an attendee reads.
 * @param {string|null} options.actorId Who did it.
 * @param {string|null} options.requestId For the audit trail.
 * @param {string} options.via What made it.
 * @param {Date} options.now The instant.
 * @param {{refunds: number, skippedZeroValue: number}} options.counts Counters, moved here.
 * @param {string[]} options.disputedOrderIds Orders left to their disputes, added to here.
 * @returns {Promise<{onlineRefund: 'REQUESTED'|'NONE_PAID'|'ALREADY_REFUNDED'|'FEE_KEPT'|'DISPUTED'|null, current: object|null}>} What became of the online part, and the order as it stands under its lock.
 */
async function refundDecision(tx, options) {
  const { event, order, kind, reason, actorId, requestId, via, now, counts, disputedOrderIds } =
    options

  // The order's row lock before its counters are read, so the reservation
  // below is made against the counters as they stand and a refund finance
  // is asking for at the same moment waits rather than racing it. Checkout
  // never locks an event, so taking the order after the event's status write
  // makes no cycle. (A PENDING order found PAID holds it already: a re-lock.)
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`

  const current = await tx.order.findUnique({
    where: { id: order.id },
    include: {
      items: { include: { tickets: true } },
      payments: { include: { disputes: true } },
    },
  })

  // Nothing left to give back: a free order, one whose whole fee a referral
  // code waived, one already refunded, or a booking whose fee left was kept
  // when its unpaid tickets were cancelled (SPEC3-XI XU6, never refunded).
  // Asked before the payment is looked for, because an order with nothing
  // paid online has none.
  if (refundableCents(current) <= 0) {
    counts.skippedZeroValue += 1

    const onlineRefund =
      current.totalCents <= 0
        ? 'NONE_PAID'
        : (current.venueFeeKeptCents ?? 0) > 0
          ? 'FEE_KEPT'
          : 'ALREADY_REFUNDED'

    return { onlineRefund, current }
  }

  const payment = current?.payments?.find((candidate) => candidate.status === 'SUCCEEDED')

  // A paid order with no succeeded payment is a reconciliation problem, not a
  // refund one, and inventing a refund against a payment that cannot be
  // found would be worse than leaving it visible.
  if (!payment) return { onlineRefund: null, current }

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

    return { onlineRefund: 'DISPUTED', current }
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

  if (created) counts.refunds += 1

  return { onlineRefund: 'REQUESTED', current }
}

/**
 * A cancelled pay-at-the-venue booking's notices (SPEC3 §9.9, SPEC3-XI XT7):
 * the buyer's, saying what became of the booking fee paid online and what was
 * paid at the door — by the buyer for the tickets they hold, and by people
 * they passed tickets to — and one more to each other account that paid at
 * the door for a ticket of the order, telling it that money is with the
 * organiser. Holders who paid nothing are told on their ticket page.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {object} options.event The event.
 * @param {object} options.order The order as read.
 * @param {object|null} options.current The order as it stands under its lock, with its lines and tickets, when it was paid.
 * @param {string|null} options.onlineRefund What became of the booking fee paid online.
 * @param {string} options.reasonCode The machine-readable reason.
 * @param {string} options.reason The prose an attendee reads.
 * @param {boolean} options.byPlatform Whether the Desi-Event team made the change.
 * @returns {Promise<number>} How many rows were written.
 */
async function writeVenueNotices(
  tx,
  { event, order, current, onlineRefund, reasonCode, reason, byPlatform },
) {
  const tickets = (current?.items ?? []).flatMap((item) => item.tickets ?? [])
  const door = doorMoneyOf(current, tickets)
  let written = await writeNotice(tx, {
    event,
    order,
    kind: 'CANCELLED',
    reasonCode,
    reason,
    byPlatform,
    extra: {
      atVenue: true,
      onlineRefund,
      paidAtDoorCents: door.buyerCents,
      paidAtDoorByOthersCents: door.othersCents,
      currency: order.currency,
    },
  })

  written += await writeHolderNotices(tx, {
    template: TEMPLATES.CANCELLED,
    holders: door.holders,
    event,
    order,
    currency: order.currency,
  })

  return written
}

/**
 * What was paid at the door for an order's tickets, split by who holds them:
 * the buyer's own (`buyerCents`), and each other account's, which paid for
 * the tickets it holds (XT7: a paid ticket has been let in and is never passed
 * on, so its holder paid for it).
 *
 * @param {{userId: string|null}|null} order The order.
 * @param {Array<{ownerUserId: string|null, venueDueCents?: number, venuePaymentId?: string|null}>} tickets Its tickets.
 * @returns {{buyerCents: number, othersCents: number, holders: Map<string, number>}} The sums, and each other holder's.
 */
export function doorMoneyOf(order, tickets) {
  const buyer = order?.userId ?? null
  const holders = new Map()
  let buyerCents = 0
  let othersCents = 0

  for (const ticket of tickets ?? []) {
    if (!ticket.venuePaymentId) continue

    const due = ticket.venueDueCents ?? 0
    const holder = ticket.ownerUserId ?? null

    if (holder === buyer) {
      buyerCents += due
    } else {
      othersCents += due

      if (holder) holders.set(holder, (holders.get(holder) ?? 0) + due)
    }
  }

  return { buyerCents, othersCents, holders }
}

/**
 * One notice per other account that paid at the door for a ticket of a
 * cancelled booking (SPEC3-XI XT7, §9.9): that the money is with the
 * organiser. Ids, the event's title and the amount; never anybody's address in
 * the payload. Keyed on the template, the event, the order and the holder, so
 * a second cancellation writes nothing.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {string} options.template `event.cancelled` or `event.session_cancelled`.
 * @param {Map<string, number>} options.holders Each paying holder's account id and what they paid.
 * @param {object} options.event The event.
 * @param {object} options.order The order.
 * @param {string} options.currency The order's currency.
 * @param {{id: string, label?: string|null}|null} [options.night] The night cancelled, for a night's notice.
 * @returns {Promise<number>} How many rows were written.
 */
export async function writeHolderNotices(
  tx,
  { template, holders, event, order, currency, night = null },
) {
  if (!holders || holders.size === 0) return 0

  const accounts = await tx.user.findMany({
    where: { id: { in: [...holders.keys()] } },
    select: { id: true, email: true },
  })
  const keyBase = night ? `${template}:${night.id}` : `${template}:${event.id}`
  let written = 0

  for (const account of [...accounts].sort((left, right) => (left.id < right.id ? -1 : 1))) {
    if (!account.email) continue

    const created = await tx.notificationOutbox.createMany({
      data: [
        {
          template,
          channel: 'EMAIL',
          recipient: account.email,
          userId: account.id,
          organizationId: event.organizationId,
          payload: {
            eventId: event.id,
            eventTitle: event.title,
            recipient: 'HOLDER',
            paidAtDoorCents: holders.get(account.id) ?? 0,
            currency,
            ...(night ? { sessionLabel: night.label ?? null } : {}),
          },
          dedupeKey: `${keyBase}:${order.id}:holder:${account.id}`,
          suppressible: isSuppressible(template),
        },
      ],
      skipDuplicates: true,
    })

    written += created.count
  }

  return written
}
