/**
 * USD orders priced the way checkout prices them, for the refund suites.
 *
 * A refund path proven only on a fee-free order is not proven: every paid USD
 * order carries the 99¢ flat fee per ticket, and the defects this helper was
 * written for — fee and tax spread onto order lines past their CHECK, too few
 * tickets withdrawn on a discounted order — never show on an order whose total
 * is its face value. So these orders are priced by `computeOrderTotals` from
 * `@desi-event/pricing`, with the fee terms checkout uses for USD
 * (`feeConfigFor`), tax at an explicit 825 basis points (the US default is 0,
 * so it is passed), and a 50 % promo code:
 *
 *   2 × $50.00 Floor + 1 × $20.00 Balcony = $120.00
 *   less 50 %                             = $60.00 face value
 *   fee 5.9 % + 3 × 99¢                   = $6.51
 *   tax 8.25 % of $66.51                  = $5.49
 *   total                                 = $72.00
 *
 * The order is then paid through `settleCheckout`, the function the capture
 * path runs, so its tickets carry real credentials and its ORDER_PAID ledger
 * batch is posted — a refund against a hand-made order would be a refund
 * against a shape checkout never produces.
 *
 * Real PostgreSQL only. Every row carries the caller's tag.
 *
 * @module @desi-event/api/tests/helpers/fee-orders
 */

import { computeOrderTotals } from '@desi-event/pricing'

import { settleCheckout } from '../../src/lib/checkout.js'
import { feeConfigFor } from '../../src/lib/checkout-pricing.js'
import { testEnv } from './app.js'

/** The currency every fee order is in. */
export const FEE_ORDER_CURRENCY = 'USD'

/** Tax, in basis points, passed explicitly: the US default is 0. */
export const FEE_ORDER_TAX_RATE_BPS = 825

/** The promo code's discount, in basis points. */
export const FEE_ORDER_PROMO_BPS = 5000

/** The two tiers and how many of each an order buys. */
export const FEE_ORDER_LINES = Object.freeze([
  Object.freeze({ key: 'floor', name: 'Floor', priceCents: 5_000, quantity: 2 }),
  Object.freeze({ key: 'balcony', name: 'Balcony', priceCents: 2_000, quantity: 1 }),
])

/**
 * The fee terms checkout uses for a USD order, from the test environment.
 *
 * @returns {{percentageBps: number, flatCents: number, currency: string}} The fee configuration.
 */
export function feeOrderFeeConfig() {
  return feeConfigFor(testEnv(), FEE_ORDER_CURRENCY)
}

/**
 * Price a fee order exactly as checkout would.
 *
 * @param {object} options Options.
 * @param {Array<{ticketTypeId: string, quantity: number, unitPriceCents: number}>} options.items The lines.
 * @param {object|null} [options.promoCode] The promo code row, or null for none.
 * @param {Date} [options.now] The pricing instant.
 * @returns {object} What `computeOrderTotals` returns.
 */
export function priceFeeOrder({ items, promoCode = null, now = new Date() }) {
  return computeOrderTotals({
    items,
    promoCode,
    feeConfig: feeOrderFeeConfig(),
    taxRateBps: FEE_ORDER_TAX_RATE_BPS,
    currency: FEE_ORDER_CURRENCY,
    now,
  })
}

/**
 * An organisation, a US venue, an event on sale with one night, its two tiers
 * and a 50 % promo code.
 *
 * @param {object} prisma A Prisma client on a migrated database.
 * @param {object} options Options.
 * @param {string} options.tag Unique to the caller's run; folded into every slug and name.
 * @param {string} [options.status] The event's status.
 * @param {number} [options.startsInDays] How far away the event is.
 * @returns {Promise<object>} `{ organization, venue, event, session, tiers, promoCode }`.
 */
export async function createFeeEvent(prisma, { tag, status = 'ON_SALE', startsInDays = 30 }) {
  const startsAt = new Date(Date.now() + startsInDays * 24 * 60 * 60 * 1000)
  const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1000)

  const organization = await prisma.organization.create({
    data: {
      name: `Fee Orders ${tag}`,
      slug: `fee-orders-${tag}`,
      contactEmail: `finance-${tag}@fee-orders.example`,
      verified: true,
      verificationStatus: 'VERIFIED',
    },
  })

  const venue = await prisma.venue.create({
    data: {
      organizationId: organization.id,
      name: `Fee Hall ${tag}`,
      slug: `fee-hall-${tag}`,
      addressLine1: '1 Test Road',
      city: 'Houston',
      region: 'TX',
      postalCode: '77002',
      country: 'US',
      timezone: 'America/Chicago',
    },
  })

  const event = await prisma.event.create({
    data: {
      organizationId: organization.id,
      venueId: venue.id,
      title: `Fee Night ${tag}`,
      slug: `fee-night-${tag}`,
      category: 'MUSIC_CONCERT',
      summary: 'An event whose orders carry a fee, tax and a promo code.',
      description: 'Built by the fee-order helper for the refund suites.',
      status,
      startsAt,
      endsAt,
      timezone: 'America/Chicago',
      publishedAt: new Date(),
      salesOpenedAt: new Date(),
      policies: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours before.' },
    },
  })

  const session = await prisma.eventSession.create({
    data: {
      eventId: event.id,
      startsAt,
      endsAt,
      timezone: 'America/Chicago',
      capacity: 500,
    },
  })

  const tiers = {}

  for (const line of FEE_ORDER_LINES) {
    tiers[line.key] = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        eventSessionId: session.id,
        name: `${line.name} ${tag}`,
        priceCents: line.priceCents,
        currency: FEE_ORDER_CURRENCY,
        quantityTotal: 200,
        maxPerOrder: 10,
        status: 'ON_SALE',
      },
    })
  }

  const promoCode = await prisma.promoCode.create({
    data: {
      organizationId: organization.id,
      eventId: event.id,
      code: `HALF${tag}`
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 32),
      type: 'PERCENTAGE',
      value: FEE_ORDER_PROMO_BPS,
    },
  })

  return { organization, venue, event, session, tiers, promoCode }
}

