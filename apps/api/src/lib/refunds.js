/**
 * Refunds: deciding, submitting, settling, and refusing.
 *
 * A refund is the one commerce action where every failure mode costs somebody
 * money. Over-refund gives away money that was never taken; under-refund keeps
 * money that is owed; a refund settled twice does both. So the shape here is
 * the same two-phase discipline checkout uses, for the same reason, plus a
 * ceiling the database enforces rather than this code.
 *
 * ## The four steps, and why they are four
 *
 *   1. **REQUESTED.** Somebody asked. The amount is reserved against the
 *      order's remaining refundable balance *in the same transaction*, which is
 *      what stops two requests from together exceeding the total. Nothing has
 *      been sent anywhere.
 *   2. **APPROVED.** Policy was satisfied — by a person with the capability, or
 *      by the event having been cancelled, which is a decision the organiser
 *      already made. Still nothing sent.
 *   3. **SUBMITTED.** Written *before* the provider is called, so a process
 *      that dies mid-call leaves durable evidence that a refund may exist. The
 *      provider is called with no transaction open.
 *   4. **SUCCEEDED.** A short transaction that records the outcome, revokes the
 *      tickets, posts the ledger batch, and moves the reserved amount from
 *      pending to settled. Conditional on the refund still being SUBMITTED, so
 *      two workers racing produce one settlement.
 *
 * A `TIMEOUT` is none of those. It is not a failure — nobody knows whether the
 * money moved — so it opens a reconciliation task and leaves the reservation in
 * place. Releasing the reservation on a timeout is how an order gets refunded
 * twice.
 *
 * ## The ceiling
 *
 * `Order.refundedCents + Order.refundPendingCents <= totalCents` is a CHECK
 * constraint. This module reserves into `refundPendingCents` before any
 * provider call and moves it to `refundedCents` on settlement, so the sum is
 * correct at every instant in between. Two concurrent requests for the whole
 * order do not both succeed: PostgreSQL serialises them on the row, and the
 * second one violates the constraint.
 *
 * That is deliberate. The check could be done in application code — read the
 * balance, compare, write — and it would be wrong under concurrency in a way
 * that is almost impossible to notice in testing and expensive in production.
 *
 * ## What is never done here
 *
 * No Stripe identifier is invented. In mock mode the provider returns its own
 * references and they are stored as given; nothing in this module manufactures
 * one to make a row look complete.
 *
 * @module @desi-event/api/lib/refunds
 */

import { refundBatch, refundSettledBatch } from '@desi-event/ledger'
import { PROVIDER_ERROR_CODES } from '@desi-event/providers'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { conflict, httpError, notFound, unprocessable } from './errors.js'
import { postBatch } from './ledger.js'
import { openReconciliation } from './webhook-handlers.js'

/**
 * Every state a refund can be in.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const REFUND_STATES = Object.freeze({
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  SUBMITTED: 'SUBMITTED',
  SUCCEEDED: 'SUCCEEDED',
  DECLINED: 'DECLINED',
  FAILED: 'FAILED',
  TIMEOUT: 'TIMEOUT',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  CANCELLED: 'CANCELLED',
})

/**
 * What each state may become.
 *
 * Written out rather than implied by the code that performs the transitions,
 * because "can a declined refund be resubmitted?" is a question that otherwise
 * gets three different answers in three places.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const REFUND_TRANSITIONS = Object.freeze({
  REQUESTED: Object.freeze([REFUND_STATES.APPROVED, REFUND_STATES.CANCELLED]),
  APPROVED: Object.freeze([REFUND_STATES.SUBMITTED, REFUND_STATES.CANCELLED]),
  SUBMITTED: Object.freeze([
    REFUND_STATES.SUCCEEDED,
    REFUND_STATES.DECLINED,
    REFUND_STATES.FAILED,
    REFUND_STATES.TIMEOUT,
    REFUND_STATES.RECONCILIATION_REQUIRED,
  ]),
  // A timeout is not terminal and it is not a failure. It resolves when
  // somebody — a webhook, a re-query, an operator — establishes what happened.
  TIMEOUT: Object.freeze([
    REFUND_STATES.SUCCEEDED,
    REFUND_STATES.FAILED,
    REFUND_STATES.RECONCILIATION_REQUIRED,
  ]),
  RECONCILIATION_REQUIRED: Object.freeze([REFUND_STATES.SUCCEEDED, REFUND_STATES.FAILED]),
  // A refusal or a failure may be tried again once the cause is addressed,
  // which is what an operator does after fixing a connected account.
  DECLINED: Object.freeze([REFUND_STATES.APPROVED, REFUND_STATES.CANCELLED]),
  FAILED: Object.freeze([REFUND_STATES.APPROVED, REFUND_STATES.CANCELLED]),
  SUCCEEDED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
})

/** States where money is reserved against the order but not yet given back. */
export const PENDING_STATES = Object.freeze(
  new Set([
    REFUND_STATES.REQUESTED,
    REFUND_STATES.APPROVED,
    REFUND_STATES.SUBMITTED,
    REFUND_STATES.TIMEOUT,
    REFUND_STATES.RECONCILIATION_REQUIRED,
  ]),
)

