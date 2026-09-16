/**
 * Reconciliation: deciding what actually happened, and acting on it once.
 *
 * Every other module in this application either knows what happened or refuses
 * to guess. This is the module for the cases where nobody knows: a provider
 * that did not answer, a webhook whose contents contradict the stored payment,
 * an intent this system has never heard of. Each one becomes a
 * `ReconciliationTask`, and each task is work for a person.
 *
 * ## The rule that shapes everything here
 *
 * **An operator never edits a payment or an order.** There is no route that
 * takes a status, and nothing in this module writes one from a request. What an
 * operator can do is ask the provider again, and then tell the system to apply
 * whatever the provider said — through the same domain commands the ordinary
 * path uses, which are idempotent and which enforce their own invariants.
 *
 * That is not a formality. An operator who could set `status = 'PAID'` could
 * mark an order paid that was never charged, and the ledger, the tickets and
 * the payout would all follow. What they can do instead is establish the fact
 * and let the system draw the consequence, exactly once.
 *
 * ## Unknown is not failure
 *
 * A provider that answers "I do not recognise that intent" is not a provider
 * saying the charge failed. It may be a lookup against the wrong account, a
 * reference recorded wrongly, or an object that has not propagated yet.
 * {@link compareEvidence} returns `CONFLICT` or `UNKNOWN` for those, and
 * neither resolves anything: the task stays open, or it is escalated.
 *
 * ## The order of operations
 *
 *   1. **Claim.** OPEN to IN_PROGRESS, conditional, so two operators working
 *      the same queue do not both start on one item.
 *   2. **Re-query**, with no transaction open. The provider is a network call
 *      and holding a row lock across one is how a queue becomes a deadlock.
 *   3. **Compare** the answer against local evidence that was recorded when the
 *      problem happened and has not been edited since.
 *   4. **Apply**, in a short transaction, through a domain command.
 *   5. **Resolve**, recording who, how and why.
 *
 * @module @desi-event/api/lib/reconciliation
 */

import { PAYMENT_INTENT_STATUS } from '@desi-event/providers'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { CAPTURE_OUTCOMES, compensateCheckout, settleCheckout } from './checkout.js'
import { conflict, notFound, unprocessable } from './errors.js'
import { REFUND_OUTCOMES, REFUND_STATES, recordRefundFailure, settleRefund } from './refunds.js'

/**
 * Every state a task can be in.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const TASK_STATES = Object.freeze({
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  ESCALATED: 'ESCALATED',
})

/**
 * What each state may become.
 *
 * An escalated task can come back to IN_PROGRESS — escalation is asking for
 * help, not closing the item — and a resolved one is finished.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const TASK_TRANSITIONS = Object.freeze({
  OPEN: Object.freeze([TASK_STATES.IN_PROGRESS, TASK_STATES.ESCALATED, TASK_STATES.RESOLVED]),
  IN_PROGRESS: Object.freeze([TASK_STATES.RESOLVED, TASK_STATES.ESCALATED, TASK_STATES.OPEN]),
  ESCALATED: Object.freeze([TASK_STATES.IN_PROGRESS, TASK_STATES.RESOLVED]),
  RESOLVED: Object.freeze([]),
})

/** The states a task is still work in. */
export const ACTIVE_STATES = Object.freeze([
  TASK_STATES.OPEN,
  TASK_STATES.IN_PROGRESS,
  TASK_STATES.ESCALATED,
])

/**
 * What comparing the provider's answer against local evidence concluded.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const VERDICTS = Object.freeze({
  /** The money moved. Complete what was left half-done. */
  SETTLE: 'SETTLE',
  /** It did not move. Undo what was reserved. */
  RELEASE: 'RELEASE',
  /** Already finished by something else. Nothing to apply. */
  ALREADY_DONE: 'ALREADY_DONE',
  /** The provider and local evidence disagree. A person decides. */
  CONFLICT: 'CONFLICT',
  /** The provider could not say. Never read as failure. */
  UNKNOWN: 'UNKNOWN',
})

