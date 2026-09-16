/**
 * Two-phase checkout.
 *
 * The rule this module exists to enforce: **no call to a payment provider ever
 * happens while a database transaction is open.**
 *
 * Holding locks across a network call to a third party couples the database's
 * availability to theirs. A gateway that is merely slow exhausts the
 * transaction timeout, the surrounding transaction rolls back, and the money
 * has still moved — a charge with no order and no tickets against it. That is
 * the worst failure a ticketing system has, because the buyer has paid and the
 * system has no record of it.
 *
 * So checkout is three steps, and the boundaries are the point:
 *
 *   1. {@link beginCheckout} — validate, price, reserve inventory, and write a
 *      PENDING order with an INITIATED payment attempt. Commits. After this
 *      returns, durable evidence exists that a charge is about to be attempted.
 *   2. {@link captureOutsideTransaction} — call the provider with nothing open.
 *      However long it takes, no locks are held and nothing can time out
 *      underneath it.
 *   3. {@link settleCheckout} or {@link compensateCheckout} — a short
 *      transaction that records the outcome. Settlement is conditional on the
 *      order still being PENDING, so two workers racing the same payment
 *      produce exactly one fulfilment.
 *
 * A timeout is not a decline. A decline means no money moved; a timeout means
 * nobody knows. Those take different paths: a decline compensates immediately,
 * a timeout leaves the order PENDING and flags the payment for reconciliation,
 * because cancelling an order whose charge may have succeeded is how you
 * refund-by-accident or strand a buyer who was in fact charged.
 *
 * @module @desi-event/api/lib/checkout
 */

import { orderPaidBatch } from '@desi-event/ledger'
import { PROVIDER_ERROR_CODES } from '@desi-event/providers'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { postBatch } from './ledger.js'
import { sellSeats } from './seating.js'
import { issueTicketCredential } from './ticket-credentials.js'
import { openReconciliation } from './webhook-handlers.js'

/** What the provider told us, once we are out of the transaction. */
export const CAPTURE_OUTCOMES = Object.freeze({
  SUCCEEDED: 'SUCCEEDED',
  DECLINED: 'DECLINED',
  /** No definite answer. The money may or may not have moved. */
  TIMEOUT: 'TIMEOUT',
})

/**
 * Call the payment provider. No transaction may be open when this runs.
 *
 * Never throws for a payment outcome — a decline and a timeout are results, not
 * exceptions, and the caller has to record both. It still throws for a
 * programming error, which is not a payment outcome.
 *
 * @param {object} payments The payment provider.
 * @param {object} order The committed PENDING order.
 * @returns {Promise<{outcome: string, intent: object|null, failureCode: string|null, rawStatus: string|null}>} What happened.
 */
export async function captureOutsideTransaction(payments, order) {
  try {
    const intent = await payments.createIntent({
      amountCents: order.totalCents,
      currency: order.currency,
      orderId: order.id,
      metadata: { reference: order.reference, buyerEmail: order.buyerEmail },
    })

    const captured = await payments.capture(intent.id, {
      amountCents: order.totalCents,
      currency: order.currency,
    })

    return {
      outcome: CAPTURE_OUTCOMES.SUCCEEDED,
      intent: captured,
      failureCode: null,
      rawStatus: captured.status ?? null,
    }
  } catch (error) {
    if (error?.code === PROVIDER_ERROR_CODES.PAYMENT_TIMEOUT) {
      return {
        outcome: CAPTURE_OUTCOMES.TIMEOUT,
        intent: null,
        failureCode: null,
        rawStatus: 'TIMEOUT',
        providerRef: error.details?.intentId ?? null,
      }
    }

    if (error?.code === PROVIDER_ERROR_CODES.PAYMENT_DECLINED) {
      return {
        outcome: CAPTURE_OUTCOMES.DECLINED,
        intent: null,
        failureCode: error.details?.failureCode ?? 'card_declined',
        rawStatus: 'FAILED',
        providerRef: error.details?.intentId ?? null,
      }
    }

    throw error
  }
}