let sequence = 0

/**
 * A paid fee order against a fee event: priced, charged and settled.
 *
 * @param {object} prisma A Prisma client on a migrated database.
 * @param {object} world From {@link createFeeEvent}.
 * @param {object} options Options.
 * @param {string} options.tag Unique to the caller's run.
 * @param {object} options.payments The in-memory payment provider the refunds will go to.
 * @param {string} options.credentialSecret The secret passes are derived from.
 * @param {boolean} [options.withPromo] Whether the order uses the 50 % promo code.
 * @param {string|null} [options.userId] The buyer's account, when there is one.
 * @param {Array<{ticketTypeId: string, quantity: number, unitPriceCents: number}>|null} [options.lines] Other lines than {@link FEE_ORDER_LINES}, such as a free tier beside a paid one. An order that comes to nothing is settled with no payment, as checkout settles one.
 * @returns {Promise<{order: object, payment: object|null, totals: object, tickets: Array<object>}>} The paid order with its items, its payment, its pricing and its tickets.
 */
export async function createFeeOrder(
  prisma,
  world,
  { tag, payments, credentialSecret, withPromo = true, userId = null, lines = null },
) {
  sequence += 1

  const now = new Date()
  const suffix = `${tag}${sequence.toString(36)}`.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const promoCode = withPromo ? world.promoCode : null
  const items =
    lines ??
    FEE_ORDER_LINES.map((line) => ({
      ticketTypeId: world.tiers[line.key].id,
      quantity: line.quantity,
      unitPriceCents: line.priceCents,
    }))
  const totals = priceFeeOrder({ items, promoCode, now })

  // A real intent, captured, so a refund has something to be against. The
  // provider is the in-memory one: no network, no credentials, and its refund
  // ids are its own rather than manufactured here. A free order has none.
  const intent =
    totals.totalCents > 0
      ? payments.createIntent({ amountCents: totals.totalCents, currency: FEE_ORDER_CURRENCY })
      : null

  if (intent) payments.capture(intent.id)

  const { order, payment } = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        reference: `DE-FEE${suffix}`.slice(0, 32),
        eventId: world.event.id,
        eventSessionId: world.session.id,
        userId,
        buyerEmail: `buyer-${suffix.toLowerCase()}@fee-orders.example`,
        buyerName: 'Fee Buyer',
        status: 'PENDING',
        currency: FEE_ORDER_CURRENCY,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        feesCents: totals.feesCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        promoCodeId: promoCode && totals.discountCents > 0 ? promoCode.id : null,
      },
    })

    for (const line of totals.lineItems) {
      await tx.orderItem.create({
        data: {
          orderId: created.id,
          ticketTypeId: line.ticketTypeId,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          subtotalCents: line.subtotalCents,
        },
      })
    }

    const attempt = intent
      ? await tx.payment.create({
          data: {
            orderId: created.id,
            provider: payments.name,
            providerRef: intent.id,
            status: 'INITIATED',
            amountCents: totals.totalCents,
            currency: FEE_ORDER_CURRENCY,
          },
        })
      : null

    return { order: created, payment: attempt }
  })

  let codes = 0

  // Settlement bumps each tier's `quantitySold` under its row lock, so callers
  // that build orders ten at a time on the same tiers (case 28 builds 500)
  // queue behind one another inside this transaction. Under coverage on a busy
  // runner that wait alone passed Prisma's five-second default. The budget is
  // the fixture's own; the product's settlement transactions keep theirs.
  await prisma.$transaction(
    (tx) =>
      settleCheckout(tx, {
        order,
        payment,
        result: { outcome: 'SUCCEEDED', intent, rawStatus: 'SUCCEEDED' },
        now,
        generateTicketCode: () => {
          codes += 1

          return `DET-FEE${suffix}${codes}`
        },
        credentialSecret,
      }),
    { timeout: 30_000, maxWait: 10_000 },
  )

  const paid = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true } })
  const settledPayment = payment
    ? await prisma.payment.findUnique({ where: { id: payment.id } })
    : null
  const tickets = await prisma.ticket.findMany({
    where: { orderItemId: { in: paid.items.map((item) => item.id) } },
  })

  return { order: paid, payment: settledPayment, totals, tickets }
}
