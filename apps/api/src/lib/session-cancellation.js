/**
 * Cancelling one night of a live event (SPEC2-XI X-N).
 *
 * The night becomes CANCELLED, which is final (`desi_event_session_cancel_is_final`).
 * Its ticket types close, its holds are released, its unpaid orders are
 * cancelled and its tickets are withdrawn, all in one transaction that locks
 * the event row first (the revision compare-and-set), then the night's ticket
 * types, then the night: the checkout's lock order, so a sale for that night
 * either commits first and is counted, or waits and then finds the night gone.
 *
 * Each paid order touching the night is owed something:
 *
 *   - every line on that night: a refund of everything the order has left;
 *   - lines on other nights too: a refund of that night's lines, with their
 *     share of the booking fee and the tax;
 *   - a line good for every night: nothing — the ticket is kept for the other
 *     nights, and its holder is told;
 *   - a free line: nothing to refund, the ticket is withdrawn;
 *   - a disputed payment: left to the finance team, as a cancelled event's is.
 *
 * The refunds are asked for and reserved in the transaction; after the commit
 * they are sent through the refund service (`lib/event-refunds.js`). Nothing in
 * the transaction calls a payment provider.
 *
 * @file @desi-event/api/lib/session-cancellation
 */

import { isSuppressible } from '@desi-event/notifications'
import { LIVE_STATUSES } from '@desi-event/schemas/lifecycle'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { assertSittingStillOpen, authorityAuditMetadata, byPlatform } from './event-authority.js'
import { recordChangeNotice } from './event-change-notices.js'
import {
  IN_FLIGHT_PAYMENT_STATES,
  cancelUnpaidOrders,
  nightHasStarted,
  releaseHoldsOf,
} from './event-deletion.js'
import { refundOwed } from './event-refunds.js'
import { httpError } from './errors.js'
import { lockTicketTypes } from './inventory.js'
import {
  REFUND_BLOCKING_DISPUTE_STATES,
  orderParts,
  partsLeft,
  partsSpokenFor,
  pendingLines,
  quoteNamedLines,
  refundableCents,
  requestRefund,
} from './refunds.js'
import { lockEventSessions } from './session-inventory.js'
import { SESSION_CANCELLED_PREFIX, withdrawTickets } from './tickets.js'
import { openReconciliation } from './webhook-handlers.js'

/** The template a night's cancellation notice is sent with. */
export const SESSION_CANCELLED_TEMPLATE = 'event.session_cancelled'

/** The sentence for each refusal. */
export const SESSION_CANCELLATION_SENTENCES = Object.freeze({
  NOT_LIVE:
    'Nights are cancelled only on a published event. Before it is published, remove the night instead; once the event is over or cancelled, its nights stay as they are.',
  NOT_EDITABLE: 'This night was cancelled.',
  SESSION_STARTED:
    'This night has started, or its doors open within the hour, so it can no longer be cancelled.',
  LAST_SESSION: 'This is the only night still on. Cancel or delete the event instead.',
  PAYMENT_IN_FLIGHT:
    'Somebody is paying for a ticket for this night right now. Try again in a few minutes. If this stays, the payment has to be resolved first.',
})

/** What a canceller is told when orders changed since the preview. */
export const ORDERS_CHANGED_SENTENCE =
  'Tickets for this night were bought or refunded since you opened this. Read what cancelling it does now.'

/**
 * What a night's cancellation did for one order, as its notice says it
 * (`event.session_cancelled`, `payload.outcome`). Each has its own sentence in
 * the worker's template, so nobody is told their tickets were free when they
 * paid for them.
 *
 * - `REFUNDED`: a refund of the night's tickets was asked for and reserved.
 * - `KEPT`: a ticket good for every night, kept for the others.
 * - `FREE`: a free order; its tickets for the night are withdrawn.
 * - `NOTHING_OWED`: a paid order with nothing left to refund for the night
 *   (already refunded, or a promo code left the night's tickets worth nothing).
 * - `DISPUTED`: the payment is disputed, so the refund is left to the finance
 *   team, who are given a reconciliation task.
 * - `UNPAID`: an unpaid order for the night, cancelled.
 * - `NOT_SENT`: a paid order with no payment to refund to; nothing was sent.
 */
