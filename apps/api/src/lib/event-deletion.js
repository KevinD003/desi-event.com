/**
 * Deleting and restoring an event (SPEC2-XI X-D, X-T).
 *
 * Deletion is a soft delete: the event becomes DELETED, which is outside every
 * allow-list of statuses the public surfaces, the door, checkout and the
 * pictures read, and keeps its orders, tickets, refunds, history and pictures,
 * so the Desi-Event team can restore it.
 *
 * What deleting does depends on what was sold ({@link classifyDeletion}):
 *
 *   - **REMOVE** — nobody holds a paid order: the event's holds are released,
 *     its unpaid orders cancelled, the tickets of its free orders withdrawn;
 *   - **CANCEL_AND_REFUND** — paid orders and the event has not taken place (or
 *     was postponed or cancelled): it is cancelled first, with the notices and
 *     a reserved refund of everything left for every paid order whose payment
 *     is not disputed, its tickets are withdrawn, and after the commit the
 *     refunds are sent (`lib/event-refunds.js`);
 *   - **REMOVE_AFTER_EVENT** — it has taken place: its page comes down, and
 *     orders and tickets stay as they are.
 *
 * The preview and the commit compute the same thing; the commit computes it
 * again, inside one transaction that locks the event row first (the revision
 * compare-and-set), then its ticket types, then its nights, so a sale that
 * lands meanwhile either commits first and is counted, or waits on a tier lock
 * and then finds the event gone.
 *
 * Nothing in the transaction calls a payment provider.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc namepath.
 *
 * @file @desi-event/api/lib/event-deletion
 */

import { CAPABILITIES } from '@desi-event/permissions'
import { NIGHT_START_MARGIN_MINUTES } from '@desi-event/schemas/event-control'
import {
  DELETION_OUTCOME_COLUMN,
  LIVE_STATUSES,
  PUBLICLY_VISIBLE_STATUSES,
  findTransition,
  restoreTarget,
} from '@desi-event/schemas/lifecycle'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import {
  AUTHORITY_KINDS,
  authorityAuditMetadata,
  endSittingsOnDeletion,
  memberHolds,
  platformHolds,
} from './event-authority.js'
import { clearAttendeeStaging } from './checkout.js'
import { cancellationWork } from './event-cancellation.js'
import { recordChangeNotice } from './event-change-notices.js'
import { lifecycleStamps } from './event-lifecycle.js'
import { eventRefundPrefix, refundOwed } from './event-refunds.js'
import { forbidden, httpError } from './errors.js'
import { disambiguateSlug } from './identifiers.js'
import { lockTicketTypes } from './inventory.js'
import { REFUND_BLOCKING_DISPUTE_STATES, refundableCents, requestRefund } from './refunds.js'
import { releaseSeats } from './seating.js'
import { lockEventSessions } from './session-inventory.js'
import { EVENT_DELETED_PREFIX, withdrawTickets } from './tickets.js'
import { TRANSACTION_BUDGETS, budgetedTransaction, liveOrderCount } from './transaction-budget.js'
import { isEligible } from './verification.js'

/** A night counts as started this long before its doors (or its start). */
export const NIGHT_START_MARGIN_MS = NIGHT_START_MARGIN_MINUTES * 60_000

/** Payment states of an order's payment that mean money may be moving now. */
export const IN_FLIGHT_PAYMENT_STATES = Object.freeze([
  'INITIATED',
  'PENDING',
  'TIMEOUT',
  'REQUIRES_ACTION',
  // A payment that succeeded on an order still PENDING has not been applied
  // yet: the webhook that marks the order paid is on its way.
  'SUCCEEDED',
])

/** Payment states that leave a PENDING order safe to cancel. */
const DEAD_PAYMENT_STATES = Object.freeze(['FAILED', 'CANCELLED'])

/** Ticket states a deletion withdraws. */
const WITHDRAWABLE_TICKET_STATES = Object.freeze(['VALID', 'TRANSFER_PENDING'])

/** Ticket states counted as tickets someone holds. */
const HELD_TICKET_STATES = Object.freeze(['VALID', 'TRANSFER_PENDING', 'CHECKED_IN'])

/** Statuses that cannot have paid orders: one found there is a fault (case 5). */
const NO_ORDER_STATUSES = Object.freeze(
  new Set(['DRAFT', 'CHANGES_REQUIRED', 'REVIEW_PENDING', 'APPROVED', 'REJECTED']),
)

/** The sentence for each refusal. */
export const DELETION_REFUSAL_SENTENCES = Object.freeze({
  ALREADY_DELETED: 'This event was already deleted.',
  PAYMENT_IN_FLIGHT:
    'Somebody is paying for a ticket right now. Try again in a few minutes. If this stays, the payment has to be resolved first.',
  UNEXPECTED_ORDERS:
    'This event has paid orders it should not have. The finance team has to look at them first.',
  EVENT_IN_PROGRESS:
    'A night of this event has started or is about to. Cancel the nights still to come (each refunds its tickets), and delete the event once its last night is over.',
})

/** What the deleter is told when the outcome moved since the preview. */
export const OUTCOME_CHANGED_SENTENCE =
  'Tickets were sold, or the event changed, since you opened this. Read what deleting it does now.'

