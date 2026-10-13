/**
 * Refunding one order's booking fee by hand, for the Desi-Event team (SPEC3
 * §7.4): `platformFees.preview` and `platformFees.refund`.
 *
 * The booking fee is Desi-Event's money, so refunding it on its own is the
 * Desi-Event team's decision (A4: "an admin can still refund a fee on a past
 * order by hand"). The session, `platform_fee:refund` (ADMIN, FINANCE_ADMIN,
 * SUPER_ADMIN) and, on the refund, the FINANCE_ACTION step-up come from the
 * contract; the refund carries its own limit of thirty an hour per
 * administrator (`fee-refund:actor:<id>`).
 *
 * ## What it refunds
 *
 * What is left of the order's booking fee and the tax that fee carried, and
 * nothing else (`requestRefund` with `feeOnly`): no ticket is withdrawn, no
 * line is touched, the order's status does not change, and it is never
 * promoted to a refund of the whole order. A share of the fee Desi-Event kept
 * when unpaid tickets were cancelled is not left to refund (SPEC3-XI XU6).
 *
 * ## In one hand, bounded
 *
 * It is asked for, approved and sent by the same administrator, recorded as
 * both (DF8): a request-and-approve authority in one hand, bounded to the fee
 * of one order. An administrator does not refund the fee of their own order,
 * nor of an order on an event of an organisation they belong to (403
 * `CONFLICT_OF_INTEREST`). The amount the administrator was shown is a
 * precondition, checked under the order's row lock (409 `PRICE_CHANGED`).
 *
 * Nothing here names the buyer: the preview carries the order's figures and
 * its event, never a name or an address.
 *
 * @module @desi-event/api/routes/platform-fees
 */

import {
  PAYMENT_TERMS_SENTENCES,
  forbidden,
  httpError,
  notFound,
  paymentTermsRefusal,
} from '../lib/errors.js'
import { isSameAddress } from '../lib/delivery.js'
import {
  approveRefund,
  feeRefundQuote,
  paymentDisputeBlocks,
  requestRefund,
  submitRefund,
} from '../lib/refunds.js'
import { toRefund } from '../lib/presenters.js'
import { defineRoute } from '../lib/register.js'
import { TRANSACTION_BUDGETS, budgetedTransaction } from '../lib/transaction-budget.js'
import { feeRefundRateLimit } from '../plugins/rate-limit.js'

/** The one answer for an order that does not exist. */
const NO_SUCH_ORDER = 'No such order.'

/** What the buyer of an order is told when they try to refund its fee themselves. */
const OWN_ORDER_SENTENCE =
  'This is your own order, so another administrator has to refund its booking fee.'

/** A fee refund that changed while the administrator looked at it. */
const FEE_CHANGED_SENTENCE =
  "What is left of this order's booking fee changed after you opened it. Nothing was refunded. Look at the order again."

/** What the administrator is told when the order was held too long by another change. */
const FEE_REFUND_TRY_AGAIN =
  'Another change to this order was being saved at the same moment, so its booking fee was not refunded. Try again in a moment.'

/** Order statuses whose booking fee can still be refunded: paid, or refunded with fee left. */
const FEE_REFUNDABLE_STATUSES = Object.freeze(['PAID', 'REFUNDED'])

/** What both routes read of an order. */
const ORDER_FOR_FEE = Object.freeze({
  event: { select: { id: true, title: true, organizationId: true, startsAt: true } },
})

/**
 * The order's succeeded payment: what a booking fee refund is made against.
 * None for an order that paid nothing online.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {string} orderId The order.
 * @returns {Promise<object|null>} The payment.
 */
