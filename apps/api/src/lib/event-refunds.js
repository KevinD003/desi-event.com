/**
 * The refund driver: sending the refunds a cancelled event, a deleted event or
 * a cancelled night owes (SPEC2-XI X-D, X-N).
 *
 * Cancelling asks for the refunds and reserves them, inside the cancellation's
 * transaction (`cancellationWork`, `cancelSession`); nothing there calls a
 * payment provider. This runs after that transaction has committed, never
 * inside one with a provider call, and takes each refund through the same
 * steps finance would at the refund screen:
 *
 *   1. a payment whose dispute is open is left to the finance team (counted
 *      `disputed`): the dispute decides where that money goes;
 *   2. a refund written before refunds reserved anything is repaired first
 *      (`repairUnreservedRefund`);
 *   3. REQUESTED is approved; DECLINED or FAILED is approved again, which
 *      reserves it again (`approveRefund`) or answers `REFUND_BALANCE_GONE`,
 *      when it is withdrawn and whatever is left is asked for under a new key;
 *   4. it is sent and settled (`submitRefund`), with the seats withheld — a
 *      cancelled event's or night's seats never go back on sale.
 *
 * It takes the ones never tried first, then the oldest, in batches (a refund
 * a dispute holds back takes no place in one): 500 in MOCK, where a settlement is a
 * write and nothing more, and 25 otherwise, so a request to a real provider
 * never makes hundreds of calls. The rest wait for `events.finishRefunds`. In
 * this build payments are simulated (PAYMENT_MODE=MOCK), so no money moves.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc namepath.
 *
 * @file @desi-event/api/lib/event-refunds
 */

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import {
  REFUND_BLOCKING_DISPUTE_STATES,
  REFUND_OUTCOMES,
  REFUND_STATES,
  SEAT_POLICIES,
  approveRefund,
  cancelRefund,
  paymentDisputeBlocks,
  refundableCents,
  repairUnreservedRefund,
  requestRefund,
  submitRefund,
} from './refunds.js'

/** How many refunds one pass of the driver sends, by payment mode. */
export const REFUND_DRIVER_BATCH = Object.freeze({ MOCK: 500, default: 25 })

/** The states of a refund that is owed and not yet with the provider. */
export const OWED_REFUND_STATES = Object.freeze([
  REFUND_STATES.REQUESTED,
  REFUND_STATES.APPROVED,
  REFUND_STATES.DECLINED,
  REFUND_STATES.FAILED,
])

/** The key prefix of the refunds an event's cancellation asked for. */
export function eventRefundPrefix(eventId) {
  return `event-cancelled:${eventId}:`
}

/** The key prefix of the refunds a night's cancellation asked for. */
export function sessionRefundPrefix(sessionId) {
  return `session-cancelled:${sessionId}:`
}

/**
 * The `where` that selects what an event (or one of its nights) still owes.
 *
 * @param {object} event The event, with `id` and, for the whole event, `sessions`.
 * @param {string|null} sessionId One night only, or null for the event and every night.
 * @returns {object} A Prisma `where` for `Refund`.
 */
export function owedRefundsWhere(event, sessionId = null) {
  const prefixes = sessionId
    ? [sessionRefundPrefix(sessionId)]
    : [
        eventRefundPrefix(event.id),
        ...(event.sessions ?? []).map((session) => sessionRefundPrefix(session.id)),
      ]

  return {
    reason: 'EVENT_CANCELLED',
    status: { in: [...OWED_REFUND_STATES] },
    order: { eventId: event.id },
    OR: prefixes.map((prefix) => ({ idempotencyKey: { startsWith: prefix } })),
  }
}

/** A refund's payment has a dispute that stops it being sent (R8). */
const DISPUTE_BLOCKS = Object.freeze({
  disputes: { some: { status: { in: [...REFUND_BLOCKING_DISPUTE_STATES] } } },
})

/**
 * The owed refunds the driver can send: those whose payment no dispute blocks.
 *
 * A blocked one is the finance team's until its dispute is decided, so it is
 * counted apart (`disputed`) and never takes a place in a batch: otherwise a
 * batch's worth of disputed refunds, always the oldest, would be picked first
 * on every pass and nothing behind them would ever be sent.
 *
 * @param {object} event The event, with `id` and, for the whole event, `sessions`.
 * @param {string|null} sessionId One night only, or null for the event and every night.
 * @returns {object} A Prisma `where` for `Refund`.
 */
