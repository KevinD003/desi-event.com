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
 * ## What a refund is made of
 *
 * An order's money has three parts: face value net of any discount, the
 * platform fee and the tax ({@link orderParts}). A refund gives back a share of
 * each, and `Refund.allocation` records which: `{ faceValueCents, feeCents,
 * taxCents, form, whole }`. The ledger batch is posted from it.
 *
 * Only the face value goes onto order lines. `RefundItem.amountCents` and
 * `OrderItem.refundedCents` count face value, which is what the CHECK
 * `order_item_refund_within_line` (`refundedCents <= subtotalCents`) means;
 * spreading fee and tax over the lines as well took a full refund of any order
 * with a fee past that CHECK, after the provider had already paid it back.
 *
 * A refund of everything left (`whole`) withdraws every ticket still standing,
 * free ones included. A partial refund withdraws only the tickets it pays for
 * in full, counted after the discount; money that pays for no whole ticket is
 * recorded on the order and in the split, and withdraws nothing.
 *
 * ## Orders paid at the venue (SPEC3 §10.2)
 *
 * A pay-at-the-venue order paid online only its booking fee and any tax on it;
 * the ticket price is paid at the door, to the organiser, and never comes back
 * through here. So its face value online is 0 ({@link orderParts}), and the
 * fee and tax are shared between its tickets by their **basis**, the net
 * ticket price (`subtotal − discount`, {@link orderBasis}), rather than by a
 * face value it does not have. Every refund records the basis it spoke for
 * (`allocation.basisCents`): a card order's face value, a pay-at-the-venue
 * order's tickets' basis, 0 for the booking fee on its own. Its forms: the
 * whole order (every standing ticket withdrawn, what is left of the fee and
 * tax given back), named tickets (their share of the fee and tax; the lines
 * carry 0), never an amount (422 `AMOUNT_REFUND_NOT_FOR_VENUE_ORDERS`). Money
 * taken at the door is the organiser's to return, and nothing here touches it.
 *
 * ## The booking fee on its own (`fee`, SPEC3 §7.4)
 *
 * The Desi Events team can refund what is left of one order's booking fee and
 * the tax it carried, by hand ({@link requestRefund} with `feeOnly`). It
 * withdraws no ticket, writes no line, is never promoted to the whole order and
 * never moves the order to REFUNDED. The tax it gave back is not shared out
 * again by a later refund of tickets (`feeFormTaxCents`).
 *
 * ## What is never done here
 *
 * No Stripe identifier is invented. In mock mode the provider returns its own
 * references and they are stored as given; nothing in this module manufactures
 * one to make a row look complete.
 *
 * A disputed payment is not refunded here: the dispute decides where that
 * money goes, and a refund on top of a chargeback pays the buyer twice.
 *
 * @module @desi-event/api/lib/refunds
 */

import {
  ACCOUNTS,
  BATCH_KINDS,
  CREDIT,
  DEBIT,
  composeBatch,
  entry,
  refundBatch,
  refundSettledBatch,
} from '@desi-event/ledger'
import { allocateProportionally } from '@desi-event/pricing'
import { PROVIDER_ERROR_CODES } from '@desi-event/providers'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import {
  PAYMENT_TERMS_SENTENCES,
  conflict,
  httpError,
  notFound,
  paymentTermsRefusal,
  unprocessable,
} from './errors.js'
import { postBatch, resolveAccounts } from './ledger.js'
import { settleReferralUsesIfEnded } from './referral-uses.js'
import { lateCaptureLedgerKey, openReconciliation } from './webhook-handlers.js'

/**
 * The ticket states a settling refund revokes: a ticket that still admits and
 * has not been used. `TRANSFER_PENDING` is one — an outstanding offer leaves
 * the holder admissible — and `CHECKED_IN` is not, because an admitted ticket
 * is terminal.
 *
 * @type {ReadonlyArray<string>}
 */
const REFUNDABLE_TICKET_STATES = Object.freeze(['VALID', 'TRANSFER_PENDING'])

/**
 * The `revokedReason` prefixes of tickets withdrawn because their event was
 * deleted or their night cancelled (`withdrawTickets` in `./tickets.js`),
 * which a cancellation refund settles as REFUNDED.
 */
const WITHDRAWN_REASON_PREFIXES = Object.freeze(['event-deleted:', 'session-cancelled:'])

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
 * The booking fee The Desi Events kept when unpaid pay-at-the-venue tickets were
 * cancelled (`venueFeeKeptCents`, SPEC3-XI XU6) is never refundable: it is
 * taken off here, for every caller, and CHECK `order_venue_kept_within_total`
 * refuses a reservation that would reach into it. A card order keeps nothing.
 *
 * @param {object} order An `Order` row.
 * @returns {number} Integer cents, never negative.
 */
export function refundableCents(order) {
  return Math.max(
    0,
    order.totalCents -
      order.refundedCents -
      order.refundPendingCents -
      (order.venueFeeKeptCents ?? 0),
  )
}

/**
 * How many tickets of an order line are left to refund: its quantity, less
 * those refunded, those cancelled unpaid (SPEC3-XI §10.2: gone, never
 * refunded) and those unresolved refunds already hold.
 *
 * @param {{quantity: number, refundedQuantity?: number, venueCancelledQuantity?: number}} item The order line.
 * @param {number} [pending] Tickets of the line unresolved refunds hold.
 * @returns {number} The count; negative only when the line's counters disagree.
 */
export function lineQuantityLeft(item, pending = 0) {
  return item.quantity - (item.refundedQuantity ?? 0) - (item.venueCancelledQuantity ?? 0) - pending
}

/**
 * The dispute states in which a payment is not refunded here.
 *
 * An open chargeback, one under review, one the buyer won, or one closed
 * without a win: in each the dispute decides where the money goes, and a
 * refund sent beside it pays the buyer twice. `WON` does not block (the money
 * stayed with the organiser), and neither do the two `WARNING_*` states, which
 * are enquiries a refund may settle.
 *
 * @type {ReadonlyArray<string>}
 */
export const REFUND_BLOCKING_DISPUTE_STATES = Object.freeze([
  'OPENED',
  'NEEDS_RESPONSE',
  'UNDER_REVIEW',
  'CHARGE_REFUNDED',
  'LOST',
  'CLOSED',
])

/** The three parts of an order's money, all zero. */
const NO_PARTS = Object.freeze({ faceValueCents: 0, feeCents: 0, taxCents: 0 })

/**
 * The refund forms a request can take. `fee` is the booking fee on its own,
 * refunded by the team at The Desi Events (SPEC3 §7.4).
 */
export const FORMS = Object.freeze({
  WHOLE: 'whole',
  AMOUNT: 'amount',
  LINES: 'lines',
  FEE: 'fee',
})

/** How an order paid at the venue is recorded (`Order.paymentMethod`). */
const AT_VENUE = 'AT_VENUE'

/**
 * Whether an order was booked to pay its ticket price at the venue.
 *
 * @param {{paymentMethod?: string}|null} order An order row.
 * @returns {boolean} True for a pay-at-the-venue order.
 */
export function isAtVenue(order) {
  return order?.paymentMethod === AT_VENUE
}

/**
 * Add up the three parts.
 *
 * @param {{faceValueCents: number, feeCents: number, taxCents: number}} parts The parts.
 * @returns {number} Their sum.
 */
function sumParts(parts) {
  return parts.faceValueCents + parts.feeCents + parts.taxCents
}

/**
 * Read a stored allocation as parts, or nothing when it is not one.
 *
 * @param {unknown} value A `Refund.allocation`.
 * @returns {{faceValueCents: number, feeCents: number, taxCents: number}|null} The parts.
 */
function partsOf(value) {
  if (!value || typeof value !== 'object') return null

  const { faceValueCents, feeCents, taxCents } = /** @type {Record<string, unknown>} */ (value)
  const parts = { faceValueCents, feeCents, taxCents }

  return Object.values(parts).every((part) => Number.isInteger(part) && part >= 0)
    ? /** @type {{faceValueCents: number, feeCents: number, taxCents: number}} */ (parts)
    : null
}

/**
 * The answer when an order's numbers do not add up.
 *
 * @param {string} message What does not add up.
 * @param {object} details Context for the log.
 * @returns {Error} A 409.
 */
function totalsInconsistent(message, details) {
  return httpError(409, 'ORDER_TOTALS_INCONSISTENT', message, details)
}

/**
 * What a payment on a disputed order is told.
 *
 * @param {object} details Context for the log.
 * @returns {Error} A 409 `PAYMENT_DISPUTED`.
 */
function paymentDisputed(details) {
  return httpError(
    409,
    'PAYMENT_DISPUTED',
    'This payment is disputed, so it is not refunded here: the dispute decides where the money goes. The finance team can look at it.',
    details,
  )
}

/**
 * What a retried refund is told when its money has gone elsewhere.
 *
 * @param {object} details Context for the log.
 * @returns {Error} A 409 `REFUND_BALANCE_GONE`.
 */
function balanceGone(details) {
  return httpError(
    409,
    'REFUND_BALANCE_GONE',
    'This order no longer has what this refund was for left to refund: another refund has taken part of it since this one failed. Cancel this refund and ask for what is left.',
    details,
  )
}

/**
 * What a refund is told, before anything is sent, when its lines cannot settle.
 *
 * @param {object} details Context for the log.
 * @returns {Error} A 409 `REFUND_LINES_INVALID`.
 */
function linesInvalid(details) {
  return httpError(
    409,
    'REFUND_LINES_INVALID',
    'This refund gives back more on one of the order’s lines than that line has left, so it was not sent: settling it would fail after the money had gone. It was worked out before refunds kept fee and tax off the lines, or another refund has since given back part of those tickets. Cancel this refund and ask for what is left.',
    details,
  )
}

/**
 * What a refund is told, before anything is sent, when it holds no reservation.
 *
 * @param {object} details Context for the log.
 * @returns {Error} A 409 `REFUND_NOT_RESERVED`.
 */
function notReserved(details) {
  return httpError(
    409,
    'REFUND_NOT_RESERVED',
    'This refund is not reserved against its order, so it was not sent: settling it would fail after the money had gone. Cancel this refund and ask for what is left.',
    details,
  )
}

/**
 * The three parts of what an order was paid.
 *
 * Read off the order's own stored totals, which checkout wrote from
 * `computeOrderTotals`: face value net of the discount, the platform fee, and
 * the tax. They must add up to the total. When they do not, nothing is worked
 * out from them: a refund split from numbers that disagree would post a ledger
 * batch that is wrong in a way nobody would look for.
 *
 * A pay-at-the-venue order's face value online is 0: its ticket price, net of
 * the discount, is what it owes at the door (`venueDueCents`), and its total
 * is the booking fee and any tax on it. A card order owes nothing at the door,
 * so its parts are what they always were.
 *
 * @param {object} order An `Order` row.
 * @returns {{faceValueCents: number, feeCents: number, taxCents: number}} The parts.
 * @throws {Error} 409 `ORDER_TOTALS_INCONSISTENT` when they do not add up to `totalCents`.
 */
export function orderParts(order) {
  const parts = {
    faceValueCents:
      (order.subtotalCents ?? 0) - (order.discountCents ?? 0) - (order.venueDueCents ?? 0),
    feeCents: order.feesCents ?? 0,
    taxCents: order.taxCents ?? 0,
  }
  const sane = Object.values(parts).every((part) => Number.isInteger(part) && part >= 0)

  if (!sane || sumParts(parts) !== order.totalCents) {
    throw totalsInconsistent(
      'This order’s recorded face value, fee and tax do not add up to its total, so no refund is worked out from them. The finance team can look at it.',
      { orderId: order.id, ...parts, totalCents: order.totalCents },
    )
  }

  return parts
}

/**
 * An order's net ticket price: its subtotal less its discount, whether it is
 * paid by card or at the door (SPEC3 §10.2). Shares of the fee and the tax are
 * apportioned by it, so a pay-at-the-venue order's tickets share its booking
 * fee exactly as a card order's tickets share theirs.
 *
 * @param {object} order An `Order` row.
 * @returns {number} Integer cents.
 */
export function orderBasis(order) {
  return (order.subtotalCents ?? 0) - (order.discountCents ?? 0)
}