export const NIGHT_OUTCOMES = Object.freeze([
  'REFUNDED',
  'KEPT',
  'FREE',
  'NOTHING_OWED',
  'DISPUTED',
  'UNPAID',
  'NOT_SENT',
])

/** Ticket states a night's cancellation withdraws. */
const WITHDRAWABLE = Object.freeze(['VALID', 'TRANSFER_PENDING'])

/** An order's lines as a night's cancellation reads them: tier, tickets and seats. */
const ORDER_LINES = Object.freeze({
  items: { include: { ticketType: true, tickets: { include: { eventSeat: true } } } },
})

/**
 * Whether an order line is for this night: its ticket type names the night, or
 * one of its tickets holds a seat on it.
 *
 * @param {object} item An order line with `ticketType` and `tickets[].eventSeat`.
 * @param {string} nightId The night.
 * @returns {boolean} True when the line is on the night.
 */
function lineOnNight(item, nightId) {
  if (item.ticketType?.eventSessionId === nightId) return true

  return (item.tickets ?? []).some((ticket) => ticket.eventSeat?.eventSessionId === nightId)
}

/**
 * Whether an order line is good for every night: its ticket type names none,
 * and none of its tickets holds a seat (which would pin it to one night).
 *
 * @param {object} item An order line with `ticketType` and `tickets[].eventSeat`.
 * @returns {boolean} True for a line good for every night.
 */
function lineEveryNight(item) {
  if (item.ticketType?.eventSessionId) return false

  return !(item.tickets ?? []).some((ticket) => ticket.eventSeat?.eventSessionId)
}

/**
 * Whether an order's payment is disputed in a way that stops a refund.
 *
 * @param {object} order An order with `payments[].disputes`.
 * @returns {boolean} True when one blocks.
 */
function disputed(order) {
  return (order.payments ?? []).some((payment) =>
    (payment.disputes ?? []).some((dispute) =>
      REFUND_BLOCKING_DISPUTE_STATES.includes(dispute.status),
    ),
  )
}

/**
 * The lines of an order to refund for the night: the night's lines with a
 * ticket left and a price, as many tickets as each has left.
 *
 * @param {object} order The order, with `items`.
 * @param {string} nightId The night.
 * @param {Map<string, number>} pendingByLine Tickets unresolved refunds already hold on each line.
 * @returns {Array<{orderItemId: string, quantity: number}>} The lines.
 */
function nightLines(order, nightId, pendingByLine = new Map()) {
  return (order.items ?? [])
    .filter((item) => lineOnNight(item, nightId) && item.unitPriceCents > 0)
    .map((item) => ({
      orderItemId: item.id,
      quantity: item.quantity - (item.refundedQuantity ?? 0) - (pendingByLine.get(item.id) ?? 0),
    }))
    .filter((line) => line.quantity > 0)
}

/**
 * Everything a night's cancellation is decided from.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object} event The event, with `id`, `status` and `sessions`.
 * @param {object} session The night.
 * @param {Date} now The instant.
 * @returns {Promise<object>} The facts, and a plan per touched order.
 */