/**
 * What happens to a refunded seat.
 *
 * Named rather than assumed, because "the seat goes back on sale" is a business
 * decision with a wrong answer in both directions: resell a seat for an event
 * starting in an hour and two people arrive at it; hold a seat back from an
 * event three months away and the organiser loses a sale they could have made.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SEAT_POLICIES = Object.freeze({
  /** Back to AVAILABLE. The default when the event is far enough away. */
  RESELL: 'RESELL',
  /** Held out of sale, visible to the organiser as BLOCKED with a reason. */
  WITHHOLD: 'WITHHOLD',
})

/** How close to the event a refunded seat stops being resold, in hours. */
export const RESELL_CUTOFF_HOURS = 24

/**
 * Whether one refund state may become another.
 *
 * @param {string} from The current state.
 * @param {string} to The proposed state.
 * @returns {boolean} True when the transition is in the table.
 */
export function canTransition(from, to) {
  return (REFUND_TRANSITIONS[from] ?? []).includes(to)
}

/**
 * Decide what happens to a refunded seat.
 *
 * @param {object} options Options.
 * @param {Date|null} options.eventStartsAt When the event starts.
 * @param {Date} options.now The instant of the refund.
 * @param {string} [options.override] An explicit policy, when an organiser chose one.
 * @returns {string} One of {@link SEAT_POLICIES}.
 */
export function seatPolicyFor({ eventStartsAt, now, override }) {
  if (override === SEAT_POLICIES.RESELL || override === SEAT_POLICIES.WITHHOLD) return override

  if (!eventStartsAt) return SEAT_POLICIES.WITHHOLD

  const hoursAway = (new Date(eventStartsAt).getTime() - now.getTime()) / 3_600_000

  return hoursAway >= RESELL_CUTOFF_HOURS ? SEAT_POLICIES.RESELL : SEAT_POLICIES.WITHHOLD
}

/**
 * How much of an order is still refundable.
 *
 * Reads the order's own counters rather than summing refunds, because the
 * counters are what the CHECK constraint is written against and a second
 * opinion that disagreed with the constraint would be the more dangerous
 * number.
 *
 * @param {object} order An `Order` row.
 * @returns {number} Integer cents, never negative.
 */
export function refundableCents(order) {
  return Math.max(0, order.totalCents - order.refundedCents - order.refundPendingCents)
}

/**
 * Work out what each order line gives back, for a requested amount.
 *
 * Proportional to what each line contributed, with the rounding remainder put
 * on the largest line. A refund that did not add up to the requested amount
 * would be a refund whose parts disagree with its whole, and the ledger would
 * refuse the batch — correctly, and much later than here.
 *
 * @param {object} options Options.
 * @param {Array<object>} options.items The order's lines.
 * @param {number} options.amountCents What is being refunded.
 * @returns {Array<{orderItemId: string, amountCents: number, quantity: number}>} The allocation.
 */