/** What the deleter is told when a finished event nobody was checked in at needs a word. */
export const TOOK_PLACE_UNCONFIRMED_SENTENCE =
  'Nobody was checked in at this event through Desi-Event. Confirm that it took place, or choose to cancel it and refund every order.'

/**
 * What a deleter is told when the deletion ran out of time: behind another
 * change to the event (a night's cancellation, an edit) past its lock wait,
 * or past its budget. Rolled back whole: nothing was cancelled, refunded or
 * withdrawn, and the event is as it was.
 */
export const DELETION_OUT_OF_TIME_SENTENCE =
  'Another change to this event was being saved at the same moment, and deleting it could not wait for it, so nothing was changed: the event is as it was. Try again in a moment.'

/**
 * What the Desi-Event team is told when a restore ran out of time. Rolled
 * back whole: the event is still deleted.
 */
export const RESTORE_OUT_OF_TIME_SENTENCE =
  'Another change to this event was being saved at the same moment, and restoring it could not wait for it, so nothing was changed: the event is still deleted. Try again in a moment.'

/** What the deleter is told when the typed web address does not match. */
export const CONFIRMATION_MISMATCH_SENTENCE =
  'Type the event’s web address exactly as it is shown to confirm.'

/**
 * Whether a payment has a dispute that stops a refund of it.
 *
 * @param {object} payment A payment, with `disputes`.
 * @returns {boolean} True when one blocks.
 */
function disputeBlocks(payment) {
  return (payment.disputes ?? []).some((dispute) =>
    REFUND_BLOCKING_DISPUTE_STATES.includes(dispute.status),
  )
}

/**
 * The nights a deletion reads: the sessions that are not cancelled, or the
 * event itself as its one night when it has no session rows at all.
 *
 * @param {object} event The event, with `startsAt`, `endsAt` and `sessions`.
 * @returns {{nights: object[], everyNightCancelled: boolean}} The nights still on.
 */
export function nightsOf(event) {
  const sessions = event.sessions ?? []

  if (sessions.length === 0) {
    return {
      nights: [{ id: null, startsAt: event.startsAt, endsAt: event.endsAt, doorsOpenAt: null }],
      everyNightCancelled: false,
    }
  }

  const nights = sessions.filter((session) => session.status !== 'CANCELLED')

  return { nights, everyNightCancelled: nights.length === 0 }
}

/**
 * Whether a night has started for the purpose of this area: it is within an
 * hour of its doors opening (or of its start, when it lists no door time).
 *
 * @param {object} night A night, with `startsAt` and `doorsOpenAt`.
 * @param {Date} now The instant.
 * @returns {boolean} True once it counts as started.
 */
export function nightHasStarted(night, now) {
  const opens = new Date(night.doorsOpenAt ?? night.startsAt).getTime()

  return now.getTime() >= opens - NIGHT_START_MARGIN_MS
}

/**
 * Everything a deletion is decided from, counted.
 *
 * Read again inside the deletion's transaction, after its locks.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object} event The event, with `id`, `status`, `startsAt`, `endsAt`, `sessions` and `ticketTypes`.
 * @param {Date} now The instant.
 * @returns {Promise<object>} The facts.
 */
export async function loadDeletionFacts(db, event, now) {
  const orders = await db.order.findMany({
    where: { eventId: event.id },
    include: { payments: { include: { disputes: true } } },
  })

  const sold = []
  const refundable = []
  const disputed = []
  const zeroValue = []
  const partlyRefunded = []
  const pending = []
  const inFlight = []
  let paymentsInFlight = 0
  let refundableCents = 0
  let currency = null

  for (const order of orders) {
    if (order.status === 'PENDING') {
      pending.push(order)

      const moving = (order.payments ?? []).filter((payment) =>
        IN_FLIGHT_PAYMENT_STATES.includes(payment.status),
      )

      if (moving.length > 0) {
        inFlight.push(order)
        paymentsInFlight += moving.length
      }

      continue
    }

    if (order.status !== 'PAID') continue

    if (order.totalCents === 0) {
      zeroValue.push(order)
      continue
    }

    const left = order.totalCents - order.refundedCents

    if (left <= 0) continue

    sold.push(order)
    currency = currency ?? order.currency

    if (order.refundedCents > 0) partlyRefunded.push(order)

    if ((order.payments ?? []).some(disputeBlocks)) {
      disputed.push(order)
      continue
    }

    // What is left to give back, whether or not a refund for it is already
    // reserved (a cancelled event's are): it is what the deletion's refunds
    // send.
    refundable.push(order)
    refundableCents += left
  }

  const tierIds = (event.ticketTypes ?? []).map((tier) => tier.id)
  const activeHolds =
    tierIds.length === 0
      ? 0
      : await db.ticketHold.count({
          where: { ticketTypeId: { in: tierIds }, status: 'ACTIVE', expiresAt: { gt: now } },
        })

  const tickets = await db.ticket.count({
    where: { status: { in: [...HELD_TICKET_STATES] }, orderItem: { order: { eventId: event.id } } },
  })

  const checkIns = await db.checkIn.count({
    where: { ticket: { orderItem: { order: { eventId: event.id } } } },
  })

  // An archived event that had taken place: the last move into ARCHIVED came
  // from COMPLETED.
  let archivedFrom = null

  if (event.status === 'ARCHIVED') {
    const archive = await db.eventModerationAction.findFirst({
      where: { eventId: event.id, toStatus: 'ARCHIVED' },
      orderBy: { createdAt: 'desc' },
      select: { fromStatus: true },
    })

    archivedFrom = archive?.fromStatus ?? null
  }

  const { nights, everyNightCancelled } = nightsOf(event)
  const started = checkIns > 0 || nights.some((night) => nightHasStarted(night, now))
  const finished =
    nights.length > 0 && nights.every((night) => new Date(night.endsAt).getTime() <= now.getTime())

  return {
    orders: orders.length,
    soldOrders: sold.length,
    refundableOrders: refundable.length,
    refundableCents,
    currency,
    disputedOrders: disputed.length,
    zeroValueOrders: zeroValue.length,
    partlyRefundedOrders: partlyRefunded.length,
    pendingOrders: pending.length,
    inFlight: inFlight.length,
    paymentsInFlight,
    activeHolds,
    tickets,
    checkIns,
    nights: nights.length,
    everyNightCancelled,
    started,
    finished,
    archivedFrom,
  }
}