/**
 * How a task was closed.
 *
 * Written rather than free text, because "how was this resolved?" asked six
 * months later has to be answerable by a query.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RESOLUTIONS = Object.freeze({
  /** The provider confirmed it, and the domain command completed it. */
  SETTLED_FROM_PROVIDER: 'SETTLED_FROM_PROVIDER',
  /** The provider confirmed it failed, and the reservation was released. */
  RELEASED_FROM_PROVIDER: 'RELEASED_FROM_PROVIDER',
  /** Something else had already finished it. */
  ALREADY_CONSISTENT: 'ALREADY_CONSISTENT',
  /** No system action; an operator recorded what was done elsewhere. */
  NO_ACTION_REQUIRED: 'NO_ACTION_REQUIRED',
})

/** How old, in hours, before a task is worth chasing. */
export const AGING_THRESHOLDS = Object.freeze({ WARNING_HOURS: 24, CRITICAL_HOURS: 72 })

/**
 * How overdue a task is.
 *
 * Three bands rather than a number, because a queue sorted by age already shows
 * the number; what a band adds is agreement about when something is late.
 *
 * @param {object} task The task.
 * @param {Date} now The instant.
 * @returns {string} `FRESH`, `AGING` or `OVERDUE`.
 */
export function agingBand(task, now) {
  const hours = (now.getTime() - new Date(task.createdAt).getTime()) / 3_600_000

  if (hours >= AGING_THRESHOLDS.CRITICAL_HOURS) return 'OVERDUE'
  if (hours >= AGING_THRESHOLDS.WARNING_HOURS) return 'AGING'

  return 'FRESH'
}

/**
 * Whether one task state may become another.
 *
 * @param {string} from The current state.
 * @param {string} to The proposed state.
 * @returns {boolean} True when the transition is in the table.
 */
export function canTransition(from, to) {
  return (TASK_TRANSITIONS[from] ?? []).includes(to)
}

/**
 * Move a task to a new state, conditionally.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.task The task as it was read.
 * @param {string} params.to The new state.
 * @param {object} [params.data] Extra columns.
 * @returns {Promise<boolean>} Whether this call performed the transition.
 * @throws {Error} 409 when the transition is not in the table.
 */
export async function transition(tx, { task, to, data = {} }) {
  if (!canTransition(task.state, to)) {
    throw conflict(
      `A ${task.state.toLowerCase().replace(/_/g, ' ')} task cannot become ${to.toLowerCase().replace(/_/g, ' ')}.`,
      { from: task.state, to },
    )
  }

  const { count } = await tx.reconciliationTask.updateMany({
    where: { id: task.id, state: task.state },
    data: { state: to, ...data },
  })

  return count === 1
}

/**
 * Append an operator note, never replacing what is there.
 *
 * Notes are the record of what somebody thought at the time, and a note that
 * can be edited is not a record. Stored as a JSON array and appended to, so a
 * later note cannot silently rewrite an earlier one.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.task The task.
 * @param {string} params.note What was written.
 * @param {string} params.actorId Who wrote it.
 * @param {Date} params.now When.
 * @returns {Promise<object>} The updated task.
 */
export async function appendNote(tx, { task, note, actorId, now }) {
  const existing = Array.isArray(task.notes) ? task.notes : []

  return tx.reconciliationTask.update({
    where: { id: task.id },
    data: { notes: [...existing, { at: now.toISOString(), actorId, note }] },
  })
}

/**
 * Take an item off the queue.
 *
 * Conditional on the state it was read in, so two operators working the same
 * queue do not both start on one item and do the work twice.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.task The task.
 * @param {string} params.actorId Who is picking it up.
 * @param {Date} params.now The instant.
 * @returns {Promise<boolean>} Whether this call claimed it.
 */