export function allocateAcrossLines({ items, amountCents }) {
  const refundable = items.filter((item) => item.subtotalCents - item.refundedCents > 0)
  const total = refundable.reduce((sum, item) => sum + (item.subtotalCents - item.refundedCents), 0)

  if (total === 0 || amountCents === 0) return []

  const allocation = refundable.map((item) => {
    const available = item.subtotalCents - item.refundedCents

    return {
      orderItemId: item.id,
      amountCents: Math.floor((amountCents * available) / total),
      quantity: 0,
      available,
      unitPriceCents: item.unitPriceCents,
    }
  })

  // The remainder. Put on the biggest line rather than spread, because a
  // one-cent difference on one line is easier to explain than a cent
  // distributed across five.
  const assigned = allocation.reduce((sum, line) => sum + line.amountCents, 0)
  const remainder = amountCents - assigned

  if (remainder !== 0) {
    const biggest = allocation.reduce((best, line) =>
      line.available > best.available ? line : best,
    )
    biggest.amountCents += remainder
  }

  return allocation
    .filter((line) => line.amountCents > 0)
    .map((line) => ({
      orderItemId: line.orderItemId,
      amountCents: line.amountCents,
      // Whole tickets only: a refund of half a ticket's value does not revoke
      // half a ticket, and rounding up would revoke one the buyer still paid for.
      quantity: line.unitPriceCents > 0 ? Math.floor(line.amountCents / line.unitPriceCents) : 0,
    }))
}

/**
 * Work out what a refund of named lines is worth.
 *
 * This is the "refund by order item" form, and it is not the same operation as
 * refunding an amount. Here the caller names lines and quantities — two of the
 * four tickets on this line — and the amount follows from the order's own unit
 * prices. The amount is *never* taken from the request: a caller who could
 * name the price of the tickets they are refunding could refund more than they
 * paid.
 *
 * A line's remaining quantity counts both what has settled — `refundedQuantity`,
 * written at settlement — and what is already asked for and not yet resolved.
 * Counting only the settled figure would let two pending requests each name the
 * last ticket on a line; the order's money ceiling would still hold, but the
 * two refunds would between them revoke one ticket and pay for two.
 *
 * @param {object} options Options.
 * @param {Array<object>} options.items The order's lines.
 * @param {Array<{orderItemId: string, quantity: number}>} options.lines What to give back.
 * @param {Map<string, number>} [options.pendingByLine] Quantities already spoken for by unresolved refunds.
 * @returns {{allocation: Array<{orderItemId: string, amountCents: number, quantity: number}>, amountCents: number}} The allocation and its total.
 * @throws {Error} 422 for a line that is not on the order, or a quantity it cannot cover.
 */
export function allocateNamedLines({ items, lines, pendingByLine = new Map() }) {
  const byId = new Map(items.map((item) => [item.id, item]))
  const wanted = new Map()

  for (const line of lines) {
    wanted.set(line.orderItemId, (wanted.get(line.orderItemId) ?? 0) + line.quantity)
  }

  const allocation = []
  let amountCents = 0

  for (const [orderItemId, quantity] of wanted) {
    const item = byId.get(orderItemId)

    if (!item) {
      throw unprocessable('That line is not on this order.', { orderItemId })
    }

    const available = item.quantity - item.refundedQuantity - (pendingByLine.get(orderItemId) ?? 0)

    if (quantity > available) {
      throw unprocessable(
        available <= 0
          ? 'Every ticket on that line has already been refunded or is being refunded.'
          : `That line has ${available} ticket(s) left to refund.`,
        { orderItemId, requested: quantity, available },
      )
    }

    const lineCents = item.unitPriceCents * quantity

    amountCents += lineCents
    allocation.push({ orderItemId, amountCents: lineCents, quantity })
  }

  if (amountCents <= 0) {
    // A line of free tickets. The tickets are still revoked, but that is a
    // revocation rather than a refund, and routing it through a payment
    // provider would ask for zero cents back from a real processor.
    throw unprocessable('Those lines are worth nothing, so there is nothing to refund.', { lines })
  }

  return { allocation, amountCents }
}

/**
 * How many tickets on each line are already spoken for by an unresolved refund.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {string} orderId Which order.
 * @returns {Promise<Map<string, number>>} Line id to quantity.
 */
export async function pendingQuantitiesByLine(tx, orderId) {
  const refunds = await tx.refund.findMany({
    where: { orderId, status: { in: [...PENDING_STATES] } },
    select: { id: true },
  })

  const pending = new Map()

  if (refunds.length === 0) return pending

  const items = await tx.refundItem.findMany({
    where: { refundId: { in: refunds.map((refund) => refund.id) } },
  })

  for (const item of items) {
    pending.set(item.orderItemId, (pending.get(item.orderItemId) ?? 0) + item.quantity)
  }

  return pending
}