/**
 * The basis a stored allocation spoke for: its own `basisCents` when it has
 * one (every refund since paying at the venue was built), else its face value
 * (every refund before it, all of card orders, where the two are the same).
 *
 * @param {unknown} allocation A `Refund.allocation`.
 * @param {{faceValueCents: number}} parts Its parts.
 * @returns {number} Integer cents.
 */
function basisOfAllocation(allocation, parts) {
  const stored = allocation && typeof allocation === 'object' ? allocation.basisCents : undefined

  return Number.isInteger(stored) && stored >= 0 ? stored : parts.faceValueCents
}

/**
 * What a refund of named tickets is shared out by (SPEC3 §10.2): the order's
 * basis, the basis other refunds already spoke for, and the tax a refund of
 * the booking fee on its own already gave back, which is not shared out again.
 *
 * A card order's basis is its face value and what other refunds took of it,
 * so its tickets' shares are worked out exactly as they always were; only a
 * booking-fee refund's tax changes them, and only on an order taxed on its fee.
 *
 * @param {object} order An `Order` row.
 * @param {{faceValueCents: number, feeCents: number, taxCents: number, basisCents?: number, feeFormTaxCents?: number}} spoken From {@link partsSpokenFor}.
 * @returns {{atVenue: boolean, orderBasisCents: number, takenBasisCents: number|null, feeTaxTakenCents: number}} The working.
 */
export function shareBasisOf(order, spoken) {
  const atVenue = isAtVenue(order)

  return {
    atVenue,
    orderBasisCents: orderBasis(order),
    // A card order counts what was taken of its face value, as it always
    // did; a pay-at-the-venue order, the basis its refunds spoke for.
    takenBasisCents: atVenue ? (spoken?.basisCents ?? 0) : null,
    feeTaxTakenCents: spoken?.feeFormTaxCents ?? 0,
  }
}

/**
 * Whether a refund row is one event cancellation wrote before refunds reserved.
 *
 * Those rows were written with `createMany`: no reservation against the order,
 * no lines and no allocation. They can never settle as they are — settling
 * would take `refundPendingCents` below zero — so they are repaired on first
 * touch ({@link repairUnreservedRefund}), and withdrawing one releases nothing.
 *
 * @param {object} refund A `Refund` row.
 * @param {number} refundItemCount How many `RefundItem` rows it has.
 * @returns {boolean} True for an unreserved cancellation refund.
 */
export function isUnreservedLegacyRefund(refund, refundItemCount) {
  return (
    refund?.reason === 'EVENT_CANCELLED' &&
    (refund.allocation === null || refund.allocation === undefined) &&
    (refund.status === REFUND_STATES.REQUESTED || refund.status === REFUND_STATES.APPROVED) &&
    refundItemCount === 0
  )
}

/**
 * The parts of an order other refunds have already given back or promised.
 *
 * Every refund still in flight and every settled one, read from its
 * `allocation`. A row whose allocation is missing, or does not add up to its
 * amount, counts as `splitRefund` of its amount, so the sum always matches the
 * counters the order carries. An unreserved cancellation refund is left out,
 * because the counters do not carry it either.
 *
 * Beside the three parts it sums the basis they spoke for (`basisCents`,
 * {@link basisOfAllocation}) and the tax the booking-fee refunds gave back
 * (`feeFormTaxCents`), which a later refund of tickets does not share out
 * again (SPEC3 §10.2).
 *
 * The booking fee kept when unpaid tickets were cancelled is spoken for too
 * (SPEC3-XI §10.2): `{ faceValueCents: 0, feeCents: venueFeeKeptCents,
 * taxCents: 0, basisCents: venueCancelledBasisCents }`. So what is left
 * excludes kept money for every form — whole, lines, the booking fee on its
 * own, a night's quote, the drivers — and the basis already taken counts the
 * cancelled tickets, keeping every later share exact. 0 on a card order.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {object} order The order, with its totals.
 * @param {object} [options] Options.
 * @param {string|null} [options.excludeRefundId] A refund to leave out, when it is the one being decided.
 * @returns {Promise<{faceValueCents: number, feeCents: number, taxCents: number, basisCents: number, feeFormTaxCents: number}>} The parts spoken for.
 */
export async function partsSpokenFor(tx, order, { excludeRefundId = null } = {}) {
  const rows = await tx.refund.findMany({
    where: { orderId: order.id, status: { in: [...PENDING_STATES, REFUND_STATES.SUCCEEDED] } },
  })
  const counted = rows.filter((row) => row.id !== excludeRefundId)
  const legacyShaped = counted.filter((row) => isUnreservedLegacyRefund(row, 0))
  const itemCounts = new Map()

  if (legacyShaped.length > 0) {
    const items = await tx.refundItem.findMany({
      where: { refundId: { in: legacyShaped.map((row) => row.id) } },
    })

    for (const item of items) {
      itemCounts.set(item.refundId, (itemCounts.get(item.refundId) ?? 0) + 1)
    }
  }

  const spoken = { ...NO_PARTS, basisCents: 0, feeFormTaxCents: 0 }

  for (const row of counted) {
    if (isUnreservedLegacyRefund(row, itemCounts.get(row.id) ?? 0)) continue

    const stored = partsOf(row.allocation)
    const exact = stored && sumParts(stored) === row.amountCents
    const parts = exact ? stored : splitRefund(order, row.amountCents)

    spoken.faceValueCents += parts.faceValueCents
    spoken.feeCents += parts.feeCents
    spoken.taxCents += parts.taxCents
    spoken.basisCents += exact ? basisOfAllocation(row.allocation, parts) : parts.faceValueCents

    if (exact && row.allocation?.form === FORMS.FEE) spoken.feeFormTaxCents += parts.taxCents
  }

  // What unpaid tickets' cancellations kept: their share of the fee, for good,
  // and the door price no longer owed for them.
  spoken.feeCents += order.venueFeeKeptCents ?? 0
  spoken.basisCents += order.venueCancelledBasisCents ?? 0

  return spoken
}

/**
 * What is left of each part once other refunds are counted.
 *
 * @param {{faceValueCents: number, feeCents: number, taxCents: number}} parts The order's parts.
 * @param {{faceValueCents: number, feeCents: number, taxCents: number}} spoken What other refunds hold.
 * @returns {{faceValueCents: number, feeCents: number, taxCents: number}} Each part left, never negative.
 */
export function partsLeft(parts, spoken) {
  return {
    faceValueCents: Math.max(0, parts.faceValueCents - spoken.faceValueCents),
    feeCents: Math.max(0, parts.feeCents - spoken.feeCents),
    taxCents: Math.max(0, parts.taxCents - spoken.taxCents),
  }
}

/**
 * Split one refund across face value, fee and tax.
 *
 * Three forms:
 *
 * - **whole** — everything left on the order. The split is `left`.
 * - **amount** — a sum. Fee and tax take their proportional share of it,
 *   rounded, each capped by what is left of it and by the amount; the face
 *   value is the rest, so it is never negative. A face value above what is
 *   left moves into fee and then tax, within what is left of them.
 * - **lines** — named tickets. The face value is theirs, net of the discount;
 *   fee and tax follow in proportion to their basis — the face value on a card
 *   order, the net ticket price on a pay-at-the-venue order, whose face value
 *   online is 0 — floored cumulatively from what earlier refunds already took,
 *   so successive line refunds add up to exactly the order's fee and tax (the
 *   tax less what a refund of the booking fee on its own already gave back).
 *
 * @param {object} options Options.
 * @param {{faceValueCents: number, feeCents: number, taxCents: number}} options.parts The order's parts.
 * @param {{faceValueCents: number, feeCents: number, taxCents: number}} options.left What is left of each.
 * @param {'whole'|'amount'|'lines'} options.form Which form.
 * @param {number} [options.amountCents] The amount, for `whole` and `amount`.
 * @param {number} [options.lineFaceCents] The named tickets' net face value, for `lines`.
 * @param {number|null} [options.lineBasisCents] The named tickets' basis, for `lines`; their face value when not given.
 * @param {number|null} [options.takenBasisCents] The basis earlier refunds spoke for; the face value they took when not given.
 * @param {number|null} [options.orderBasisCents] The order's basis ({@link orderBasis}); its face value when not given.
 * @param {number} [options.feeTaxTakenCents] Tax given back by refunds of the booking fee on its own, not shared out again.
 * @param {boolean} [options.lastShare] For `lines`: the named tickets are the last the order has to give back ({@link basisLeftWhenLast}), so they take the fee and tax left whole.
 * @returns {{faceValueCents: number, feeCents: number, taxCents: number}} The split. For `lines`, its sum is the refund amount.
 * @throws {Error} 409 `ORDER_TOTALS_INCONSISTENT` when the amount exceeds everything left.
 */
export function refundPartsFor({
  parts,
  left,
  form,
  amountCents = 0,
  lineFaceCents = 0,
  lineBasisCents = null,
  takenBasisCents = null,
  orderBasisCents = null,
  feeTaxTakenCents = 0,
  lastShare = false,
}) {
  if (form === FORMS.LINES) {
    const face = lineFaceCents
    const basis = orderBasisCents ?? parts.faceValueCents

    if (basis <= 0) return { faceValueCents: face, feeCents: 0, taxCents: 0 }

    // The last tickets of a pay-at-the-venue order take what is left of the
    // fee and its tax: the cents rounding left behind have no other ticket to
    // go with, and without them the order could never end REFUNDED.
    if (lastShare) return { faceValueCents: face, feeCents: left.feeCents, taxCents: left.taxCents }

    const taken = takenBasisCents ?? parts.faceValueCents - left.faceValueCents
    const named = lineBasisCents ?? face
    const shareOf = (whole) =>
      Math.max(
        0,
        Math.floor((whole * (taken + named)) / basis) - Math.floor((whole * taken) / basis),
      )

    return {
      faceValueCents: face,
      feeCents: Math.min(left.feeCents, shareOf(parts.feeCents)),
      taxCents: Math.min(left.taxCents, shareOf(Math.max(0, parts.taxCents - feeTaxTakenCents))),
    }
  }

  if (form === FORMS.WHOLE && sumParts(left) === amountCents) return { ...left }

  // The amount form, and a whole refund whose parts disagree with the order's
  // counters (they can only when a stored allocation was edited by hand): the
  // proportional split, inside what is left.
  const total = sumParts(parts)

  if (total <= 0 || amountCents > sumParts(left)) {
    throw totalsInconsistent(
      'This order’s refunds and its totals disagree about what is left, so no refund is worked out from them. The finance team can look at it.',
      { requested: amountCents, left },
    )
  }

  let fee = Math.min(left.feeCents, Math.round((parts.feeCents * amountCents) / total), amountCents)
  let tax = Math.min(
    left.taxCents,
    Math.round((parts.taxCents * amountCents) / total),
    amountCents - fee,
  )
  let face = amountCents - fee - tax

  if (face > left.faceValueCents) {
    let excess = face - left.faceValueCents
    const moreFee = Math.min(excess, left.feeCents - fee)

    face = left.faceValueCents
    fee += moreFee
    excess -= moreFee

    const moreTax = Math.min(excess, left.taxCents - tax)

    tax += moreTax
  }

  return { faceValueCents: face, feeCents: fee, taxCents: tax }
}

/**
 * Each line's share of the order's discount, as checkout spread it.
 *
 * @param {Array<object>} items The order's lines.
 * @param {number} discountCents The order's discount.
 * @returns {Map<string, number>} Line id to its share.
 */
function discountSharesByLine(items, discountCents) {
  const shares =
    discountCents > 0 && items.length > 0
      ? allocateProportionally(
          discountCents,
          items.map((item) => item.subtotalCents),
        )
      : items.map(() => 0)

  return new Map(items.map((item, index) => [item.id, shares[index] ?? 0]))
}

/**
 * What the next `count` tickets on a line cost after the discount.
 *
 * Ticket by ticket, as {@link allocateNamedLines} prices them: `unit × count`
 * less the discount those tickets carry, counted from the `before` tickets
 * already refunded or asked for, so successive refunds of one line add up to
 * exactly its share of the discount.
 *
 * @param {object} item The order line.
 * @param {number} share The line's share of the discount.
 * @param {number} before Tickets on the line already refunded or asked for.
 * @param {number} count How many more.
 * @returns {number} Integer cents.
 */
function netCostOfTickets(item, share, before, count) {
  const discount =
    share > 0
      ? Math.floor((share * (before + count)) / item.quantity) -
        Math.floor((share * before) / item.quantity)
      : 0

  return item.unitPriceCents * count - discount
}

