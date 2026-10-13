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

import { conflict, databaseErrorCode, forbidden, notFound, unprocessable } from '../lib/errors.js'
import { toRefund } from '../lib/presenters.js'
import {
  PENDING_STATES,
  REFUND_STATES,
  approveRefund,
  cancelRefund,
  lineQuantityLeft,
  loadRefundContext,
  pendingQuantitiesByLine,
  refundableCents,
  repairUnreservedRefund,
  requestRefund,
  submitRefund,
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
  order: {
    select: {
      reference: true,
      paymentMethod: true,
      event: { select: { organizationId: true } },
    },
  },
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

  const [presented] = await withDoorFacts(prisma, [row])

  return presented
}

/**
 * Refunds as the refund screens read them. A pay-at-the-venue order's carry
 * how its ticket price was paid and what was taken at the door for its
 * tickets (SPEC3 §9.7, §11.3): only the booking fee paid online comes back,
 * and the door money stays with the organiser, which the detail says.
 *
 * @param {object} prisma A Prisma client.
 * @param {Array<object>} rows Refund rows with {@link REFUND_INCLUDE}.
 * @returns {Promise<Array<object>>} Payloads satisfying `refundSchema`, in the same order.
 */
async function withDoorFacts(prisma, rows) {
  const venueOrderIds = [
    ...new Set(
      rows.filter((row) => row.order?.paymentMethod === 'AT_VENUE').map((row) => row.orderId),
    ),
  ]
  const taken = new Map()

  if (venueOrderIds.length > 0) {
    const sums = await prisma.venuePayment.groupBy({
      by: ['orderId'],
      where: { orderId: { in: venueOrderIds } },
      _sum: { amountCents: true },
    })

    for (const sum of sums) taken.set(sum.orderId, sum._sum?.amountCents ?? 0)
  }

  // Said only of a pay-at-the-venue order (`toRefund` decides): a card
  // order's refund reads as it always did.
  return rows.map((row) => toRefund(row, { paidAtDoorCents: taken.get(row.orderId) ?? 0 }))
}

/**
 * Answer a duplicate request with the refund the first copy made.
 *
 * `requestRefund` looks the key up again under the order's lock, so two copies
 * of one request for the same order meet there. What reaches here is the rest:
 * a copy that lost the race on the key's unique index some other way. It is a
 * retry, and it is answered as one — 200 with the refund — rather than as a
 * 500. A key already used for a different order is not a retry of this
 * request, and is refused as a conflict rather than answered with somebody
 * else's refund.
 *
 * @param {object} prisma A Prisma client.
 * @param {unknown} error What the transaction threw.
 * @param {object} context The request.
 * @param {string} context.idempotencyKey Its key.
 * @param {object} context.order The order it is for.
 * @returns {Promise<{refund: object, created: boolean}>} The first copy's refund.
 * @throws {Error} The original error for anything else; 409 for a key used on another order.
 */
async function replayOnDuplicateKey(prisma, error, { idempotencyKey, order }) {
  if (databaseErrorCode(error) !== 'P2002') throw error

  const existing = await prisma.refund.findUnique({ where: { idempotencyKey } })

  if (!existing) throw error

  if (existing.orderId !== order.id) {
    throw conflict('That idempotency key was already used for a refund of another order.', {
      orderId: order.id,
    })
  }

  return { refund: existing, created: false }
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
              // Tickets cancelled unpaid are gone, never refunded (SPEC3-XI
              // §10.2): the dialog never offers one.
              cancelledQuantity: item.venueCancelledQuantity ?? 0,
              refundableQuantity: Math.max(0, lineQuantityLeft(item, pendingQuantity)),
            }
          }),
          refunds: await withDoorFacts(prisma, refunds),
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

      // `requestRefund` takes the order's row lock and reads the order, its
      // lines and what other refunds hold on them again under it: the copy
      // above was read outside the transaction, and deciding from it let two
      // requests for the last ticket on a line both be reserved.
      const outcome = await prisma
        .$transaction(async (tx) =>
          requestRefund(tx, {
            order,
            payment,
            amountCents,
            lines: lines ?? null,
            reason,
            reasonNote,
            idempotencyKey,
            actorId: request.actor.id,
            requestId: request.id,
            now,
          }),
        )
        .catch((error) => replayOnDuplicateKey(prisma, error, { idempotencyKey, order }))

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
        data: await withDoorFacts(prisma, rows),
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

      const [presented] = await withDoorFacts(prisma, [row])

      return { data: presented }
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

      // A cancellation refund written before refunds reserved anything is
      // repaired first, in its own transaction: the repair is right whatever
      // the approval then decides, and a refusal below must not undo it.
      const repaired = await prisma.$transaction((tx) =>
        repairUnreservedRefund(tx, {
          refund,
          actorId: request.actor.id,
          requestId: request.id,
          now,
        }),
      )
      const target = repaired.refund

      // Withdrawn because the order had nothing left, or an approved row now
      // reserved in place: nothing is left to approve, and the row says why.
      if (
        repaired.mode === 'CANCELLED_NOTHING_LEFT' ||
        (repaired.mode === 'RESERVED' && target.status === REFUND_STATES.APPROVED)
      ) {
        return { data: await present(prisma, target.id) }
      }

      // The order is read inside the approval, which takes the reservation
      // again (under the order's row lock) when the refund was declined or
      // failed, or refuses with REFUND_BALANCE_GONE.
      const applied = await prisma.$transaction(async (tx) =>
        approveRefund(tx, {
          refund: target,
          order: await tx.order.findUnique({ where: { id: target.orderId } }),
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
          status: target.status,
        })
      }

      return { data: await present(prisma, target.id) }
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

      // A cancellation refund written before refunds reserved anything is
      // reserved (or replaced) first, in its own transaction. A replacement
      // of an approved row is approved with it, so it stays in the state the
      // old row was in.
      const target = await prisma.$transaction(async (tx) => {
        const repaired = await repairUnreservedRefund(tx, {
          refund,
          actorId: request.actor.id,
          requestId: request.id,
          now,
        })

        if (repaired.mode !== 'REPLACED' || refund.status !== REFUND_STATES.APPROVED) {
          return repaired.refund
        }

        await approveRefund(tx, {
          refund: repaired.refund,
          order: await tx.order.findUnique({ where: { id: refund.orderId } }),
          actorId: request.actor.id,
          requestId: request.id,
          now,
          via: 'reservation_repair',
        })

        return tx.refund.findUnique({ where: { id: repaired.refund.id } })
      })

      // SUBMITTED in its own transaction, the provider with nothing open, a
      // short transaction recording what it said: `submitRefund`.
      const { refund: after } = await submitRefund(prisma, providers, {
        refund: target,
        order,
        payment,
        organizationId,
        eventStartsAt,
        seatPolicy: request.body.seatPolicy,
        actorId: request.actor.id,
        requestId: request.id,
      })

      // Whatever the outcome, the answer is the refund as it now stands. A
      // declined refund is a 200 describing a declined refund, not a 4xx: the
      // request succeeded, and it is the money that did not move.
      return { data: await present(prisma, after.id) }
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