/**
 * Split a refund across the parts of the order it came from.
 *
 * Read off the order's stored totals, which came from the pricing snapshot at
 * checkout — not from live fee tables, which may have moved. A full refund
 * gives back everything; a partial one gives back a proportional share of each
 * part, so a half refund returns half the tax and half the fee.
 *
 * @param {object} order The order, with its totals.
 * @param {number} amountCents The refund amount.
 * @returns {{faceValueCents: number, feeCents: number, taxCents: number}} The split.
 */
export function splitRefund(order, amountCents) {
  if (amountCents >= order.totalCents) {
    return {
      faceValueCents: order.subtotalCents - (order.discountCents ?? 0),
      feeCents: order.feesCents ?? 0,
      taxCents: order.taxCents ?? 0,
    }
  }

  const share = amountCents / order.totalCents
  const feeCents = Math.round((order.feesCents ?? 0) * share)
  const taxCents = Math.round((order.taxCents ?? 0) * share)

  return { faceValueCents: amountCents - feeCents - taxCents, feeCents, taxCents }
}

/**
 * Ask for a refund, reserving the amount against the order.
 *
 * The reservation is the point. `refundPendingCents` goes up in the same
 * transaction that creates the row, so from this instant the order's remaining
 * refundable balance reflects this request — and the CHECK constraint refuses a
 * second request that would take the pair over the total.
 *
 * Two forms, and the amount is server-side in both. `amountCents` refunds a sum
 * and spreads it proportionally across the lines; `lines` names order items and
 * quantities, and the amount follows from the order's own unit prices. A caller
 * may send one or the other. Sending a price is not a form at all.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.order The order, with items.
 * @param {object} params.payment The succeeded payment to refund against.
 * @param {number} [params.amountCents] How much, for an amount refund.
 * @param {Array<{orderItemId: string, quantity: number}>} [params.lines] Which lines, for an item refund.
 * @param {Map<string, number>} [params.pendingByLine] Quantities already spoken for, for an item refund.
 * @param {string} params.reason A `RefundReason`.
 * @param {string|null} [params.reasonNote] Prose for the audit trail.
 * @param {string} params.idempotencyKey Unique per logical request.
 * @param {string|null} [params.actorId] Who asked. Null for a system request.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{refund: object, created: boolean}>} The refund, and whether this call made it.
 * @throws {Error} 409 when the order has less left than was asked for; 422 for a bad amount.
 */
export async function requestRefund(tx, params) {
  const {
    order,
    payment,
    lines = null,
    reason,
    reasonNote = null,
    idempotencyKey,
    pendingByLine = new Map(),
    actorId = null,
    requestId = null,
    now,
  } = params

  // Idempotency at the request boundary. A retried request — a lost response, a
  // double-clicked button, a job that ran twice — gets the refund the first one
  // made, rather than a second reservation against the same order.
  const existing = await tx.refund.findUnique({ where: { idempotencyKey } })

  if (existing) return { refund: existing, created: false }

  const named = lines
    ? allocateNamedLines({ items: order.items ?? [], lines, pendingByLine })
    : null
  const amountCents = named ? named.amountCents : params.amountCents

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw unprocessable('A refund has to be for a positive whole number of cents.', { amountCents })
  }

  if (payment.currency !== order.currency) {
    // Belt and braces: `desi_refund_within_order_total` refuses this too. A
    // refund in a currency the order was not paid in is not a rounding issue.
    throw unprocessable('That payment was taken in a different currency from the order.', {
      orderCurrency: order.currency,
      paymentCurrency: payment.currency,
    })
  }

  const remaining = refundableCents(order)

  if (amountCents > remaining) {
    throw conflict(
      remaining === 0
        ? 'This order has already been refunded in full.'
        : `This order has ${remaining} cent(s) left to refund.`,
      { requested: amountCents, remaining },
    )
  }

  // Reserve first. The update is conditional on the counters this decision was
  // made against, so a request that raced another one changes nothing and is
  // told so, rather than both of them writing a row the constraint then has to
  // catch.
  const { count } = await tx.order.updateMany({
    where: {
      id: order.id,
      refundedCents: order.refundedCents,
      refundPendingCents: order.refundPendingCents,
    },
    data: { refundPendingCents: order.refundPendingCents + amountCents },
  })

  if (count === 0) {
    throw conflict('Somebody else started a refund on this order. Read it again and retry.', {
      orderId: order.id,
    })
  }

  const created = await tx.refund.create({
    data: {
      orderId: order.id,
      paymentId: payment.id,
      provider: payment.provider,
      amountCents,
      currency: order.currency,
      reason,
      reasonNote,
      status: REFUND_STATES.REQUESTED,
      allocation: splitRefund(order, amountCents),
      requestedById: actorId,
      idempotencyKey,
    },
  })

  const allocation = named
    ? named.allocation
    : allocateAcrossLines({ items: order.items ?? [], amountCents })

  for (const line of allocation) {
    await tx.refundItem.create({
      data: {
        refundId: created.id,
        orderItemId: line.orderItemId,
        quantity: Math.max(1, line.quantity),
        amountCents: line.amountCents,
      },
    })
  }

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.REFUND_REQUESTED,
    entityType: 'Refund',
    entityId: created.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      orderId: order.id,
      paymentId: payment.id,
      amountCents,
      currency: order.currency,
      reason,
      reasonNote,
      form: named ? 'lines' : 'amount',
      lines: named ? named.allocation : null,
      source: actorId ? 'operator' : 'system',
      remainingBefore: remaining,
    },
  })

  return { refund: created, created: true }
}