/**
 * What each line still has to give back: its subtotal, less its share of the
 * discount, less what settled refunds put on it and what unresolved ones hold.
 *
 * This is the room the line CHECK (`refundedCents <= subtotalCents`) leaves,
 * net of the discount the line never collected.
 *
 * @param {Array<object>} items The order's lines, as they stand.
 * @param {number} discountCents The order's discount.
 * @param {Map<string, number>} pendingCentsByLine Face value unresolved refunds hold, per line.
 * @returns {Map<string, number>} Line id to cents, never negative.
 */
function roomOnLines(items, discountCents, pendingCentsByLine) {
  const shares = discountSharesByLine(items, discountCents)

  return new Map(
    items.map((item) => [
      item.id,
      Math.max(
        0,
        item.subtotalCents -
          (shares.get(item.id) ?? 0) -
          (item.refundedCents ?? 0) -
          (pendingCentsByLine.get(item.id) ?? 0),
      ),
    ]),
  )
}

/**
 * How many whole tickets a line's share pays for, counted after the discount.
 *
 * Ticket by ticket, the way {@link allocateNamedLines} prices them: the next
 * `n` tickets cost `unit × n` less the discount they carry, counted from the
 * tickets already refunded or asked for.
 *
 * @param {object} line A working line from {@link allocateAcrossLines}.
 * @param {number} amountCents The line's share of the face value.
 * @returns {number} The largest whole number of tickets that share pays for.
 */
function ticketsPaidFor(line, amountCents) {
  const { item, share, remainingQuantity } = line

  if (item.unitPriceCents <= 0 || remainingQuantity <= 0) return 0

  const before = item.quantity - remainingQuantity
  let paid = 0

  for (let count = 1; count <= remainingQuantity; count += 1) {
    if (netCostOfTickets(item, share, before, count) > amountCents) break

    paid = count
  }

  return paid
}

/**
 * Work out what each order line gives back, for a face value.
 *
 * **`amountCents` is face value only**: fee and tax are not a line's to give
 * back, and live in `Refund.allocation`. The spread is proportional to what
 * each line has left — its subtotal, less its share of the discount (the same
 * `allocateProportionally` checkout uses), less what refunds have already put
 * on it — with the rounding remainder on the biggest line and no line given
 * more than it has left; what overflows goes to the next line with room. What
 * no line has room for (only possible when older rows put fee or tax on a
 * line) is not given to one, and stays on the order.
 *
 * Tickets: a `whole` refund withdraws every ticket still standing on every
 * line, free lines included; a partial one withdraws the tickets its share pays
 * for in full ({@link ticketsPaidFor}) and nothing for a share that pays for
 * none. The old call with `items` and `amountCents` alone still works.
 *
 * @param {object} options Options.
 * @param {Array<object>} options.items The order's lines.
 * @param {number} options.amountCents The face value being refunded.
 * @param {number} [options.discountCents] The order's discount.
 * @param {Map<string, number>} [options.pendingByLine] Tickets unresolved refunds already hold, per line.
 * @param {Map<string, number>} [options.pendingCentsByLine] Face value unresolved refunds already hold, per line.
 * @param {boolean} [options.whole] Whether this is everything left on the order.
 * @returns {Array<{orderItemId: string, amountCents: number, quantity: number}>} The allocation, in line order.
 */
export function allocateAcrossLines({
  items,
  amountCents,
  discountCents = 0,
  pendingByLine = new Map(),
  pendingCentsByLine = new Map(),
  whole = false,
}) {
  const shares =
    discountCents > 0 && items.length > 0
      ? allocateProportionally(
          discountCents,
          items.map((item) => item.subtotalCents),
        )
      : items.map(() => 0)

  const lines = items.map((item, index) => ({
    item,
    share: shares[index] ?? 0,
    remainingNet: Math.max(
      0,
      item.subtotalCents -
        (shares[index] ?? 0) -
        (item.refundedCents ?? 0) -
        (pendingCentsByLine.get(item.id) ?? 0),
    ),
    remainingQuantity: Math.max(0, lineQuantityLeft(item, pendingByLine.get(item.id) ?? 0)),
    amountCents: 0,
  }))

  const room = lines.reduce((sum, line) => sum + line.remainingNet, 0)

  if (amountCents > 0 && room > 0) {
    for (const line of lines) {
      line.amountCents = Math.min(
        line.remainingNet,
        Math.floor((amountCents * line.remainingNet) / room),
      )
    }

    // The remainder. Put on the biggest line rather than spread, because a
    // one-cent difference on one line is easier to explain than a cent
    // distributed across five — and never past what a line has left, which
    // is what the line CHECK is written against.
    let remainder = amountCents - lines.reduce((sum, line) => sum + line.amountCents, 0)
    const biggestFirst = [...lines].sort((a, b) => b.remainingNet - a.remainingNet)

    for (const line of biggestFirst) {
      if (remainder <= 0) break

      const add = Math.max(0, Math.min(remainder, line.remainingNet - line.amountCents))

      line.amountCents += add
      remainder -= add
    }
  }

  return lines
    .map((line) => ({
      orderItemId: line.item.id,
      amountCents: line.amountCents,
      // Whole tickets only: a refund of half a ticket's value does not revoke
      // half a ticket, and rounding up would revoke one the buyer still paid for.
      quantity: whole ? line.remainingQuantity : ticketsPaidFor(line, line.amountCents),
    }))
    .filter((line) => line.amountCents > 0 || (whole && line.quantity > 0))
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
 * ## A discounted order
 *
 * A promo code took money off the order as a whole, spread over its lines in
 * proportion to their subtotals — the same `allocateProportionally` checkout
 * uses. A ticket refunded by line gives back what was paid for it, so each
 * line's share of the discount is netted off, ticket by ticket: the first `n`
 * tickets of a line carry `floor(share × n / quantity)` of it. Counting from
 * the tickets already refunded or asked for means the parts of several partial
 * refunds add up to exactly the line's share, never a cent more.
 *
 * ## A line with less left than its tickets cost
 *
 * With `roomByLine`, no line is given more than it has left to give back. A
 * line can have less left than its remaining tickets cost when an earlier
 * refund put more on it than the tickets it withdrew — an amount refund worked
 * out before 2026-09-30 spread fee and tax over the lines. Those tickets'
 * value already went back in part, so they are refunded for what the line has
 * left; asking the line for their full price would take it past its subtotal,
 * which the line CHECK refuses in settlement, after the provider has paid.
 *
 * @param {object} options Options.
 * @param {Array<object>} options.items The order's lines.
 * @param {Array<{orderItemId: string, quantity: number}>} options.lines What to give back.
 * @param {Map<string, number>} [options.pendingByLine] Quantities already spoken for by unresolved refunds.
 * @param {number} [options.discountCents] The order's discount, netted off line by line.
 * @param {Map<string, number>|null} [options.roomByLine] What each line has left to give back; each line's amount is capped by it.
 * @returns {{allocation: Array<{orderItemId: string, amountCents: number, quantity: number}>, amountCents: number}} The allocation and its total.
 * @throws {Error} 422 for a line that is not on the order, a quantity it cannot cover, or lines worth nothing.
 */
export function allocateNamedLines(options) {
  const named = priceNamedLines(options)

  if (named.amountCents <= 0) {
    // A line of free tickets. The tickets are still revoked, but that is a
    // revocation rather than a refund, and routing it through a payment
    // provider would ask for zero cents back from a real processor.
    throw unprocessable('Those lines are worth nothing, so there is nothing to refund.', {
      lines: options.lines,
    })
  }

  return named
}

/**
 * Price named lines as {@link allocateNamedLines} does, and answer lines worth
 * nothing with a total of zero rather than a refusal, so a caller that asks
 * for many orders' lines at once can tell "worth nothing" apart from every
 * other refusal.
 *
 * @param {object} options As {@link allocateNamedLines} takes them.
 * @param {Array<object>} options.items The order's lines.
 * @param {Array<{orderItemId: string, quantity: number}>} options.lines What to give back.
 * @param {Map<string, number>} [options.pendingByLine] Quantities already spoken for by unresolved refunds.
 * @param {number} [options.discountCents] The order's discount, netted off line by line.
 * @param {Map<string, number>|null} [options.roomByLine] What each line has left to give back.
 * @returns {{allocation: Array<{orderItemId: string, amountCents: number, quantity: number}>, amountCents: number}} The allocation and its total, which may be zero.
 * @throws {Error} 422 for a line that is not on the order, or a quantity it cannot cover.
 */
export function priceNamedLines({
  items,
  lines,
  pendingByLine = new Map(),
  discountCents = 0,
  roomByLine = null,
}) {
  const byId = new Map(items.map((item) => [item.id, item]))
  const wanted = new Map()
  const shares =
    discountCents > 0 && items.length > 0
      ? allocateProportionally(
          discountCents,
          items.map((item) => item.subtotalCents),
        )
      : items.map(() => 0)
  const shareByLine = new Map(items.map((item, index) => [item.id, shares[index] ?? 0]))

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

    const available = lineQuantityLeft(item, pendingByLine.get(orderItemId) ?? 0)

    if (quantity > available) {
      throw unprocessable(
        available <= 0
          ? 'Every ticket on that line has already been refunded or is being refunded.'
          : `That line has ${available} ticket(s) left to refund.`,
        { orderItemId, requested: quantity, available },
      )
    }

    // The line's discount carried by these tickets: counted from those already
    // refunded or asked for, so successive partial refunds sum to the share.
    const share = shareByLine.get(orderItemId) ?? 0
    const before = item.quantity - available
    const discountOnThese =
      share > 0
        ? Math.floor((share * (before + quantity)) / item.quantity) -
          Math.floor((share * before) / item.quantity)
        : 0
    const lineCents = Math.min(
      item.unitPriceCents * quantity - discountOnThese,
      roomByLine ? Math.max(0, roomByLine.get(orderItemId) ?? 0) : Number.POSITIVE_INFINITY,
    )

    amountCents += lineCents
    allocation.push({ orderItemId, amountCents: lineCents, quantity })
  }

  return { allocation, amountCents }
}

/**
 * Named tickets' face value, brought down to what the order has left of it.
 *
 * A sum refunded earlier without tickets (the amount form) gave back face
 * value that `OrderItem.refundedCents` never saw, because that column moves
 * only with the tickets a refund withdraws. The tickets it left standing then
 * cost more than the order has left to give back, and `requestRefund` refuses
 * to name them at their price. A caller that must refund them — a cancelled
 * night's tickets — asks for what is left instead: each line's amount is
 * scaled down in proportion (`allocateProportionally`, as checkout spread the
 * discount), and the ticket quantities stay as they are, because the earlier
 * sum already paid part of those tickets back.
 *
 * @param {{allocation: Array<{orderItemId: string, amountCents: number, quantity: number}>, amountCents: number}} named From {@link priceNamedLines}.
 * @param {number} capCents The face value the order has left.
 * @returns {{allocation: Array<{orderItemId: string, amountCents: number, quantity: number}>, amountCents: number}} The same tickets, for no more than `capCents`.
 */
export function capNamedFace(named, capCents) {
  const cap = Math.max(0, capCents)

  if (named.amountCents <= cap) return named

  const shares =
    cap > 0
      ? allocateProportionally(
          cap,
          named.allocation.map((line) => line.amountCents),
        )
      : named.allocation.map(() => 0)

  return {
    allocation: named.allocation.map((line, index) => ({
      ...line,
      amountCents: shares[index] ?? 0,
    })),
    amountCents: cap,
  }
}

/**
 * What a refund of named lines comes to: the tickets' face value, net of the
 * discount and within each line's room, and the fee and tax share that
 * follows it (R6). The one working that {@link requestRefund} reserves, and
 * that a preview shows without reserving, so the two cannot disagree.
 *
 * @param {object} options Options.
 * @param {Array<object>} options.items The order's lines, as they stand.
 * @param {Array<{orderItemId: string, quantity: number}>} options.lines What to give back.
 * @param {{quantities: Map<string, number>, cents: Map<string, number>}} options.pending What unresolved refunds hold on each line ({@link pendingLines}).
 * @param {number} options.discountCents The order's discount.
 * @param {{faceValueCents: number, feeCents: number, taxCents: number}} options.parts The order's parts ({@link orderParts}).
 * @param {{faceValueCents: number, feeCents: number, taxCents: number}} options.left What is left of each ({@link partsLeft}).
 * @param {boolean} [options.capFaceToLeft] Bring the face value down to what the order has left ({@link capNamedFace}) instead of letting {@link requestRefund} refuse it.
 * @param {{atVenue: boolean, orderBasisCents: number, takenBasisCents: number|null, feeTaxTakenCents: number}|null} [options.share] What the fee and tax are shared out by ({@link shareBasisOf}); a card order's face value when not given.
 * @returns {{priced: object, named: object, basis: number, split: {faceValueCents: number, feeCents: number, taxCents: number}, amountCents: number}} The tickets at their price, the tickets as asked for, their basis (their price before any cap), the split and its sum.
 * @throws {Error} 422 for a line that is not on the order, or a quantity it cannot cover.
 */
