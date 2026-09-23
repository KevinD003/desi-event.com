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
 *  3. **The provider is never called with a transaction open.** Checkout is
 *     three steps — reserve and commit, capture, then a short transaction that
 *     records the outcome — and the boundaries are the point. See
 *     `../lib/checkout.js` for why.
 *
 * Reserved seating adds one rule on top: a seat's price comes from the seat,
 * not from the tier, so a selection spanning two price zones becomes two order
 * lines of one ticket type. Which line pays for which seat is written onto the
 * hold item at checkout, because by settlement the zone override may have moved
 * and there would be no way to tell.
 *
 * @module @desi-event/api/routes/orders
 */

import {
  authorizeHoldRelease,
  holdExpiresAt,
  resolveHoldOwnership,
  salesWindowState,
  validateQuantityRequest,
} from '@desi-event/inventory'
import { CAPABILITIES, assertCan } from '@desi-event/permissions'
import {
  assertTaxPolicyUsable,
  buildPricingSnapshot,
  computeOrderTotals,
  feeConfigForCurrency,
  resolveTaxPolicy,
} from '@desi-event/pricing'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'
import { BOOKABLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { conflict, httpError, notFound, unprocessable } from '../lib/errors.js'
import { generateOrderReference, generateTicketCode } from '../lib/identifiers.js'
import { lockTicketTypes, readAvailability } from '../lib/inventory.js'
import { toOrder } from '../lib/presenters.js'
import {
  assertSeatsCoherent,
  loadSeatedHoldItems,
  priceLines,
  stampHoldItems,
} from '../lib/seated-checkout.js'
import {
  CAPTURE_OUTCOMES,
  captureOutsideTransaction,
  compensateCheckout,
  recordCaptureTimeout,
  settleCheckout,
} from '../lib/checkout.js'
import { defineRoute } from '../lib/register.js'

/** Everything an order payload needs, in one query. */
/**
 * Transaction settings for checkout.
 *
 * Prisma's defaults are `timeout: 5000` and `maxWait: 2000`, and the payment
 * capture happens inside this transaction so that a declined card leaves no
 * partial order behind. Five seconds is comfortable for the in-memory provider
 * and thin for a real one: a gateway that takes longer would have the money
 * taken while the surrounding transaction rolls the order back, leaving a
 * charge with no tickets against it.
 *
 * The wider window buys headroom, but it is not a substitute for the real fix.
 * Before a production gateway is wired up, checkout should move to a two-phase
 * flow — persist a PENDING order, capture outside any transaction, then settle
 * or compensate in a second transaction — so that no external call is ever
 * holding database locks. See docs/architecture.md.
 */
/**
 * Phase 1 and phase 3 are both purely local work — validate and write, or
 * record an outcome. Neither calls anything external. The provider call happens
 * between them with no transaction open at all; see lib/checkout.js.
 */
const CHECKOUT_TRANSACTION_OPTIONS = Object.freeze({ timeout: 10_000, maxWait: 5_000 })
const SETTLEMENT_TRANSACTION_OPTIONS = Object.freeze({ timeout: 10_000, maxWait: 5_000 })

const ORDER_INCLUDE = Object.freeze({
  items: { include: { tickets: true } },
  event: { include: { venue: true, organization: true, ticketTypes: true } },
})

/**
 * Build the platform fee configuration for one order.
 *
 * The terms come from `@desi-event/pricing` so that the total quoted on the
 * checkout page and the total charged here are computed from the same table.
 * They used to be computed from different ones, and the buyer was shown a
 * figure that was never what got billed.
 *
 * The flat component is denominated in a currency, so the deployment's
 * configured flat fee applies only to the base currency; other currencies take
 * their own figure. `computeOrderTotals` rejects a mismatch rather than
 * quietly charging an INR fee on a USD order.
 *
 * @param {object} env The parsed API environment.
 * @param {string} currency The order currency.
 * @returns {{percentageBps: number, flatCents: number, currency: string}} A fee configuration.
 */
export function feeConfigFor(env, currency) {
  return feeConfigForCurrency(currency, {
    percentageBps: env.PLATFORM_FEE_BPS,
    flatCents: env.PLATFORM_FEE_FLAT_CENTS,
  })
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
 * Ownership is checked here for the same reason it is checked on release:
 * spending a hold consumes somebody's reservation. A caller who guessed or
 * observed another buyer's hold id could otherwise convert it into their own
 * order. An unowned hold answers 404 exactly as a non-existent one does, so
 * this cannot be used to discover which ids are real.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {string[]} holdIds Hold ids from the request.
 * @param {Set<string>} ticketTypeIds Ticket type ids the order is for.
 * @param {Date} now The instant the request is being evaluated at.
 * @param {object} owner Caller identity.
 * @param {{id: string}|null} [owner.actor] The verified server actor.
 * @param {string|null} [owner.guestToken] The one-time token for a guest hold.
 * @returns {Promise<Map<string, object[]>>} Live holds grouped by ticket type id.
 * @throws {Error} A 404 for an unknown or unowned hold, 410 for a lapsed one, 409 for one already spent.
 */
async function resolveHolds(tx, holdIds, ticketTypeIds, now, owner = {}) {
  /** @type {Map<string, object[]>} */
  const byTicketType = new Map()

  if (!holdIds || holdIds.length === 0) return byTicketType

  const holds = await tx.ticketHold.findMany({ where: { id: { in: holdIds } } })
  const found = new Set(holds.map((hold) => hold.id))

  for (const id of holdIds) {
    if (!found.has(id)) throw notFound(`No such hold: ${id}.`)
  }

  for (const hold of holds) {
    const { allowed } = authorizeHoldRelease({
      hold,
      actor: owner.actor,
      guestToken: owner.guestToken,
    })

    if (!allowed) throw notFound(`No such hold: ${hold.id}.`)

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
      // An idempotency key lets a retried checkout resolve to the original
      // order instead of creating and charging a second one.
      const idempotencyKey = request.headers['idempotency-key'] ?? null
      const requestedIds = body.items.map((item) => item.ticketTypeId)

      // A retry carrying the same key must not produce a second charge. The
      // unique index on Order.idempotencyKey is the real guarantee; this read
      // just turns the common case into a clean replay instead of a 409.
      if (idempotencyKey) {
        const existing = await prisma.order.findUnique({
          where: { idempotencyKey },
          include: ORDER_INCLUDE,
        })

        if (existing) {
          request.log.info(
            { orderId: existing.id, reference: existing.reference },
            'checkout replayed; returning the original order',
          )

          return { data: toOrder(existing) }
        }
      }

      const begun = await prisma.$transaction(async (tx) => {
        // Same discipline as holds.create: lock every tier involved, in sorted
        // order so two concurrent multi-tier orders cannot deadlock, and only
        // then read anything.
        await lockTicketTypes(tx, requestedIds)

        const event = await tx.event.findUnique({ where: { id: body.eventId } })
        if (!event) throw notFound('No such event.')
        if (!BOOKABLE_STATUSES.has(event.status)) {
          throw unprocessable('This event is not on sale.')
        }

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

        const holdsByType = await resolveHolds(tx, body.holdIds, new Set(requestedIds), now, {
          actor: request.actor,
          guestToken: request.headers['x-hold-token'] ?? null,
        })

        // Reserved seating, if any. Read after the tier row locks are held, so
        // the seat states below cannot move under the order being built, and
        // checked before anything is priced: a seat that is not this hold's to
        // sell must not reach the pricing step at all.
        const holdsById = new Map()
        for (const bucket of holdsByType.values()) {
          for (const hold of bucket) holdsById.set(hold.id, hold)
        }

        const seatedItems = await loadSeatedHoldItems(tx, [...holdsById.keys()])
        assertSeatsCoherent(seatedItems, holdsById, body.eventSessionId ?? null)

        for (const seated of seatedItems) {
          const seatSession = await tx.eventSession.findUnique({
            where: { id: seated.eventSeat.eventSessionId },
            select: { eventId: true },
          })

          // A hold whose seats belong to another event's session. The trigger
          // that keeps an order's lines to one event cannot see this, because
          // the line is for a tier of the right event; only the seat is wrong.
          if (seatSession?.eventId !== event.id) {
            throw unprocessable('Those seats are not on sale at this event.', {
              seatSession: seated.eventSeat.eventSessionId,
            })
          }
        }

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

        // Tax follows the jurisdiction of the supply — where the event is held
        // — not the currency it is priced in. A Toronto event priced in rupees
        // is taxed in Ontario, and the previous currency-keyed lookup would
        // have charged it Indian GST.
        const venue = event.venueId
          ? await tx.venue.findUnique({
              where: { id: event.venueId },
              select: { country: true, region: true },
            })
          : null

        const taxPolicy = resolveTaxPolicy({
          country: venue?.country ?? null,
          region: venue?.region ?? null,
          at: now,
        })

        // Fails closed in production: charging a buyer an unverified rate, and
        // telling an organiser they owe it, is worse than refusing the sale.
        assertTaxPolicyUsable(taxPolicy, {
          environment: env.NODE_ENV,
          allowDemo: env.ALLOW_DEMO_TAX_IN_PRODUCTION === true,
        })

        const promoCode = await resolvePromoCode(tx, body.promoCode, event)

        // A seated tier is priced seat by seat: a selection spanning two zones
        // is two lines of one ticket type, because an order line carries one
        // unit price and those seats did not cost the same.
        const { lines: pricedLines, seatsByLineKey } = priceLines({
          items: body.items,
          ticketTypesById: byId,
          seatedItems,
        })

        const totals = computeOrderTotals({
          items: pricedLines,
          promoCode,
          feeConfig: feeConfigFor(env, currency),
          taxRateBps: taxPolicy.rateBps,
          currency,
          now,
        })

        // A promo that exists but is inactive, out of window or exhausted
        // yields a zero discount. It must not consume a redemption or be
        // stamped on the order: doing so burns a campaign for buyers who never
        // received the discount, and misattributes full-price revenue to it.
        const promoApplied = Boolean(promoCode) && totals.discountCents > 0

        const created = await tx.order.create({
          data: {
            reference: generateOrderReference(),
            idempotencyKey,
            pricingSnapshot: buildPricingSnapshot({
              feeConfig: feeConfigFor(env, currency),
              taxPolicy,
              currency,
            }),
            eventId: event.id,
            // Ownership follows the authenticated caller only. Honouring a
            // userId from the body would let an anonymous request attach an
            // order to any account.
            userId: request.actor?.id ?? null,
            buyerEmail: body.buyerEmail,
            buyerName: body.buyerName,
            status: 'PENDING',
            currency: totals.currency,
            subtotalCents: totals.subtotalCents,
            discountCents: totals.discountCents,
            feesCents: totals.feesCents,
            taxCents: totals.taxCents,
            totalCents: totals.totalCents,
            promoCodeId: promoApplied ? promoCode.id : null,
          },
        })

        const orderItems = []

        for (const line of totals.lineItems) {
          orderItems.push(
            await tx.orderItem.create({
              data: {
                orderId: created.id,
                ticketTypeId: line.ticketTypeId,
                quantity: line.quantity,
                unitPriceCents: line.unitPriceCents,
                subtotalCents: line.subtotalCents,
              },
            }),
          )
        }

        // Attach the buyer's holds to the order so the settlement step can
        // convert them, and reserve anything not already held. Inventory has
        // to stay reserved for the whole time the provider is being called:
        // without this an unheld line would be free for somebody else to buy
        // while this buyer's card is authorising.
        const seatedTypes = new Set(seatedItems.map((seated) => seated.ticketTypeId))

        for (const item of body.items) {
          const held = (holdsByType.get(item.ticketTypeId) ?? []).reduce(
            (sum, hold) => sum + hold.quantity,
            0,
          )

          for (const hold of holdsByType.get(item.ticketTypeId) ?? []) {
            await tx.ticketHold.update({ where: { id: hold.id }, data: { orderId: created.id } })
          }

          // A seated line's quantity is its seats, and `priceLines` has already
          // refused any other number. Topping it up with a quantity hold would
          // reserve stock with no seat behind it, which reserved seating does
          // not have.
          const unheld = seatedTypes.has(item.ticketTypeId) ? 0 : item.quantity - held
          if (unheld > 0) {
            const { ownership } = resolveHoldOwnership({ actor: request.actor })
            await tx.ticketHold.create({
              data: {
                ticketTypeId: item.ticketTypeId,
                orderId: created.id,
                quantity: unheld,
                status: 'ACTIVE',
                expiresAt: holdExpiresAt(now, env.TICKET_HOLD_TTL_SECONDS),
                userId: ownership.userId,
                guestTokenHash: ownership.guestTokenHash,
              },
            })
          }
        }

        // Which line pays for which seat, written down now rather than derived
        // at settlement from prices that may have moved since.
        await stampHoldItems(tx, { seatsByLineKey, orderItems })

        if (promoApplied) {
          // `increment` rather than a read-modify-write: two checkouts that
          // resolved the same promo row concurrently would otherwise both
          // write the same count and lose a redemption.
          await tx.promoCode.update({
            where: { id: promoCode.id },
            data: { redemptionCount: { increment: 1 } },
          })
        }

        // A zero-total order (a 100% promo, a free event) moves no money, so
        // there is nothing to attempt and no attempt row to write.
        const zeroTotal = totals.totalCents === 0

        // Otherwise the payment attempt is written and committed BEFORE the
        // provider is called, so a process that dies mid-call still leaves
        // evidence that a charge may exist.
        const payment = zeroTotal
          ? null
          : await tx.payment.create({
              data: {
                orderId: created.id,
                provider: providers.payments.name,
                status: 'INITIATED',
                amountCents: totals.totalCents,
                currency: totals.currency,
                idempotencyKey: idempotencyKey ? `${idempotencyKey}:1` : null,
                attemptNumber: 1,
              },
            })

        return { order: created, payment, zeroTotal }
      }, CHECKOUT_TRANSACTION_OPTIONS)

      // ---- Phase 2: the provider call, with NO transaction open -------------
      const result = begun.zeroTotal
        ? {
            outcome: CAPTURE_OUTCOMES.SUCCEEDED,
            intent: null,
            failureCode: null,
            rawStatus: 'ZERO_TOTAL',
          }
        : await captureOutsideTransaction(providers.payments, begun.order)

      // ---- Phase 3: a short transaction recording the outcome ---------------
      const order = await prisma.$transaction(async (tx) => {
        const common = {
          order: begun.order,
          payment: begun.payment,
          now,
          actorId: request.actor?.id ?? null,
          requestId: request.id,
        }

        if (result.outcome === CAPTURE_OUTCOMES.SUCCEEDED) {
          await settleCheckout(tx, {
            ...common,
            result,
            generateTicketCode,
            credentialSecret: env.AUTH_SECRET,
          })
        } else if (result.outcome === CAPTURE_OUTCOMES.TIMEOUT) {
          await recordCaptureTimeout(tx, { ...common, result })
        } else {
          await compensateCheckout(tx, { ...common, failureCode: result.failureCode })
        }

        return tx.order.findUnique({ where: { id: begun.order.id }, include: ORDER_INCLUDE })
      }, SETTLEMENT_TRANSACTION_OPTIONS)

      if (result.outcome === CAPTURE_OUTCOMES.TIMEOUT) {
        request.log.error(
          { orderId: order.id, reference: order.reference, paymentId: begun.payment.id },
          'payment capture timed out; order left pending for reconciliation',
        )
        throw httpError(
          502,
          'PAYMENT_TIMEOUT',
          'The payment provider did not respond in time. Your order is being confirmed; do not retry yet.',
        )
      }

      if (result.outcome === CAPTURE_OUTCOMES.DECLINED) {
        throw httpError(402, 'PAYMENT_DECLINED', 'The payment was declined.')
      }

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

      const buyer = ownsOrder(request.actor, order)

      if (!buyer) {
        const organizationId = order.event?.organizationId

        // `assertCan` raises the 403; there is no role comparison here.
        assertCan(request.actor, CAPABILITIES.ORDER_VIEW, { organizationId })
      }

      // Only the buyer gets their own address back. `order:view` reaches every
      // organisation role from VIEWER up, and none of them needs it.
      return { data: toOrder(order, { buyerAddress: buyer }) }
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