/**
 * Move a refund to a new state, conditionally.
 *
 * Every transition in this module goes through here, so the transition table is
 * enforced in one place and the `updateMany` count is what decides a race.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.refund The refund as it was read.
 * @param {string} params.to The new state.
 * @param {object} [params.data] Extra columns to write.
 * @returns {Promise<boolean>} Whether this call performed the transition.
 * @throws {Error} 409 when the transition is not in the table.
 */
export async function transition(tx, { refund, to, data = {} }) {
  if (!canTransition(refund.status, to)) {
    throw conflict(
      `A ${refund.status.toLowerCase().replace(/_/g, ' ')} refund cannot become ${to.toLowerCase().replace(/_/g, ' ')}.`,
      { from: refund.status, to },
    )
  }

  const { count } = await tx.refund.updateMany({
    where: { id: refund.id, status: refund.status },
    data: { status: to, ...data },
  })

  return count === 1
}

/**
 * Approve a requested refund.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.refund The refund.
 * @param {string|null} params.actorId Who approved it.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<boolean>} Whether this call performed the transition.
 */
export async function approveRefund(tx, { refund, actorId, requestId = null, now }) {
  const applied = await transition(tx, {
    refund,
    to: REFUND_STATES.APPROVED,
    data: { approvedById: actorId },
  })

  if (!applied) return false

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.REFUND_APPROVED,
    entityType: 'Refund',
    entityId: refund.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      orderId: refund.orderId,
      amountCents: refund.amountCents,
      currency: refund.currency,
      previousStatus: refund.status,
      source: actorId ? 'operator' : 'system',
    },
  })

  return true
}

/**
 * Mark a refund as handed to the provider.
 *
 * Written before the call, not after. A process that dies during the call
 * leaves a SUBMITTED row, which is the evidence reconciliation needs that a
 * refund may exist — the alternative is an APPROVED row and a refund nobody
 * knows about.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.refund The refund.
 * @param {Date} params.now The instant.
 * @returns {Promise<boolean>} Whether this call performed the transition.
 */
export async function markSubmitted(tx, { refund, now }) {
  return transition(tx, {
    refund,
    to: REFUND_STATES.SUBMITTED,
    data: { submittedAt: now, attempts: { increment: 1 } },
  })
}

/** What the provider said, once we are out of the transaction. */
export const REFUND_OUTCOMES = Object.freeze({
  SUCCEEDED: 'SUCCEEDED',
  DECLINED: 'DECLINED',
  FAILED: 'FAILED',
  /** No definite answer. The money may or may not have moved. */
  TIMEOUT: 'TIMEOUT',
})

/**
 * Call the provider. No transaction may be open when this runs.
 *
 * Never throws for a refund outcome — a refusal and a timeout are results, not
 * exceptions. It still throws for a programming error, which is not one.
 *
 * @param {object} payments The payment provider.
 * @param {object} refund The SUBMITTED refund.
 * @param {object} payment The payment it is against.
 * @returns {Promise<{outcome: string, providerRefundId: string|null, failureCode: string|null, rawStatus: string|null}>} What happened.
 */