export async function claimTask(tx, { task, actorId, now }) {
  const claimed = await transition(tx, {
    task,
    to: TASK_STATES.IN_PROGRESS,
    data: { assignedToId: actorId },
  })

  if (!claimed) return false

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.RECONCILIATION_CLAIMED,
    entityType: 'ReconciliationTask',
    entityId: task.id,
    actorId,
    metadata: { at: now.toISOString(), kind: task.kind, previousState: task.state },
  })

  return true
}

/**
 * Ask the provider what it thinks, with no transaction open.
 *
 * Never throws for a provider answer. An intent the provider does not recognise
 * is an observation — and specifically not an observation that the charge
 * failed, which is the distinction this whole module exists to preserve.
 *
 * @param {object} payments The payment provider.
 * @param {string|null} providerRef What to ask about.
 * @returns {Promise<{found: boolean, status: string|null, amountCents: number|null, currency: string|null, refundedAmountCents: number|null, error: string|null}>} What it said.
 */
export async function requeryOutsideTransaction(payments, providerRef) {
  if (!providerRef) {
    return {
      found: false,
      status: null,
      amountCents: null,
      currency: null,
      refundedAmountCents: null,
      error: 'there is no provider reference to ask about',
    }
  }

  try {
    const intent = await payments.getStatus(providerRef)

    return {
      found: true,
      status: intent.status,
      amountCents: intent.amountCents,
      currency: intent.currency,
      refundedAmountCents: intent.refundedAmountCents ?? 0,
      error: null,
    }
  } catch (error) {
    return {
      found: false,
      status: null,
      amountCents: null,
      currency: null,
      refundedAmountCents: null,
      // The message, not the object: a provider error can carry a request body,
      // and an operations screen is not a place to print one.
      error: String(error?.message ?? error).slice(0, 300),
    }
  }
}

/**
 * Compare what the provider said against local evidence.
 *
 * Pure, and deliberately so: what a verdict *is* should be readable without a
 * database, and it is the part most worth testing exhaustively.
 *
 * The amount and currency are checked before the status. A provider answer for
 * the right reference but the wrong amount is not a reason to settle an order —
 * it is the strongest possible sign that the reference is wrong, and settling
 * on it would charge the buyer for something else entirely.
 *
 * @param {object} params Inputs.
 * @param {string} params.kind The task's `ReconciliationKind`.
 * @param {object} params.observed From {@link requeryOutsideTransaction}.
 * @param {object} params.payment The local payment row.
 * @param {object} [params.order] The local order row.
 * @param {object} [params.refund] The refund, for a `REFUND_UNKNOWN` task.
 * @returns {{verdict: string, why: string}} The conclusion and a sentence saying why.
 */
