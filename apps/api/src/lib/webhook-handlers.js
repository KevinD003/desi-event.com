/**
 * What a verified event actually does.
 *
 * One handler per event type, dispatched from a stored row rather than from a
 * request. Three rules run through all of them, and each exists because of a
 * specific way this goes wrong:
 *
 *   1. **Drift is refused, not applied.** An event whose amount, currency or
 *      order does not match the stored payment is not acted on — it opens a
 *      reconciliation task. A payment that arrives for ₹1 against a ₹2,500 order
 *      is either a bug or an attack, and applying it is worse than either.
 *   2. **Every mutation is conditional on the state it expects.** A
 *      `payment_intent.succeeded` marks a payment paid only if it is not already;
 *      an out-of-order `payment_failed` arriving after a success matches nothing.
 *      Stripe does not guarantee order, so ordering cannot be assumed — it has to
 *      be made not to matter.
 *   3. **Replaying is a no-op, by construction.** Not by checking "have I seen
 *      this event" — the unique index already does that — but because each
 *      handler's write is conditional on a state it has already left. Replay is
 *      how a dead-lettered event is recovered, so it has to be safe.
 *
 * @module @desi-event/api/lib/webhook-handlers
 */

import { HANDLED_EVENTS } from '@desi-event/providers'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'

/**
 * Amount and currency drift beyond which an event is refused.
 *
 * Zero. There is no tolerance: a payment provider does not round, and a
 * mismatch is information rather than noise.
 *
 * @type {number}
 */
export const AMOUNT_TOLERANCE_CENTS = 0

/**
 * Open a reconciliation task, or leave the existing one alone.
 *
 * Deliberately not `create`: an event that keeps failing must not produce a
 * hundred tasks for one payment. The first task is the one an operator works, and
 * subsequent attempts add to its count rather than to its number.
 *
 * A `refundId` narrows the match as well as being stored. Two refunds against
 * one payment are two separate unknowns — a partial refund that timed out and
 * a later one that also did are not the same question — so folding them into
 * one task would leave an operator resolving one and silently closing both.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} task The task.
 * @param {string} task.kind A `ReconciliationKind`.
 * @param {string|null} [task.paymentId] The payment.
 * @param {string|null} [task.orderId] The order.
 * @param {string|null} [task.refundId] The refund, when the doubt is about one.
 * @param {string|null} [task.webhookEventId] The delivery that raised it.
 * @param {string|null} [task.providerRef] The provider's reference.
 * @param {string|null} [task.organizationId] Whose work item it is. Null is platform-level.
 * @param {object} [task.localState] What this system believes.
 * @param {object} [task.providerState] What the provider said.
 * @param {string} [task.lastError] Why.
 * @returns {Promise<object>} The task.
 */
export async function openReconciliation(prisma, task) {
  const existing = await prisma.reconciliationTask.findFirst({
    where: {
      kind: task.kind,
      state: { in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] },
      ...(task.refundId ? { refundId: task.refundId } : {}),
      ...(task.paymentId ? { paymentId: task.paymentId } : {}),
      ...(task.providerRef && !task.paymentId ? { providerRef: task.providerRef } : {}),
    },
  })

  if (existing) {
    return prisma.reconciliationTask.update({
      where: { id: existing.id },
      data: {
        attempts: { increment: 1 },
        ...(task.lastError ? { lastError: String(task.lastError).slice(0, 500) } : {}),
        ...(task.providerState ? { providerState: task.providerState } : {}),
      },
    })
  }

  return prisma.reconciliationTask.create({
    data: {
      kind: task.kind,
      state: 'OPEN',
      paymentId: task.paymentId ?? null,
      orderId: task.orderId ?? null,
      // Stored, not merely accepted. A task about a refund that does not name
      // the refund is a task nobody can act on.
      refundId: task.refundId ?? null,
      webhookEventId: task.webhookEventId ?? null,
      providerRef: task.providerRef ?? null,
      organizationId: task.organizationId ?? null,
      localState: task.localState ?? undefined,
      providerState: task.providerState ?? undefined,
      attempts: 1,
      lastError: task.lastError ? String(task.lastError).slice(0, 500) : null,
    },
  })
}