export function quoteNamedLines({
  items,
  lines,
  pending,
  discountCents,
  parts,
  left,
  capFaceToLeft = false,
  share = null,
}) {
  const priced = priceNamedLines({
    items,
    lines,
    pendingByLine: pending.quantities,
    discountCents,
    roomByLine: roomOnLines(items, discountCents, pending.cents),
  })
  // The last tickets a pay-at-the-venue order has to give back speak for the
  // basis left, not their price by position: a promo code's discount can
  // split a line's door price unevenly between its tickets, and a cancellation
  // of unpaid tickets counts their own dues, so prices by position and by
  // ticket can disagree by a cent. The last share squares them.
  const lastBasis = share?.atVenue
    ? basisLeftWhenLast({
        items,
        pendingByLine: pending.quantities,
        taking: wantedByLine(lines),
        orderBasisCents: share.orderBasisCents,
        takenBasisCents: share.takenBasisCents ?? 0,
      })
    : null
  const basis = lastBasis ?? priced.amountCents
  // A pay-at-the-venue order's tickets have no face value online: what they
  // cost is paid at the door, so the lines give back nothing and the refund is
  // their share of the booking fee and its tax, by their basis (SPEC3 §10.2).
  const named = share?.atVenue
    ? {
        allocation: priced.allocation.map((line) => ({ ...line, amountCents: 0 })),
        amountCents: 0,
      }
    : capFaceToLeft
      ? capNamedFace(priced, left.faceValueCents)
      : priced
  const split = refundPartsFor({
    parts,
    left,
    form: FORMS.LINES,
    lineFaceCents: named.amountCents,
    lineBasisCents: share?.atVenue ? basis : null,
    takenBasisCents: share?.takenBasisCents ?? null,
    orderBasisCents: share?.atVenue ? share.orderBasisCents : null,
    feeTaxTakenCents: share?.feeTaxTakenCents ?? 0,
    lastShare: lastBasis !== null,
  })

  return { priced, named, basis, split, amountCents: sumParts(split) }
}

/**
 * How many tickets of each line a request names.
 *
 * @param {Array<{orderItemId: string, quantity: number}>} lines What to give back.
 * @returns {Map<string, number>} Line id to quantity.
 */
function wantedByLine(lines) {
  const wanted = new Map()

  for (const line of lines) {
    wanted.set(line.orderItemId, (wanted.get(line.orderItemId) ?? 0) + line.quantity)
  }

  return wanted
}

/**
 * The basis left on a pay-at-the-venue order when the tickets about to be
 * refunded or cancelled are the last it has to give back: every line's
 * quantity left (less what unresolved refunds hold) is taken by them. Null
 * otherwise, and the tickets speak for their own basis.
 *
 * A ticket still counted on its line — one let in, one standing — keeps the
 * rule from applying, so its share of the fee is never handed to another.
 *
 * @param {object} options Options.
 * @param {Array<object>} options.items Every line of the order, as it stands.
 * @param {Map<string, number>} [options.pendingByLine] Tickets unresolved refunds hold, per line.
 * @param {Map<string, number>} options.taking Tickets this refund or cancellation takes, per line.
 * @param {number} options.orderBasisCents The order's basis ({@link orderBasis}).
 * @param {number} options.takenBasisCents The basis refunds and cancellations already spoke for.
 * @returns {number|null} The basis left, or null when tickets would still be left.
 */
export function basisLeftWhenLast({
  items,
  pendingByLine = new Map(),
  taking,
  orderBasisCents,
  takenBasisCents,
}) {
  if (!items || items.length === 0) return null

  const last = items.every(
    (item) =>
      lineQuantityLeft(item, pendingByLine.get(item.id) ?? 0) - (taking.get(item.id) ?? 0) <= 0,
  )

  return last ? Math.max(0, orderBasisCents - takenBasisCents) : null
}

/**
 * How many tickets on each line are already spoken for by an unresolved refund.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {string} orderId Which order.
 * @returns {Promise<Map<string, number>>} Line id to quantity.
 */
export async function pendingQuantitiesByLine(tx, orderId) {
  const { quantities } = await pendingLines(tx, orderId)

  return quantities
}

/**
 * What unresolved refunds already hold on each line: tickets and face value.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {string} orderId Which order.
 * @param {object} [options] Options.
 * @param {string|null} [options.excludeRefundId] A refund to leave out, when it is the one being decided.
 * @returns {Promise<{quantities: Map<string, number>, cents: Map<string, number>}>} Per line id.
 */
export async function pendingLines(tx, orderId, { excludeRefundId = null } = {}) {
  const refunds = await tx.refund.findMany({
    where: { orderId, status: { in: [...PENDING_STATES] } },
    select: { id: true },
  })
  const ids = refunds.map((refund) => refund.id).filter((id) => id !== excludeRefundId)

  const quantities = new Map()
  const cents = new Map()

  if (ids.length === 0) return { quantities, cents }

  const items = await tx.refundItem.findMany({ where: { refundId: { in: ids } } })

  for (const item of items) {
    quantities.set(item.orderItemId, (quantities.get(item.orderItemId) ?? 0) + item.quantity)
    cents.set(item.orderItemId, (cents.get(item.orderItemId) ?? 0) + item.amountCents)
  }

  return { quantities, cents }
}

/**
 * Whether a payment has a dispute that stops a refund of it.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {string} paymentId Which payment.
 * @returns {Promise<boolean>} True when a dispute in {@link REFUND_BLOCKING_DISPUTE_STATES} names it.
 */
export async function paymentDisputeBlocks(tx, paymentId) {
  const dispute = await tx.dispute.findFirst({
    where: { paymentId, status: { in: [...REFUND_BLOCKING_DISPUTE_STATES] } },
    select: { id: true },
  })

  return Boolean(dispute)
}

/**
 * Split a refund across the parts of the order it came from.
 *
 * Read off the order's stored totals, which came from the pricing snapshot at
 * checkout — not from live fee tables, which may have moved. A full refund
 * gives back everything; a partial one gives back a proportional share of each
 * part, so a half refund returns half the tax and half the fee.
 *
 * A pay-at-the-venue order's face value online is 0 ({@link orderParts}), so
 * its split is fee and tax only, whatever the amount.
 *
 * @param {object} order The order, with its totals.
 * @param {number} amountCents The refund amount.
 * @returns {{faceValueCents: number, feeCents: number, taxCents: number}} The split.
 */
export function splitRefund(order, amountCents) {
  const face = order.subtotalCents - (order.discountCents ?? 0) - (order.venueDueCents ?? 0)

  if (amountCents >= order.totalCents) {
    return {
      faceValueCents: face,
      feeCents: order.feesCents ?? 0,
      taxCents: order.taxCents ?? 0,
    }
  }

  const share = amountCents / order.totalCents
  const taxCents = Math.round((order.taxCents ?? 0) * share)

  if (isAtVenue(order)) {
    // Nothing paid online but the fee and its tax: the fee takes what the tax
    // does not, so the parts still add up to the amount.
    const feeCents = Math.min(order.feesCents ?? 0, amountCents - Math.min(taxCents, amountCents))

    return { faceValueCents: 0, feeCents, taxCents: amountCents - feeCents }
  }

  const feeCents = Math.round((order.feesCents ?? 0) * share)

  return { faceValueCents: amountCents - feeCents - taxCents, feeCents, taxCents }
}

/**
 * Write a refund's lines.
 *
 * A line whose share pays for no whole ticket writes no row: its money is
 * recorded on the order and in the split, and no ticket the buyer still paid
 * for is withdrawn. `OrderItem.refundedCents` moves only with these rows.
 *
 * In the amount form a line is given what the tickets it withdraws cost after
 * the discount, and no more. The rest of its share is money-only, like a share
 * that pays for no ticket at all: left on the line, it would stand in for part
 * of a ticket the buyer still holds, and a later refund of that ticket by name
 * — priced at what it cost — would take the line past its subtotal, which the
 * line CHECK refuses in settlement, after the provider has paid. The whole
 * form gives every line its share, since it withdraws everything; the lines
 * form's amounts are the named tickets' own.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {string} params.refundId The refund.
 * @param {Array<{orderItemId: string, amountCents: number, quantity: number}>} params.allocation Its lines, from {@link allocateAcrossLines} or {@link allocateNamedLines}.
 * @param {Array<object>} params.items The order's lines, as they stand.
 * @param {number} params.discountCents The order's discount.
 * @param {Map<string, number>} params.pendingByLine Tickets other unresolved refunds hold, per line.
 * @param {'whole'|'amount'|'lines'} params.form The refund's form.
 * @returns {Promise<number>} The face value put on the lines.
 */
async function writeRefundItems(
  tx,
  { refundId, allocation, items, discountCents, pendingByLine, form },
) {
  const byId = new Map(items.map((item) => [item.id, item]))
  const shares = discountSharesByLine(items, discountCents)
  let onLines = 0

  for (const line of allocation) {
    if (line.quantity <= 0) continue

    let amountCents = line.amountCents
    const item = byId.get(line.orderItemId)

    if (form === FORMS.AMOUNT && item) {
      const standing = Math.max(0, lineQuantityLeft(item, pendingByLine.get(item.id) ?? 0))

      amountCents = Math.min(
        line.amountCents,
        netCostOfTickets(item, shares.get(item.id) ?? 0, item.quantity - standing, line.quantity),
      )
    }

    await tx.refundItem.create({
      data: { refundId, orderItemId: line.orderItemId, quantity: line.quantity, amountCents },
    })

    onLines += amountCents
  }

  return onLines
}

/**
 * What tax a refund of the booking fee on its own gives back with it (SPEC3
 * §7.4): all the tax left on a pay-at-the-venue order, which is charged on
 * its fee alone; on a card order, the fee's share of everything it was taxed
 * on (`orderBasis + fee`), floored, within the tax left. 0 for every order
 * with no tax, which is every US order.
 *
 * @param {object} order The order.
 * @param {{feeCents: number}} parts Its parts ({@link orderParts}).
 * @param {{feeCents: number, taxCents: number}} left What is left of each ({@link partsLeft}).
 * @returns {number} Integer cents.
 */
function taxOnFeeLeft(order, parts, left) {
  if (isAtVenue(order)) return left.taxCents

  const taxed = orderBasis(order) + parts.feeCents

  if (taxed <= 0) return 0

  return Math.min(left.taxCents, Math.floor(((order.taxCents ?? 0) * left.feeCents) / taxed))
}

/**
 * What a refund of one order's booking fee by hand would give back now (SPEC3
 * §7.4), worked out as {@link requestRefund} with `feeOnly` works it out: the
 * fee left after every refund settled or in flight, and the tax it carried.
 * Read under the order's row lock when it is about to be acted on.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object} order The order, with its totals.
 * @returns {Promise<{feeCents: number, taxCents: number, amountCents: number, feeSpokenCents: number}>} The fee and tax left to refund, their sum, and the fee other refunds already took.
 */
export async function feeRefundQuote(db, order) {
  const parts = orderParts(order)
  const spoken = await partsSpokenFor(db, order)
  const left = partsLeft(parts, spoken)
  const taxCents = taxOnFeeLeft(order, parts, left)

  return {
    feeCents: left.feeCents,
    taxCents,
    amountCents: left.feeCents + taxCents,
    feeSpokenCents: parts.feeCents - left.feeCents,
  }
}