/**
 * A refusal, by code.
 *
 * @param {string} code One of {@link DELETION_REFUSAL_SENTENCES}' keys.
 * @returns {{code: string, message: string}} The refusal.
 */
function refusal(code) {
  return { code, message: DELETION_REFUSAL_SENTENCES[code] }
}

/**
 * What deleting this event does now. Pure; the first matching case wins
 * (SPEC2-XI X-D's table).
 *
 * @param {object} event The event, with `status`.
 * @param {object} facts From {@link loadDeletionFacts}.
 * @returns {{outcome: string|null, refusal: {code: string, message: string}|null, choices: string[]|null, needsTookPlaceConfirmation: boolean}} The decision.
 */
export function classifyDeletion(event, facts) {
  const decided = (outcome) => ({
    outcome,
    refusal: null,
    choices: null,
    needsTookPlaceConfirmation: false,
  })
  const refused = (code) => ({
    outcome: null,
    refusal: refusal(code),
    choices: null,
    needsTookPlaceConfirmation: false,
  })
  const { status } = event

  // 1–3
  if (status === 'DELETED') return refused('ALREADY_DELETED')
  if (facts.inFlight > 0) return refused('PAYMENT_IN_FLIGHT')
  if (facts.soldOrders === 0) return decided('REMOVE')

  // 4
  if (status === 'CANCELLED' || status === 'POSTPONED') return decided('CANCEL_AND_REFUND')

  // 5–6
  if (status === 'COMPLETED') return decided('REMOVE_AFTER_EVENT')
  if (status === 'ARCHIVED') {
    return facts.archivedFrom === 'COMPLETED'
      ? decided('REMOVE_AFTER_EVENT')
      : refused('UNEXPECTED_ORDERS')
  }
  if (NO_ORDER_STATUSES.has(status) || !LIVE_STATUSES.has(status)) {
    return refused('UNEXPECTED_ORDERS')
  }

  // 7–11: a live event.
  if (facts.everyNightCancelled) return decided('CANCEL_AND_REFUND')
  if (facts.started && !facts.finished) return refused('EVENT_IN_PROGRESS')
  if (facts.finished && facts.checkIns > 0) return decided('REMOVE_AFTER_EVENT')

  if (facts.finished) {
    return {
      outcome: null,
      refusal: null,
      choices: ['REMOVE_AFTER_EVENT', 'CANCEL_AND_REFUND'],
      needsTookPlaceConfirmation: true,
    }
  }

  return decided('CANCEL_AND_REFUND')
}

/** The organisation capabilities each outcome needs. */
const ORGANIZATION_NEEDS = Object.freeze({
  REMOVE: Object.freeze([CAPABILITIES.EVENT_DELETE_UNSOLD]),
  REMOVE_AFTER_EVENT: Object.freeze([CAPABILITIES.EVENT_DELETE]),
  CANCEL_AND_REFUND: Object.freeze([CAPABILITIES.EVENT_DELETE, CAPABILITIES.EVENT_CANCEL]),
})

/**
 * Whether this actor may ask to delete this event at all: an organisation
 * member holding `event:delete_unsold`, or the Desi-Event team. Everybody else
 * is answered as if the event did not exist.
 *
 * @param {object|null} actor The request actor.
 * @param {object} event The event, with `organizationId`.
 * @returns {boolean} True when the deletion routes answer this actor.
 */
export function mayAskToDelete(actor, event) {
  return (
    memberHolds(actor, CAPABILITIES.EVENT_DELETE_UNSOLD, event.organizationId) ||
    platformHolds(actor, CAPABILITIES.EVENT_PLATFORM_DELETE)
  )
}

/**
 * Who may delete with this outcome (SPEC2-XI X-9's matrix). Membership first.
 *
 * @param {object|null} actor The request actor.
 * @param {object} event The event, with `organizationId`.
 * @param {string|null} outcome The outcome; null for a refusal, which is read as REMOVE's.
 * @param {object} [facts] The facts, for the sentence's count.
 * @returns {{permitted: boolean, missing: string|null, authority: 'ORGANIZATION'|'PLATFORM'|null}} The answer.
 */