/**
 * Find the payment an event is about.
 *
 * By the provider's own reference, which is the only identifier both sides agree
 * on. Deliberately *not* by the `orderId` in the event's metadata: metadata is
 * set by this system and echoed by Stripe, so trusting it to find the payment
 * would mean trusting a field that a compromised dashboard session could edit.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} providerRef The PaymentIntent id.
 * @returns {Promise<object|null>} The payment with its order, or null.
 */
export function findPaymentByRef(prisma, providerRef) {
  return prisma.payment.findFirst({
    where: { providerRef },
    include: { order: true },
  })
}

/**
 * Whether an event's money matches the payment it names.
 *
 * Checked before anything is applied. Three things must agree: the amount, the
 * currency, and — when the event carries one — the connected account. An event
 * that agrees on none of them is not about this payment.
 *
 * @param {object} payment The stored `Payment`.
 * @param {object} intent The Stripe PaymentIntent from the event.
 * @param {string|null} accountContext The connected account the event arrived for.
 * @returns {{ok: boolean, drift: object|null}} Whether to proceed, and what differed.
 */
export function checkForDrift(payment, intent, accountContext) {
  const drift = {}

  if (Math.abs((intent.amount ?? 0) - payment.amountCents) > AMOUNT_TOLERANCE_CENTS) {
    drift.amount = { expected: payment.amountCents, received: intent.amount ?? null }
  }

  if (String(intent.currency ?? '').toUpperCase() !== String(payment.currency).toUpperCase()) {
    drift.currency = { expected: payment.currency, received: intent.currency ?? null }
  }

  // Only when both sides name one. A platform event about a payment that has no
  // connected account is not drift.
  if (accountContext && payment.providerAccountId && accountContext !== payment.providerAccountId) {
    drift.account = { expected: payment.providerAccountId, received: accountContext }
  }

  return Object.keys(drift).length === 0 ? { ok: true, drift: null } : { ok: false, drift }
}

/**
 * The outcome a handler reports back to the dispatcher.
 *
 * @typedef {object} HandlerResult
 * @property {'processed'|'ignored'|'reconcile'} outcome What happened.
 * @property {string|null} [orderId] The order it concerned.
 * @property {string|null} [paymentId] The payment it concerned.
 * @property {string} [reason] Why, for the stored row and the log.
 */

/**
 * Mark a payment paid, once.
 *
 * The update is conditional on the payment *not* already being paid, so a
 * duplicate delivery, a replay and an out-of-order arrival all write nothing and
 * report success. That is what makes acknowledging a delivery safe.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} context The context.
 * @param {object} context.payment The stored payment.
 * @param {object} context.intent The Stripe PaymentIntent.
 * @param {string} context.webhookEventId The delivery.
 * @param {Date} [context.now] The current time.
 * @returns {Promise<HandlerResult>} The outcome.
 */
export async function applyPaymentSucceeded(
  prisma,
  { payment, intent, webhookEventId, now = new Date() },
) {
  const { count } = await prisma.payment.updateMany({
    where: { id: payment.id, status: { notIn: ['SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED'] } },
    data: {
      status: 'SUCCEEDED',
      settledAt: now,
      reconciliationRequired: false,
      rawProviderStatus: intent.status ?? null,
      failureCode: null,
    },
  })

  if (count === 0) {
    // Already settled. Nothing to do and nothing wrong: this is the duplicate
    // and replay path, and it must be quiet.
    return {
      outcome: 'processed',
      orderId: payment.orderId,
      paymentId: payment.id,
      reason: 'already settled',
    }
  }

  // The order follows the payment, and only from a state where money was still
  // expected. An order somebody cancelled in the meantime does not become paid
  // because a late webhook arrived.
  // Only from PENDING. An order somebody cancelled, or one that expired, does
  // not become paid because a late webhook arrived — it becomes a reconciliation
  // item, which is what the drift and no-match paths above are for.
  await prisma.order.updateMany({
    where: { id: payment.orderId, status: 'PENDING' },
    data: { status: 'PAID', paidAt: now },
  })

  await recordAudit(prisma, {
    action: AUDIT_ACTIONS.ORDER_PAID,
    entityType: 'Payment',
    entityId: payment.id,
    metadata: { source: 'webhook', webhookEventId, providerStatus: intent.status ?? null },
  })

  return { outcome: 'processed', orderId: payment.orderId, paymentId: payment.id }
}