export function compareEvidence({ kind, observed, payment, order, refund }) {
  if (!observed.found) {
    return {
      verdict: VERDICTS.UNKNOWN,
      why: observed.error ?? 'the provider had nothing to say about that reference',
    }
  }

  if (observed.amountCents !== payment.amountCents || observed.currency !== payment.currency) {
    return {
      verdict: VERDICTS.CONFLICT,
      why: `the provider reports ${observed.amountCents} ${observed.currency} against a payment of ${payment.amountCents} ${payment.currency}`,
    }
  }

  if (kind === 'REFUND_UNKNOWN') {
    if (!refund) {
      return { verdict: VERDICTS.CONFLICT, why: 'the task names a refund that is gone' }
    }

    if (refund.status === REFUND_STATES.SUCCEEDED) {
      return { verdict: VERDICTS.ALREADY_DONE, why: 'the refund has already been settled' }
    }

    // How much the provider says has gone back, against how much this refund is
    // for. Cumulative, because an intent may carry several refunds and the
    // question is whether *this* one is among them.
    const refunded = observed.refundedAmountCents ?? 0

    if (refunded >= refund.amountCents) {
      return {
        verdict: VERDICTS.SETTLE,
        why: `the provider has given back ${refunded} of ${payment.amountCents}, which covers this refund`,
      }
    }

    if (refunded === 0 && observed.status === PAYMENT_INTENT_STATUS.SUCCEEDED) {
      return {
        verdict: VERDICTS.RELEASE,
        why: 'the provider reports the charge intact and nothing refunded',
      }
    }

    return {
      verdict: VERDICTS.CONFLICT,
      why: `the provider has given back ${refunded}, which is neither this refund nor nothing`,
    }
  }

  // PAYMENT_TIMEOUT and PROVIDER_MISMATCH both turn on the same question: did
  // the charge succeed?
  if (order && order.status !== 'PENDING') {
    return {
      verdict: VERDICTS.ALREADY_DONE,
      why: `the order is already ${order.status.toLowerCase()}`,
    }
  }

  if (observed.status === PAYMENT_INTENT_STATUS.SUCCEEDED) {
    return { verdict: VERDICTS.SETTLE, why: 'the provider reports the charge succeeded' }
  }

  if (observed.status === PAYMENT_INTENT_STATUS.FAILED) {
    return { verdict: VERDICTS.RELEASE, why: 'the provider reports the charge failed' }
  }

  if (observed.status === PAYMENT_INTENT_STATUS.REFUNDED) {
    return {
      verdict: VERDICTS.CONFLICT,
      why: 'the provider reports a refunded charge against an order that was never completed',
    }
  }

  // REQUIRES_CAPTURE: authorised and not captured. Neither settled nor failed,
  // and calling it either would be inventing an answer the provider did not
  // give.
  return {
    verdict: VERDICTS.UNKNOWN,
    why: `the provider reports ${observed.status}, which is neither a charge nor a failure`,
  }
}

/**
 * Everything a task's decision needs, loaded together.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {string} taskId Which task.
 * @returns {Promise<{task: object, payment: object|null, order: object|null, refund: object|null}>} The rows.
 * @throws {Error} 404 when the task is gone.
 */
export async function loadTaskContext(prisma, taskId) {
  const task = await prisma.reconciliationTask.findUnique({ where: { id: taskId } })

  if (!task) throw notFound('No such reconciliation task.')

  const payment = task.paymentId
    ? await prisma.payment.findUnique({ where: { id: task.paymentId } })
    : null
  const orderId = task.orderId ?? payment?.orderId ?? null
  const order = orderId ? await prisma.order.findUnique({ where: { id: orderId } }) : null
  const refund = task.refundId
    ? await prisma.refund.findUnique({ where: { id: task.refundId } })
    : null

  return { task, payment, order, refund }
}

/**
 * Apply a verdict through the domain command that owns the change.
 *
 * Nothing here writes a payment or an order status directly. `settleCheckout`
 * is the same function the ordinary capture path calls and is conditional on
 * the order still being PENDING, so a reconciliation that races a late webhook
 * produces one settlement between them. The same is true of every other command
 * reached from here.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.context From {@link loadTaskContext}.
 * @param {string} params.verdict One of {@link VERDICTS}.
 * @param {object} params.observed What the provider said.
 * @param {string} params.actorId Who is applying it.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @param {Function} params.generateTicketCode Passed through to settlement.
 * @param {string} params.credentialSecret Passed through to settlement.
 * @param {string} [params.organizationId] Whose event it is, for a refund settlement.
 * @param {Date|null} [params.eventStartsAt] For the refunded-seat policy.
 * @returns {Promise<{applied: boolean, detail: object}>} What the command did.
 * @throws {Error} 422 when the verdict is not one that can be applied.
 */