function succeededPayment(db, orderId) {
  return db.payment.findFirst({
    where: { orderId, status: 'SUCCEEDED' },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * One order's booking-fee figures, as the preview and the refund's answer
 * carry them (`platformFeePreviewSchema`): no buyer, no address.
 *
 * What can be refunded is 0 for an order that cannot have its fee refunded
 * here at all: one not paid (or refunded with fee left), or with no payment
 * taken online.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object} order The order, with {@link ORDER_FOR_FEE}.
 * @returns {Promise<object>} The figures.
 */
async function feeFigures(db, order) {
  const payment = await succeededPayment(db, order.id)
  const quote = await feeRefundQuote(db, order)
  const kept = order.venueFeeKeptCents ?? 0
  const refundable = FEE_REFUNDABLE_STATUSES.includes(order.status) && Boolean(payment)

  return {
    reference: order.reference,
    eventId: order.event.id,
    eventTitle: order.event.title,
    status: order.status,
    paymentMethod: order.paymentMethod ?? 'CARD',
    currency: order.currency,
    feesCents: order.feesCents ?? 0,
    feeWaivedCents: order.feeWaivedCents ?? 0,
    // What refunds (settled or on their way) took of the fee; a kept share is
    // shown on its own line, and is never refundable.
    feeRefundedCents: Math.max(0, quote.feeSpokenCents - kept),
    refundableFeeCents: refundable ? quote.feeCents : 0,
    taxOnFeeCents: refundable ? quote.taxCents : 0,
    feeKeptCents: kept,
    disputed: payment ? await paymentDisputeBlocks(db, payment.id) : false,
  }
}

/**
 * Refuse an administrator acting on their own order, or on an order of an
 * organisation they belong to (DF8).
 *
 * Their own order is the one the rest of the API reads back to them as its
 * buyer (`ownsOrder` in `routes/orders.js`): placed while signed in to their
 * account, or as a guest with their own address. Matching the account alone
 * would let an administrator buy as a guest, sign back in and refund that
 * order's fee to themselves.
 *
 * @param {object} actor The request actor.
 * @param {object} order The order, with its event.
 * @returns {void}
 * @throws {Error} 403 `CONFLICT_OF_INTEREST`.
 */
function assertIndependent(actor, order) {
  const ownAccount = Boolean(order.userId) && order.userId === actor.id

  if (ownAccount || isSameAddress(order.buyerEmail, actor.email)) {
    throw forbidden(OWN_ORDER_SENTENCE, 'CONFLICT_OF_INTEREST')
  }

  const member = (actor.memberships ?? []).some(
    (membership) => membership?.organizationId === order.event.organizationId,
  )

  if (member) throw forbidden(PAYMENT_TERMS_SENTENCES.conflictOfInterest, 'CONFLICT_OF_INTEREST')
}

/**
 * Register the booking-fee refund routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.providers The provider registry.
 * @param {{max?: number, timeWindow?: string|number}} [deps.feeRefundLimit] Overrides for the refund's limit.
 * @returns {void} Nothing.
 */
export function registerPlatformFeeRoutes(app, { prisma, providers, feeRefundLimit = {} } = {}) {
  defineRoute(app, 'platformFees.preview', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store, private')

      const order = await prisma.order.findUnique({
        where: { reference: request.params.reference },
        include: ORDER_FOR_FEE,
      })

      if (!order) throw notFound(NO_SUCH_ORDER)

      return { data: await feeFigures(prisma, order) }
    },
  })

  defineRoute(app, 'platformFees.refund', {
    config: { rateLimit: feeRefundRateLimit(feeRefundLimit) },
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store, private')

      const { reason, expectedRefundableCents } = request.body
      const actor = request.actor

      const order = await prisma.order.findUnique({
        where: { reference: request.params.reference },
        include: ORDER_FOR_FEE,
      })

      if (!order) throw notFound(NO_SUCH_ORDER)

      assertIndependent(actor, order)

      const payment = await succeededPayment(prisma, order.id)

      // Only money paid online can go back: an order never paid (or paid
      // nothing online, its whole fee waived) has no fee to refund here.
      if (!payment || !FEE_REFUNDABLE_STATUSES.includes(order.status)) {
        throw paymentTermsRefusal('NO_FEE_TO_REFUND')
      }

      // Asked for and approved under the order's row lock, from the order as
      // it stands under it, against the amount the administrator was shown.
      const approved = await budgetedTransaction(
        prisma,
        { budget: TRANSACTION_BUDGETS.REFUND, refusal: FEE_REFUND_TRY_AGAIN },
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`

          const current = await tx.order.findUnique({ where: { id: order.id } })
          const quote = await feeRefundQuote(tx, current)

          if (quote.amountCents <= 0) {
            throw httpError(409, 'NO_FEE_TO_REFUND', PAYMENT_TERMS_SENTENCES.noFeeLeft)
          }

          if (quote.amountCents !== expectedRefundableCents) {
            throw httpError(409, 'PRICE_CHANGED', FEE_CHANGED_SENTENCE)
          }

          const now = new Date()
          const { refund } = await requestRefund(tx, {
            order: current,
            payment,
            feeOnly: true,
            reason: 'BOOKING_FEE',
            reasonNote: reason,
            // One request, one refund: a retry finds the fee spoken for and is
            // refused, never refunded twice.
            idempotencyKey: `platform-fee-refund:${order.id}:${request.id}`,
            actorId: actor.id,
            requestId: request.id,
            via: 'platform_fee_refund',
            now,
          })

          // The same administrator approves it: one hand, one order's fee.
          await approveRefund(tx, {
            refund,
            order: current,
            actorId: actor.id,
            requestId: request.id,
            via: 'platform_fee_refund',
            now,
          })

          return tx.refund.findUnique({ where: { id: refund.id } })
        },
      )

      // Sent with nothing open; the simulated provider settles it at once.
      const { refund: after } = await submitRefund(prisma, providers, {
        refund: approved,
        order,
        payment,
        organizationId: order.event.organizationId,
        eventStartsAt: order.event.startsAt ?? null,
        actorId: actor.id,
        requestId: request.id,
        via: 'platform_fee_refund',
      })

      const row = await prisma.refund.findUnique({
        where: { id: after.id },
        include: {
          items: true,
          order: {
            select: {
              reference: true,
              paymentMethod: true,
              event: { select: { organizationId: true } },
            },
          },
        },
      })
      const fresh = await prisma.order.findUnique({
        where: { id: order.id },
        include: ORDER_FOR_FEE,
      })
      const doorCents = await prisma.venuePayment.aggregate({
        where: { orderId: order.id },
        _sum: { amountCents: true },
      })

      return {
        data: {
          refund: toRefund(row, { paidAtDoorCents: doorCents._sum?.amountCents ?? 0 }),
          fee: await feeFigures(prisma, fresh),
        },
      }
    },
  })
}
