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
 * ## Booking fees, referral codes and paying at the venue (SPEC3 §4.7)
 *
 * Every order records the booking fee its terms came to (`feeGrossCents`) and
 * what a referral code waived (CHECK `order_fee_parts`), so the orders here
 * do too. Three more builders:
 *
 *   - {@link referralCodeFixture}: a referral code whose text is generated at
 *     run time from the generated codes' alphabet — never a literal in the
 *     repository — for the stub or a real database alike;
 *   - {@link waivedOrder}: a card order whose booking fee a referral code
 *     waived, settled through `settleCheckout` like any card order;
 *   - {@link atVenueOrder}: a PAID pay-at-the-venue order, written exactly as
 *     settlement leaves one (SPEC3 §6.1, §9.2, §10.1): priced by
 *     `computeOrderTotals` with `paymentMethod: 'AT_VENUE'`, each line's door
 *     price split across its tickets with `splitAcrossTickets` (the first
 *     tickets taking the extra cent), the online part — the booking fee and any
 *     tax on it, or nothing — captured by the in-memory provider and posted as
 *     a fee-only ledger batch with no organiser share, the tiers' sold counts
 *     moved, and the referral code's use taken. The door's suites build their
 *     orders with it rather than through checkout.
 *
 * @module @desi-event/api/tests/helpers/fee-orders
 */

import { randomInt } from 'node:crypto'

import { orderPaidBatch } from '@desi-event/ledger'
import { computeOrderTotals, splitAcrossTickets } from '@desi-event/pricing'
import { REFERRAL_ALPHABET } from '@desi-event/schemas/payment-terms'

import { AUDIT_ACTIONS, recordAudit } from '../../src/lib/audit.js'
import { settleCheckout } from '../../src/lib/checkout.js'
import { feeConfigFor } from '../../src/lib/checkout-pricing.js'
import { postBatch } from '../../src/lib/ledger.js'
import { consumeReferralUse } from '../../src/lib/referral-uses.js'
import { issueTicketCredential } from '../../src/lib/ticket-credentials.js'
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
 * @param {'CARD'|'AT_VENUE'} [options.paymentMethod] How the ticket price is paid; CARD unless told.
 * @param {boolean} [options.feeWaived] Whether a referral code removes the whole booking fee.
 * @param {{percentageBps: number, flatCents: number, currency: string}} [options.feeConfig] The event's own terms; the site default for USD unless given.
 * @param {number} [options.taxRateBps] The tax rate; {@link FEE_ORDER_TAX_RATE_BPS} unless given.
 * @returns {object} What `computeOrderTotals` returns.
 */
export function priceFeeOrder({
  items,
  promoCode = null,
  now = new Date(),
  paymentMethod = 'CARD',
  feeWaived = false,
  feeConfig = feeOrderFeeConfig(),
  taxRateBps = FEE_ORDER_TAX_RATE_BPS,
}) {
  return computeOrderTotals({
    items,
    promoCode,
    feeConfig,
    taxRateBps,
    currency: FEE_ORDER_CURRENCY,
    now,
    paymentMethod,
    feeWaived,
  })
}

/**
 * The booking-fee columns an order records (SPEC3 §5.2): the terms used, the
 * gross fee, what a referral code waived and the code, and how it is paid.
 *
 * @param {object} totals What `computeOrderTotals` returned.
 * @param {object} options Options.
 * @param {{percentageBps: number, flatCents: number}} options.feeConfig The terms it was priced with.
 * @param {'SITE_DEFAULT'|'EVENT'} [options.feeSource] Whose terms they were.
 * @param {string|null} [options.feeSettingId] The event's fee decision, for EVENT terms.
 * @param {string|null} [options.referralCodeId] The code that waived the fee.
 * @param {'CARD'|'AT_VENUE'} [options.paymentMethod] How the ticket price is paid.
 * @returns {object} Order columns.
 */