export function sendableRefundsWhere(event, sessionId = null) {
  return { AND: [owedRefundsWhere(event, sessionId), { NOT: { payment: DISPUTE_BLOCKS } }] }
}

/**
 * How many refunds an event (or one night) still owes and can send: the ones
 * a dispute holds back are the finance team's, not owed from here.
 *
 * @param {object} db A Prisma client.
 * @param {object} event The event, with `id` and `sessions`.
 * @param {string|null} [sessionId] One night only.
 * @returns {Promise<number>} The count.
 */
export async function countOwedRefunds(db, event, sessionId = null) {
  return db.refund.count({ where: sendableRefundsWhere(event, sessionId) })
}

/**
 * How many owed refunds a dispute holds back.
 *
 * @param {object} db A Prisma client.
 * @param {object} event The event, with `id` and `sessions`.
 * @param {string|null} [sessionId] One night only.
 * @returns {Promise<number>} The count.
 */
export async function countDisputedRefunds(db, event, sessionId = null) {
  return db.refund.count({
    where: { AND: [owedRefundsWhere(event, sessionId), { payment: DISPUTE_BLOCKS }] },
  })
}

/**
 * Whether an error is one of the refund service's refusals for this refund
 * alone, which the driver counts and carries on past.
 *
 * @param {unknown} error Whatever was thrown.
 * @returns {boolean} True for a 409.
 */
function isRefusal(error) {
  return error?.statusCode === 409
}

/**
 * Approve one owed refund, again if it was declined or failed, and say which
 * refund is to be sent: the same one, its repair, or its replacement.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} refund The owed refund, as read.
 * @param {object} context Who and why.
 * @param {string|null} context.actorId The person whose command started this.
 * @param {string|null} context.requestId For the audit trail.
 * @param {string} context.via What drove it.
 * @param {Date} context.now The instant.
 * @returns {Promise<object|null>} The APPROVED refund to send, or null when nothing is left to send.
 */
async function approveOwed(prisma, refund, { actorId, requestId, via, now }) {
  const repaired = await prisma.$transaction((tx) =>
    repairUnreservedRefund(tx, { refund, actorId, requestId, now }),
  )

  if (repaired.mode === 'CANCELLED_NOTHING_LEFT') return null

  const target = repaired.refund

  if (target.status === REFUND_STATES.APPROVED) return target

  try {
    await prisma.$transaction(async (tx) =>
      approveRefund(tx, {
        refund: target,
        order: await tx.order.findUnique({ where: { id: target.orderId } }),
        actorId,
        requestId,
        now,
        via,
      }),
    )
  } catch (error) {
    if (error?.code !== 'REFUND_BALANCE_GONE') throw error

    // Another refund took part of the order since this one failed. Withdraw
    // it and ask for whatever is left under a new key, as finance would.
    const replacement = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: target.orderId } })

      await cancelRefund(tx, {
        refund: target,
        order,
        reason: 'Replaced: the order had less left to refund than this refund named',
        actorId,
        requestId,
        now,
      })

      const fresh = await tx.order.findUnique({
        where: { id: target.orderId },
        include: { items: true },
      })

      if (refundableCents(fresh) <= 0) return null

      const payment = await tx.payment.findUnique({ where: { id: target.paymentId } })
      const { refund: asked } = await requestRefund(tx, {
        order: fresh,
        payment,
        whole: true,
        reason: target.reason,
        reasonNote: target.reasonNote,
        idempotencyKey: `${target.idempotencyKey}:r${(target.attempts ?? 0) + 1}`,
        actorId,
        requestId,
        via,
        now,
      })

      if (asked.status === REFUND_STATES.REQUESTED) {
        await approveRefund(tx, { refund: asked, order: fresh, actorId, requestId, now, via })
      }

      return tx.refund.findUnique({ where: { id: asked.id } })
    })

    return replacement?.status === REFUND_STATES.APPROVED ? replacement : null
  }

  return prisma.refund.findUnique({ where: { id: target.id } })
}