/**
 * Move an order's reserved seats from HELD to SOLD.
 *
 * Reserved seating is an extra step on top of quantity: a general-admission
 * order only decrements a counter, but a seated order has named rows that have
 * to stop being holdable and start belonging to an order line. It happens in the
 * settlement transaction rather than after it, because a seat that is paid for
 * and still HELD is a seat the expiry sweep may release out from under a ticket.
 *
 * Which line pays for which seat was decided at checkout and written onto the
 * hold item, so this reads a column rather than reconstructing the answer. It
 * used to match a held seat to the order line of the same ticket type, which is
 * wrong as soon as one selection spans two price zones: that is two lines of
 * one tier, and the map had room for only one of them. The seat that lost the
 * collision was sold against the wrong line at the wrong price.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {string} params.orderId The order being settled.
 * @returns {Promise<number>} How many seats were sold.
 * @throws {Error} When a held seat was never stamped with the line that pays for it.
 */
export async function sellHeldSeats(tx, { orderId }) {
  const holds = await tx.ticketHold.findMany({
    where: { orderId, status: 'ACTIVE' },
    select: { id: true },
  })

  if (holds.length === 0) return 0

  let sold = 0

  for (const hold of holds) {
    const heldSeats = await tx.holdItem.findMany({
      where: { holdId: hold.id, eventSeatId: { not: null } },
      select: { eventSeatId: true, orderItemId: true, ticketTypeId: true },
    })

    if (heldSeats.length === 0) continue

    const orderItemBySeat = {}

    for (const heldSeat of heldSeats) {
      if (!heldSeat.orderItemId) {
        // A seat reserved for this order that no line claims. Selling the rest
        // and skipping this one would leave a seat held against a paid order,
        // which the expiry sweep would eventually release out from under a
        // ticket. Refusing rolls the settlement back instead.
        throw new Error(
          `Hold ${hold.id} reserves seat ${heldSeat.eventSeatId} for order ${orderId}, but no line on that order pays for it`,
        )
      }

      orderItemBySeat[heldSeat.eventSeatId] = heldSeat.orderItemId
    }

    sold += await sellSeats(tx, { holdId: hold.id, orderItemBySeat })
  }

  return sold
}

/**
 * Post the ledger batch for a paid order.
 *
 * The split comes from the order's own stored totals, which were computed from
 * the versioned pricing snapshot at checkout — not from the live fee tables,
 * which may have moved since. The organiser is credited the **subtotal** and the
 * discount is debited as contra-revenue, so the money given away stays visible
 * rather than disappearing into a smaller payable.
 *
 * The arithmetic is checked by `orderPaidBatch`, which refuses a split that does
 * not add up to what was captured. That matters more than it looks: a wrong
 * split that happened to balance would post and never be questioned.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.order The order, with its totals.
 * @param {object|null} params.payment The payment attempt, when there was one.
 * @param {Date} params.now The posting instant.
 * @param {string|null} [params.actorId] Who settled it. Null means a system job.
 * @returns {Promise<object|null>} The posted batch, or null for a zero-total order.
 */
export async function postOrderLedger(tx, { order, payment, now, actorId = null }) {
  // A free order moves no money, so there is nothing to record. Posting a
  // zero-value batch would satisfy the balance rule and mean nothing.
  if (!order.totalCents) return null

  const event = await tx.event.findUnique({
    where: { id: order.eventId },
    select: { organizationId: true },
  })

  const batch = orderPaidBatch({
    capturedCents: order.totalCents,
    organizerNetCents: order.subtotalCents,
    platformFeeCents: order.feesCents ?? 0,
    taxCents: order.taxCents ?? 0,
    discountCents: order.discountCents ?? 0,
    currency: order.currency,
    organizationId: event?.organizationId ?? null,
    reference: order.reference,
  })

  const { batch: posted } = await postBatch(tx, batch, {
    sourceType: 'ORDER',
    sourceId: order.id,
    reference: `LB-${order.reference}`,
    orderId: order.id,
    paymentId: payment?.id ?? null,
    actorId,
    now,
  })

  return posted
}