/**
 * The basis a new refund speaks for, stored as `allocation.basisCents` (SPEC3
 * §10.2): a card order's face value, whatever the form; a pay-at-the-venue
 * order's named tickets' basis, or for the whole order the basis left; 0 for
 * the booking fee on its own.
 *
 * @param {object} options Options.
 * @param {string} options.form The refund's form.
 * @param {{faceValueCents: number}} options.split Its split.
 * @param {{atVenue: boolean, orderBasisCents: number, takenBasisCents: number|null}} options.share From {@link shareBasisOf}.
 * @param {{basis: number}|null} options.quoted The named tickets' quote, for the lines form.
 * @returns {number} Integer cents.
 */
function basisSpokenFor({ form, split, share, quoted }) {
  if (form === FORMS.FEE) return 0
  if (!share.atVenue) return split.faceValueCents
  if (form === FORMS.LINES) return quoted?.basis ?? 0

  return Math.max(0, share.orderBasisCents - (share.takenBasisCents ?? 0))
}

/**
 * The answer to a request whose key already names a refund.
 *
 * The refund that key made, when it was for this order: the request is a retry.
 * A key already used for another order is not a retry of this request, and
 * answering it with that order's refund would hand the caller a refund they
 * did not ask about.
 *
 * @param {object} existing The refund the key names.
 * @param {object} order The order this request is for.
 * @returns {{refund: object, created: boolean}} The existing refund, not created by this call.
 * @throws {Error} 409 when the key was used for another order.
 */
function replayOf(existing, order) {
  if (existing.orderId !== order.id) {
    throw conflict('That idempotency key was already used for a refund of another order.', {
      orderId: order.id,
    })
  }

  return { refund: existing, created: false }
}

/**
 * Ask for a refund, reserving the amount against the order.
 *
 * The reservation is the point. `refundPendingCents` goes up in the same
 * transaction that creates the row, so from this instant the order's remaining
 * refundable balance reflects this request — and the CHECK constraint refuses a
 * second request that would take the pair over the total.
 *
 * Three forms, and the amount is server-side in all of them:
 *
 * - `amountCents` refunds a sum. When the sum is everything the order has left
 *   it is the **whole** form, and withdraws every ticket still standing.
 * - `whole: true` asks for everything left without naming it.
 * - `lines` names order items and quantities. The face value follows from the
 *   order's own unit prices, net of the discount, and the refund adds those
 *   tickets' share of the fee and the tax. When that comes to everything the
 *   order has left it is the whole form too, and withdraws every ticket still
 *   standing, free ones included.
 *
 * A caller may send one or the other. Sending a price is not a form at all.
 * The split across face value, fee and tax is stored in `allocation`; only the
 * face value is put on the lines ({@link allocateAcrossLines}).
 *
 * A line is given what the tickets it withdraws cost, never more: in a partial
 * amount refund, the part of a line's share that pays for no further whole
 * ticket is money-only, recorded on the order and in the split like a share
 * that pays for no ticket at all. So `OrderItem.refundedCents` is what the
 * withdrawn tickets cost, and a later refund of that line's remaining tickets
 * by name finds their full price still there. A line an older refund gave more
 * than that is asked only for what it has left ({@link allocateNamedLines}).
 *
 * Everything is decided under the order's row lock, from the order as it
 * stands under it: its counters, its lines, and what unresolved refunds hold.
 * A copy the caller read before the lock — the route reads the order outside
 * its transaction — is used for its id only; a refund that settled or was asked
 * for in between would otherwise be missed, and two requests for the last
 * ticket on a line would both be reserved.
 *
 * A payment with a blocking dispute is refused (409 `PAYMENT_DISPUTED`): the
 * dispute decides where that money goes.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.order The order; only its id is relied on, the row and its lines are read again under lock.
 * @param {object} params.payment The succeeded payment to refund against.
 * @param {number} [params.amountCents] How much, for an amount refund.
 * @param {Array<{orderItemId: string, quantity: number}>} [params.lines] Which lines, for an item refund.
 * @param {boolean} [params.whole] Everything the order has left. Names no amount.
 * @param {Map<string, number>} [params.pendingByLine] Ignored: what unresolved refunds hold on each line is read under the lock. Accepted so older callers keep working.
 * @param {string} params.reason A `RefundReason`.
 * @param {string|null} [params.reasonNote] Prose for the audit trail.
 * @param {string} params.idempotencyKey Unique per logical request.
 * @param {string|null} [params.actorId] Who asked. Null for a system request.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {string|null} [params.via] What asked, when it was not a person at the refund screen.
 * @param {boolean} [params.capFaceToLeft] Lines form: ask for no more face value than the order has left, rather than refusing tickets an earlier sum refund already paid back in part ({@link capNamedFace}). A cancelled night's refund asks for this.
 * @param {boolean} [params.promoteToWhole] Lines form: whether named tickets that come to everything the order has left become the whole form and withdraw every ticket still standing. True by default; a cancelled night's refund passes false, because the order's tickets for its other nights are kept (SPEC2-XI X-N).
 * @param {boolean} [params.feeOnly] The booking fee on its own (SPEC3 §7.4): what is left of the fee and the tax it carried, no ticket withdrawn, never the whole form. Names neither an amount, lines nor `whole`.
 * @param {Date} params.now The instant.
 * @returns {Promise<{refund: object, created: boolean}>} The refund, and whether this call made it.
 * @throws {Error} 409 when the order has less left than was asked for or its payment is disputed; 409 `NO_FEE_TO_REFUND` for a booking fee with nothing left; 422 for a bad amount, and `AMOUNT_REFUND_NOT_FOR_VENUE_ORDERS` for a sum asked of a pay-at-the-venue order.
 */
export async function requestRefund(tx, params) {
  const {
    order: given,
    payment,
    lines = null,
    whole = false,
    feeOnly = false,
    reason,
    reasonNote = null,
    idempotencyKey,
    actorId = null,
    requestId = null,
    via = null,
    capFaceToLeft = false,
    promoteToWhole = true,
    now,
  } = params

  // Idempotency at the request boundary. A retried request — a lost response, a
  // double-clicked button, a job that ran twice — gets the refund the first one
  // made, rather than a second reservation against the same order.
  const existing = await tx.refund.findUnique({ where: { idempotencyKey } })

  if (existing) return replayOf(existing, given)

  const namesAmount = params.amountCents !== undefined && params.amountCents !== null

  if (whole && (lines || namesAmount)) {
    throw unprocessable('A refund of everything left names neither an amount nor lines.', {
      orderId: given.id,
    })
  }

  if (feeOnly && (whole || lines || namesAmount)) {
    throw unprocessable(
      'A refund of the booking fee names neither an amount, lines nor the whole order.',
      { orderId: given.id },
    )
  }

  // The order's row lock, then the order as it stands under it: its counters,
  // its lines and what unresolved refunds hold on each. Every writer of a
  // refund takes this lock before it moves any of them, so under it the
  // refunds read below, the counters and the lines agree, and the split and
  // the tickets worked out from them are the ones the reservation is made
  // against. Nothing is taken from the caller's copy but the id: the route
  // reads the order before its transaction, and a refund that settled or was
  // asked for in between would put a ticket on a line that has none left.
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${given.id} FOR UPDATE`

  // The key again, under the lock. Two copies of one request — a double click,
  // a client retry sent before the first answer came back — both miss the read
  // above; the second then waits here for the first, which has committed by
  // the time the lock is granted. Its refund is this request's answer. Deciding
  // afresh from the counters as they now stand would reserve nothing twice
  // (the key's unique index would refuse the row), but it would answer the
  // retry with a database error instead of the refund it asked for.
  const committed = await tx.refund.findUnique({ where: { idempotencyKey } })

  if (committed) return replayOf(committed, given)

  const stored = await tx.order.findUnique({ where: { id: given.id }, include: { items: true } })
  const order = { ...given, ...(stored ?? {}) }
  const atVenue = isAtVenue(order)

  // A pay-at-the-venue order paid online only its booking fee and the tax on
  // it: a sum asked of it would be the fee of The Desi Events given back with no ticket
  // withdrawn, and an amount equal to what is left would be promoted to the
  // whole order. Its tickets are refunded by name or all together; its fee on
  // its own only by the team at The Desi Events (SPEC3 §9.7).
  if (atVenue && !lines && !whole && !feeOnly) {
    throw paymentTermsRefusal('AMOUNT_REFUND_NOT_FOR_VENUE_ORDERS')
  }

  const items = order.items ?? []
  const discountCents = order.discountCents ?? 0
  const parts = orderParts(order)
  const spoken = await partsSpokenFor(tx, order)
  const left = partsLeft(parts, spoken)
  const share = shareBasisOf(order, spoken)
  const pending = await pendingLines(tx, order.id)
  const remaining = refundableCents(order)

  const quoted = lines
    ? quoteNamedLines({ items, lines, pending, discountCents, parts, left, capFaceToLeft, share })
    : null

  if (quoted && quoted.priced.amountCents <= 0) {
    // A line of free tickets. The tickets are still revoked, but that is a
    // revocation rather than a refund, and routing it through a payment
    // provider would ask for zero cents back from a real processor.
    throw unprocessable('Those lines are worth nothing, so there is nothing to refund.', { lines })
  }

  const named = quoted ? quoted.named : null

  let form
  let amountCents
  let split = null

  if (feeOnly) {
    // What is left of the booking fee, and the tax it carried (SPEC3 §7.4).
    form = FORMS.FEE
    split = {
      faceValueCents: 0,
      feeCents: left.feeCents,
      taxCents: taxOnFeeLeft(order, parts, left),
    }
    amountCents = sumParts(split)

    if (amountCents <= 0) {
      throw httpError(409, 'NO_FEE_TO_REFUND', PAYMENT_TERMS_SENTENCES.noFeeLeft, {
        orderId: order.id,
      })
    }
  } else if (named) {
    split = quoted.split
    amountCents = quoted.amountCents
    // Named tickets whose share of the fee and the tax takes everything the
    // order has left are a whole refund: the free tickets beside them (or a
    // ticket a promo code left worth nothing) had their fee given back with
    // this share, and nothing could ever withdraw them afterwards — a whole
    // or amount refund finds nothing left, and a refund of them by name finds
    // them worth nothing. So every ticket still standing goes with it — unless
    // the caller keeps those tickets on purpose: a cancelled night refunds its
    // own tickets and nobody's ticket for another night (`promoteToWhole`).
    form = promoteToWhole && amountCents === remaining ? FORMS.WHOLE : FORMS.LINES
  } else if (whole) {
    form = FORMS.WHOLE
    amountCents = remaining
  } else {
    amountCents = params.amountCents
    form = amountCents === remaining ? FORMS.WHOLE : FORMS.AMOUNT
  }

  if (whole && remaining === 0) {
    throw conflict('This order has already been refunded in full.', { requested: 0, remaining })
  }

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

  // Named tickets worth more face value than the order has left can only
  // follow a sum refunded without tickets; the rest of the order is what is
  // left to ask for.
  if (amountCents > remaining || (named && named.amountCents > left.faceValueCents)) {
    throw conflict(
      remaining === 0
        ? 'This order has already been refunded in full.'
        : `This order has ${remaining} cent(s) left to refund.`,
      { requested: amountCents, remaining },
    )
  }

  if (await paymentDisputeBlocks(tx, payment.id)) {
    throw paymentDisputed({ orderId: order.id, paymentId: payment.id })
  }

  if (!split) split = refundPartsFor({ parts, left, form, amountCents })

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
      allocation: {
        ...split,
        form,
        whole: form === FORMS.WHOLE,
        basisCents: basisSpokenFor({ form, split, share, quoted }),
      },
      requestedById: actorId,
      idempotencyKey,
    },
  })

  // The booking fee on its own withdraws no ticket and writes no line.
  const allocation =
    form === FORMS.FEE
      ? []
      : named && form === FORMS.LINES
        ? named.allocation
        : allocateAcrossLines({
            items,
            amountCents: split.faceValueCents,
            discountCents,
            pendingByLine: pending.quantities,
            pendingCentsByLine: pending.cents,
            whole: form === FORMS.WHOLE,
          })

  const onLines = await writeRefundItems(tx, {
    refundId: created.id,
    allocation,
    items,
    discountCents,
    pendingByLine: pending.quantities,
    form,
  })

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
      form,
      whole: form === FORMS.WHOLE,
      faceValueCents: split.faceValueCents,
      feeCents: split.feeCents,
      taxCents: split.taxCents,
      lines: named ? named.allocation : null,
      // Face value given back without withdrawing a ticket.
      moneyOnlyCents: split.faceValueCents - onLines,
      via,
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
 * Reserve a declined or failed refund's amount against its order again.
 *
 * A refusal or a failure releases the reservation ({@link recordRefundFailure}),
 * because nothing moved. Trying the refund again has to take it back before
 * anything is sent, or the settlement that follows decrements
 * `refundPendingCents` a second time and the Order CHECK refuses it — after
 * the provider has paid. Everything is checked against the order as it now
 * stands, under its row lock: the tickets on the refund's lines, each part of
 * its allocation, and the money. Another refund may have taken some of it since
 * this one failed; then nothing is written and the answer is 409
 * `REFUND_BALANCE_GONE`.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.refund The refund being tried again, as it was read.
 * @param {object} [params.order] Its order; only the id is used, the row is re-read under lock.
 * @returns {Promise<object>} The order as it stood before the reservation.
 * @throws {Error} 409 `REFUND_BALANCE_GONE` when the order no longer has it; 409 `PAYMENT_DISPUTED`.
 */
export async function reserveAgain(tx, { refund, order = null }) {
  const orderId = order?.id ?? refund.orderId

  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`

  const current = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } })

  if (!current) throw httpError(409, 'ORDER_MISSING', 'That refund names an order that is gone.')

  const details = { refundId: refund.id, orderId }
  const pending = await pendingLines(tx, orderId, { excludeRefundId: refund.id })
  const lineOf = new Map((current.items ?? []).map((item) => [item.id, item]))
  const shares =
    (current.discountCents ?? 0) > 0 && (current.items ?? []).length > 0
      ? allocateProportionally(
          current.discountCents,
          current.items.map((item) => item.subtotalCents),
        )
      : (current.items ?? []).map(() => 0)
  const shareOf = new Map((current.items ?? []).map((item, index) => [item.id, shares[index] ?? 0]))

  for (const item of await tx.refundItem.findMany({ where: { refundId: refund.id } })) {
    const line = lineOf.get(item.orderItemId)

    if (!line) throw balanceGone(details)

    const ticketsLeft = lineQuantityLeft(line, pending.quantities.get(line.id) ?? 0)
    const moneyLeft =
      line.subtotalCents -
      (shareOf.get(line.id) ?? 0) -
      (line.refundedCents ?? 0) -
      (pending.cents.get(line.id) ?? 0)

    if (item.quantity > ticketsLeft || item.amountCents > moneyLeft) throw balanceGone(details)
  }

  const left = partsLeft(
    orderParts(current),
    await partsSpokenFor(tx, current, { excludeRefundId: refund.id }),
  )
  const stored = partsOf(refund.allocation)
  const wanted =
    stored && sumParts(stored) === refund.amountCents
      ? stored
      : splitRefund(current, refund.amountCents)

  if (
    refund.amountCents > refundableCents(current) ||
    wanted.faceValueCents > left.faceValueCents ||
    wanted.feeCents > left.feeCents ||
    wanted.taxCents > left.taxCents
  ) {
    throw balanceGone(details)
  }

  if (await paymentDisputeBlocks(tx, refund.paymentId)) throw paymentDisputed(details)

  // The same conditional update `requestRefund` makes. Under the row lock it
  // cannot miss, and if it ever did the answer is the same: not reserved.
  const { count } = await tx.order.updateMany({
    where: {
      id: orderId,
      refundedCents: current.refundedCents,
      refundPendingCents: current.refundPendingCents,
    },
    data: { refundPendingCents: current.refundPendingCents + refund.amountCents },
  })

  if (count === 0) throw balanceGone(details)

  return current
}

