/**
 * Checkout: turning holds into a paid order, and reading orders back.
 *
 * `orders.create` is the one endpoint in this application where a bug costs
 * real money, so it obeys three rules without exception:
 *
 *  1. **Prices are never taken from the request.** Only `ticketTypeId` and
 *     `quantity` are trusted; every amount is recomputed from the database rows
 *     by `@desi-event/pricing`.
 *  2. **Availability is re-checked under the row lock**, exactly as in
 *     `holds.create`, because a hold may have lapsed between the cart and the
 *     card. The buyer's own holds are excluded from the held total so their
 *     reservation is not counted against them.
 *  3. **Nothing survives a failed payment.** Order, items, tickets, the sold
 *     counter and the hold conversions are all written inside one transaction
 *     that the payment runs inside; a decline throws, the transaction rolls
 *     back, and the database looks exactly as it did before the attempt.
 *
 * Holding a database transaction open across a payment call is a deliberate
 * trade: it costs a lock held for the duration of the provider round-trip, and
 * it buys the guarantee that a captured payment and its tickets are never
 * written apart. For a ticketing system the second is worth far more than the
 * first.
 *
 * @module @desi-event/api/routes/orders
 */

import { salesWindowState, validateQuantityRequest } from '@desi-event/inventory'
import { CAPABILITIES, assertCan } from '@desi-event/permissions'
import { computeOrderTotals } from '@desi-event/pricing'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { conflict, httpError, notFound, unprocessable } from '../lib/errors.js'
import { generateOrderReference, generateTicketCode } from '../lib/identifiers.js'
import { lockTicketTypes, readAvailability } from '../lib/inventory.js'
import { toOrder } from '../lib/presenters.js'
import { defineRoute } from '../lib/register.js'

/** Everything an order payload needs, in one query. */
const ORDER_INCLUDE = Object.freeze({
  items: { include: { tickets: true } },
  event: { include: { venue: true, organization: true, ticketTypes: true } },
})

/**
 * Build the platform fee configuration for one order.
 *
 * The flat component is denominated in a currency, so it is stamped with the
 * order's currency; `computeOrderTotals` rejects a mismatch rather than
 * quietly charging an INR fee on a USD order.
 *
 * @param {object} env The parsed API environment.
 * @param {string} currency The order currency.
 * @returns {{percentageBps: number, flatCents: number, currency: string}} A fee configuration.
 */
export function feeConfigFor(env, currency) {
  return {
    percentageBps: env.PLATFORM_FEE_BPS,
    flatCents: env.PLATFORM_FEE_FLAT_CENTS,
    currency,
  }
}

/**
 * Resolve the promo code named by a checkout request, if any.
 *
 * An unknown code is refused outright. A *known* code that has expired, been
 * switched off or been exhausted is not an error — `computeDiscount` returns a
 * zero discount for it — because the buyer should still be able to complete
 * the purchase at full price.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {string|undefined} code The promo code from the request.
 * @param {object} event The event being bought into.
 * @returns {Promise<object|null>} The `PromoCode` row, or `null` when none was supplied.
 * @throws {Error} A 422 when the code does not exist for this event's organisation.
 */
async function resolvePromoCode(tx, code, event) {
  if (!code) return null

  const promoCode = await tx.promoCode.findFirst({
    where: {
      code,
      organizationId: event.organizationId,
      OR: [{ eventId: event.id }, { eventId: null }],
    },
  })

  if (!promoCode) throw unprocessable(`Promo code "${code}" is not valid for this event.`)

  return promoCode
}

/**
 * Validate the holds a checkout request claims, and group them by ticket type.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {string[]} holdIds Hold ids from the request.
 * @param {Set<string>} ticketTypeIds Ticket type ids the order is for.
 * @param {Date} now The instant the request is being evaluated at.
 * @returns {Promise<Map<string, object[]>>} Live holds grouped by ticket type id.
 * @throws {Error} A 404 for an unknown hold, 410 for a lapsed one, 409 for one already spent.
 */