/**
 * Issue one ticket, with the pass that opens the door.
 *
 * Two writes rather than one, because the credential is derived from the
 * ticket's own id and that id does not exist until the row does. The plaintext
 * is computed, hashed, and thrown away here; only the digest is stored. Nothing
 * returns it, because at issuance nobody is watching — the buyer reads their
 * pass later, through a route that re-derives it for them.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {string} params.orderItemId The line this ticket is on.
 * @param {string|null} params.eventSeatId The seat it admits to, for reserved seating.
 * @param {string|null} params.attendeeName Whose name is printed on it.
 * @param {string|null} params.ownerUserId Who holds it, when the buyer was signed in.
 * @param {function(): string} params.generateTicketCode Ticket code factory.
 * @param {string} params.credentialSecret The deployment's `AUTH_SECRET`.
 * @param {Date} params.now Issuance instant.
 * @returns {Promise<object>} The created ticket, without its credential.
 */
export async function issueTicket(
  tx,
  {
    orderItemId,
    eventSeatId,
    attendeeName,
    ownerUserId,
    generateTicketCode,
    credentialSecret,
    now,
  },
) {
  const ticket = await tx.ticket.create({
    data: {
      orderItemId,
      code: generateTicketCode(),
      attendeeName,
      ownerUserId,
      eventSeatId,
      status: 'VALID',
    },
  })

  const { credentialHash } = issueTicketCredential({
    secret: credentialSecret,
    ticketId: ticket.id,
    version: ticket.credentialVersion ?? 1,
  })

  return tx.ticket.update({
    where: { id: ticket.id },
    data: { credentialHash, credentialIssuedAt: now },
  })
}

/**
 * Record a successful capture and fulfil the order.
 *
 * The update is conditional on the order still being PENDING. That single
 * condition is what stops two workers — a webhook and a redirect, or two
 * retries — from issuing two sets of tickets for one payment.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Settlement inputs.
 * @param {object} params.order The PENDING order.
 * @param {object} params.payment The payment attempt row.
 * @param {object} params.result The capture result.
 * @param {Date} params.now Settlement instant.
 * @param {function(): string} params.generateTicketCode Ticket code factory.
 * @param {string} params.credentialSecret The deployment's `AUTH_SECRET`, for minting passes.
 * @param {string|null} [params.actorId] Actor for the audit trail.
 * @param {string|null} [params.requestId] Request id for the audit trail.
 * @returns {Promise<{settled: boolean}>} Whether this call performed the transition.
 */
export async function settleCheckout(
  tx,
  {
    order,
    payment,
    result,
    now,
    generateTicketCode,
    credentialSecret,
    actorId = null,
    requestId = null,
  },
) {
  const { count } = await tx.order.updateMany({
    where: { id: order.id, status: 'PENDING' },
    data: { status: 'PAID', paidAt: now },
  })

  // Somebody else already settled this order. Do nothing: not a second set of
  // tickets, not a second audit row, not a second inventory decrement.
  if (count === 0) return { settled: false }

  const items = await tx.orderItem.findMany({ where: { orderId: order.id } })

  // The seats first, so a ticket can be minted against the seat it admits to.
  // A ticket issued before the seat was sold would have to be updated
  // afterwards, and an update is a second chance to get it wrong.
  const soldSeats = await sellHeldSeats(tx, { orderId: order.id })

  for (const item of items) {
    const seats = soldSeats
      ? await tx.eventSeat.findMany({
          where: { orderItemId: item.id },
          select: { id: true },
          orderBy: { id: 'asc' },
        })
      : []

    for (let index = 0; index < item.quantity; index += 1) {
      await issueTicket(tx, {
        orderItemId: item.id,
        eventSeatId: seats[index]?.id ?? null,
        attendeeName: order.buyerName,
        ownerUserId: order.userId ?? null,
        generateTicketCode,
        credentialSecret,
        now,
      })
    }

    await tx.ticketType.update({
      where: { id: item.ticketTypeId },
      data: { quantitySold: { increment: item.quantity } },
    })
  }

  await tx.ticketHold.updateMany({
    where: { orderId: order.id, status: 'ACTIVE' },
    data: { status: 'CONVERTED' },
  })

  // The ledger, last, and inside the same transaction. A payment recorded with
  // no ledger entry is money the business cannot see; a ledger entry with no
  // payment is money it imagines. Both are avoided by making them one commit.
  //
  // Idempotency is the batch's, not this function's: `postBatch` keys on the
  // order, so a settlement that somehow ran twice would post once. The
  // conditional update above already makes that unreachable, which is the point
  // — two independent reasons, so a change to one does not silently remove the
  // protection.
  await postOrderLedger(tx, { order, payment, now, actorId })

  // A zero-total order has no payment attempt to settle.
  if (payment) {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCEEDED',
        providerRef: result.intent?.id ?? result.providerRef ?? payment.providerRef,
        rawProviderStatus: result.rawStatus,
        settledAt: now,
        reconciliationRequired: false,
      },
    })
  }

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.ORDER_PAID,
    entityType: 'Order',
    entityId: order.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      previousStatus: 'PENDING',
      newStatus: 'PAID',
      paymentId: payment?.id ?? null,
      totalCents: order.totalCents,
      currency: order.currency,
    },
  })

  return { settled: true }
}