/**
 * Send what an event (or one of its nights) owes: one batch, the fewest tries
 * and then the oldest first.
 *
 * @param {object} prisma A Prisma client. Never a transaction client.
 * @param {object} options Options.
 * @param {object} options.event The event, with `id`, `organizationId`, `startsAt` and `sessions`.
 * @param {object|null} options.actor The person whose command started this.
 * @param {object} options.providers The provider registry.
 * @param {'event_deletion'|'session_cancellation'|'finish_refunds'} options.via What drove it.
 * @param {string|null} [options.sessionId] One night only.
 * @param {string} [options.paymentMode] `MOCK` or `STRIPE_TEST`, for the batch size.
 * @param {Date} [options.now] The instant.
 * @param {string|null} [options.requestId] For the audit trail.
 * @returns {Promise<{owed: number, settled: number, waiting: number, failed: number, disputed: number, amountCents: number, currency: string|null}>} What this pass did.
 */
export async function refundOwed(prisma, options) {
  const {
    event,
    actor = null,
    providers,
    via,
    sessionId = null,
    paymentMode = 'MOCK',
    now = new Date(),
    requestId = null,
  } = options
  const actorId = actor?.id ?? null
  const batch = REFUND_DRIVER_BATCH[paymentMode] ?? REFUND_DRIVER_BATCH.default

  const owed = await prisma.refund.count({ where: owedRefundsWhere(event, sessionId) })
  const held = await countDisputedRefunds(prisma, event, sessionId)
  // The ones never tried first, then the fewest tries: a refund the provider
  // keeps declining goes to the back, so a batch of them cannot stand in front
  // of the rest on every pass.
  const refunds = await prisma.refund.findMany({
    where: sendableRefundsWhere(event, sessionId),
    orderBy: [{ attempts: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: batch,
  })

  let settled = 0
  let failed = 0
  // Held back by a dispute: those counted before the batch, and any whose
  // dispute opened since.
  let disputed = held
  let amountCents = 0
  let currency = refunds[0]?.currency ?? null

  for (const refund of refunds) {
    if (await paymentDisputeBlocks(prisma, refund.paymentId)) {
      disputed += 1
      continue
    }

    try {
      const approved = await approveOwed(prisma, refund, {
        actorId,
        requestId,
        via,
        now: new Date(),
      })

      if (!approved) continue

      const order = await prisma.order.findUnique({ where: { id: approved.orderId } })
      const payment = await prisma.payment.findUnique({ where: { id: approved.paymentId } })
      const { outcome, refund: after } = await submitRefund(prisma, providers, {
        refund: approved,
        order,
        payment,
        organizationId: event.organizationId,
        eventStartsAt: event.startsAt ?? null,
        // Seats of a cancelled event or night never go back on sale.
        seatPolicy: SEAT_POLICIES.WITHHOLD,
        actorId,
        requestId,
      })

      if (outcome === REFUND_OUTCOMES.SUCCEEDED) {
        settled += 1
        amountCents += after.amountCents
        currency = currency ?? after.currency
      } else if (outcome === REFUND_OUTCOMES.DECLINED || outcome === REFUND_OUTCOMES.FAILED) {
        failed += 1
      }
    } catch (error) {
      if (error?.code === 'PAYMENT_DISPUTED') {
        disputed += 1
        continue
      }

      if (!isRefusal(error)) throw error

      failed += 1
    }
  }

  const summary = {
    owed,
    settled,
    waiting: Math.max(0, owed - settled - failed - disputed),
    failed,
    disputed,
    amountCents,
    currency,
  }

  // After the provider calls, in a transaction of its own: what this pass did.
  await prisma.$transaction((tx) =>
    recordAudit(tx, {
      action: AUDIT_ACTIONS.EVENT_REFUNDS_DRIVEN,
      entityType: 'Event',
      entityId: event.id,
      actorId,
      metadata: {
        requestId,
        at: now.toISOString(),
        via,
        sessionId,
        paymentMode,
        batch,
        ...summary,
      },
    }),
  )

  return summary
}
