/**
 * Refunds: the four steps, as seven routes.
 *
 * The state machine lives in `../lib/refunds.js`. This module is the part a
 * person reaches: it decides who may do each step, loads the rows the decision
 * needs, and — for the one route that talks to a provider — keeps the call
 * outside every transaction.
 *
 * ## Why approval is a separate route
 *
 * Asking for a refund and approving one are different capabilities, held by
 * different people in most organisations. Collapsing them into a single
 * "refund this order" endpoint would make that policy unexpressable: a finance
 * assistant either can refund or cannot, with nothing in between. Here
 * `order:refund_request` asks, `order:refund_approve` approves, and
 * `order:refund` is the capability that says one person may do both — which is
 * also how a small organisation with one finance user works, without the
 * separation being quietly absent for everybody else.
 *
 * ## Why submission is a separate route again
 *
 * Because it is the one that reaches a provider, and everything about the
 * boundary — SUBMITTED written first, in its own transaction; the call made
 * with nothing open; a second short transaction to record the answer — is
 * visible in one handler rather than spread across a service that also does
 * five other things.
 *
 * ## What an operator may not do here
 *
 * Set a status. There is no route that writes `SUCCEEDED`, and no body field
 * that names one. An operator saying a refund succeeded is not the same as it
 * having succeeded, and the only thing allowed to write that state is the code
 * that watched a provider say so — or, for a refund that timed out,
 * reconciliation, which is a different surface with a different capability.
 *
 * @module @desi-event/api/routes/refunds
 */

import { CAPABILITIES, assertCan, can } from '@desi-event/permissions'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js'
import { toRefund } from '../lib/presenters.js'
import {
  PENDING_STATES,
  REFUND_OUTCOMES,
  REFUND_STATES,
  approveRefund,
  cancelRefund,
  loadRefundContext,
  markSubmitted,
  pendingQuantitiesByLine,
  recordRefundFailure,
  recordRefundTimeout,
  refundableCents,
  requestRefund,
  settleRefund,
  submitOutsideTransaction,
} from '../lib/refunds.js'
import { readRankedPage } from '../lib/ranked-page.js'
import { defineRoute } from '../lib/register.js'

/** Everything a refund decision needs, loaded in one query. */
const REFUND_INCLUDE = Object.freeze({
  items: true,
  // The organisation comes with the row rather than being worked out by
  // whoever reads it. A refund payload that did not say whose it was forced
  // every caller to ask an organisation capability with no organisation, and
  // an organisation capability asked unscoped becomes a platform check — which
  // refuses every organiser and passes every platform admin. That is NF-05,
  // and it is cheaper to carry one field than to re-find it correctly at four
  // call sites.
  order: { select: { reference: true, event: { select: { organizationId: true } } } },
})

/** The order, its lines, and the organisation that owns its event. */
const ORDER_FOR_REFUND = Object.freeze({
  items: { include: { ticketType: { select: { name: true } } } },
  event: { select: { organizationId: true, startsAt: true } },
})

/**
 * Unresolved first, then newest.
 *
 * A refund queue exists for the ones somebody still has to do something about;
 * a settled refund is history, and history sorts below work. The tiers are read
 * by `readRankedPage`: sorting the status column put `TIMEOUT` and
 * `RECONCILIATION_REQUIRED` after every settled refund, because PostgreSQL
 * sorts an enum by declaration order.
 *
 * @type {Array<object>}
 */
const QUEUE_ORDER = Object.freeze([{ createdAt: 'desc' }, { id: 'asc' }])

/**
 * The refunds still in flight: every pending state, and `PROCESSING`, which
 * older records carry and which is not settled either.
 *
 * @type {ReadonlyArray<string>}
 */
const UNRESOLVED_REFUND_STATES = Object.freeze([...PENDING_STATES, 'PROCESSING'])

/**
 * Read a refund's organisation, or refuse.
 *
 * The organisation is the one that owns the order's event, which is two hops
 * from the refund and is why these routes assert in the handler rather than
 * declaring a `capabilityScope`: there is no organisation in the request to
 * scope to, and a capability asserted with no organisation is a platform
 * check — which would refuse every organiser and pass every platform admin.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} orderId Which order.
 * @returns {Promise<{organizationId: string, eventStartsAt: Date|null}>} The owner and the event date.
 * @throws {Error} 409 when the order names an event that is gone.
 */
async function ownerOf(prisma, orderId) {
  const order = await prisma.order.findUnique({ where: { id: orderId } })
  const event = order && (await prisma.event.findUnique({ where: { id: order.eventId } }))

  if (!event) {
    throw conflict('That refund names an order whose event is gone.', { orderId })
  }

  return { organizationId: event.organizationId, eventStartsAt: event.startsAt }
}

/**
 * Read one refund back with everything the response schema needs.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} id Which refund.
 * @returns {Promise<object>} A payload satisfying `refundSchema`.
 */
async function present(prisma, id) {
  const row = await prisma.refund.findUnique({ where: { id }, include: REFUND_INCLUDE })

  if (!row) throw notFound('No such refund.')

  return toRefund(row)
}

/**
 * Register the refund routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.providers The provider registry.
 * @returns {void} Nothing.
 */