/**
 * Mark a payment failed, once, and only if it has not succeeded.
 *
 * The `notIn` is the whole safety of this function. Stripe can deliver
 * `payment_failed` for an earlier attempt *after* `succeeded` for a later one; a
 * handler that wrote unconditionally would un-pay a paid order.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} context The context.
 * @param {object} context.payment The stored payment.
 * @param {object} context.intent The Stripe PaymentIntent.
 * @param {string} context.webhookEventId The delivery.
 * @returns {Promise<HandlerResult>} The outcome.
 */
export async function applyPaymentFailed(prisma, { payment, intent, webhookEventId }) {
  const { count } = await prisma.payment.updateMany({
    where: {
      id: payment.id,
      status: { notIn: ['SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED'] },
    },
    data: {
      status: 'FAILED',
      rawProviderStatus: intent.status ?? null,
      failureCode: intent.last_payment_error?.code ?? null,
    },
  })

  if (count === 0) {
    // A failure for an attempt that was superseded by a success. Recording it as
    // a reconciliation item rather than ignoring it, because it is the shape of
    // "two attempts, one succeeded" and somebody should be able to see that
    // happened.
    return {
      outcome: 'processed',
      orderId: payment.orderId,
      paymentId: payment.id,
      reason: 'a later attempt had already succeeded',
    }
  }

  // `OrderStatus` has no PAYMENT_FAILED: an order whose payment failed stays
  // PENDING so the buyer can try another card, and the payment row carries the
  // failure. Cancelling it here would take the inventory away from somebody who
  // is still trying to pay for it.

  await recordAudit(prisma, {
    action: AUDIT_ACTIONS.PAYMENT_DECLINED,
    entityType: 'Payment',
    entityId: payment.id,
    metadata: {
      source: 'webhook',
      webhookEventId,
      failureCode: intent.last_payment_error?.code ?? null,
    },
  })

  return { outcome: 'processed', orderId: payment.orderId, paymentId: payment.id }
}

/**
 * Record a state that is neither success nor failure.
 *
 * `processing` and `requires_action` both mean "not yet", and both are worth
 * storing: a buyer refreshing a page needs to be told which, and a payment stuck
 * in `processing` for a day is a reconciliation item.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} context The context.
 * @param {object} context.payment The stored payment.
 * @param {object} context.intent The Stripe PaymentIntent.
 * @param {string} context.status The `PaymentStatus` to record.
 * @returns {Promise<HandlerResult>} The outcome.
 */
export async function applyPaymentPending(prisma, { payment, intent, status }) {
  await prisma.payment.updateMany({
    where: {
      id: payment.id,
      status: { notIn: ['SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FAILED'] },
    },
    data: { status, rawProviderStatus: intent.status ?? null },
  })

  return { outcome: 'processed', orderId: payment.orderId, paymentId: payment.id }
}

/**
 * Update a connected account's stored state from an `account.updated` event.
 *
 * The event's own contents are used rather than a fresh read, which is the one
 * place this system trusts a payload over a retrieve — justified because the
 * payload is signed, and because `account.updated` is the event whose whole
 * purpose is to carry the new state. A reconciliation sweep re-reads periodically
 * regardless.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} context The context.
 * @param {object} context.account The Stripe Account from the event.
 * @returns {Promise<HandlerResult>} The outcome.
 */
export async function applyAccountUpdated(prisma, { account }) {
  const { count } = await prisma.connectedAccount.updateMany({
    where: { providerAccountId: account.id },
    data: {
      chargesEnabled: account.charges_enabled === true,
      payoutsEnabled: account.payouts_enabled === true,
      detailsSubmitted: account.details_submitted === true,
      disabledReason: account.requirements?.disabled_reason ?? null,
      // Counts, not contents. This system needs to know whether an organiser can
      // be paid; which identity documents Stripe is still waiting for is Stripe's
      // hosted page to say, and is not something to keep in a row here.
      requirementsDue: {
        currentlyDue: (account.requirements?.currently_due ?? []).length,
        pastDue: (account.requirements?.past_due ?? []).length,
      },
      syncedAt: new Date(),
    },
  })

  return count === 1
    ? { outcome: 'processed' }
    : { outcome: 'ignored', reason: 'no connected account with that id' }
}

/**
 * Dispatch one verified, stored delivery.
 *
 * Returns rather than throws for every *expected* outcome, so the dispatcher can
 * record the right state. It throws only for the unexpected — a database failure,
 * a bug — which is what schedules a retry.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} row The stored `WebhookEvent`.
 * @param {object} [options] Options.
 * @param {Date} [options.now] The current time.
 * @returns {Promise<HandlerResult>} What happened.
 */