export async function submitOutsideTransaction(payments, refund, payment) {
  try {
    const result = await payments.refund(payment.providerRef, {
      amountCents: refund.amountCents,
      currency: refund.currency,
      reason: refund.reasonNote ?? refund.reason,
    })

    return {
      outcome: REFUND_OUTCOMES.SUCCEEDED,
      // Stored as the provider gave it. Nothing here invents an identifier to
      // make the row look complete.
      providerRefundId: result?.refundId ?? result?.id ?? null,
      failureCode: null,
      rawStatus: result?.status ?? null,
    }
  } catch (error) {
    if (error?.code === PROVIDER_ERROR_CODES.PAYMENT_TIMEOUT) {
      return {
        outcome: REFUND_OUTCOMES.TIMEOUT,
        providerRefundId: null,
        failureCode: null,
        rawStatus: 'TIMEOUT',
      }
    }

    if (error?.code === PROVIDER_ERROR_CODES.PAYMENT_DECLINED) {
      return {
        outcome: REFUND_OUTCOMES.DECLINED,
        providerRefundId: null,
        failureCode: error.details?.failureCode ?? 'refund_declined',
        rawStatus: 'DECLINED',
      }
    }

    return {
      outcome: REFUND_OUTCOMES.FAILED,
      providerRefundId: null,
      failureCode: typeof error?.code === 'string' ? error.code : 'REFUND_FAILED',
      rawStatus: 'FAILED',
    }
  }
}

/**
 * Give the tickets and seats back, according to policy.
 *
 * Whole tickets only, and the seat policy is explicit. A seat is never silently
 * returned to sale: either it goes back with `RESELL`, or it is `BLOCKED` with
 * a reason an organiser can read, and both outcomes are recorded.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.refund The refund being settled.
 * @param {string} params.seatPolicy One of {@link SEAT_POLICIES}.
 * @param {Date} params.now The instant.
 * @returns {Promise<{ticketsRevoked: number, seatsReturned: number, seatsWithheld: number}>} What moved.
 */
export async function revokeAndReturn(tx, { refund, seatPolicy, now }) {
  const items = await tx.refundItem.findMany({ where: { refundId: refund.id } })

  let ticketsRevoked = 0
  let seatsReturned = 0
  let seatsWithheld = 0

  for (const item of items) {
    const tickets = await tx.ticket.findMany({
      where: { orderItemId: item.orderItemId, status: { in: ['VALID', 'TRANSFER_PENDING'] } },
      orderBy: { createdAt: 'asc' },
      take: item.quantity,
    })

    for (const ticket of tickets) {
      // Conditional on the status it was read in: a ticket checked in between
      // the read and the write has been used, and a used ticket must not be
      // quietly turned into a refunded one behind the person at the door.
      const { count } = await tx.ticket.updateMany({
        where: { id: ticket.id, status: ticket.status },
        data: {
          status: 'REFUNDED',
          revokedAt: now,
          revokedReason: `refund:${refund.id}`,
          // The pass dies with the ticket. `revokeTicket` has always cleared
          // the digest and bumped the version; this path did not, so a refunded
          // ticket kept a credential that still resolved to its row by digest.
          // Every gate that matters refused it — `admissionRefusal`, the
          // check-in trigger and the pass route's own 409 — so this was an
          // asymmetry rather than an open door, and an asymmetry in exactly the
          // place a reader would assume symmetry. It matters most for a ticket
          // that was transferred away before the refund: the person holding a
          // live-looking pass is then somebody who was never told.
          credentialHash: null,
          credentialVersion: { increment: 1 },
        },
      })

      if (count === 0) continue

      ticketsRevoked += 1

      if (!ticket.eventSeatId) continue

      if (seatPolicy === SEAT_POLICIES.RESELL) {
        await tx.eventSeat.updateMany({
          where: { id: ticket.eventSeatId, status: 'SOLD' },
          data: { status: 'AVAILABLE', orderItemId: null, holdId: null },
        })
        seatsReturned += 1
      } else {
        await tx.eventSeat.updateMany({
          where: { id: ticket.eventSeatId, status: 'SOLD' },
          data: {
            status: 'BLOCKED',
            orderItemId: null,
            holdId: null,
            blockedReason: `refunded too close to the event (refund ${refund.id})`,
          },
        })
        seatsWithheld += 1
      }
    }

    await tx.orderItem.update({
      where: { id: item.orderItemId },
      data: {
        refundedQuantity: { increment: Math.min(item.quantity, tickets.length) },
        refundedCents: { increment: item.amountCents },
      },
    })
  }

  return { ticketsRevoked, seatsReturned, seatsWithheld }
}