export function orderFeeColumns(
  totals,
  {
    feeConfig,
    feeSource = 'SITE_DEFAULT',
    feeSettingId = null,
    referralCodeId = null,
    paymentMethod = 'CARD',
  },
) {
  return {
    paymentMethod,
    feeSource,
    feeSettingId,
    feePercentageBps: feeConfig.percentageBps,
    feeFlatCentsPerTicket: feeConfig.flatCents,
    feeGrossCents: totals.feeGrossCents,
    feeWaivedCents: totals.feeWaivedCents,
    referralCodeId: totals.feeWaivedCents > 0 ? referralCodeId : null,
    venueDueCents: totals.venueDueCents,
  }
}

/**
 * A referral code's text, generated at run time as `generateReferralCode`
 * makes one: two groups of five from the alphabet without 0, O, 1, I or L.
 * Never written in the repository.
 *
 * @returns {string} The text.
 */
export function generatedReferralText() {
  const group = () =>
    Array.from({ length: 5 }, () => REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)]).join('')

  return `${group()}-${group()}`
}

/**
 * A referral code, written through whichever client is given (the stub or a
 * real database), with its scope rows.
 *
 * @param {object} db A Prisma client, a transaction client or the stub.
 * @param {object} options Options.
 * @param {string|null} options.createdById The administrator who made it.
 * @param {'ALL_EVENTS'|'SELECTED_EVENTS'} [options.scope] Its scope.
 * @param {string[]} [options.eventIds] The events of a SELECTED_EVENTS code.
 * @param {number|null} [options.maxUses] Its total limit.
 * @param {number} [options.useCount] Uses already taken.
 * @param {Date|null} [options.expiresAt] When it stops working.
 * @param {string|null} [options.label] Its label.
 * @param {boolean} [options.active] Whether it is on.
 * @returns {Promise<{row: object, referralCode: string}>} The row and its text.
 */