export async function applyVerdict(tx, params) {
  const {
    context,
    verdict,
    observed,
    actorId,
    requestId = null,
    now,
    generateTicketCode,
    credentialSecret,
    organizationId,
    eventStartsAt = null,
  } = params
  const { task, payment, order, refund } = context

  if (verdict === VERDICTS.ALREADY_DONE) return { applied: false, detail: { reason: 'already' } }

  if (verdict !== VERDICTS.SETTLE && verdict !== VERDICTS.RELEASE) {
    throw unprocessable('That verdict is not one the system can act on.', { verdict })
  }

  if (task.kind === 'REFUND_UNKNOWN') {
    if (verdict === VERDICTS.SETTLE) {
      const settled = await settleRefund(tx, {
        refund,
        order,
        result: {
          outcome: REFUND_OUTCOMES.SUCCEEDED,
          // The provider's own reference, or none. Nothing here manufactures
          // one to make the row look finished.
          providerRefundId: refund.providerRefundId ?? null,
          rawStatus: observed.status,
        },
        organizationId,
        eventStartsAt,
        actorId,
        requestId,
        now,
      })

      return { applied: settled.settled, detail: settled }
    }

    const failed = await recordRefundFailure(tx, {
      refund,
      order,
      result: {
        outcome: REFUND_OUTCOMES.FAILED,
        failureCode: 'RECONCILED_NOT_REFUNDED',
        rawStatus: observed.status,
      },
      actorId,
      requestId,
      now,
    })

    return { applied: failed.applied, detail: failed }
  }

  if (verdict === VERDICTS.SETTLE) {
    const settled = await settleCheckout(tx, {
      order,
      payment,
      result: {
        outcome: CAPTURE_OUTCOMES.SUCCEEDED,
        intent: null,
        providerRef: payment.providerRef,
        rawStatus: observed.status,
      },
      now,
      generateTicketCode,
      credentialSecret,
      actorId,
      requestId,
    })

    return { applied: settled.settled, detail: settled }
  }

  const compensated = await compensateCheckout(tx, {
    order,
    payment,
    failureCode: 'RECONCILED_NOT_CHARGED',
    now,
    actorId,
    requestId,
  })

  return { applied: compensated.compensated, detail: compensated }
}

/**
 * Close a task, recording who, how and why.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.task The task.
 * @param {string} params.resolution One of {@link RESOLUTIONS}.
 * @param {string} params.note Why, in the operator's words.
 * @param {object} params.observed What the provider said.
 * @param {string} params.actorId Who resolved it.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<boolean>} Whether this call closed it.
 */
export async function resolveTask(tx, params) {
  const { task, resolution, note, observed, actorId, requestId = null, now } = params

  const closed = await transition(tx, {
    task,
    to: TASK_STATES.RESOLVED,
    data: {
      resolution,
      resolutionNote: note,
      resolvedAt: now,
      resolvedById: actorId,
      // What the provider said, kept alongside what we believed. The local
      // state was written when the problem happened and is never edited, so the
      // pair is the evidence the decision was made on.
      providerState: observed,
      attempts: { increment: 1 },
    },
  })

  if (!closed) return false

  await appendNote(tx, { task, note, actorId, now })

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.RECONCILIATION_RESOLVED,
    entityType: 'ReconciliationTask',
    entityId: task.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      kind: task.kind,
      previousState: task.state,
      resolution,
      note,
      paymentId: task.paymentId,
      orderId: task.orderId,
      refundId: task.refundId,
      providerStatus: observed?.status ?? null,
    },
  })

  return true
}

/**
 * Escalate a task beyond whoever picked it up.
 *
 * Not a closure. An escalated task is still open work; what changes is that
 * somebody has said they cannot decide it alone, and the reason is recorded so
 * the next person does not start from nothing.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.task The task.
 * @param {string} params.reason Why.
 * @param {string} params.actorId Who escalated it.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<boolean>} Whether this call escalated it.
 */
export async function escalateTask(tx, { task, reason, actorId, requestId = null, now }) {
  const escalated = await transition(tx, {
    task,
    to: TASK_STATES.ESCALATED,
    data: { escalatedAt: now, escalationReason: reason },
  })

  if (!escalated) return false

  await appendNote(tx, { task, note: reason, actorId, now })

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.RECONCILIATION_ESCALATED,
    entityType: 'ReconciliationTask',
    entityId: task.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      kind: task.kind,
      previousState: task.state,
      reason,
    },
  })

  return true
}