/**
 * Undo a checkout whose payment did not succeed.
 *
 * The order is cancelled and the attempt recorded as failed. Holds are left
 * ACTIVE on purpose: the buyer's reservation survives so they can retry with
 * another card instead of losing their seats to the person behind them.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Compensation inputs.
 * @param {object} params.order The PENDING order.
 * @param {object} params.payment The payment attempt row.
 * @param {string|null} params.failureCode The provider's decline code.
 * @param {Date} params.now Compensation instant.
 * @param {string|null} [params.actorId] Actor for the audit trail.
 * @param {string|null} [params.requestId] Request id for the audit trail.
 * @returns {Promise<{compensated: boolean}>} Whether this call performed the transition.
 */
export async function compensateCheckout(
  tx,
  { order, payment, failureCode, now, actorId = null, requestId = null },
) {
  const { count } = await tx.order.updateMany({
    where: { id: order.id, status: 'PENDING' },
    data: { status: 'CANCELLED', cancelledAt: now },
  })

  if (count === 0) return { compensated: false }

  await tx.payment.update({
    where: { id: payment.id },
    data: { status: 'FAILED', failureCode, rawProviderStatus: 'FAILED', settledAt: now },
  })

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
      paymentId: payment.id,
      failureCode,
      reason: 'PAYMENT_DECLINED',
    },
  })

  return { compensated: true }
}

/**
 * Record an ambiguous provider timeout.
 *
 * The order stays PENDING and the payment is flagged for reconciliation. It is
 * deliberately *not* cancelled: the charge may have succeeded, and cancelling
 * would either strand a buyer who paid or trigger a refund for money that was
 * never taken. A human or a reconciliation job resolves it against the provider.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.order The PENDING order.
 * @param {object} params.payment The payment attempt row.
 * @param {object} params.result The capture result.
 * @param {Date} params.now Instant.
 * @param {string|null} [params.actorId] Actor for the audit trail.
 * @param {string|null} [params.requestId] Request id for the audit trail.
 * @returns {Promise<void>} Nothing.
 */
export async function recordCaptureTimeout(
  tx,
  { order, payment, result, now, actorId = null, requestId = null },
) {
  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: 'TIMEOUT',
      reconciliationRequired: true,
      rawProviderStatus: result.rawStatus,
      providerRef: result.providerRef ?? payment.providerRef,
    },
  })

  // A flag nothing reads is not a queue. `reconciliationRequired` marked the
  // payment, and until this line there was no work item for anybody to find, so
  // an ambiguous charge sat in the database waiting to be noticed. The task
  // carries what we believed at the time, verbatim: a later fix should not erase
  // what the problem looked like.
  await openReconciliation(tx, {
    kind: 'PAYMENT_TIMEOUT',
    paymentId: payment.id,
    orderId: order.id,
    providerRef: result.providerRef ?? payment.providerRef ?? null,
    localState: {
      orderStatus: 'PENDING',
      paymentStatus: 'TIMEOUT',
      totalCents: order.totalCents,
      currency: order.currency,
      at: now.toISOString(),
    },
    lastError: 'the provider did not answer; the charge may or may not have succeeded',
  })

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.PAYMENT_TIMEOUT,
    entityType: 'Payment',
    entityId: payment.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      orderId: order.id,
      orderStatus: 'PENDING',
      totalCents: order.totalCents,
      currency: order.currency,
      reason: 'PROVIDER_TIMEOUT_REQUIRES_RECONCILIATION',
    },
  })
}