export async function referralCodeFixture(
  db,
  {
    createdById,
    scope = 'ALL_EVENTS',
    eventIds = [],
    maxUses = null,
    useCount = 0,
    expiresAt = null,
    label = null,
    active = true,
  },
) {
  const referralCode = generatedReferralText()
  const row = await db.referralCode.create({
    data: {
      code: referralCode,
      label,
      scope,
      expiresAt,
      maxUses,
      useCount,
      active,
      switchedOffAt: active ? null : new Date(),
      createdById,
      updatedById: createdById,
    },
  })

  for (const eventId of scope === 'SELECTED_EVENTS' ? eventIds : []) {
    await db.referralCodeEvent.create({ data: { referralCodeId: row.id, eventId } })
  }

  return { row, referralCode }
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
 * @param {object|null} [options.referralCode] A referral code row whose waiver the order takes (its use counted).
 * @returns {Promise<{order: object, payment: object|null, totals: object, tickets: Array<object>}>} The paid order with its items, its payment, its pricing and its tickets.
 */
export async function createFeeOrder(
  prisma,
  world,
  {
    tag,
    payments,
    credentialSecret,
    withPromo = true,
    userId = null,
    lines = null,
    referralCode = null,
  },
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
  const feeConfig = feeOrderFeeConfig()
  const totals = priceFeeOrder({
    items,
    promoCode,
    now,
    feeConfig,
    feeWaived: Boolean(referralCode),
  })

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
        ...orderFeeColumns(totals, { feeConfig, referralCodeId: referralCode?.id ?? null }),
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

    // The code's use is taken when the order is placed, as checkout takes it.
    if (referralCode && totals.feeWaivedCents > 0) {
      await consumeReferralUse(tx, { referralCodeId: referralCode.id })
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

/**
 * A paid card order whose whole booking fee a referral code waived, settled
 * through `settleCheckout` (SPEC3 §4.7): {@link createFeeOrder} with the code.
 *
 * @param {object} prisma A Prisma client on a migrated database.
 * @param {object} world From {@link createFeeEvent}.
 * @param {object} options As {@link createFeeOrder}, with `referralCode` required.
 * @returns {Promise<{order: object, payment: object|null, totals: object, tickets: Array<object>}>} The paid order.
 * @throws {TypeError} Without a referral code.
 */
export async function waivedOrder(prisma, world, options) {
  if (!options?.referralCode) throw new TypeError('waivedOrder needs a referral code row')

  return createFeeOrder(prisma, world, options)
}

/**
 * A PAID pay-at-the-venue order, written exactly as settlement leaves one
 * (SPEC3 §6.1, §9.2, §10.1). See the module's description.
 *
 * @param {object} prisma A Prisma client on a migrated database.
 * @param {object} world From {@link createFeeEvent}.
 * @param {object} options Options.
 * @param {string} options.tag Unique to the caller's run.
 * @param {object} options.payments The in-memory payment provider.
 * @param {string} options.credentialSecret The secret passes are derived from.
 * @param {boolean} [options.withPromo] Whether the order uses the 50 % promo code.
 * @param {string|null} [options.userId] The buyer's account; AT_VENUE needs one at checkout, so pass one.
 * @param {Array<{ticketTypeId: string, quantity: number, unitPriceCents: number}>|null} [options.lines] Other lines than {@link FEE_ORDER_LINES}.
 * @param {object|null} [options.referralCode] A referral code row that waives the booking fee.
 * @param {{percentageBps: number, flatCents: number, currency: string}} [options.feeConfig] The event's own terms; the USD site default unless given.
 * @param {'SITE_DEFAULT'|'EVENT'} [options.feeSource] Whose terms `feeConfig` is.
 * @param {string|null} [options.feeSettingId] The event's fee decision, for EVENT terms.
 * @param {number} [options.taxRateBps] The place's rate (none of it is charged by default).
 * @param {boolean} [options.atVenueTaxesBookingFee] Whether the online fee carries tax (open question 9).
 * @returns {Promise<{order: object, payment: object|null, totals: object, tickets: Array<object>}>} The paid order with its items, its payment, its pricing and its tickets in issue order.
 */
export async function atVenueOrder(
  prisma,
  world,
  {
    tag,
    payments,
    credentialSecret,
    withPromo = false,
    userId = null,
    lines = null,
    referralCode = null,
    feeConfig = feeOrderFeeConfig(),
    feeSource = 'SITE_DEFAULT',
    feeSettingId = null,
    taxRateBps = FEE_ORDER_TAX_RATE_BPS,
    atVenueTaxesBookingFee = false,
  },
) {
  sequence += 1

  const now = new Date()
  const suffix = `V${tag}${sequence.toString(36)}`.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const promoCode = withPromo ? world.promoCode : null
  const items =
    lines ??
    FEE_ORDER_LINES.map((line) => ({
      ticketTypeId: world.tiers[line.key].id,
      quantity: line.quantity,
      unitPriceCents: line.priceCents,
    }))
  const totals = computeOrderTotals({
    items,
    promoCode,
    feeConfig,
    taxRateBps,
    currency: FEE_ORDER_CURRENCY,
    now,
    paymentMethod: 'AT_VENUE',
    feeWaived: Boolean(referralCode),
    atVenueTaxesBookingFee,
  })

  if (totals.venueDueCents <= 0) {
    throw new TypeError('A pay-at-the-venue order needs a ticket price above 0 after the promo')
  }

  // The online part — the booking fee and any tax on it — is captured like a
  // card order's total; nothing online means no payment at all.
  const intent =
    totals.totalCents > 0
      ? payments.createIntent({ amountCents: totals.totalCents, currency: FEE_ORDER_CURRENCY })
      : null

  if (intent) payments.capture(intent.id)

  let codes = 0
  /** @type {string[]} */
  const issued = []

  const { order, payment } = await prisma.$transaction(
    async (tx) => {
      const created = await tx.order.create({
        data: {
          reference: `DE-FEE${suffix}`.slice(0, 32),
          eventId: world.event.id,
          eventSessionId: world.session.id,
          userId,
          buyerEmail: `buyer-${suffix.toLowerCase()}@fee-orders.example`,
          buyerName: 'Venue Buyer',
          status: 'PAID',
          paidAt: now,
          currency: FEE_ORDER_CURRENCY,
          subtotalCents: totals.subtotalCents,
          discountCents: totals.discountCents,
          feesCents: totals.feesCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          promoCodeId: promoCode && totals.discountCents > 0 ? promoCode.id : null,
          ...orderFeeColumns(totals, {
            feeConfig,
            feeSource,
            feeSettingId,
            referralCodeId: referralCode?.id ?? null,
            paymentMethod: 'AT_VENUE',
          }),
        },
      })

      if (referralCode && totals.feeWaivedCents > 0) {
        await consumeReferralUse(tx, { referralCodeId: referralCode.id })
      }

      // Lines in input order and tickets in issue order: each line's door
      // price split across its tickets, the first tickets taking the extra
      // cent, so the tickets sum to the line and the lines to the order.
      for (const line of totals.lineItems) {
        const item = await tx.orderItem.create({
          data: {
            orderId: created.id,
            ticketTypeId: line.ticketTypeId,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            subtotalCents: line.subtotalCents,
            venueDueCents: line.venueDueCents,
          },
        })

        for (const share of splitAcrossTickets(line.venueDueCents, line.quantity)) {
          codes += 1

          const ticket = await tx.ticket.create({
            data: {
              orderItemId: item.id,
              code: `DET-FEE${suffix}${codes}`,
              attendeeName: 'Venue Buyer',
              ownerUserId: userId,
              status: 'VALID',
              venueDueCents: share,
            },
          })
          const { credentialHash } = issueTicketCredential({
            secret: credentialSecret,
            ticketId: ticket.id,
            version: ticket.credentialVersion ?? 1,
          })

          await tx.ticket.update({
            where: { id: ticket.id },
            data: { credentialHash, credentialIssuedAt: now },
          })
          issued.push(ticket.id)
        }
      }

      for (const line of [...totals.lineItems].sort((left, right) =>
        left.ticketTypeId < right.ticketTypeId ? -1 : 1,
      )) {
        await tx.ticketType.update({
          where: { id: line.ticketTypeId },
          data: { quantitySold: { increment: line.quantity } },
        })
      }

      const paid = intent
        ? await tx.payment.create({
            data: {
              orderId: created.id,
              provider: payments.name,
              providerRef: intent.id,
              status: 'SUCCEEDED',
              amountCents: totals.totalCents,
              currency: FEE_ORDER_CURRENCY,
              settledAt: now,
            },
          })
        : null

      // The fee-only batch (SPEC3 §10.1): the online part is Desi-Event's fee
      // and any tax on it, so no organiser share and no discount is posted —
      // the promo lowered the door price, which is not platform money.
      if (totals.totalCents > 0) {
        await postBatch(
          tx,
          orderPaidBatch({
            capturedCents: totals.totalCents,
            organizerNetCents: 0,
            platformFeeCents: totals.feesCents,
            taxCents: totals.taxCents,
            discountCents: 0,
            currency: FEE_ORDER_CURRENCY,
            organizationId: world.event.organizationId,
            reference: created.reference,
          }),
          {
            sourceType: 'ORDER',
            sourceId: created.id,
            reference: `LB-${created.reference}`,
            orderId: created.id,
            paymentId: paid?.id ?? null,
            actorId: null,
            now,
          },
        )
      }

      await recordAudit(tx, {
        action: AUDIT_ACTIONS.ORDER_PAID,
        entityType: 'Order',
        entityId: created.id,
        actorId: null,
        metadata: {
          at: now.toISOString(),
          previousStatus: 'PENDING',
          newStatus: 'PAID',
          paymentId: paid?.id ?? null,
          totalCents: totals.totalCents,
          currency: FEE_ORDER_CURRENCY,
          paymentMethod: 'AT_VENUE',
          feeSource,
          feeGrossCents: totals.feeGrossCents,
          feeWaivedCents: totals.feeWaivedCents,
          referralCodeId: totals.feeWaivedCents > 0 ? (referralCode?.id ?? null) : null,
          venueDueCents: totals.venueDueCents,
        },
      })

      return { order: created, payment: paid }
    },
    { timeout: 30_000, maxWait: 10_000 },
  )

  const paid = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true } })
  const rows = await prisma.ticket.findMany({ where: { id: { in: issued } } })
  const tickets = issued.map((id) => rows.find((row) => row.id === id))

  return { order: paid, payment, totals, tickets }
}