export async function loadNightFacts(db, event, session, now) {
  const orders = await db.order.findMany({
    where: { eventId: event.id, status: { in: ['PENDING', 'PAID'] } },
    include: { ...ORDER_LINES, payments: { include: { disputes: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  /** @type {Array<{order: object, plan: string}>} */
  const plans = []
  let inFlight = 0
  let currency = null

  for (const order of orders) {
    const onNight = (order.items ?? []).some((item) => lineOnNight(item, session.id))
    const everyNight = (order.items ?? []).some(lineEveryNight)
    const touched = onNight || everyNight || order.eventSessionId === session.id

    if (!touched) continue

    if (order.status === 'PENDING') {
      const moving = (order.payments ?? []).some((payment) =>
        IN_FLIGHT_PAYMENT_STATES.includes(payment.status),
      )

      if (moving && (onNight || order.eventSessionId === session.id)) inFlight += 1

      plans.push({
        order,
        plan: onNight || order.eventSessionId === session.id ? 'CANCEL' : 'TELL',
      })
      continue
    }

    currency = currency ?? order.currency

    if (!onNight) {
      plans.push({ order, plan: 'TELL' })
      continue
    }

    if (order.totalCents === 0 || refundableCents(order) <= 0) {
      plans.push({ order, plan: 'ZERO' })
      continue
    }

    if (disputed(order)) {
      plans.push({ order, plan: 'DISPUTED' })
      continue
    }

    const whole = (order.items ?? []).every((item) => lineOnNight(item, session.id))

    if (whole) {
      plans.push({ order, plan: 'WHOLE' })
      continue
    }

    plans.push({
      order,
      plan: nightLines(order, session.id).length > 0 ? 'LINES' : 'ZERO',
    })
  }

  const nightTierIds = new Set(
    (event.ticketTypes ?? [])
      .filter((tier) => tier.eventSessionId === session.id)
      .map((tier) => tier.id),
  )

  const tickets = await db.ticket.findMany({
    where: {
      status: { in: [...WITHDRAWABLE] },
      orderItem: { order: { eventId: event.id } },
      OR: [
        { orderItem: { ticketTypeId: { in: [...nightTierIds] } } },
        { eventSeat: { eventSessionId: session.id } },
      ],
    },
    select: { id: true },
  })

  const checkIns = await db.checkIn.count({
    where: {
      OR: [
        { eventSessionId: session.id },
        { ticket: { orderItem: { ticketTypeId: { in: [...nightTierIds] } } } },
      ],
    },
  })

  const others = (event.sessions ?? []).filter(
    (other) => other.id !== session.id && other.status !== 'CANCELLED',
  )

  return {
    plans,
    touchedOrders: plans.length,
    inFlight,
    currency,
    ticketIds: tickets.map((ticket) => ticket.id),
    nightTierIds: [...nightTierIds],
    checkIns,
    started: checkIns > 0 || nightHasStarted(session, now),
    othersOn: others.length,
  }
}

/**
 * Whether the night may be cancelled now. Pure.
 *
 * @param {object} event The event, with `status`.
 * @param {object} session The night, with `status`.
 * @param {object} facts From {@link loadNightFacts}.
 * @returns {{refusal: {code: string, message: string}|null}} The refusal, if any.
 */
export function classifySessionCancellation(event, session, facts) {
  const refused = (code) => ({
    refusal: { code, message: SESSION_CANCELLATION_SENTENCES[code] },
  })

  if (session.status === 'CANCELLED') return refused('NOT_EDITABLE')
  if (!LIVE_STATUSES.has(event.status)) return refused('NOT_LIVE')
  if (facts.started) return refused('SESSION_STARTED')
  if (facts.othersOn === 0) return refused('LAST_SESSION')
  if (facts.inFlight > 0) return refused('PAYMENT_IN_FLIGHT')

  return { refusal: null }
}

/**
 * Count what a set of plans owes, for the preview.
 *
 * @param {object} db A Prisma client.
 * @param {object} facts From {@link loadNightFacts}.
 * @param {string} nightId The night.
 * @returns {Promise<{orders: number, ordersRefunded: number, ordersToldOnly: number, zeroValueOrders: number, disputedOrders: number, ordersCancelled: number, refundableCents: number}>} The counts:
 *   every touched order is in exactly one of the five, and `orders` is their
 *   sum, the number a cancellation sends back as `expectedOrders`.
 */
async function countPlans(db, facts, nightId) {
  const counts = {
    orders: facts.touchedOrders,
    ordersRefunded: 0,
    ordersToldOnly: 0,
    zeroValueOrders: 0,
    disputedOrders: 0,
    ordersCancelled: 0,
    refundableCents: 0,
  }

  for (const { order, plan } of facts.plans) {
    if (plan === 'CANCEL') counts.ordersCancelled += 1
    if (plan === 'TELL') counts.ordersToldOnly += 1
    if (plan === 'ZERO') counts.zeroValueOrders += 1
    if (plan === 'DISPUTED') counts.disputedOrders += 1

    if (plan === 'WHOLE') {
      counts.ordersRefunded += 1
      counts.refundableCents += refundableCents(order)
    }

    if (plan === 'LINES') {
      const amount = await linesAmount(db, order, nightId)

      if (amount > 0) {
        counts.ordersRefunded += 1
        counts.refundableCents += amount
      } else {
        counts.zeroValueOrders += 1
      }
    }
  }

  return counts
}

/**
 * The refund of an order's tickets for the night: which lines, and what they
 * come to with their share of the fee and the tax. Worked out by
 * `quoteNamedLines`, the working `requestRefund` reserves, with the face value
 * brought down to what the order has left (`capFaceToLeft`): a sum refunded
 * earlier without tickets already paid part of them back, and the night's
 * cancellation refunds the rest rather than refusing them.
 *
 * Lines worth nothing — free tickets, or tickets a promo code or earlier
 * refunds left nothing on — come to 0. Every other refusal is thrown.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object} order The order, with its lines as {@link ORDER_LINES} reads them.
 * @param {string} nightId The night.
 * @returns {Promise<{lines: Array<{orderItemId: string, quantity: number}>, amountCents: number}>} The lines, and cents; 0 when there is nothing to refund.
 */
async function nightRefundQuote(db, order, nightId) {
  const pending = await pendingLines(db, order.id)
  const lines = nightLines(order, nightId, pending.quantities)

  if (lines.length === 0) return { lines, amountCents: 0 }

  const parts = orderParts(order)
  const left = partsLeft(parts, await partsSpokenFor(db, order))
  const quoted = quoteNamedLines({
    items: order.items ?? [],
    lines,
    pending,
    discountCents: order.discountCents ?? 0,
    parts,
    left,
    capFaceToLeft: true,
  })

  if (quoted.named.amountCents <= 0) return { lines, amountCents: 0 }

  return { lines, amountCents: Math.min(refundableCents(order), quoted.amountCents) }
}

/**
 * What a lines refund of the night's lines would come to, fee and tax share
 * included: worked out as `requestRefund` works it out, without reserving.
 *
 * @param {object} db A Prisma client.
 * @param {object} order The order, with `items`.
 * @param {string} nightId The night.
 * @returns {Promise<number>} Cents; 0 when the lines are worth nothing.
 */
async function linesAmount(db, order, nightId) {
  const { amountCents } = await nightRefundQuote(db, order, nightId)

  return amountCents
}

/**
 * What cancelling this night would do now, as the preview answers it.
 *
 * @param {object} db A Prisma client.
 * @param {object} options Options.
 * @param {object} options.event The event, with `sessions`, `ticketTypes` and `revision`.
 * @param {object} options.session The night.
 * @param {{permitted: boolean, missing: string|null}} options.access Whether the reader may.
 * @param {string} [options.paymentMode] The payment mode.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<object>} A payload satisfying `sessionCancellationPreviewSchema`.
 */
export async function sessionCancellationPreview(db, options) {
  const { event, session, access, paymentMode = 'MOCK', now = new Date() } = options
  const facts = await loadNightFacts(db, event, session, now)
  const { refusal } = classifySessionCancellation(event, session, facts)
  const counts = await countPlans(db, facts, session.id)

  return {
    sessionId: session.id,
    revision: event.revision ?? 0,
    permitted: refusal ? false : access.permitted,
    missing: refusal ? null : access.missing,
    refusal,
    ...counts,
    ticketsWithdrawn: facts.ticketIds.length,
    currency: facts.currency,
    paymentMode: ['MOCK', 'STRIPE_TEST', 'LIVE'].includes(paymentMode) ? paymentMode : 'MOCK',
  }
}

/**
 * Cancel one night (SPEC2-XI X-N), then send the refunds it owes.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {object} options.event The event as loaded.
 * @param {object} options.session The night, as loaded.
 * @param {object} options.actor The request actor.
 * @param {object|null} options.authority From `resolveEventAuthority`.
 * @param {string|null} [options.sessionId] The request's session id, for the sitting's re-check.
 * @param {object} options.body `revision`, `reason`, `confirm`, `expectedOrders`.
 * @param {object} options.providers The provider registry, for the refunds after the commit.
 * @param {string} [options.paymentMode] The payment mode.
 * @param {Date} [options.now] The instant.
 * @param {string|null} [options.requestId] For the audit trail.
 * @returns {Promise<{session: object, refunds: object|null, refundError: unknown, counts: object}>} The night as it now is, and what the first refund pass did.
 * @throws {Error} 409 with the refusal's code, `ORDERS_CHANGED` or `STALE_REVISION`; 403 when a sitting closed.
 */
export async function cancelSession(prisma, options) {
  const {
    event,
    session,
    actor,
    authority = null,
    sessionId = null,
    body,
    providers,
    paymentMode = 'MOCK',
    now = new Date(),
    requestId = null,
  } = options
  const reason = String(body.reason).trim()
  const actorId = actor?.id ?? null
  const platform = byPlatform(authority)

  const counts = await prisma.$transaction(async (tx) => {
    // 1. The event row first.
    const { count } = await tx.event.updateMany({
      where: { id: event.id, revision: body.revision, status: event.status },
      data: { revision: { increment: 1 } },
    })

    if (count !== 1) {
      const current = await tx.event.findUnique({
        where: { id: event.id },
        select: { revision: true, status: true },
      })

      throw httpError(
        409,
        'STALE_REVISION',
        'This event changed since you opened this. Reload and read what cancelling the night does now.',
        {
          expectedRevision: body.revision,
          currentRevision: current?.revision ?? null,
          currentStatus: current?.status ?? null,
        },
      )
    }

    await assertSittingStillOpen(tx, authority, { sessionId, now: new Date() })

    // 2. The night's ticket types, then the night.
    const nightTiers = await tx.ticketType.findMany({
      where: { eventId: event.id, eventSessionId: session.id },
      select: { id: true },
    })

    await lockTicketTypes(
      tx,
      nightTiers.map((tier) => tier.id),
    )
    await lockEventSessions(tx, [session.id])

    // 3. Decided again, from what the locks hold.
    const locked = await tx.event.findUnique({
      where: { id: event.id },
      include: { sessions: true, ticketTypes: true },
    })
    const night = locked.sessions.find((candidate) => candidate.id === session.id)

    if (!night) throw httpError(404, 'NOT_FOUND', 'No such session on this event.')

    const facts = await loadNightFacts(tx, locked, night, now)
    const { refusal } = classifySessionCancellation(locked, night, facts)

    if (refusal) {
      throw httpError(409, refusal.code, refusal.message, { refusal: refusal.code })
    }

    if (facts.touchedOrders !== body.expectedOrders) {
      throw httpError(409, 'ORDERS_CHANGED', ORDERS_CHANGED_SENTENCE, {
        expectedOrders: body.expectedOrders,
        orders: facts.touchedOrders,
      })
    }

    // 4. The night, cancelled. Final.
    await tx.eventSession.update({
      where: { id: night.id },
      data: { status: 'CANCELLED', cancelledAt: now, cancellationReason: reason },
    })

    // 5. Its ticket types close and its holds go back.
    await tx.ticketType.updateMany({
      where: { id: { in: facts.nightTierIds }, status: { not: 'CLOSED' } },
      data: { status: 'CLOSED' },
    })

    const holdsReleased = await releaseHoldsOf(tx, facts.nightTierIds, {
      now,
      reason: 'SESSION_CANCELLED',
      actorId,
      sessionId: night.id,
    })

    // 6. Its unpaid orders nobody is paying for.
    const pendingIds = facts.plans
      .filter((entry) => entry.plan === 'CANCEL')
      .map((entry) => entry.order.id)
    let ordersCancelled = 0

    if (pendingIds.length > 0) {
      ordersCancelled = await cancelUnpaidOrders(tx, {
        where: { id: { in: pendingIds } },
        reason: 'SESSION_CANCELLED',
        now,
        actorId,
        requestId,
      })
    }

    // 7. Its tickets, withdrawn.
    const ticketsWithdrawn = await withdrawTickets(tx, {
      ticketIds: facts.ticketIds,
      reason: `${SESSION_CANCELLED_PREFIX}${night.id}`,
      now,
    })

    // 8. The refunds, asked for and reserved.
    let refundsReserved = 0
    let zeroValue = 0
    let disputedOrders = 0
    let toldOnly = 0
    /** @type {Map<string, string>} One of {@link NIGHT_OUTCOMES} per touched order. */
    const outcomes = new Map()

    for (const { order, plan } of facts.plans) {
      if (plan === 'CANCEL') {
        outcomes.set(order.id, 'UNPAID')
        continue
      }

      if (plan === 'TELL') {
        toldOnly += 1
        outcomes.set(order.id, 'KEPT')
        continue
      }

      if (plan === 'ZERO') {
        zeroValue += 1
        outcomes.set(order.id, order.totalCents === 0 ? 'FREE' : 'NOTHING_OWED')
        continue
      }

      if (plan === 'DISPUTED') {
        disputedOrders += 1
        outcomes.set(order.id, 'DISPUTED')
        // Left to the dispute, and put in front of the finance team as a
        // cancelled event's disputed order is (`cancellationWork`): if the
        // dispute is won, this buyer is still owed the night.
        await openDisputeTask(tx, { order, event: locked, night })
        continue
      }

      if (plan !== 'WHOLE' && plan !== 'LINES') continue

      const payment = order.payments?.find((candidate) => candidate.status === 'SUCCEEDED')

      if (!payment) {
        outcomes.set(order.id, 'NOT_SENT')
        continue
      }

      const asked = await askRefund(tx, {
        order,
        payment,
        plan,
        nightId: night.id,
        reason,
        actorId,
        requestId,
        now,
      })

      if (asked === null) {
        zeroValue += 1
        outcomes.set(order.id, 'NOTHING_OWED')
        continue
      }

      if (asked) refundsReserved += 1
      outcomes.set(order.id, 'REFUNDED')
    }

    // 9. One notice per touched order.
    let notifications = 0

    for (const { order } of facts.plans) {
      if (!order.buyerEmail) continue

      const outcome = outcomes.get(order.id) ?? 'NOT_SENT'
      const created = await tx.notificationOutbox.createMany({
        data: [
          {
            template: SESSION_CANCELLED_TEMPLATE,
            channel: 'EMAIL',
            recipient: order.buyerEmail,
            userId: order.userId ?? null,
            organizationId: locked.organizationId,
            // Ids and prose only: no token, no secret, no payment detail.
            payload: {
              eventId: locked.id,
              eventTitle: locked.title,
              orderId: order.id,
              orderReference: order.reference ?? null,
              sessionId: night.id,
              sessionLabel: night.label ?? null,
              sessionStartsAt: new Date(night.startsAt).toISOString(),
              reason,
              outcome,
              refunded: outcome === 'REFUNDED',
              keptEveryNight: outcome === 'KEPT',
              byPlatform: platform,
            },
            dedupeKey: `session-cancelled:${night.id}:${order.id}`,
            suppressible: isSuppressible(SESSION_CANCELLED_TEMPLATE),
          },
        ],
        skipDuplicates: true,
      })

      notifications += created.count
    }

    // 10. What ticket holders are shown.
    await recordChangeNotice(tx, {
      event: locked,
      kind: 'SESSION_CANCELLED',
      fields: ['sessions'],
      changed: ['a night'],
      before: { startsAt: new Date(night.startsAt).toISOString() },
      after: null,
      reason,
      session: night,
      byPlatform: platform,
      revision: locked.revision ?? null,
    })

    const summary = {
      orders: facts.touchedOrders,
      refundsReserved,
      ordersToldOnly: toldOnly,
      zeroValueOrders: zeroValue,
      disputedOrders,
      ordersCancelled,
      holdsReleased,
      ticketsWithdrawn,
      notifications,
    }

    // 11. The record.
    await recordAudit(tx, {
      action: AUDIT_ACTIONS.EVENT_SESSION_CANCELLED,
      entityType: 'Event',
      entityId: locked.id,
      actorId,
      metadata: {
        ...authorityAuditMetadata(authority),
        requestId,
        sessionId: night.id,
        reason,
        revision: locked.revision ?? null,
        counts: summary,
      },
    })

    return summary
  })

  let refunds = null
  let refundError = null

  try {
    refunds = await refundOwed(prisma, {
      event,
      actor,
      providers,
      via: 'session_cancellation',
      sessionId: session.id,
      paymentMode,
      now,
      requestId,
    })
  } catch (error) {
    refundError = error
  }

  const cancelled = await prisma.eventSession.findUnique({ where: { id: session.id } })

  return { session: cancelled, refunds, refundError, counts }
}

/**
 * Put a disputed order on a cancelled night in front of the finance team.
 *
 * The same `PROVIDER_MISMATCH` task a cancelled event's disputed order gets:
 * no refund was asked for, because the dispute decides where the money goes,
 * and if the dispute is won the buyer is still owed the night's tickets.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {object} options.order The order, with `payments[].disputes`.
 * @param {object} options.event The event, locked.
 * @param {object} options.night The night cancelled.
 * @returns {Promise<void>} Resolves once the task is open (or counted again).
 */
async function openDisputeTask(tx, { order, event, night }) {
  const blocking = (payment) =>
    (payment.disputes ?? []).find((dispute) =>
      REFUND_BLOCKING_DISPUTE_STATES.includes(dispute.status),
    )
  const payment = (order.payments ?? []).find(blocking)

  if (!payment) return

  await openReconciliation(tx, {
    kind: 'PROVIDER_MISMATCH',
    paymentId: payment.id,
    orderId: order.id,
    providerRef: payment.providerRef ?? null,
    organizationId: event.organizationId,
    localState: {
      orderStatus: order.status,
      paymentStatus: payment.status,
      disputeStatus: blocking(payment).status,
      eventStatus: event.status,
      sessionId: night.id,
      refundableCents: refundableCents(order),
      currency: order.currency,
    },
    lastError:
      'A night of the event was cancelled while this payment was disputed, so no refund was asked for. If the dispute is won, refund the order’s tickets for that night, then note this task.',
  })
}

/**
 * Ask for one order's refund for the night, under its row lock, from the order
 * as it stands under that lock.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {object} options.order The order as the night's facts read it; only its id is relied on.
 * @param {object} options.payment Its succeeded payment.
 * @param {'WHOLE'|'LINES'} options.plan Whether the whole order is refunded, or only its lines for the night.
 * @param {string} options.nightId The night cancelled.
 * @param {string} options.reason Why, as the organiser or the Desi-Event team wrote it.
 * @param {string|null} options.actorId Who cancelled it.
 * @param {string|null} options.requestId For the audit trail.
 * @param {Date} options.now The instant.
 * @returns {Promise<boolean|null>} True when asked for now, false when it already was (a retry), null when there is nothing to refund.
 */
async function askRefund(tx, { order, payment, plan, nightId, reason, actorId, requestId, now }) {
  const common = {
    order,
    payment,
    reason: 'EVENT_CANCELLED',
    reasonNote: reason,
    idempotencyKey: `session-cancelled:${nightId}:${order.id}`,
    actorId,
    requestId,
    via: 'session_cancellation',
    now,
  }

  // The order's lock first, then the order as it stands under it. The plan
  // was read before this lock: a refund of this order that settled since then
  // moved its counters and its lines, and asking from the old copy would name
  // a ticket that has gone, or an amount that is no longer there.
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`

  // Asked for already: a retry, answered as `requestRefund` answers one.
  const asked = await tx.refund.findUnique({
    where: { idempotencyKey: common.idempotencyKey },
    select: { id: true },
  })

  if (asked) return false

  const current = await tx.order.findUnique({ where: { id: order.id }, include: ORDER_LINES })

  if (!current || refundableCents(current) <= 0) return null

  if (plan === 'WHOLE') {
    const { created } = await requestRefund(tx, { ...common, whole: true })

    return created
  }

  // Lines worth nothing (free, or left nothing by a promo code or by earlier
  // refunds) are withdrawn and not refunded. That is decided here, before
  // asking: any refusal of the request itself is a fault, and is thrown, so a
  // withdrawn ticket is never left without its refund and called nothing owed.
  const { lines, amountCents } = await nightRefundQuote(tx, current, nightId)

  if (lines.length === 0 || amountCents <= 0) return null

  // Only the night's lines, for no more face value than the order has left,
  // and never promoted to a refund of everything: the order's tickets for its
  // other nights, free ones and every-night passes included, are kept.
  const { created } = await requestRefund(tx, {
    ...common,
    lines,
    capFaceToLeft: true,
    promoteToWhole: false,
  })

  return created
}