/**
 * Record a settled refund: the money, the tickets, the ledger.
 *
 * One transaction, conditional on the refund still being SUBMITTED. That single
 * condition is what stops a webhook and a re-query from both settling one
 * refund — and settling twice would revoke twice as many tickets and post the
 * ledger twice.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.refund The SUBMITTED refund.
 * @param {object} params.order The order it is against.
 * @param {object} params.result What the provider said.
 * @param {string} params.organizationId Whose event it was.
 * @param {string} [params.seatPolicy] An explicit seat policy, when one was chosen.
 * @param {Date|null} [params.eventStartsAt] When the event starts, for the default policy.
 * @param {string|null} [params.actorId] Who settled it. Null for a system job.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{settled: boolean, ticketsRevoked?: number, seatsReturned?: number, seatsWithheld?: number}>} What happened.
 */
export async function settleRefund(tx, params) {
  const {
    refund,
    order,
    result,
    organizationId,
    seatPolicy,
    eventStartsAt = null,
    actorId = null,
    requestId = null,
    now,
  } = params

  const policy = seatPolicyFor({ eventStartsAt, now, override: seatPolicy })

  const applied = await transition(tx, {
    refund,
    to: REFUND_STATES.SUCCEEDED,
    data: {
      providerRefundId: result.providerRefundId,
      rawProviderStatus: result.rawStatus,
      settledAt: now,
      ticketsRevoked: true,
      inventoryReturned: policy === SEAT_POLICIES.RESELL,
    },
  })

  if (!applied) return { settled: false }

  // The reservation becomes a settlement. Both counters move in one statement
  // so their sum never dips below the amount actually owed.
  await tx.order.update({
    where: { id: order.id },
    data: {
      refundedCents: { increment: refund.amountCents },
      refundPendingCents: { decrement: refund.amountCents },
      ...(order.refundedCents + refund.amountCents >= order.totalCents
        ? { status: 'REFUNDED' }
        : {}),
    },
  })

  const moved = await revokeAndReturn(tx, { refund, seatPolicy: policy, now })

  const split = refund.allocation ?? splitRefund(order, refund.amountCents)

  // Two batches, not one. "We owe this back" and "it has gone" are different
  // facts, and a report that conflates them overstates what has left the
  // account.
  await postBatch(
    tx,
    refundBatch({
      refundedCents: refund.amountCents,
      organizerShareCents: split.faceValueCents,
      platformFeeRefundCents: split.feeCents,
      taxRefundCents: split.taxCents,
      currency: refund.currency,
      organizationId,
      reference: refund.id,
    }),
    {
      sourceType: 'REFUND',
      sourceId: refund.id,
      reference: `RF-${refund.id}`,
      orderId: order.id,
      refundId: refund.id,
      actorId,
      now,
    },
  )

  await postBatch(
    tx,
    refundSettledBatch({
      refundedCents: refund.amountCents,
      currency: refund.currency,
      organizationId,
      reference: refund.id,
    }),
    {
      sourceType: 'REFUND',
      sourceId: refund.id,
      reference: `RS-${refund.id}`,
      discriminator: 'settled',
      orderId: order.id,
      refundId: refund.id,
      actorId,
      now,
    },
  )

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.REFUND_SETTLED,
    entityType: 'Refund',
    entityId: refund.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      orderId: order.id,
      amountCents: refund.amountCents,
      currency: refund.currency,
      providerRefundId: result.providerRefundId,
      seatPolicy: policy,
      ...moved,
      source: actorId ? 'operator' : 'system',
    },
  })

  return { settled: true, ...moved, seatPolicy: policy }
}

/**
 * Record a refund the provider refused or could not complete.
 *
 * The reservation is released, because nothing moved and the money is
 * refundable again. That is the difference between this and a timeout.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.refund The SUBMITTED refund.
 * @param {object} params.order The order.
 * @param {object} params.result What the provider said.
 * @param {string|null} [params.actorId] For the audit trail.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{applied: boolean, status: string}>} What was written.
 */