export function registerRefundRoutes(app, { prisma, providers }) {
  defineRoute(app, 'refunds.summary', {
    handler: async (request) => {
      const order = await prisma.order.findUnique({
        where: { reference: request.params.reference },
        include: ORDER_FOR_REFUND,
      })

      if (!order) throw notFound('No such order.')

      assertCan(request.actor, CAPABILITIES.FINANCE_VIEW, {
        organizationId: order.event?.organizationId,
      })

      const pending = await pendingQuantitiesByLine(prisma, order.id)
      const refunds = await prisma.refund.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'desc' },
        include: REFUND_INCLUDE,
      })

      return {
        data: {
          orderId: order.id,
          orderReference: order.reference,
          currency: order.currency,
          totalCents: order.totalCents,
          refundedCents: order.refundedCents,
          refundPendingCents: order.refundPendingCents,
          refundableCents: refundableCents(order),
          lines: order.items.map((item) => {
            const pendingQuantity = pending.get(item.id) ?? 0

            return {
              orderItemId: item.id,
              ticketTypeId: item.ticketTypeId,
              ticketTypeName: item.ticketType?.name ?? '',
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
              refundedQuantity: item.refundedQuantity,
              pendingQuantity,
              refundableQuantity: Math.max(
                0,
                item.quantity - item.refundedQuantity - pendingQuantity,
              ),
            }
          }),
          refunds: refunds.map(toRefund),
        },
      }
    },
  })

  defineRoute(app, 'refunds.request', {
    handler: async (request, reply) => {
      const { amountCents, lines, reason, reasonNote = null, idempotencyKey } = request.body
      const now = new Date()

      const order = await prisma.order.findUnique({
        where: { reference: request.params.reference },
        include: ORDER_FOR_REFUND,
      })

      if (!order) throw notFound('No such order.')

      assertCan(request.actor, CAPABILITIES.ORDER_REFUND_REQUEST, {
        organizationId: order.event?.organizationId,
      })

      // Which payment to refund against. The succeeded one, and if there are
      // several — a retried checkout that eventually worked — the one that
      // actually took the money most recently. A refund against a failed
      // payment is not a refund.
      const payment = await prisma.payment.findFirst({
        where: { orderId: order.id, status: 'SUCCEEDED' },
        orderBy: { createdAt: 'desc' },
      })

      if (!payment) {
        throw unprocessable('Nothing was ever paid on this order, so nothing can go back.', {
          orderId: order.id,
        })
      }

      const outcome = await prisma.$transaction(async (tx) => {
        const pendingByLine = lines ? await pendingQuantitiesByLine(tx, order.id) : new Map()

        // Re-read inside the transaction. The counters the reservation is
        // conditional on have to be the ones this decision was made against,
        // and the copy above was read outside it.
        const current = await tx.order.findUnique({ where: { id: order.id } })

        return requestRefund(tx, {
          order: { ...current, items: order.items },
          payment,
          amountCents,
          lines: lines ?? null,
          pendingByLine,
          reason,
          reasonNote,
          idempotencyKey,
          actorId: request.actor.id,
          requestId: request.id,
          now,
        })
      })

      // A retry that found the first request's refund is not a creation, and
      // answering 201 would tell the client it made a second one.
      reply.code(outcome.created ? 201 : 200)

      return { data: await present(prisma, outcome.refund.id) }
    },
  })

  defineRoute(app, 'refunds.queue', {
    handler: async (request) => {
      const { page, perPage, status, orderReference, organizationId } = request.query
      const { skip, take } = toSkipTake({ page, perPage })

      // Scoped by the organisation the capability was asserted in, not by a
      // filter the caller may widen. The event is two hops away, so this is a
      // relation filter rather than a column.
      const where = {
        order: {
          event: { organizationId },
          ...(orderReference ? { reference: orderReference } : {}),
        },
        ...(status ? { status } : {}),
      }

      const [rows, total] = await Promise.all([
        readRankedPage(prisma.refund, {
          where,
          field: 'status',
          first: UNRESOLVED_REFUND_STATES,
          orderBy: QUEUE_ORDER,
          skip,
          take,
          include: REFUND_INCLUDE,
        }),
        prisma.refund.count({ where }),
      ])

      return {
        data: rows.map(toRefund),
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })

  defineRoute(app, 'refunds.get', {
    handler: async (request) => {
      const row = await prisma.refund.findUnique({
        where: { id: request.params.id },
        include: REFUND_INCLUDE,
      })

      if (!row) throw notFound('No such refund.')

      const { organizationId } = await ownerOf(prisma, row.orderId)

      assertCan(request.actor, CAPABILITIES.FINANCE_VIEW, { organizationId })

      return { data: toRefund(row) }
    },
  })

  defineRoute(app, 'refunds.approve', {
    handler: async (request) => {
      const now = new Date()
      const { refund } = await loadRefundContext(prisma, request.params.id)
      const { organizationId } = await ownerOf(prisma, refund.orderId)

      assertCan(request.actor, CAPABILITIES.ORDER_REFUND_APPROVE, { organizationId })

      // Separation of duties, enforced rather than assumed. Somebody holding
      // `order:refund` may do both halves — that is what that capability
      // means, and it is how a one-person finance team works — but an approver
      // who only holds `order:refund_approve` may not wave through their own
      // request.
      if (
        refund.requestedById === request.actor.id &&
        !can(request.actor, CAPABILITIES.ORDER_REFUND, { organizationId })
      ) {
        throw forbidden(
          'Somebody other than the person who asked has to approve this refund.',
          'SEPARATION_OF_DUTIES',
        )
      }

      const applied = await prisma.$transaction((tx) =>
        approveRefund(tx, {
          refund,
          actorId: request.actor.id,
          requestId: request.id,
          now,
        }),
      )

      // `transition` refuses a state that cannot be approved, with its own
      // message. Reaching here with `false` means somebody else got there
      // first between the read and the write.
      if (!applied) {
        throw conflict('Somebody else moved that refund on. Read it again.', {
          status: refund.status,
        })
      }

      return { data: await present(prisma, refund.id) }
    },
  })

  defineRoute(app, 'refunds.submit', {
    handler: async (request) => {
      const now = new Date()
      const { refund, order, payment } = await loadRefundContext(prisma, request.params.id)
      const { organizationId, eventStartsAt } = await ownerOf(prisma, refund.orderId)

      assertCan(request.actor, CAPABILITIES.ORDER_REFUND, { organizationId })

      if (!payment?.providerRef) {
        throw conflict('That refund names a payment with no provider reference.', {
          paymentId: refund.paymentId,
        })
      }

      // Step one: SUBMITTED, in its own transaction, before anything is sent.
      // A process that dies during the call below leaves this row behind, which
      // is the evidence reconciliation needs that a refund may exist.
      const claimed = await prisma.$transaction((tx) => markSubmitted(tx, { refund, now }))

      // Same as approval: an unsubmittable state raises from the transition
      // table, so `false` here is a lost race — and losing it matters, because
      // the winner is talking to a provider right now.
      if (!claimed) {
        throw conflict('That refund is already being submitted. Read it again.', {
          status: refund.status,
        })
      }

      // Step two: the provider, with nothing open. The transaction above has
      // committed and the one below has not started.
      const result = await submitOutsideTransaction(providers.payments, refund, payment)

      // Step three: a short transaction recording what it said. Conditional on
      // the refund still being SUBMITTED, so a webhook that arrived while the
      // call was in flight and this handler cannot both settle it.
      const submitted = { ...refund, status: REFUND_STATES.SUBMITTED }

      await prisma.$transaction(async (tx) => {
        if (result.outcome === REFUND_OUTCOMES.SUCCEEDED) {
          return settleRefund(tx, {
            refund: submitted,
            order,
            result,
            organizationId,
            seatPolicy: request.body.seatPolicy,
            eventStartsAt,
            actorId: request.actor.id,
            requestId: request.id,
            now: new Date(),
          })
        }

        if (result.outcome === REFUND_OUTCOMES.TIMEOUT) {
          return recordRefundTimeout(tx, {
            refund: submitted,
            order,
            result,
            organizationId,
            actorId: request.actor.id,
            requestId: request.id,
            now: new Date(),
          })
        }

        return recordRefundFailure(tx, {
          refund: submitted,
          order,
          result,
          actorId: request.actor.id,
          requestId: request.id,
          now: new Date(),
        })
      })

      // Whatever the outcome, the answer is the refund as it now stands. A
      // declined refund is a 200 describing a declined refund, not a 4xx: the
      // request succeeded, and it is the money that did not move.
      return { data: await present(prisma, refund.id) }
    },
  })

  defineRoute(app, 'refunds.cancel', {
    handler: async (request) => {
      const now = new Date()
      const { refund, order } = await loadRefundContext(prisma, request.params.id)
      const { organizationId } = await ownerOf(prisma, refund.orderId)

      // Either capability withdraws a refund, but the requester's own is
      // enough only for their own: withdrawing somebody else's request is an
      // approval decision in the other direction.
      const mine =
        refund.requestedById === request.actor.id &&
        can(request.actor, CAPABILITIES.ORDER_REFUND_REQUEST, { organizationId })

      if (!mine) {
        assertCan(request.actor, CAPABILITIES.ORDER_REFUND_APPROVE, { organizationId })
      }

      // Said here rather than left to the transition table, because the
      // reason is specific: a submitted refund may already have moved money,
      // and withdrawing it would leave the row saying one thing and the
      // provider having done another. Every other refusal comes from the table.
      if (refund.status === REFUND_STATES.SUBMITTED) {
        throw conflict(
          'That refund is with the provider. It cannot be withdrawn until there is an answer.',
          { status: refund.status },
        )
      }

      const applied = await prisma.$transaction((tx) =>
        cancelRefund(tx, {
          refund,
          order,
          reason: request.body.reason,
          actorId: request.actor.id,
          requestId: request.id,
          now,
        }),
      )

      if (!applied) {
        throw conflict('Somebody else moved that refund on. Read it again.', {
          status: refund.status,
        })
      }

      return { data: await present(prisma, refund.id) }
    },
  })
}