async function resolveHolds(tx, holdIds, ticketTypeIds, now) {
  /** @type {Map<string, object[]>} */
  const byTicketType = new Map()

  if (!holdIds || holdIds.length === 0) return byTicketType

  const holds = await tx.ticketHold.findMany({ where: { id: { in: holdIds } } })
  const found = new Set(holds.map((hold) => hold.id))

  for (const id of holdIds) {
    if (!found.has(id)) throw notFound(`No such hold: ${id}.`)
  }

  for (const hold of holds) {
    if (hold.status === 'CONVERTED') {
      throw conflict(`Hold ${hold.id} has already been used for another order.`)
    }
    if (hold.status !== 'ACTIVE') {
      throw httpError(410, 'HOLD_EXPIRED', `Hold ${hold.id} is no longer active.`)
    }
    if (new Date(hold.expiresAt).getTime() <= now.getTime()) {
      throw httpError(410, 'HOLD_EXPIRED', `Hold ${hold.id} expired; please try again.`)
    }
    if (!ticketTypeIds.has(hold.ticketTypeId)) {
      throw conflict(`Hold ${hold.id} is for a ticket type that is not in this order.`)
    }

    const bucket = byTicketType.get(hold.ticketTypeId) ?? []
    bucket.push(hold)
    byTicketType.set(hold.ticketTypeId, bucket)
  }

  return byTicketType
}

/**
 * Take payment for an order and return the captured intent.
 *
 * @param {object} payments The injected payment provider.
 * @param {object} order The `Order` row being paid for.
 * @returns {Promise<object>} The captured intent.
 * @throws {Error} When the provider refuses or declines.
 */
async function capturePayment(payments, order) {
  const intent = await payments.createIntent({
    amountCents: order.totalCents,
    currency: order.currency,
    orderId: order.id,
    metadata: { reference: order.reference, buyerEmail: order.buyerEmail },
  })

  return payments.capture(intent.id, { amountCents: order.totalCents, currency: order.currency })
}

/**
 * Whether this caller may read an order.
 *
 * The buyer always may — matched on the signed-in user id, or on the email the
 * order was placed with, which is what makes a guest checkout readable once
 * that guest signs up. Otherwise it takes `order:view` in the organisation
 * running the event.
 *
 * @param {object|null} actor The request actor.
 * @param {object} order The `Order` row, including its event.
 * @returns {boolean} True when the caller owns the order.
 */
function ownsOrder(actor, order) {
  if (!actor) return false
  if (order.userId && order.userId === actor.id) return true

  return (
    typeof actor.email === 'string' &&
    typeof order.buyerEmail === 'string' &&
    actor.email.toLowerCase() === order.buyerEmail.toLowerCase()
  )
}

/**
 * Register the order routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.providers The provider registry.
 * @param {object} deps.env The parsed API environment.
 * @returns {void} Nothing.
 */