/**
 * Approve a requested refund, or approve a declined or failed one again.
 *
 * From DECLINED or FAILED the reservation was released when the provider said
 * no, so it is taken again here, in the same transaction ({@link reserveAgain}),
 * or the approval is refused 409 `REFUND_BALANCE_GONE` and nothing changes. The
 * audit row says `reReserved: true`.
 *
 * A payment whose dispute blocks a refund is not approved from any state (409
 * `PAYMENT_DISPUTED`): a chargeback opened after the refund was asked for
 * decides where that money goes just as much as one opened before. The
 * refund keeps its reservation and its state, so it can go ahead once the
 * dispute is won, or be cancelled.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.refund The refund.
 * @param {object} [params.order] Its order. Re-read under lock when a reservation is taken again.
 * @param {string|null} params.actorId Who approved it.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @param {string|null} [params.via] What approved it, when it was not a person at the refund screen.
 * @returns {Promise<boolean>} Whether this call performed the transition.
 * @throws {Error} 409 `REFUND_BALANCE_GONE` when a retry cannot be reserved; 409 `PAYMENT_DISPUTED`.
 */
export async function approveRefund(
  tx,
  { refund, order = null, actorId, requestId = null, now, via = null },
) {
  const reReserved =
    refund.status === REFUND_STATES.DECLINED || refund.status === REFUND_STATES.FAILED

  if (canTransition(refund.status, REFUND_STATES.APPROVED)) {
    if (await paymentDisputeBlocks(tx, refund.paymentId)) {
      throw paymentDisputed({
        refundId: refund.id,
        orderId: refund.orderId,
        paymentId: refund.paymentId,
      })
    }
  }

  const applied = await transition(tx, {
    refund,
    to: REFUND_STATES.APPROVED,
    data: { approvedById: actorId },
  })

  if (!applied) return false

  // After the conditional transition, so a lost race reserves nothing; inside
  // the caller's transaction, so a refusal here undoes the transition too.
  if (reReserved) await reserveAgain(tx, { refund, order })

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
      reReserved,
      via,
      // The booking fee refunded on its own says so on every step (SPEC3 §4.3).
      ...(refund.allocation?.form === FORMS.FEE ? { form: FORMS.FEE } : {}),
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
 * The order in which a refund withdraws a line's standing tickets: tickets
 * not paid at the door first, then the rest, each group oldest first.
 *
 * A ticket good for every night stays VALID after it is paid for at the door
 * and let in (`admission.js`), so a line can hold a ticket whose price is with
 * the organiser beside one that still owes it. A refund of one ticket of that
 * line gives back a share of the booking fee and must withdraw the one still
 * owed for; withdrawing the paid one would kill a ticket the buyer has paid
 * for in cash and leave them owing the price again on the other. A card
 * order's tickets have no door payment, so they keep the oldest-first order.
 *
 * @param {Array<{venuePaymentId?: string|null}>} tickets A line's standing tickets, oldest first.
 * @returns {Array<object>} The same tickets in withdrawal order (a new array; stable).
 */
export function withdrawalOrder(tickets) {
  const unpaid = tickets.filter((ticket) => (ticket.venuePaymentId ?? null) === null)
  const paid = tickets.filter((ticket) => (ticket.venuePaymentId ?? null) !== null)

  return [...unpaid, ...paid]
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
  // A cancelled event's or night's refund also takes the tickets withdrawn when
  // it was deleted or the night cancelled (SPEC2-XI X-D, X-N): they are
  // CANCELLED already, admit nobody, and are what the money is for.
  const takesWithdrawn = refund.reason === 'EVENT_CANCELLED'
  const settleable = takesWithdrawn
    ? {
        OR: [
          { status: { in: [...REFUNDABLE_TICKET_STATES] } },
          {
            status: 'CANCELLED',
            OR: WITHDRAWN_REASON_PREFIXES.map((prefix) => ({
              revokedReason: { startsWith: prefix },
            })),
          },
        ],
      }
    : { status: { in: [...REFUNDABLE_TICKET_STATES] } }

  let ticketsRevoked = 0
  let seatsReturned = 0
  let seatsWithheld = 0

  for (const item of items) {
    // The order line, locked before its tickets are read. Accepting a transfer
    // takes the same lock before it retires a ticket and issues its successor,
    // so the two take turns: this read sees either the ticket before the
    // handover or its successor after it, never the moment between — and never
    // a predecessor whose successor then keeps admitting after the money went
    // back (ADR 0006, superseding ADR 0005's deferral). The refund row and the
    // order were locked by the updates above, so the order is Refund, Order,
    // OrderItem, Tickets — the one order every writer follows.
    await tx.$queryRaw`SELECT "id" FROM "OrderItem" WHERE "id" = ${item.orderItemId} FOR UPDATE`

    const tickets = withdrawalOrder(
      await tx.ticket.findMany({
        where: { orderItemId: item.orderItemId, ...settleable },
        orderBy: { createdAt: 'asc' },
      }),
    ).slice(0, item.quantity)

    for (const ticket of tickets) {
      // Conditional on the ticket still being refundable, not on the exact
      // status it was read in. A ticket checked in between the read and the
      // write has been used, and a used ticket must not be quietly turned into
      // a refunded one behind the person at the door: CHECKED_IN is not in the
      // set, so that update matches nothing. But starting an offer takes no
      // order-line lock, and moves a ticket from VALID to TRANSFER_PENDING
      // with its own conditional update; conditioning on the status read here
      // made that ticket match nothing too, so the money went back and the
      // ticket kept admitting. PostgreSQL re-checks this condition against the
      // row as the concurrent writer left it, so either order of arrival now
      // ends with the ticket refunded, and an offer started afterwards finds
      // it REFUNDED and moves nothing.
      const { count } = await tx.ticket.updateMany({
        where: { id: ticket.id, ...settleable },
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
 * How many of an order's tickets still admit: VALID or TRANSFER_PENDING, the
 * states a refund would withdraw.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {string} orderId The order.
 * @returns {Promise<number>} The count.
 */
async function standingTicketCount(tx, orderId) {
  const lines = await tx.orderItem.findMany({ where: { orderId }, select: { id: true } })

  if (lines.length === 0) return 0

  return tx.ticket.count({
    where: {
      orderItemId: { in: lines.map((line) => line.id) },
      status: { in: [...REFUNDABLE_TICKET_STATES] },
    },
  })
}

/**
 * The batch a settled refund posts: `refundBatch`, or the same entries with the
 * discount given back to the organiser's side, or without the organiser's line
 * when it gives back nothing of theirs.
 *
 * Checkout credits the organiser the order's full **subtotal** and carries the
 * discount as contra-revenue (`promotional_discount`, debited). A refund takes
 * back the organiser's share of what they were credited — the face value
 * returned plus the discount that face value carried — and credits
 * `promotional_discount` with that discount, so a fully refunded order leaves
 * the organiser owed nothing and the discount account back where it started.
 * Taking back only the face value net of the discount left the organiser owed
 * the discount for an order that had been refunded in full, and payable.
 *
 * An order bought with a full-value promo code still paid the fee (and the tax
 * on it), so a refund of only fee and tax has no organiser line; a ledger entry
 * must be above zero.
 *
 * @param {object} input As `refundBatch` takes it.
 * @param {number} input.refundedCents The total going back to the buyer.
 * @param {number} input.organizerShareCents Taken back from the organiser's payable: face value plus its discount.
 * @param {number} [input.discountRefundCents] The discount that face value carried, credited back to `promotional_discount`.
 * @param {number} input.platformFeeRefundCents Fee given back.
 * @param {number} input.taxRefundCents Tax given back.
 * @param {string} input.currency ISO 4217 code.
 * @param {string} input.organizationId Whose payable is reduced.
 * @param {string} input.reference A human-readable reference for the memos.
 * @returns {object} A composed batch.
 */
function refundLedgerBatch(input) {
  const discountRefundCents = input.discountRefundCents ?? 0

  if (input.organizerShareCents > 0 && discountRefundCents === 0) return refundBatch(input)

  const { refundedCents, platformFeeRefundCents, taxRefundCents, currency, organizationId } = input
  const reference = input.reference
  const entries = []

  if (input.organizerShareCents > 0) {
    entries.push(
      entry(
        ACCOUNTS.ORGANIZER_PAYABLE,
        DEBIT,
        input.organizerShareCents,
        `Refund ${reference} taken from organiser`,
        organizationId,
      ),
    )
  }

  if (discountRefundCents > 0) {
    entries.push(
      entry(
        ACCOUNTS.PROMOTIONAL_DISCOUNT,
        CREDIT,
        discountRefundCents,
        `Refund ${reference} discount reversed`,
        organizationId,
      ),
    )
  }

  if (platformFeeRefundCents > 0) {
    entries.push(
      entry(
        ACCOUNTS.PLATFORM_FEE_REVENUE,
        DEBIT,
        platformFeeRefundCents,
        `Refund ${reference} fee returned`,
        organizationId,
      ),
    )
  }

  if (taxRefundCents > 0) {
    entries.push(
      entry(
        ACCOUNTS.TAX_PAYABLE,
        DEBIT,
        taxRefundCents,
        `Refund ${reference} tax returned`,
        organizationId,
      ),
    )
  }

  entries.push(
    entry(
      ACCOUNTS.REFUND_CLEARING,
      CREDIT,
      refundedCents,
      `Refund ${reference} owed to buyer`,
      organizationId,
    ),
  )

  return composeBatch({ kind: BATCH_KINDS.REFUND, currency, entries })
}

/**
 * How much of the order's discount a settling refund gives back to the
 * organiser's side of the ledger.
 *
 * The discount follows the face value: once the settled refunds have given
 * back `f` of the order's face value `F`, `floor(D × f / F)` of its discount
 * `D` has been reversed, and all of it once the order is refunded in full. The
 * amount is that target less what earlier refunds of the order already
 * reversed, read off the ledger itself, so successive refunds add up to
 * exactly the discount whatever order they settle in. Read under the order's
 * row lock, which the settlement's counter update took, so two settlements
 * never both count the same cents.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} order The order, as the settlement's update left it.
 * @returns {Promise<number>} Integer cents, never negative.
 */
async function discountToReverse(tx, order) {
  const discount = order.discountCents ?? 0

  // A pay-at-the-venue order posted no discount: the promo lowered the price
  // paid at the door, which is not platform money (SPEC3 §10.1).
  if (discount <= 0 || isAtVenue(order)) return 0

  let target = discount

  if (order.refundedCents < order.totalCents) {
    const face = (order.subtotalCents ?? 0) - discount

    if (face > 0) {
      const settled = await tx.refund.findMany({
        where: { orderId: order.id, status: REFUND_STATES.SUCCEEDED },
      })
      const settledFace = settled.reduce((sum, row) => {
        const stored = partsOf(row.allocation)
        const parts =
          stored && sumParts(stored) === row.amountCents
            ? stored
            : splitRefund(order, row.amountCents)

        return sum + parts.faceValueCents
      }, 0)

      target = Math.floor((discount * Math.min(settledFace, face)) / face)
    } else {
      target = Math.floor((discount * order.refundedCents) / order.totalCents)
    }
  }

  const accounts = await resolveAccounts(tx, [ACCOUNTS.PROMOTIONAL_DISCOUNT])
  const discountAccount = accounts.get(ACCOUNTS.PROMOTIONAL_DISCOUNT)
  const batches = await tx.ledgerBatch.findMany({
    where: { orderId: order.id, kind: BATCH_KINDS.REFUND },
    include: { entries: true },
  })
  const reversed = batches
    .flatMap((batch) => batch.entries ?? [])
    .filter((line) => line.accountId === discountAccount && line.direction === CREDIT)
    .reduce((sum, line) => sum + line.amountCents, 0)

  return Math.max(0, Math.min(discount, target) - reversed)
}

/**
 * Take `FOR KEY SHARE` on an order's own night, when it has one: the lock a
 * second update of the order in the same transaction takes anyway, through
 * its foreign key, taken in its place in SPEC3-XI §2.1's order (nights before
 * orders) rather than after the order. The night never changes for the life
 * of the order, so reading it unlocked is enough.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {{id: string, eventSessionId?: string|null}} order The order.
 * @returns {Promise<string|null>} The night locked, if any.
 */
export async function lockOrderNight(tx, order) {
  const eventSessionId =
    order?.eventSessionId !== undefined
      ? order.eventSessionId
      : ((await tx.order.findUnique({ where: { id: order.id }, select: { eventSessionId: true } }))
          ?.eventSessionId ?? null)

  if (!eventSessionId) return null

  await tx.$queryRaw`SELECT "id" FROM "EventSession" WHERE "id" = ${eventSessionId} FOR KEY SHARE`

  return eventSessionId
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
 * @param {string|null} [params.via] What sent it, when it was not a person at the refund screen (the booking fee refunded by hand: `platform_fee_refund`).
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
    via = null,
    now,
  } = params

  const policy = seatPolicyFor({ eventStartsAt, now, override: seatPolicy })

  // The booking fee refunded on its own (SPEC3 §10.2) withdraws no ticket and
  // returns no place, so its record says neither; every other form records
  // what settling it does to the tickets, as before.
  const feeOnly = refund.allocation?.form === FORMS.FEE

  // The order's night first, `FOR KEY SHARE` (SPEC3-XI §2.1: nights before
  // orders). This settlement writes the order more than once (its counters,
  // then REFUNDED, then the referral marker), and PostgreSQL checks a row's
  // foreign keys again when it is updated a second time in one transaction:
  // that check takes `KEY SHARE` on the night, after the order. A night's
  // cancellation or a deletion holds the night `FOR UPDATE` and waits for the
  // order, so taken there the two would wait on each other. Taken here, before
  // anything else, one of them simply goes first.
  await lockOrderNight(tx, order)

  const applied = await transition(tx, {
    refund,
    to: REFUND_STATES.SUCCEEDED,
    data: {
      providerRefundId: result.providerRefundId,
      rawProviderStatus: result.rawStatus,
      settledAt: now,
      ticketsRevoked: !feeOnly,
      inventoryReturned: !feeOnly && policy === SEAT_POLICIES.RESELL,
    },
  })

  if (!applied) return { settled: false }

  // The reservation becomes a settlement. Both counters move in one statement
  // so their sum never dips below the amount actually owed. Whether the order
  // is now refunded in full is read off the row this update returns — the
  // counters as they stand under the row lock it took — and not off the copy
  // the caller read before submitting: two partial refunds that together
  // cover the order, settling at once, each saw the other's money missing
  // from that copy, and neither marked the order REFUNDED.
  const after = await tx.order.update({
    where: { id: order.id },
    data: {
      refundedCents: { increment: refund.amountCents },
      refundPendingCents: { decrement: refund.amountCents },
    },
  })

  const moved = await revokeAndReturn(tx, { refund, seatPolicy: policy, now })

  // Refunded in full, and none of its tickets still admits: the order is
  // REFUNDED. Every refund that comes to all an order has left withdraws
  // every ticket standing (the whole form), except a cancelled night's: it
  // gives back everything while the order's tickets for its other nights —
  // a free one, an every-night pass, one an earlier sum already paid back in
  // part — are kept (SPEC2-XI X-N). The door refuses every ticket of an order
  // that is not PAID, so such an order stays PAID while a ticket of it stands.
  //
  // The booking fee refunded on its own never moves the order: a buyer who
  // paid at the door and was let in keeps a PAID order (SPEC3 §10.2).
  //
  // "In full" counts the booking fee The Desi Events kept when unpaid tickets were
  // cancelled (SPEC3-XI §10.2): it is never refunded, so an order whose every
  // other cent went back is refunded as far as it ever will be.
  const refundedInFull = after.refundedCents + (after.venueFeeKeptCents ?? 0) >= after.totalCents

  if (!feeOnly && refundedInFull && after.status !== 'REFUNDED') {
    if ((await standingTicketCount(tx, order.id)) === 0) {
      await tx.order.update({ where: { id: order.id }, data: { status: 'REFUNDED' } })
    }
  }

  // The order's referral use, when it has now ended (SPEC3-XI XR4): after the
  // last order, line, ticket and seat write of this settlement, so the code
  // is its last row lock. Once, whichever path settles the refund.
  await settleReferralUsesIfEnded(tx, {
    entries: [{ orderId: order.id, cause: 'REFUNDED' }],
    actorId,
    requestId,
    now,
  })

  const split = refund.allocation ?? splitRefund(order, refund.amountCents)

  // Money taken on an order that was already closed was never credited to
  // the organiser, the fee or the tax: the webhook recorded it as owed back
  // to the buyer the moment it arrived (`lateCaptureLedgerKey`). Its refund
  // pays that debt, so it posts no decision batch — debiting the organiser
  // for money they were never credited would charge them for an order they
  // were never paid — only the settlement below.
  const lateCapture = await tx.ledgerBatch.findUnique({
    where: { idempotencyKey: lateCaptureLedgerKey(refund.paymentId) },
  })
  const discountReversedCents = lateCapture ? 0 : await discountToReverse(tx, after)

  // Two batches, not one. "We owe this back" and "it has gone" are different
  // facts, and a report that conflates them overstates what has left the
  // account.
  if (!lateCapture) {
    await postBatch(
      tx,
      refundLedgerBatch({
        refundedCents: refund.amountCents,
        organizerShareCents: split.faceValueCents + discountReversedCents,
        discountRefundCents: discountReversedCents,
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
  }

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
      discountReversedCents,
      capturedAfterClose: Boolean(lateCapture),
      ...(feeOnly ? { form: FORMS.FEE } : {}),
      ...(via ? { via } : {}),
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
 * The reservation is released — unless the row is an unreserved cancellation
 * refund ({@link isUnreservedLegacyRefund}), which never reserved anything, so
 * releasing its amount would take `refundPendingCents` below what the order's
 * other refunds hold.
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
  // The refund's row lock, then the order's — the order every writer takes
  // them in — and the refund read again under them. Whether it holds a
  // reservation is decided from that read: a repair that reserved the row
  // after the caller read it (it takes the same two locks) has either
  // finished, and its lines and allocation are seen here, or waits until this
  // withdrawal has committed. Deciding from an earlier read cancelled a row
  // that had since been reserved without releasing the reservation, and the
  // order could never be refunded again.
  await tx.$queryRaw`SELECT "id" FROM "Refund" WHERE "id" = ${refund.id} FOR UPDATE`
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`

  const fresh = (await tx.refund.findUnique({ where: { id: refund.id } })) ?? refund

  // Somebody moved it on since it was read: not this call's to withdraw.
  if (fresh.status !== refund.status) return false

  const unreserved = isUnreservedLegacyRefund(
    fresh,
    await tx.refundItem.count({ where: { refundId: refund.id } }),
  )

  const applied = await transition(tx, {
    refund: fresh,
    to: REFUND_STATES.CANCELLED,
    data: { reasonNote: reason },
  })

  if (!applied) return false

  if (PENDING_STATES.has(refund.status) && !unreserved) {
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
      // Nothing was reserved, so nothing was released.
      reservationReleased: PENDING_STATES.has(refund.status) && !unreserved,
      source: actorId ? 'operator' : 'system',
    },
  })

  return true
}

/**
 * Reserve an unreserved cancellation refund, or replace it.
 *
 * Event cancellation used to write its refunds with `createMany`: `REQUESTED`,
 * for the order's whole total, with no reservation, no lines and no
 * allocation. Such a row can never settle. It is repaired the first time
 * anything touches it — approval, submission, the event's refund driver —
 * under the order's row lock:
 *
 * - **`RESERVED`** — the order still has at least the row's amount left. The
 *   amount is reserved and the row gains its lines and allocation, as
 *   `requestRefund` would have written them (the whole form when it is
 *   everything left). Its status is kept.
 * - **`REPLACED`** — the order has less left, because finance refunded part of
 *   it since. The row is withdrawn without touching the counters (it never
 *   reserved), and a whole refund of what is left is requested in its place
 *   under `<old key>:repaired`, `REQUESTED`, for the same requester. The caller
 *   approves it when the old row was `APPROVED`.
 * - **`CANCELLED_NOTHING_LEFT`** — nothing is left; the row is withdrawn.
 *
 * A payment with a blocking dispute is left alone and answered 409
 * `PAYMENT_DISPUTED`, as a new request would be.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.refund The refund as it was read.
 * @param {object} [params.order] Its order; re-read under lock.
 * @param {string|null} params.actorId Who touched it.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{refund: object, mode: 'NOT_NEEDED'|'RESERVED'|'REPLACED'|'CANCELLED_NOTHING_LEFT'}>} The refund to carry on with, and what was done.
 * @throws {Error} 409 `PAYMENT_DISPUTED`; 409 `ORDER_TOTALS_INCONSISTENT`.
 */
export async function repairUnreservedRefund(
  tx,
  { refund, order = null, actorId, requestId = null, now },
) {
  if (!isUnreservedLegacyRefund(refund, 0)) return { refund, mode: 'NOT_NEEDED' }

  const orderId = order?.id ?? refund.orderId

  // The refund's row lock, then the order's: the order every writer takes
  // them in, so a withdrawal of the same row waits for this repair or this
  // repair for it, and neither decides from a read the other has overtaken.
  await tx.$queryRaw`SELECT "id" FROM "Refund" WHERE "id" = ${refund.id} FOR UPDATE`
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`

  // Read again under the lock: a second repair that waited on it finds the
  // row already repaired and does nothing.
  const fresh = await tx.refund.findUnique({ where: { id: refund.id } })
  const itemCount = await tx.refundItem.count({ where: { refundId: refund.id } })

  if (!fresh || !isUnreservedLegacyRefund(fresh, itemCount)) {
    return { refund: fresh ?? refund, mode: 'NOT_NEEDED' }
  }

  const current = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } })
  const remaining = refundableCents(current)

  if (remaining > 0 && (await paymentDisputeBlocks(tx, fresh.paymentId))) {
    throw paymentDisputed({ refundId: fresh.id, orderId, paymentId: fresh.paymentId })
  }

  let mode
  let target = fresh
  let replacement = null

  if (remaining >= fresh.amountCents) {
    const form = remaining === fresh.amountCents ? FORMS.WHOLE : FORMS.AMOUNT
    const parts = orderParts(current)
    const left = partsLeft(parts, await partsSpokenFor(tx, current, { excludeRefundId: fresh.id }))
    const split = refundPartsFor({ parts, left, form, amountCents: fresh.amountCents })
    const pending = await pendingLines(tx, orderId, { excludeRefundId: fresh.id })

    const { count } = await tx.order.updateMany({
      where: {
        id: orderId,
        refundedCents: current.refundedCents,
        refundPendingCents: current.refundPendingCents,
      },
      data: { refundPendingCents: current.refundPendingCents + fresh.amountCents },
    })

    if (count === 0) {
      throw conflict('Somebody else started a refund on this order. Read it again and retry.', {
        orderId,
      })
    }

    const lines = allocateAcrossLines({
      items: current.items ?? [],
      amountCents: split.faceValueCents,
      discountCents: current.discountCents ?? 0,
      pendingByLine: pending.quantities,
      pendingCentsByLine: pending.cents,
      whole: form === FORMS.WHOLE,
    })

    await writeRefundItems(tx, {
      refundId: fresh.id,
      allocation: lines,
      items: current.items ?? [],
      discountCents: current.discountCents ?? 0,
      pendingByLine: pending.quantities,
      form,
    })

    const written = await tx.refund.updateMany({
      where: { id: fresh.id, status: fresh.status },
      data: { allocation: { ...split, form, whole: form === FORMS.WHOLE } },
    })

    if (written.count === 0) {
      throw conflict('Somebody else moved that refund on. Read it again.', {
        status: fresh.status,
      })
    }

    mode = 'RESERVED'
    target = await tx.refund.findUnique({ where: { id: fresh.id } })
  } else {
    await cancelRefund(tx, {
      refund: fresh,
      order: current,
      reason:
        remaining > 0
          ? 'Replaced: the order had less left to refund than this request named'
          : 'Withdrawn: the order had nothing left to refund',
      actorId,
      requestId,
      now,
    })

    if (remaining > 0) {
      const payment = await tx.payment.findUnique({ where: { id: fresh.paymentId } })
      const requested = await requestRefund(tx, {
        order: current,
        payment,
        whole: true,
        reason: fresh.reason,
        reasonNote: fresh.reasonNote,
        idempotencyKey: `${fresh.idempotencyKey}:repaired`,
        // The same requester: this is their request, carried on. The person
        // who touched it is named on the repair's own audit row.
        actorId: fresh.requestedById ?? null,
        requestId,
        via: 'reservation_repair',
        now,
      })

      replacement = requested.refund
      target = replacement
      mode = 'REPLACED'
    } else {
      target = await tx.refund.findUnique({ where: { id: fresh.id } })
      mode = 'CANCELLED_NOTHING_LEFT'
    }
  }

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.REFUND_RESERVATION_REPAIRED,
    entityType: 'Refund',
    entityId: fresh.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      orderId,
      mode,
      legacyAmountCents: fresh.amountCents,
      remainingCents: remaining,
      replacementRefundId: replacement?.id ?? null,
      previousStatus: fresh.status,
      source: actorId ? 'operator' : 'system',
    },
  })

  return { refund: target, mode }
}

/** The refund states whose lines may settle at any moment. */
const IN_FLIGHT_STATES = Object.freeze([
  REFUND_STATES.SUBMITTED,
  REFUND_STATES.TIMEOUT,
  REFUND_STATES.RECONCILIATION_REQUIRED,
])

/**
 * Check, under lock and before anything is sent, that a refund can settle.
 *
 * Settlement runs after the provider has paid, so a settlement that fails —
 * a CHECK refusing it — leaves the money gone and the refund `SUBMITTED`.
 * Everything settlement relies on is checked here instead, where a refusal
 * costs nothing:
 *
 * - **the dispute** — a chargeback opened after the refund was asked for
 *   decides where the money goes (409 `PAYMENT_DISPUTED`);
 * - **the reservation** — settlement moves the amount out of
 *   `refundPendingCents`, which has to hold it (409 `REFUND_NOT_RESERVED`);
 * - **the lines** — a line must not carry more than its face value
 *   (`OrderItem.refundedCents <= subtotalCents`), counting what settled
 *   refunds put on it, what refunds already with the provider hold, and this
 *   refund. A refund asked for before 2026-09-30 spread fee and tax over the
 *   lines, which is also refused: its lines give back more than its
 *   allocation's face value (409 `REFUND_LINES_INVALID`).
 *
 * The refund's row lock and then the order's, the order every writer takes
 * them in, held until `SUBMITTED` is written in the same transaction, so no
 * other refund of the order is sent or settles between the check and the
 * claim. A refund that moved on since the caller read it is left to the
 * transition, which refuses it.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.refund The refund about to be submitted, as the caller read it.
 * @returns {Promise<void>} Nothing; it throws instead.
 * @throws {Error} 409 `PAYMENT_DISPUTED`, `REFUND_NOT_RESERVED` or `REFUND_LINES_INVALID`.
 */
export async function assertRefundSendable(tx, { refund }) {
  await tx.$queryRaw`SELECT "id" FROM "Refund" WHERE "id" = ${refund.id} FOR UPDATE`
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${refund.orderId} FOR UPDATE`

  const fresh = await tx.refund.findUnique({ where: { id: refund.id } })

  if (
    !fresh ||
    fresh.status !== refund.status ||
    !canTransition(fresh.status, REFUND_STATES.SUBMITTED)
  ) {
    return
  }

  const details = { refundId: fresh.id, orderId: fresh.orderId }

  if (await paymentDisputeBlocks(tx, fresh.paymentId)) {
    throw paymentDisputed({ ...details, paymentId: fresh.paymentId })
  }

  const order = await tx.order.findUnique({
    where: { id: fresh.orderId },
    include: { items: true },
  })

  if (!order) throw httpError(409, 'ORDER_MISSING', 'That refund names an order that is gone.')

  if (order.refundPendingCents < fresh.amountCents) {
    throw notReserved({
      ...details,
      amountCents: fresh.amountCents,
      refundPendingCents: order.refundPendingCents,
    })
  }

  const mine = await tx.refundItem.findMany({ where: { refundId: fresh.id } })
  const stored = partsOf(fresh.allocation)
  const onLines = mine.reduce((sum, item) => sum + item.amountCents, 0)

  if (stored && onLines > stored.faceValueCents) {
    throw linesInvalid({ ...details, onLines, faceValueCents: stored.faceValueCents })
  }

  const flying = await tx.refund.findMany({
    where: { orderId: order.id, status: { in: [...IN_FLIGHT_STATES] } },
    select: { id: true },
  })
  const flyingIds = flying.map((row) => row.id).filter((id) => id !== fresh.id)
  const held = new Map()

  if (flyingIds.length > 0) {
    for (const item of await tx.refundItem.findMany({ where: { refundId: { in: flyingIds } } })) {
      held.set(item.orderItemId, (held.get(item.orderItemId) ?? 0) + item.amountCents)
    }
  }

  const lineOf = new Map((order.items ?? []).map((item) => [item.id, item]))
  const asked = new Map()

  for (const item of mine) {
    asked.set(item.orderItemId, (asked.get(item.orderItemId) ?? 0) + item.amountCents)
  }

  for (const [orderItemId, amountCents] of asked) {
    const line = lineOf.get(orderItemId)
    const total = (line?.refundedCents ?? 0) + (held.get(orderItemId) ?? 0) + amountCents

    if (!line || total > line.subtotalCents) {
      throw linesInvalid({ ...details, orderItemId, subtotalCents: line?.subtotalCents ?? null })
    }
  }
}

/**
 * Send an approved refund to the provider and record what it said.
 *
 * The three steps of `refunds.submit`, in one place so every caller shares
 * them: SUBMITTED in its own transaction, before anything is sent; the
 * provider with nothing open; a short transaction recording the answer,
 * conditional on the refund still being SUBMITTED, so a webhook that settled it
 * meanwhile and this call cannot both do so. The refund passed is the one to
 * send, as read after any repair.
 *
 * Before the claim, in its transaction, {@link assertRefundSendable} checks
 * what settlement will rely on — no blocking dispute, the reservation, room on
 * the lines — and refuses with a 409 while nothing has been sent.
 *
 * @param {object} prisma A Prisma client. Never a transaction client.
 * @param {object} providers The provider registry.
 * @param {object} params Inputs.
 * @param {object} params.refund The APPROVED refund, as it was read.
 * @param {object} params.order Its order.
 * @param {object} params.payment The payment it is against.
 * @param {string} params.organizationId Whose event it was.
 * @param {Date|null} [params.eventStartsAt] For the refunded-seat policy.
 * @param {string} [params.seatPolicy] An explicit seat policy.
 * @param {string|null} [params.actorId] Who sent it.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {string|null} [params.via] What sent it, carried on the settlement's audit row.
 * @returns {Promise<{outcome: string, refund: object}>} What the provider said, and the refund as it now stands.
 * @throws {Error} 409 when the refund cannot be submitted, cannot settle, or another caller is submitting it.
 */
export async function submitRefund(prisma, providers, params) {
  const {
    refund,
    order,
    payment,
    organizationId,
    eventStartsAt = null,
    seatPolicy,
    actorId = null,
    requestId = null,
    via = null,
  } = params

  // Step one: SUBMITTED, in its own transaction, before anything is sent.
  // A process that dies during the call below leaves this row behind, which
  // is the evidence reconciliation needs that a refund may exist. First, under
  // the same locks, everything settlement will rely on: a refusal here costs
  // nothing, and the same refusal in settlement would come after the money.
  const claimed = await prisma.$transaction(async (tx) => {
    await assertRefundSendable(tx, { refund })

    return markSubmitted(tx, { refund, now: new Date() })
  })

  // An unsubmittable state raises from the transition table, so `false` here
  // is a lost race — and losing it matters, because the winner is talking to a
  // provider right now.
  if (!claimed) {
    throw conflict('That refund is already being submitted. Read it again.', {
      status: refund.status,
    })
  }

  const submitted = { ...refund, status: REFUND_STATES.SUBMITTED }

  // Step two: the provider, with nothing open. The transaction above has
  // committed and the one below has not started.
  const result = await submitOutsideTransaction(providers.payments, submitted, payment)

  // Step three: a short transaction recording what it said. Conditional on
  // the refund still being SUBMITTED, so a webhook that arrived while the call
  // was in flight and this call cannot both settle it. Nothing here decides
  // from the caller's copy of the order's counters: settlement reads them off
  // its own update.
  await prisma.$transaction(async (tx) => {
    if (result.outcome === REFUND_OUTCOMES.SUCCEEDED) {
      return settleRefund(tx, {
        refund: submitted,
        order,
        result,
        organizationId,
        seatPolicy,
        eventStartsAt,
        actorId,
        requestId,
        via,
        now: new Date(),
      })
    }

    if (result.outcome === REFUND_OUTCOMES.TIMEOUT) {
      return recordRefundTimeout(tx, {
        refund: submitted,
        order,
        result,
        organizationId,
        actorId,
        requestId,
        now: new Date(),
      })
    }

    return recordRefundFailure(tx, {
      refund: submitted,
      order,
      result,
      actorId,
      requestId,
      now: new Date(),
    })
  })

  const after = await prisma.refund.findUnique({ where: { id: refund.id } })

  return { outcome: result.outcome, refund: after ?? submitted }
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
