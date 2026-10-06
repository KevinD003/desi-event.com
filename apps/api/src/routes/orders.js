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

import { holdExpiresAt, resolveHoldOwnership } from '@desi-event/inventory'
import { CAPABILITIES, assertCan } from '@desi-event/permissions'
import { buildPricingSnapshot } from '@desi-event/pricing'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { changesForOrder } from '../lib/event-change-notices.js'
import { feeConfigFor, priceCheckout, toOrderQuote } from '../lib/checkout-pricing.js'
import { EVENT_COVER_INCLUDE } from '../lib/event-media.js'
import {
  conflict,
  databaseErrorCode,
  exposedServerError,
  httpError,
  notFound,
} from '../lib/errors.js'
import { generateOrderReference, generateTicketCode } from '../lib/identifiers.js'
import { toOrder } from '../lib/presenters.js'
import { stampHoldItems } from '../lib/seated-checkout.js'
import {
  CAPTURE_OUTCOMES,
  captureOutsideTransaction,
  compensateCheckout,
  recordCaptureTimeout,
  recordUnsettledCapture,
  settleCheckout,
} from '../lib/checkout.js'
import { defineRoute } from '../lib/register.js'
import {
  groupPassIssued,
  groupPassSummary,
  retrieveGroupPass,
  rotateGroupPass,
} from '../lib/group-passes.js'
import { passRateLimit, promoAttemptRateLimit, quoteRateLimit } from '../plugins/rate-limit.js'

// Re-exported: routes/events.js prices listing cards with it, and it has always
// been reached through this module.
export { feeConfigFor }

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

/** Which night a line is for, as its tier names it. */
const LINE_SESSION_SELECT = Object.freeze({
  id: true,
  label: true,
  startsAt: true,
  endsAt: true,
  doorsOpenAt: true,
  timezone: true,
})

const ORDER_INCLUDE = Object.freeze({
  items: {
    include: {
      tickets: true,
      ticketType: {
        select: { name: true, eventSessionId: true, eventSession: { select: LINE_SESSION_SELECT } },
      },
    },
  },
  // The approved cover rides along so an order shows the event's picture; the
  // summary presenter filters it again.
  event: {
    include: { venue: true, organization: true, ticketTypes: true, ...EVENT_COVER_INCLUDE },
  },
})

/**
 * The order statuses a checkout attempt sold into. A retry of the attempt
 * answers 201 with the order as it stands now: a refund since then does not
 * make the sale the attempt made any less its outcome.
 */
const SOLD_STATUSES = new Set(['PAID', 'REFUNDED'])

/** What a checkout that ended without a sale answers, first time and on a retry. */
const ORDER_CANCELLED_MESSAGE =
  'The order could not be completed, so it was cancelled. Nothing was charged; reserve the tickets again to carry on.'

/**
 * The 409 for an attempt whose order ended without a sale and without a
 * declined card: a free order whose settlement refused, or one that lapsed.
 * Nothing was charged, and the holds it named are not to be relied on, so
 * the buyer reserves again.
 *
 * @returns {Error} A 409 `ORDER_CANCELLED`.
 */
function orderCancelled() {
  return httpError(409, 'ORDER_CANCELLED', ORDER_CANCELLED_MESSAGE)
}

/**
 * What a retried checkout answers, from the order its `Idempotency-Key`
 * already placed.
 *
 * A key names one attempt, and a retry of it is answered with that attempt's
 * outcome — never with a second order or a second charge, and never with a
 * success the attempt did not have. The outcome is read from the order now,
 * because the attempt may have settled since it first answered:
 *
 * - sold (`PAID`, or `REFUNDED` since): 201 and the order, as a first answer
 *   that got through would have been;
 * - `PENDING`: the payment is still being checked — the first request is still
 *   running, its capture timed out, or it was captured and the order could not
 *   be completed. 409 `ORDER_PENDING` with the order's reference: the attempt
 *   is not finished, and the buyer must not be sent to pay again;
 * - `CANCELLED` after a declined card: 402 `PAYMENT_DECLINED`, the answer the
 *   attempt got. Trying again is a new attempt, with a new key;
 * - any other `CANCELLED` or `EXPIRED`: 409 `ORDER_CANCELLED`, the answer a
 *   free order whose settlement refused got.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} existing The order, with `ORDER_INCLUDE`.
 * @param {object} log The request logger.
 * @returns {Promise<{data: object}>} The sold order, for a 201.
 * @throws {Error} 409 `ORDER_PENDING`, 402 `PAYMENT_DECLINED` or 409 `ORDER_CANCELLED`.
 */