export async function recordRefundFailure(tx, params) {
  const { refund, order, result, actorId = null, requestId = null, now } = params

  const status =
    result.outcome === REFUND_OUTCOMES.DECLINED ? REFUND_STATES.DECLINED : REFUND_STATES.FAILED

  const applied = await transition(tx, {
    refund,
    to: status,
    data: { failureCode: result.failureCode, rawProviderStatus: result.rawStatus },
  })

  if (!applied) return { applied: false, status: refund.status }

  await tx.order.update({
    where: { id: order.id },
    data: { refundPendingCents: { decrement: refund.amountCents } },
  })

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.REFUND_FAILED,
    entityType: 'Refund',
    entityId: refund.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      orderId: order.id,
      amountCents: refund.amountCents,
      currency: refund.currency,
      failureCode: result.failureCode,
      newStatus: status,
      source: actorId ? 'operator' : 'system',
    },
  })

  return { applied: true, status }
}

/**
 * Record a refund the provider did not answer.
 *
 * The reservation stays. Releasing it would let somebody refund the same money
 * twice while the first one is still possibly in flight, which is the single
 * most expensive thing this module could get wrong.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.refund The SUBMITTED refund.
 * @param {object} params.order The order.
 * @param {object} params.result What the provider said.
 * @param {string|null} [params.organizationId] Whose work item the task is.
 * @param {string|null} [params.actorId] For the audit trail.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{applied: boolean}>} Whether this call performed the transition.
 */
export async function recordRefundTimeout(tx, params) {
  const {
    refund,
    order,
    result,
    organizationId = null,
    actorId = null,
    requestId = null,
    now,
  } = params

  const applied = await transition(tx, {
    refund,
    to: REFUND_STATES.TIMEOUT,
    data: { rawProviderStatus: result.rawStatus },
  })

  if (!applied) return { applied: false }

  // A flag nothing reads is not a queue.
  await openReconciliation(tx, {
    kind: 'REFUND_UNKNOWN',
    paymentId: refund.paymentId,
    orderId: order.id,
    refundId: refund.id,
    providerRef: null,
    // Scoped, so the organiser's own finance team sees their work item rather
    // than everything landing on a platform queue.
    organizationId,
    localState: {
      refundStatus: REFUND_STATES.TIMEOUT,
      amountCents: refund.amountCents,
      currency: refund.currency,
      at: now.toISOString(),
    },
    lastError: 'the provider did not answer; the refund may or may not have gone',
  })

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.REFUND_TIMEOUT,
    entityType: 'Refund',
    entityId: refund.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      orderId: order.id,
      amountCents: refund.amountCents,
      currency: refund.currency,
      reason: 'PROVIDER_TIMEOUT_REQUIRES_RECONCILIATION',
      reservationHeld: true,
      source: actorId ? 'operator' : 'system',
    },
  })

  return { applied: true }
}

/**
 * Withdraw a refund nobody has submitted.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.refund The refund.
 * @param {object} params.order The order.
 * @param {string} params.reason Why.
 * @param {string|null} params.actorId Who.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<boolean>} Whether this call performed the transition.
 */
export async function cancelRefund(tx, { refund, order, reason, actorId, requestId = null, now }) {
  const applied = await transition(tx, {
    refund,
    to: REFUND_STATES.CANCELLED,
    data: { reasonNote: reason },
  })

  if (!applied) return false

  if (PENDING_STATES.has(refund.status)) {
    await tx.order.update({
      where: { id: order.id },
      data: { refundPendingCents: { decrement: refund.amountCents } },
    })
  }

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.REFUND_CANCELLED,
    entityType: 'Refund',
    entityId: refund.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      orderId: order.id,
      amountCents: refund.amountCents,
      currency: refund.currency,
      previousStatus: refund.status,
      reason,
      source: actorId ? 'operator' : 'system',
    },
  })

  return true
}

/**
 * Load a refund with everything a transition needs, or fail by name.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {string} refundId Which one.
 * @returns {Promise<{refund: object, order: object, payment: object}>} The three rows.
 * @throws {Error} 404 when the refund or its order is gone.
 */
export async function loadRefundContext(tx, refundId) {
  const refund = await tx.refund.findUnique({ where: { id: refundId } })

  if (!refund) throw notFound('No such refund.')

  const order = await tx.order.findUnique({ where: { id: refund.orderId } })

  if (!order) throw httpError(409, 'ORDER_MISSING', 'That refund names an order that is gone.')

  const payment = await tx.payment.findUnique({ where: { id: refund.paymentId } })

  return { refund, order, payment }
}