export function deletionAuthority(actor, event, outcome, facts = null) {
  const needs = ORGANIZATION_NEEDS[outcome] ?? ORGANIZATION_NEEDS.REMOVE

  if (needs.every((capability) => memberHolds(actor, capability, event.organizationId))) {
    return { permitted: true, missing: null, authority: AUTHORITY_KINDS.ORGANIZATION }
  }

  if (platformHolds(actor, CAPABILITIES.EVENT_PLATFORM_DELETE)) {
    return { permitted: true, missing: null, authority: AUTHORITY_KINDS.PLATFORM }
  }

  if (outcome === 'CANCEL_AND_REFUND') {
    const paid = facts?.refundableOrders ?? facts?.soldOrders ?? null
    const counted =
      paid === null ? 'refunds its paid orders' : `refunds ${paid} paid ${plural(paid, 'order')}`

    return {
      permitted: false,
      missing: `Deleting this event ${counted}, which an organisation administrator or owner decides. Ask one of them, or the Desi-Event team.`,
      authority: null,
    }
  }

  if (outcome === 'REMOVE_AFTER_EVENT') {
    return {
      permitted: false,
      missing:
        'Deleting an event that has taken place is decided by an organisation administrator or owner. Ask one of them, or the Desi-Event team.',
      authority: null,
    }
  }

  return {
    permitted: false,
    missing: 'Only the people who run this event, or the Desi-Event team, can delete it.',
    authority: null,
  }
}

/**
 * A noun, plural when the count asks for it.
 *
 * @param {number} count How many.
 * @param {string} noun The noun.
 * @returns {string} The noun as the count needs it.
 */
function plural(count, noun) {
  return count === 1 ? noun : `${noun}s`
}

/**
 * The 403 for an actor whose authority does not cover this outcome.
 *
 * @param {string} outcome The outcome.
 * @param {string} missing The sentence.
 * @returns {Error} The refusal.
 */
function notAuthorised(outcome, missing) {
  return outcome === 'CANCEL_AND_REFUND'
    ? forbidden(missing, 'REFUND_AUTHORITY_REQUIRED')
    : forbidden(missing)
}

/**
 * What deleting this event would do now, as the preview answers it.
 *
 * @param {object} db A Prisma client.
 * @param {object} options Options.
 * @param {object} options.event The event, with `sessions`, `ticketTypes`, `slug`, `publishedAt` and `revision`.
 * @param {object} options.actor The reader.
 * @param {string} [options.paymentMode] The payment mode.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<object>} A payload satisfying `eventDeletionPreviewSchema`.
 */
export async function deletionPreview(
  db,
  { event, actor, paymentMode = 'MOCK', now = new Date() },
) {
  const facts = await loadDeletionFacts(db, event, now)
  const decision = classifyDeletion(event, facts)
  // A choice is the deleter's to make; who may make it is asked of the
  // narrower of the two (REMOVE_AFTER_EVENT), and the commit asks again of the
  // one chosen.
  const asked = decision.outcome ?? decision.choices?.[0] ?? null
  const { permitted, missing, authority } = deletionAuthority(actor, event, asked, facts)

  return {
    eventId: event.id,
    status: event.status,
    revision: event.revision ?? 0,
    outcome: decision.outcome,
    choices: decision.choices,
    needsTookPlaceConfirmation: decision.needsTookPlaceConfirmation,
    refusal: decision.refusal,
    authority,
    permitted: decision.refusal ? false : permitted,
    missing: decision.refusal ? null : missing,
    counts: {
      paidOrders: facts.soldOrders,
      refundableCents: facts.refundableCents,
      currency: facts.currency,
      pendingOrders: facts.pendingOrders,
      paymentsInFlight: facts.paymentsInFlight,
      activeHolds: facts.activeHolds,
      tickets: facts.tickets,
      checkIns: facts.checkIns,
      zeroValueOrders: facts.zeroValueOrders,
      disputedOrders: facts.disputedOrders,
      partlyRefundedOrders: facts.partlyRefundedOrders,
    },
    slug: { value: event.slug, keptRetired: Boolean(event.publishedAt) },
    paymentMode: ['MOCK', 'STRIPE_TEST', 'LIVE'].includes(paymentMode) ? paymentMode : 'MOCK',
  }
}

/**
 * Cancel unpaid orders that no payment is moving for (none at all, or only
 * failed and cancelled ones), as a declined checkout's order is cancelled
 * (`compensateCheckout`): the promo code's use is given back, the names staged
 * for the tickets are cleared (there will be no tickets), and each order's
 * cancellation is audited, in the caller's transaction.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {object} options.where Which orders: `{ eventId }`, or `{ id: { in } }`.
 * @param {'EVENT_DELETED'|'SESSION_CANCELLED'} options.reason Why, for the audit.
 * @param {Date} options.now The instant.
 * @param {string|null} [options.actorId] Who, for the audit.
 * @param {string|null} [options.requestId] For the audit trail.
 * @returns {Promise<number>} How many were cancelled.
 */