async function replayCheckout(prisma, existing, log) {
  log.info(
    { orderId: existing.id, reference: existing.reference, status: existing.status },
    'checkout replayed; answering with the original order',
  )

  if (SOLD_STATUSES.has(existing.status)) return { data: toOrder(existing) }

  if (existing.status === 'PENDING') {
    throw httpError(
      409,
      'ORDER_PENDING',
      `This attempt already placed order ${existing.reference}, and whether its payment went through is still being checked. Nothing more has been charged; please do not pay again. The order's page shows where it stands.`,
      { orderReference: existing.reference },
    )
  }

  const declined = await prisma.payment.findFirst({
    where: { orderId: existing.id, status: 'FAILED' },
    select: { id: true },
  })

  if (declined) throw paymentDeclined()

  throw orderCancelled()
}

/**
 * The answer to a declined card: nothing was taken, the order is cancelled,
 * and the holds stay with the buyer for another attempt.
 *
 * @returns {Error} A 402 `PAYMENT_DECLINED`.
 */
function paymentDeclined() {
  return httpError(
    402,
    'PAYMENT_DECLINED',
    'The payment was declined, and nothing was charged. Your reservation is kept, so you can try again.',
  )
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
 * @param {{max?: number, timeWindow?: string|number}} [deps.passLimit] Overrides for the pass rate limit, which the group pass shares; supplied by tests.
 * @param {{max?: number, timeWindow?: string|number}} [deps.quoteLimit] Overrides for the checkout-quote rate limit, and for the promo-attempt limit on a checkout that names a code; supplied by tests.
 * @returns {void} Nothing.
 */
export function registerOrderRoutes(app, { prisma, providers, env, passLimit, quoteLimit }) {
  defineRoute(app, 'orders.create', {
    // Counted only when the body names a promo code: see promoAttemptRateLimit.
    config: { rateLimit: promoAttemptRateLimit(quoteLimit) },
    handler: async (request) => {
      const body = request.body
      const now = new Date()
      // An idempotency key lets a retried checkout resolve to the original
      // order instead of creating and charging a second one.
      const idempotencyKey = request.headers['idempotency-key'] ?? null

      // A retry carrying the same key must not produce a second charge. The
      // unique index on Order.idempotencyKey is the real guarantee; this read
      // answers the common case, and the index's refusal below answers two
      // requests that both got past it. Either way the retry is answered with
      // the attempt's own outcome (`replayCheckout`).
      if (idempotencyKey) {
        const existing = await prisma.order.findUnique({
          where: { idempotencyKey },
          include: ORDER_INCLUDE,
        })

        if (existing) return replayCheckout(prisma, existing, request.log)
      }

      const begun = await prisma
        .$transaction(async (tx) => {
          // Everything the quote computes, computed the same way, under the
          // checkout locks: tiers, then nights, then the promo code.
          const priced = await priceCheckout(tx, {
            body,
            actor: request.actor,
            guestToken: request.headers['x-hold-token'] ?? null,
            now,
            env,
            lock: true,
          })
          const {
            event,
            currency,
            holdsByType,
            seatedTiers,
            seatsByLineKey,
            taxPolicy,
            promoCode,
            promoApplied,
            totals,
            attendees,
          } = priced

          // A precondition, never a price. The buyer was shown a figure; if the
          // server's figure is different now — a code used up meanwhile, a tax
          // change — refuse before anything is written, rather than charging an
          // amount nobody agreed to.
          if (
            body.expectedTotalCents !== undefined &&
            body.expectedTotalCents !== totals.totalCents
          ) {
            throw httpError(
              409,
              'PRICE_CHANGED',
              'The total changed since it was shown. Nothing has been charged.',
              { totalCents: totals.totalCents, discountCents: totals.discountCents },
            )
          }

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
              // The night, when every line is for the same one.
              eventSessionId: priced.eventSessionId,
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
                  // Staged until settlement puts them on the tickets. A
                  // general-admission tier is one line; a seated tier's names
                  // travel with its seats instead, on the hold items.
                  attendeeNames: attendees.gaNamesByTicketType.get(line.ticketTypeId) ?? [],
                },
              }),
            )
          }

          // Attach the buyer's holds to the order so the settlement step can
          // convert them, and reserve anything not already held. Inventory has
          // to stay reserved for the whole time the provider is being called:
          // without this an unheld line would be free for somebody else to buy
          // while this buyer's card is authorising.
          const seatedTypes = seatedTiers

          for (const item of body.items) {
            const held = (holdsByType.get(item.ticketTypeId) ?? []).reduce(
              (sum, hold) => sum + hold.quantity,
              0,
            )

            for (const hold of holdsByType.get(item.ticketTypeId) ?? []) {
              // Conditional on what was read under the hold's row lock: still
              // active, and still with the order it had (none, or one whose card
              // was declined). Anything else means the hold moved on, and the
              // order is refused before it is charged.
              const { count } = await tx.ticketHold.updateMany({
                where: { id: hold.id, status: 'ACTIVE', orderId: hold.orderId ?? null },
                data: { orderId: created.id },
              })

              if (count !== 1) {
                throw conflict(
                  `Hold ${hold.id} changed while this order was being placed. Nothing has been charged.`,
                  { holdId: hold.id },
                )
              }
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
          await stampHoldItems(tx, {
            seatsByLineKey,
            orderItems,
            namesByEventSeatId: attendees.namesByEventSeatId,
          })

          if (promoApplied) {
            // Under the promo row lock `priceCheckout` took, after re-reading the
            // row, so the count this increments is the one the discount was
            // judged against. `increment` all the same, and the table's CHECK
            // refuses a count past the cap whatever happens here.
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
        .catch(async (error) => {
          // Two requests with one key that both missed the read above — a
          // double submission — meet here: the second's order collides with
          // the first's on the key's unique index. That is a retry, and it is
          // answered as one rather than as a 500.
          if (!idempotencyKey || databaseErrorCode(error) !== 'P2002') throw error

          const existing = await prisma.order.findUnique({
            where: { idempotencyKey },
            include: ORDER_INCLUDE,
          })

          if (!existing) throw error

          return { replayed: await replayCheckout(prisma, existing, request.log) }
        })

      if (begun.replayed) return begun.replayed

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
      const common = {
        order: begun.order,
        payment: begun.payment,
        now,
        actorId: request.actor?.id ?? null,
        requestId: request.id,
      }

      let order

      try {
        order = await prisma.$transaction(async (tx) => {
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
      } catch (error) {
        if (result.outcome !== CAPTURE_OUTCOMES.SUCCEEDED) throw error

        // The money has moved (or, for a zero total, nothing had to) and the
        // settlement refused. Its transaction rolled back, so the order is
        // still PENDING; a fresh one records the capture and opens a task, or
        // cancels a free order, rather than leaving an attempt nothing reads.
        await prisma.$transaction(
          (tx) =>
            recordUnsettledCapture(tx, {
              ...common,
              result,
              reason: typeof error?.code === 'string' ? error.code : (error?.name ?? 'Error'),
            }),
          SETTLEMENT_TRANSACTION_OPTIONS,
        )

        // A free order moved no money, and it has been cancelled: a precise
        // refusal, not a fault — the buyer reserves again.
        if (!begun.payment) {
          request.log.warn(
            {
              orderId: begun.order.id,
              reference: begun.order.reference,
              reason: typeof error?.code === 'string' ? error.code : (error?.name ?? 'Error'),
            },
            'free order could not be completed; cancelled',
          )
          throw orderCancelled()
        }

        request.log.error(
          {
            orderId: begun.order.id,
            reference: begun.order.reference,
            paymentId: begun.payment.id,
            reason: typeof error?.code === 'string' ? error.code : (error?.name ?? 'Error'),
          },
          'payment captured but the order could not be completed; left for reconciliation',
        )
        throw exposedServerError(
          500,
          'ORDER_NOT_COMPLETED',
          'Your payment was taken, but the order could not be completed. It has been passed to our team to settle or refund; please do not pay again.',
          { orderReference: begun.order.reference },
        )
      }

      if (result.outcome === CAPTURE_OUTCOMES.TIMEOUT) {
        request.log.error(
          { orderId: order.id, reference: order.reference, paymentId: begun.payment.id },
          'payment capture timed out; order left pending for reconciliation',
        )
        throw exposedServerError(
          502,
          'PAYMENT_TIMEOUT',
          'The payment provider did not respond in time, so whether you were charged is being checked. Your order keeps its tickets reserved until that is settled; please do not pay again.',
          { orderReference: order.reference },
        )
      }

      if (result.outcome === CAPTURE_OUTCOMES.DECLINED) throw paymentDeclined()

      request.log.info(
        { orderId: order.id, reference: order.reference, totalCents: order.totalCents },
        'order paid',
      )

      // The buyer placed it, so they get the joining link of a paid online
      // event here, as they would reading it back.
      return { data: toOrder(order, { joinUrl: true }) }
    },
  })

  defineRoute(app, 'orders.quote', {
    config: { rateLimit: quoteRateLimit(quoteLimit) },
    handler: async (request) => {
      const now = new Date()

      // The charge's own function, with no locks and nothing written: the
      // transaction is only so every read sees one snapshot.
      const priced = await prisma.$transaction((tx) =>
        priceCheckout(tx, {
          body: request.body,
          actor: request.actor,
          guestToken: null,
          now,
          env,
          lock: false,
          unknownPromoIsError: false,
        }),
      )

      return { data: toOrderQuote(priced, now) }
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
      //
      // Whether there is a group pass is the account holder's to know, so the
      // summary is null for everybody else — including somebody signed in at
      // the buyer's address on another account. It carries no secret.
      // Whether the pass was taken out decides how few tickets keep it
      // showing, so it is asked only for the account that bought the order.
      const buyerAccount = Boolean(order.userId) && order.userId === request.actor?.id
      const issued = buyerAccount ? await groupPassIssued(prisma, order.id) : false

      return {
        data: {
          // The joining link and the address are the buyer's alone.
          ...toOrder(order, { buyerAddress: buyer, joinUrl: buyer }),
          groupPass: groupPassSummary(order, { viewerUserId: request.actor?.id, issued }),
          // What changed about the event since this order was placed and
          // touches it, as recorded with each change (SPEC2-XI X-14).
          eventChanges: await changesForOrder(prisma, order),
        },
      }
    },
  })

  // The group pass: holder-only, derived, `no-store`. The reasoning is in
  // ../lib/group-passes.js; nothing here logs the payload.
  defineRoute(app, 'orders.groupPass', {
    config: { rateLimit: passRateLimit(passLimit) },
    handler: async (request, reply) => {
      const data = await retrieveGroupPass({
        prisma,
        env,
        actor: request.actor,
        reference: request.params.reference,
        requestId: request.id,
        log: request.log,
      })

      reply.header('cache-control', 'no-store, private')
      reply.header('pragma', 'no-cache')

      return { data }
    },
  })

  defineRoute(app, 'orders.rotateGroupPass', {
    config: { rateLimit: passRateLimit(passLimit) },
    handler: async (request, reply) => {
      const data = await rotateGroupPass({
        prisma,
        env,
        actor: request.actor,
        reference: request.params.reference,
        requestId: request.id,
      })

      reply.header('cache-control', 'no-store, private')
      reply.header('pragma', 'no-cache')

      return { data }
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
        // A wrapper, not `orders.map(toOrder)`: map would hand the presenter the
        // array index as its options argument, which worked only because a
        // number destructures to the defaults.
        data: orders.map((order) => toOrder(order)),
        pagination: buildPaginationMeta({
          page: request.query.page,
          perPage: request.query.perPage,
          total,
        }),
      }
    },
  })
}
