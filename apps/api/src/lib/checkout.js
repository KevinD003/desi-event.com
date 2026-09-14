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

import { PROVIDER_ERROR_CODES } from '@desi-event/providers'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'

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
 * @param {string|null} [params.actorId] Actor for the audit trail.
 * @param {string|null} [params.requestId] Request id for the audit trail.
 * @returns {Promise<{settled: boolean}>} Whether this call performed the transition.
 */
export async function settleCheckout(
  tx,
  { order, payment, result, now, generateTicketCode, actorId = null, requestId = null },
) {
  const { count } = await tx.order.updateMany({
    where: { id: order.id, status: 'PENDING' },
    data: { status: 'PAID', paidAt: now },
  })

  // Somebody else already settled this order. Do nothing: not a second set of
  // tickets, not a second audit row, not a second inventory decrement.
  if (count === 0) return { settled: false }

  const items = await tx.orderItem.findMany({ where: { orderId: order.id } })

  for (const item of items) {
    for (let index = 0; index < item.quantity; index += 1) {
      await tx.ticket.create({
        data: {
          orderItemId: item.id,
          code: generateTicketCode(),
          attendeeName: order.buyerName,
          status: 'VALID',
        },
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