export async function cancelUnpaidOrders(
  tx,
  { where, reason, now, actorId = null, requestId = null },
) {
  const unpaid = {
    status: 'PENDING',
    payments: { every: { status: { in: [...DEAD_PAYMENT_STATES] } } },
  }
  const candidates = await tx.order.findMany({
    where: { ...where, ...unpaid },
    select: { id: true, promoCodeId: true },
    orderBy: { id: 'asc' },
  })

  let cancelled = 0

  for (const order of candidates) {
    // Each one conditionally, so an order that started paying meanwhile is
    // left alone and nothing is given back for it.
    const { count } = await tx.order.updateMany({
      where: { id: order.id, ...unpaid },
      data: { status: 'CANCELLED', cancelledAt: now },
    })

    if (count === 0) continue

    cancelled += 1

    const returned = order.promoCodeId
      ? await tx.promoCode.updateMany({
          where: { id: order.promoCodeId, redemptionCount: { gt: 0 } },
          data: { redemptionCount: { decrement: 1 } },
        })
      : { count: 0 }

    await clearAttendeeStaging(tx, { orderId: order.id })

    await recordAudit(tx, {
      action: AUDIT_ACTIONS.ORDER_CANCELLED,
      entityType: 'Order',
      entityId: order.id,
      actorId,
      metadata: {
        requestId,
        at: now.toISOString(),
        previousStatus: 'PENDING',
        newStatus: 'CANCELLED',
        paymentId: null,
        reason,
        promoRedemptionReturned: returned.count > 0,
      },
    })
  }

  return cancelled
}

/**
 * Ask for what a cancelled event's paid orders still have left to refund.
 *
 * Deleting a CANCELLED event is CANCEL_AND_REFUND, but its cancellation has
 * already run (`cancellationWork`), so nothing would otherwise ask again. An
 * order can still have money left that no refund holds: a disputed order the
 * cancellation left to its dispute, which was then won, or a refund finance
 * cancelled. The preview counts that money as refunded by the deletion, and
 * the deletion withdraws the order's tickets, so it asks for it here: a whole
 * refund of what is left, reserved in this transaction and sent by the driver
 * after the commit.
 *
 * Each order's row is locked first, so the reservation is made against its
 * counters as they stand. An order whose refunds already hold everything it
 * has left (`refundableCents` 0) asks for nothing, so a refund the
 * cancellation reserved is never asked for twice; a payment still disputed is
 * left to the finance team, as the cancellation left it. The key starts with
 * the event's cancellation prefix, so the driver and `events.finishRefunds`
 * find it; when the cancellation's own key for the order is taken (its refund
 * was cancelled, or settled part of the order), a numbered one is used.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {object} options.event The event, locked.
 * @param {string} options.reason The deletion's reason, as the refunds' note.
 * @param {string|null} options.actorId Who deleted it.
 * @param {string|null} options.requestId For the audit trail.
 * @param {Date} options.now The instant.
 * @returns {Promise<{refunds: number, skippedDisputed: number}>} How many refunds were asked for, and how many orders were left to their disputes.
 */