export function registerOrderRoutes(app, { prisma, providers, env }) {
  defineRoute(app, 'orders.create', {
    handler: async (request) => {
      const body = request.body
      const now = new Date()
      const requestedIds = body.items.map((item) => item.ticketTypeId)

      const order = await prisma.$transaction(async (tx) => {
        // Same discipline as holds.create: lock every tier involved, in sorted
        // order so two concurrent multi-tier orders cannot deadlock, and only
        // then read anything.
        await lockTicketTypes(tx, requestedIds)

        const event = await tx.event.findUnique({ where: { id: body.eventId } })
        if (!event) throw notFound('No such event.')
        if (event.status !== 'PUBLISHED') throw unprocessable('This event is not on sale.')

        const ticketTypes = await tx.ticketType.findMany({ where: { id: { in: requestedIds } } })
        const byId = new Map(ticketTypes.map((ticketType) => [ticketType.id, ticketType]))

        for (const id of requestedIds) {
          const ticketType = byId.get(id)
          if (!ticketType || ticketType.eventId !== event.id) {
            throw notFound(`No such ticket type for this event: ${id}.`)
          }
        }

        const currencies = new Set(ticketTypes.map((ticketType) => ticketType.currency))
        if (currencies.size > 1) {
          throw unprocessable('Every ticket type in an order must share one currency.')
        }
        const currency = ticketTypes[0].currency

        const holdsByType = await resolveHolds(tx, body.holdIds, new Set(requestedIds), now)

        for (const item of body.items) {
          const ticketType = byId.get(item.ticketTypeId)

          const windowState = salesWindowState({
            status: ticketType.status,
            salesStartAt: ticketType.salesStartAt,
            salesEndAt: ticketType.salesEndAt,
            now,
          })
          if (windowState !== 'ON_SALE') {
            throw unprocessable(`"${ticketType.name}" is not on sale.`, { windowState })
          }

          // The buyer's own holds already reserve stock for them, so they are
          // excluded from the held total rather than counted against the very
          // request they exist to protect.
          const ownHolds = holdsByType.get(ticketType.id) ?? []
          const { availableQuantity } = await readAvailability(tx, ticketType, {
            now,
            ignoreHoldIds: ownHolds.map((hold) => hold.id),
          })

          validateQuantityRequest({
            quantity: item.quantity,
            minPerOrder: ticketType.minPerOrder,
            maxPerOrder: ticketType.maxPerOrder,
            availableQuantity,
          })
        }

        const promoCode = await resolvePromoCode(tx, body.promoCode, event)

        const totals = computeOrderTotals({
          items: body.items.map((item) => ({
            ticketTypeId: item.ticketTypeId,
            quantity: item.quantity,
            unitPriceCents: byId.get(item.ticketTypeId).priceCents,
            name: byId.get(item.ticketTypeId).name,
          })),
          promoCode,
          feeConfig: feeConfigFor(env, currency),
          currency,
          now,
        })

        const created = await tx.order.create({
          data: {
            reference: generateOrderReference(),
            eventId: event.id,
            userId: body.userId ?? request.actor?.id ?? null,
            buyerEmail: body.buyerEmail,
            buyerName: body.buyerName,
            status: 'PENDING',
            currency: totals.currency,
            subtotalCents: totals.subtotalCents,
            discountCents: totals.discountCents,
            feesCents: totals.feesCents,
            taxCents: totals.taxCents,
            totalCents: totals.totalCents,
            promoCodeId: promoCode?.id ?? null,
          },
        })

        for (const line of totals.lineItems) {
          const item = await tx.orderItem.create({
            data: {
              orderId: created.id,
              ticketTypeId: line.ticketTypeId,
              quantity: line.quantity,
              unitPriceCents: line.unitPriceCents,
              subtotalCents: line.subtotalCents,
            },
          })

          for (let index = 0; index < line.quantity; index += 1) {
            await tx.ticket.create({
              data: {
                orderItemId: item.id,
                code: generateTicketCode(),
                attendeeName: body.buyerName,
                status: 'VALID',
              },
            })
          }
        }

        // A zero-total order (a 100% promo code, a free event) never touches
        // the payment provider: there is nothing to authorise, and a provider
        // that rejects zero-amount intents would otherwise block free tickets.
        if (totals.totalCents > 0) {
          const intent = await capturePayment(providers.payments, created)

          await tx.payment.create({
            data: {
              orderId: created.id,
              provider: providers.payments.name,
              providerRef: intent.id,
              status: 'SUCCEEDED',
              amountCents: totals.totalCents,
              currency: totals.currency,
            },
          })
        }

        for (const item of body.items) {
          await tx.ticketType.update({
            where: { id: item.ticketTypeId },
            data: { quantitySold: byId.get(item.ticketTypeId).quantitySold + item.quantity },
          })
        }

        for (const holds of holdsByType.values()) {
          for (const hold of holds) {
            await tx.ticketHold.update({
              where: { id: hold.id },
              data: { status: 'CONVERTED', orderId: created.id },
            })
          }
        }

        if (promoCode) {
          await tx.promoCode.update({
            where: { id: promoCode.id },
            data: { redemptionCount: promoCode.redemptionCount + 1 },
          })
        }

        await tx.order.update({
          where: { id: created.id },
          data: { status: 'PAID', paidAt: now },
        })

        return tx.order.findUnique({ where: { id: created.id }, include: ORDER_INCLUDE })
      })

      request.log.info(
        { orderId: order.id, reference: order.reference, totalCents: order.totalCents },
        'order paid',
      )

      return { data: toOrder(order) }
    },
  })

  defineRoute(app, 'orders.get', {
    handler: async (request) => {
      const order = await prisma.order.findUnique({
        where: { reference: request.params.reference },
        include: ORDER_INCLUDE,
      })

      if (!order) throw notFound('No such order.')

      if (!ownsOrder(request.actor, order)) {
        const organizationId = order.event?.organizationId

        // `assertCan` raises the 403; there is no role comparison here.
        assertCan(request.actor, CAPABILITIES.ORDER_VIEW, { organizationId })
      }

      return { data: toOrder(order) }
    },
  })

  defineRoute(app, 'orders.listMine', {
    handler: async (request) => {
      const where = { userId: request.actor.id }
      const { skip, take } = toSkipTake(request.query)

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip,
          take,
          include: ORDER_INCLUDE,
        }),
        prisma.order.count({ where }),
      ])

      return {
        data: orders.map(toOrder),
        pagination: buildPaginationMeta({
          page: request.query.page,
          perPage: request.query.perPage,
          total,
        }),
      }
    },
  })
}