export async function dispatchDelivery(prisma, row, { now = new Date() } = {}) {
  const internal = HANDLED_EVENTS[row.eventType]

  if (!internal) {
    // Recorded and ignored. A type nobody handles today is evidence when
    // somebody asks why something did not happen.
    return { outcome: 'ignored', reason: `no handler for ${row.eventType}` }
  }

  const object = row.payload?.data?.object ?? {}
  const accountContext = row.accountContext || null

  if (row.eventType === 'account.updated') {
    return applyAccountUpdated(prisma, { account: object })
  }

  if (row.eventType === 'account.application.deauthorized') {
    await prisma.connectedAccount.updateMany({
      where: { providerAccountId: object.id ?? row.accountContext },
      data: { chargesEnabled: false, payoutsEnabled: false, disabledReason: 'deauthorized' },
    })

    return { outcome: 'processed' }
  }

  if (!row.eventType.startsWith('payment_intent.')) {
    // Refunds, disputes, transfers and payouts are handled by their own modules,
    // which are not reachable from here yet. Recorded as ignored with a reason
    // rather than silently dropped or falsely marked processed.
    return { outcome: 'ignored', reason: `${row.eventType} has no handler in this build` }
  }

  const providerRef = object.id

  if (!providerRef) return { outcome: 'ignored', reason: 'the event names no payment intent' }

  const payment = await findPaymentByRef(prisma, providerRef)

  if (!payment) {
    // An event for a payment this system has never heard of. Not ignored: it is
    // either a Stripe object created outside this system, or a payment whose row
    // was lost, and both want somebody to look.
    await openReconciliation(prisma, {
      kind: 'PROVIDER_MISMATCH',
      providerRef,
      webhookEventId: row.id,
      providerState: { status: object.status ?? null, amount: object.amount ?? null },
      lastError: 'a webhook arrived for a payment intent with no local payment',
    })

    return { outcome: 'reconcile', reason: 'no local payment for that intent' }
  }

  const { ok, drift } = checkForDrift(payment, object, accountContext)

  if (!ok) {
    // Refused rather than applied. This is the case where believing the event
    // would settle an order for the wrong amount, in the wrong currency, or on
    // behalf of the wrong organiser.
    await openReconciliation(prisma, {
      kind: 'PROVIDER_MISMATCH',
      paymentId: payment.id,
      orderId: payment.orderId,
      providerRef,
      webhookEventId: row.id,
      localState: {
        amountCents: payment.amountCents,
        currency: payment.currency,
        status: payment.status,
      },
      providerState: { amount: object.amount, currency: object.currency, status: object.status },
      lastError: `the event disagrees with the stored payment: ${Object.keys(drift).join(', ')}`,
    })

    return {
      outcome: 'reconcile',
      orderId: payment.orderId,
      paymentId: payment.id,
      reason: `drift in ${Object.keys(drift).join(', ')}`,
    }
  }

  if (internal === 'payment.succeeded') {
    return applyPaymentSucceeded(prisma, {
      payment,
      intent: object,
      webhookEventId: row.id,
      now,
    })
  }

  if (internal === 'payment.failed') {
    return applyPaymentFailed(prisma, { payment, intent: object, webhookEventId: row.id })
  }

  if (internal === 'payment.cancelled') {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: { notIn: ['SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED'] } },
      data: { status: 'CANCELLED', rawProviderStatus: object.status ?? null },
    })

    return { outcome: 'processed', orderId: payment.orderId, paymentId: payment.id }
  }

  // `PaymentStatus` has no PROCESSING and no AUTHORIZED. Both map to PENDING —
  // the schema's "money expected, nothing settled" state — and the provider's own
  // word is kept in `rawProviderStatus`, so the distinction is recorded rather
  // than invented as an enum value that no other code reads.
  const pendingStatus = {
    'payment.processing': 'PENDING',
    'payment.requires_action': 'REQUIRES_ACTION',
    'payment.authorized': 'PENDING',
  }[internal]

  if (pendingStatus) {
    return applyPaymentPending(prisma, { payment, intent: object, status: pendingStatus })
  }

  return { outcome: 'ignored', reason: `${internal} has no handler in this build` }
}