export async function refundWhatIsLeft(tx, { event, reason, actorId, requestId, now }) {
  const orders = await tx.order.findMany({
    where: { eventId: event.id, status: 'PAID', totalCents: { gt: 0 } },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  let refunds = 0
  let skippedDisputed = 0

  for (const { id } of orders) {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`

    const order = await tx.order.findUnique({
      where: { id },
      include: { items: true, payments: { include: { disputes: true } } },
    })

    if (!order || order.status !== 'PAID' || refundableCents(order) <= 0) continue

    const payment = (order.payments ?? []).find((candidate) => candidate.status === 'SUCCEEDED')

    if (!payment) continue

    if (disputeBlocks(payment)) {
      skippedDisputed += 1
      continue
    }

    const base = `${eventRefundPrefix(event.id)}${order.id}`
    const used = await tx.refund.count({ where: { idempotencyKey: { startsWith: base } } })
    const { created } = await requestRefund(tx, {
      order,
      payment,
      whole: true,
      reason: 'EVENT_CANCELLED',
      reasonNote: reason,
      idempotencyKey: used === 0 ? base : `${base}:d${used}`,
      actorId,
      requestId,
      via: 'event_deletion',
      now,
    })

    if (created) refunds += 1
  }

  return { refunds, skippedDisputed }
}

/**
 * Release every ACTIVE hold of these ticket types, seats included.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {string[]} tierIds The ticket types.
 * @param {object} options Options.
 * @param {Date} options.now The instant.
 * @param {string} options.reason Why, as `releaseReason`.
 * @param {string|null} [options.actorId] Who, as `releasedBy`.
 * @param {string|null} [options.sessionId] Only the holds for this night, when given.
 * @returns {Promise<number>} How many holds were released.
 */
export async function releaseHoldsOf(
  tx,
  tierIds,
  { now, reason, actorId = null, sessionId = null },
) {
  if (tierIds.length === 0 && !sessionId) return 0

  const holds = await tx.ticketHold.findMany({
    where: {
      status: 'ACTIVE',
      ...(sessionId
        ? { OR: [{ eventSessionId: sessionId }, { ticketTypeId: { in: tierIds } }] }
        : { ticketTypeId: { in: tierIds } }),
    },
    select: { id: true },
  })

  let released = 0

  for (const hold of holds) {
    const { count } = await tx.ticketHold.updateMany({
      where: { id: hold.id, status: 'ACTIVE' },
      data: {
        status: 'RELEASED',
        releasedAt: now,
        releasedBy: actorId ?? reason,
        releaseReason: reason,
      },
    })

    if (count === 1) {
      released += 1
      await releaseSeats(tx, hold.id)
    }
  }

  return released
}

/**
 * Delete an event (SPEC2-XI X-D, T1), then send what it owes.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {object} options.event The event as loaded, with `sessions` and `ticketTypes`.
 * @param {object} options.actor The request actor.
 * @param {object} options.body The request body: `revision`, `reason`, `confirmSlug`, `expectedOutcome`, `confirmTookPlace`.
 * @param {object} options.providers The provider registry, for the refunds after the commit.
 * @param {string} [options.paymentMode] The payment mode.
 * @param {Date} [options.now] The instant.
 * @param {string|null} [options.requestId] For the audit trail.
 * @returns {Promise<object>} `{ event, outcome, refunds, refundError }`: the deleted event, and what the first refund pass did.
 * @throws {Error} 409, 422 or 403, each naming why.
 */
export async function deleteEvent(prisma, options) {
  const {
    event,
    actor,
    body,
    providers,
    paymentMode = 'MOCK',
    now = new Date(),
    requestId = null,
  } = options
  const reason = String(body.reason).trim()

  if (event.status === 'DELETED') {
    throw httpError(409, 'ALREADY_DELETED', DELETION_REFUSAL_SENTENCES.ALREADY_DELETED)
  }

  if (String(body.confirmSlug).trim().toLowerCase() !== String(event.slug).toLowerCase()) {
    throw httpError(422, 'CONFIRMATION_MISMATCH', CONFIRMATION_MISMATCH_SENTENCE, {
      field: 'confirmSlug',
    })
  }

  // A budget sized to the orders it will touch and to the wait behind whatever
  // holds the event's row (a night's cancellation, an edit): one that runs out
  // answers 503 and leaves the event as it was (`lib/transaction-budget.js`).
  const orders = await liveOrderCount(prisma, event.id)

  const budget = {
    budget: TRANSACTION_BUDGETS.ORDERS,
    orders,
    refusal: DELETION_OUT_OF_TIME_SENTENCE,
  }

  const result = await budgetedTransaction(prisma, budget, async (tx) => {
    // 1. The event row first: the revision compare-and-set.
    const { count } = await tx.event.updateMany({
      where: { id: event.id, revision: body.revision, status: event.status },
      data: { revision: { increment: 1 } },
    })

    if (count !== 1) {
      const current = await tx.event.findUnique({
        where: { id: event.id },
        select: { revision: true, status: true },
      })

      if (current?.status === 'DELETED') {
        throw httpError(409, 'ALREADY_DELETED', DELETION_REFUSAL_SENTENCES.ALREADY_DELETED)
      }

      throw httpError(
        409,
        'STALE_REVISION',
        'This event changed since you opened this. Reload and read what deleting it does now.',
        {
          expectedRevision: body.revision,
          currentRevision: current?.revision ?? null,
          currentStatus: current?.status ?? null,
        },
      )
    }

    // 2. Its ticket types, then its nights: the checkout's lock order.
    const tiers = await tx.ticketType.findMany({
      where: { eventId: event.id },
      select: { id: true },
    })
    const tierIds = tiers.map((tier) => tier.id)

    await lockTicketTypes(tx, tierIds)

    const sessions = await tx.eventSession.findMany({ where: { eventId: event.id } })

    await lockEventSessions(
      tx,
      sessions.map((session) => session.id),
    )

    // 3. Decided again, from what the locks hold.
    const locked = await tx.event.findUnique({
      where: { id: event.id },
      include: { sessions: true, ticketTypes: true },
    })
    const facts = await loadDeletionFacts(tx, locked, now)
    const decision = classifyDeletion(locked, facts)

    if (decision.refusal) {
      throw httpError(409, decision.refusal.code, decision.refusal.message, {
        refusal: decision.refusal.code,
      })
    }

    // 4. The outcome the deleter read, the confirmation, and the authority.
    let outcome = decision.outcome

    if (decision.choices) {
      if (!decision.choices.includes(body.expectedOutcome)) {
        throw httpError(409, 'OUTCOME_CHANGED', OUTCOME_CHANGED_SENTENCE, {
          choices: decision.choices,
        })
      }

      outcome = body.expectedOutcome

      if (outcome === 'REMOVE_AFTER_EVENT' && body.confirmTookPlace !== true) {
        throw httpError(422, 'TOOK_PLACE_UNCONFIRMED', TOOK_PLACE_UNCONFIRMED_SENTENCE, {
          field: 'confirmTookPlace',
        })
      }
    } else if (body.expectedOutcome !== outcome) {
      throw httpError(409, 'OUTCOME_CHANGED', OUTCOME_CHANGED_SENTENCE, { outcome })
    }

    const answer = deletionAuthority(actor, locked, outcome, facts)

    if (!answer.permitted) throw notAuthorised(outcome, answer.missing)

    const authority =
      answer.authority === AUTHORITY_KINDS.PLATFORM
        ? { kind: AUTHORITY_KINDS.PLATFORM, via: 'DELETION', editId: null, reason: null }
        : { kind: AUTHORITY_KINDS.ORGANIZATION }
    const byPlatform = authority.kind === AUTHORITY_KINDS.PLATFORM
    const actorId = actor?.id ?? null

    // 5. Unpaid orders nobody is paying for, and every hold.
    const ordersCancelled = await cancelUnpaidOrders(tx, {
      where: { eventId: event.id },
      reason: 'EVENT_DELETED',
      now,
      actorId,
      requestId,
    })
    const holdsReleased = await releaseHoldsOf(tx, tierIds, {
      now,
      reason: 'EVENT_DELETED',
      actorId,
    })

    // 6. Cancel first when it refunds and is not cancelled already.
    let refundWork = null
    let from = locked.status

    if (outcome === 'CANCEL_AND_REFUND' && locked.status !== 'CANCELLED') {
      if (!findTransition(locked.status, 'CANCELLED')) {
        throw httpError(
          409,
          'ILLEGAL_TRANSITION',
          `An event that is ${locked.status} cannot be cancelled.`,
        )
      }

      const cancelled = await tx.event.update({
        where: { id: event.id },
        data: lifecycleStamps({ to: 'CANCELLED', reason, event: locked }),
      })

      await tx.eventModerationAction.create({
        data: {
          eventId: event.id,
          actorId,
          fromStatus: locked.status,
          toStatus: 'CANCELLED',
          reason,
        },
      })

      refundWork = await cancellationWork(tx, {
        event: cancelled,
        kind: 'CANCELLED',
        reasonCode: 'EVENT_DELETED',
        reason,
        actorId,
        requestId,
        byPlatform,
        via: 'event_deletion',
        now,
      })

      await recordAudit(tx, {
        action: 'event.cancelled',
        entityType: 'Event',
        entityId: event.id,
        actorId,
        metadata: {
          ...authorityAuditMetadata(authority),
          from: locked.status,
          to: 'CANCELLED',
          reason,
          via: 'event_deletion',
          refundWork,
        },
      })

      from = 'CANCELLED'
    } else if (outcome === 'CANCEL_AND_REFUND') {
      // Cancelled already: its cancellation asked for its refunds, and this
      // asks for whatever no refund holds now.
      refundWork = await refundWhatIsLeft(tx, {
        event: locked,
        reason,
        actorId,
        requestId,
        now,
      })
    }

    // 7. Every ticket still standing, unless the event took place.
    let ticketsWithdrawn = 0

    if (outcome !== 'REMOVE_AFTER_EVENT') {
      const standing = await tx.ticket.findMany({
        where: {
          status: { in: [...WITHDRAWABLE_TICKET_STATES] },
          orderItem: { order: { eventId: event.id } },
        },
        select: { id: true },
      })

      ticketsWithdrawn = await withdrawTickets(tx, {
        ticketIds: standing.map((ticket) => ticket.id),
        reason: `${EVENT_DELETED_PREFIX}${event.id}`,
        now,
      })
    }

    // 8. DELETED, with the record of it. A web address never public is
    // released; one that was keeps pointing at nothing.
    const slugReleased = !locked.publishedAt

    await tx.event.update({
      where: { id: event.id },
      data: {
        status: 'DELETED',
        deletedAt: now,
        deletedById: actorId,
        deletionReason: reason,
        deletionOutcome: DELETION_OUTCOME_COLUMN[outcome],
        deletionAuthority: authority.kind,
        statusBeforeDeletion: from,
        slug: slugReleased ? `deleted-${event.id}` : locked.slug,
        deletedSlug: slugReleased ? locked.slug : null,
      },
    })

    await tx.eventModerationAction.create({
      data: { eventId: event.id, actorId, fromStatus: from, toStatus: 'DELETED', reason },
    })

    const counts = {
      paidOrders: facts.soldOrders,
      refundableOrders: facts.refundableOrders,
      refundableCents: facts.refundableCents,
      currency: facts.currency,
      zeroValueOrders: facts.zeroValueOrders,
      disputedOrders: facts.disputedOrders,
      partlyRefundedOrders: facts.partlyRefundedOrders,
      ordersCancelled,
      holdsReleased,
      ticketsWithdrawn,
      checkIns: facts.checkIns,
      refundsReserved: refundWork?.refunds ?? 0,
    }

    await recordAudit(tx, {
      action: AUDIT_ACTIONS.EVENT_DELETED,
      entityType: 'Event',
      entityId: event.id,
      actorId,
      metadata: {
        requestId,
        from,
        ...(from !== locked.status ? { cancelledFrom: locked.status } : {}),
        outcome,
        authority: authority.kind,
        reason,
        counts,
        slugReleased,
        ...(decision.choices ? { choices: decision.choices } : {}),
        ...(body.confirmTookPlace === true ? { confirmTookPlace: true } : {}),
      },
    })

    // 9. Sittings end with it.
    await endSittingsOnDeletion(tx, event.id, now)

    // 10. What ticket holders are shown, when anybody holds an order.
    if (facts.orders > 0) {
      await recordChangeNotice(tx, {
        event: locked,
        kind: 'DELETED',
        reason,
        byPlatform,
        revision: locked.revision ?? 0,
      })
    }

    return { outcome, authority }
  })

  // After the commit: the refunds, through the refund service. A failure here
  // leaves the deletion as it is; `events.finishRefunds` sends the rest.
  let refunds = null
  let refundError = null

  if (result.outcome === 'CANCEL_AND_REFUND') {
    try {
      const deleted = await prisma.event.findUnique({
        where: { id: event.id },
        include: { sessions: true },
      })

      refunds = await refundOwed(prisma, {
        event: deleted,
        actor,
        providers,
        via: 'event_deletion',
        paymentMode,
        now,
        requestId,
      })
    } catch (error) {
      refundError = error
    }
  }

  const deleted = await prisma.event.findUnique({ where: { id: event.id } })

  return { event: deleted, outcome: result.outcome, refunds, refundError }
}

/**
 * Bring a deleted event back (SPEC2-XI X-T). Platform only; the route asserts
 * `event:platform_delete`.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {object} options.event The event, with `organization`.
 * @param {object} options.actor The request actor.
 * @param {string} options.reason Why, 10 to 500 characters.
 * @param {number} options.revision The revision the caller read.
 * @param {Date} [options.now] The instant.
 * @param {string|null} [options.requestId] For the audit trail.
 * @returns {Promise<object>} `{ event, to, slugChanged }`: the restored event.
 * @throws {Error} 409 `NOT_DELETED`, `ORGANIZER_NOT_VERIFIED` or `STALE_REVISION`.
 */
export async function restoreEvent(prisma, options) {
  const { event, actor, revision, now = new Date(), requestId = null } = options
  const reason = String(options.reason).trim()

  if (event.status !== 'DELETED') {
    throw httpError(
      409,
      'NOT_DELETED',
      'This event is not deleted, so there is nothing to restore.',
      {
        status: event.status,
      },
    )
  }

  const to = restoreTarget(event.statusBeforeDeletion)

  // Back on the site only for an organisation that may publish: verified and
  // not suspended (X-12), the suspension winning as it does everywhere else.
  if (PUBLICLY_VISIBLE_STATUSES.has(to) && !isEligible(event.organization)) {
    const suspended = Boolean(event.organization?.suspendedAt)

    throw httpError(
      409,
      'ORGANIZER_NOT_VERIFIED',
      suspended
        ? 'This event would come back on the site, and its organisation is suspended. Lift the suspension first.'
        : 'This event would come back on the site, and its organisation is not verified. Verify the organisation first.',
      {
        to,
        verificationStatus: event.organization?.verificationStatus ?? null,
        suspended,
      },
    )
  }

  const budget = { budget: TRANSACTION_BUDGETS.ROW, refusal: RESTORE_OUT_OF_TIME_SENTENCE }

  return budgetedTransaction(prisma, budget, async (tx) => {
    // The web address back, if nobody took it meanwhile.
    let slug = event.slug
    let slugChanged = false

    if (event.deletedSlug) {
      const taken = await tx.event.findUnique({
        where: { slug: event.deletedSlug },
        select: { id: true },
      })

      slug =
        taken && taken.id !== event.id ? disambiguateSlug(event.deletedSlug) : event.deletedSlug
      slugChanged = slug !== event.deletedSlug
    }

    const { count } = await tx.event.updateMany({
      where: { id: event.id, revision, status: 'DELETED' },
      data: {
        revision: revision + 1,
        status: to,
        slug,
        deletedAt: null,
        deletedById: null,
        deletionReason: null,
        deletionOutcome: null,
        deletionAuthority: null,
        statusBeforeDeletion: null,
        deletedSlug: null,
      },
    })

    if (count !== 1) {
      const current = await tx.event.findUnique({
        where: { id: event.id },
        select: { revision: true, status: true },
      })

      if (current?.status !== 'DELETED') {
        throw httpError(
          409,
          'NOT_DELETED',
          'This event is not deleted, so there is nothing to restore.',
          {
            status: current?.status ?? null,
          },
        )
      }

      throw httpError(
        409,
        'STALE_REVISION',
        'This event changed since you opened it. Reload and try again.',
        { expectedRevision: revision, currentRevision: current?.revision ?? null },
      )
    }

    await tx.eventModerationAction.create({
      data: {
        eventId: event.id,
        actorId: actor?.id ?? null,
        fromStatus: 'DELETED',
        toStatus: to,
        reason,
      },
    })

    await recordAudit(tx, {
      action: AUDIT_ACTIONS.EVENT_RESTORED,
      entityType: 'Event',
      entityId: event.id,
      actorId: actor?.id ?? null,
      metadata: {
        requestId,
        at: now.toISOString(),
        from: 'DELETED',
        to,
        statusBefore: event.statusBeforeDeletion,
        outcome: event.deletionOutcome,
        authority: AUTHORITY_KINDS.PLATFORM,
        reason,
        revision: revision + 1,
        slug: { restored: Boolean(event.deletedSlug), changed: slugChanged },
      },
    })

    const restored = await tx.event.findUnique({ where: { id: event.id } })

    return { event: restored, to, slugChanged }
  })
}
