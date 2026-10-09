/**
 * How booking fees, referral codes and paying at the venue reach the existing
 * payloads and bodies (SPEC3 §11.2–§11.3), and the shapes of the new routes'
 * answers. Every field added to an existing payload is optional, so a payload
 * built before the handlers fill it still parses.
 */

import { describe, expect, it } from 'vitest'

import { orderSchema, refundSchema, ticketSchema } from './entities.js'
import {
  atVenueFactsSchema,
  eventDeletionPreviewSchema,
  platformEventRowSchema,
  sessionCancellationPreviewSchema,
} from './event-control.js'
import {
  checkInRequestSchema,
  createOrderRequestSchema,
  groupCheckInRequestSchema,
  quoteOrderRequestSchema,
} from './requests.js'
import {
  PAYMENT_TERMS_HISTORY_PAGE,
  errorResponseSchema,
  adminReferralCodeSchema,
  admissionPreviewResponseSchema,
  checkInResponseSchema,
  groupPassResponseSchema,
  orderQuoteResponseSchema,
  paymentTermsAdminResponseSchema,
  platformFeePreviewSchema,
  platformFeeRefundResponseSchema,
  referralAdministratorRowSchema,
  referralCodeDetailResponseSchema,
  referralUseSchema,
  ticketPassResponseSchema,
  venuePaymentsReportResponseSchema,
} from './responses.js'

/** A cuid-shaped id, distinct per seed. */
const id = (seed) => `c${String(seed).padStart(24, '0')}`

const NOW = '2026-10-08T10:00:00.000Z'

describe('orders.quote and orders.create bodies', () => {
  const quote = { eventId: id(1), items: [{ ticketTypeId: id(2), quantity: 2 }] }

  it('take a payment method and a referral code, and default to neither', () => {
    expect(quoteOrderRequestSchema.parse(quote)).not.toHaveProperty('paymentMethod')
    expect(
      quoteOrderRequestSchema.parse({
        ...quote,
        paymentMethod: 'AT_VENUE',
        referralCode: ' garba-2026 ',
      }),
    ).toMatchObject({ paymentMethod: 'AT_VENUE', referralCode: 'garba-2026' })
    expect(quoteOrderRequestSchema.safeParse({ ...quote, paymentMethod: 'CASH' }).success).toBe(
      false,
    )
  })

  it('give a malformed referral code no 400 of its own, but refuse a control character', () => {
    expect(quoteOrderRequestSchema.safeParse({ ...quote, referralCode: '!!' }).success).toBe(true)
    expect(quoteOrderRequestSchema.safeParse({ ...quote, referralCode: 'A\u0000B' }).success).toBe(
      false,
    )
    expect(
      quoteOrderRequestSchema.safeParse({ ...quote, referralCode: 'x'.repeat(65) }).success,
    ).toBe(false)
  })

  it('let an order carry the amount it was shown for the door, as a precondition', () => {
    const order = {
      ...quote,
      buyerEmail: 'buyer@example.com',
      buyerName: 'A Buyer',
      paymentMethod: 'AT_VENUE',
      expectedVenueDueCents: 5000,
      referralCode: 'GARBA-2026',
    }

    expect(createOrderRequestSchema.parse(order)).toMatchObject({
      paymentMethod: 'AT_VENUE',
      expectedVenueDueCents: 5000,
      referralCode: 'GARBA-2026',
    })
    expect(
      createOrderRequestSchema.safeParse({ ...order, expectedVenueDueCents: -1 }).success,
    ).toBe(false)
  })
})

describe('the door bodies', () => {
  const base = { code: 'DE-ABCD-EFGH', previewReference: 'p'.repeat(40) }

  it('let a confirmation carry the payment taken at the door, strictly', () => {
    const parsed = checkInRequestSchema.safeParse({ ...base, payment: { amountCents: 2500 } })

    if (parsed.success) {
      expect(parsed.data.payment).toEqual({ amountCents: 2500 })
    }

    expect(checkInRequestSchema.safeParse({ ...base, payment: { amountCents: 0 } }).success).toBe(
      false,
    )
    expect(
      checkInRequestSchema.safeParse({ ...base, payment: { amountCents: 2500, method: 'CASH' } })
        .success,
    ).toBe(false)
  })

  it('let a group confirmation carry one positive amount for the named tickets', () => {
    const group = {
      code: 'DEG-ABCDEFGHJKMN',
      previewReference: 'p'.repeat(40),
      ticketIds: [id(1)],
    }
    const withPayment = groupCheckInRequestSchema.safeParse({ ...group, paymentCents: 5000 })
    const without = groupCheckInRequestSchema.safeParse(group)

    expect(withPayment.success).toBe(without.success)
    expect(groupCheckInRequestSchema.safeParse({ ...group, paymentCents: 0 }).success).toBe(false)
  })
})

describe('the quote answer', () => {
  const quote = {
    currency: 'USD',
    subtotalCents: 5000,
    discountCents: 0,
    feesCents: 0,
    taxCents: 0,
    totalCents: 0,
    lines: [
      {
        ticketTypeId: id(1),
        name: 'General',
        sessionId: null,
        quantity: 2,
        unitPriceCents: 2500,
        subtotalCents: 5000,
        discountCents: 0,
      },
    ],
    promo: null,
    pricedAt: NOW,
  }

  it('still parses an answer built before booking fees were per event', () => {
    expect(orderQuoteResponseSchema.safeParse({ data: quote }).success).toBe(true)
  })

  it('carries the method, the fee before and after a referral code, and the door amount', () => {
    const parsed = orderQuoteResponseSchema.parse({
      data: {
        ...quote,
        paymentMethod: 'AT_VENUE',
        feeGrossCents: 548,
        feeWaivedCents: 548,
        venueDueCents: 5000,
        fee: { percentageBps: 300, flatCentsPerTicket: 199 },
        tax: { applied: false, appliedTo: 'NOTHING', notAppliedReason: 'PAID_AT_VENUE' },
        referral: { applied: true, reason: null },
        venuePayment: { available: true },
        lines: [{ ...quote.lines[0], venueDueCents: 5000 }],
      },
    })

    expect(parsed.data.lines[0].venueDueCents).toBe(5000)
    expect(parsed.data.fee).not.toHaveProperty('source')
  })

  it('never says where the fee came from, nor echoes the referral code', () => {
    const parsed = orderQuoteResponseSchema.parse({
      data: {
        ...quote,
        fee: { percentageBps: 300, flatCentsPerTicket: 199, source: 'EVENT' },
        referral: { applied: false, reason: 'NOT_ACCEPTED', referralCode: 'GARBA-2026' },
        referralCode: 'GARBA-2026',
      },
    })

    expect(parsed.data.fee).toEqual({ percentageBps: 300, flatCentsPerTicket: 199 })
    expect(JSON.stringify(parsed)).not.toContain('GARBA-2026')
  })
})

describe('orders, tickets and refunds', () => {
  const order = {
    id: id(1),
    reference: 'DE-ABCDEFGH',
    eventId: id(2),
    buyerName: 'A Buyer',
    subtotalCents: 5000,
    totalCents: 548,
  }

  it('carry an order’s payment method, fee parts and state at the door', () => {
    const parsed = orderSchema.parse({
      ...order,
      paymentMethod: 'AT_VENUE',
      feeGrossCents: 548,
      feeWaivedCents: 0,
      referralApplied: false,
      fee: { percentageBps: 300, flatCentsPerTicket: 199 },
      tax: { applied: false, appliedTo: 'NOTHING' },
      venuePayment: {
        dueCents: 5000,
        paidCents: 0,
        unpaidTickets: 2,
        unpaidCents: 5000,
        paidTickets: 0,
        state: 'TO_PAY',
      },
    })

    expect(parsed.venuePayment.state).toBe('TO_PAY')
    expect(orderSchema.safeParse({ ...order, fee: null, venuePayment: null }).success).toBe(true)
  })

  it('never carry the referral code’s id, nor the terms’ raw columns', () => {
    const parsed = orderSchema.parse({
      ...order,
      referralCodeId: id(9),
      feeSettingId: id(8),
      feePercentageBps: 300,
      feeFlatCentsPerTicket: 199,
      venueDueCents: 5000,
    })

    for (const key of [
      'referralCodeId',
      'feeSettingId',
      'feePercentageBps',
      'feeFlatCentsPerTicket',
      'venueDueCents',
    ]) {
      expect(parsed, key).not.toHaveProperty(key)
    }
  })

  it('carry what a ticket owes at the door, and never its payment’s id', () => {
    const ticket = { id: id(3), orderItemId: id(4), code: 'DE-ABCD-EFGH' }
    const parsed = ticketSchema.parse({
      ...ticket,
      venueDueCents: 2500,
      venuePaymentId: id(5),
      venuePayment: { dueCents: 2500, paid: false, currency: 'USD' },
    })

    expect(parsed.venuePayment).toEqual({ dueCents: 2500, paid: false, currency: 'USD' })
    expect(parsed).not.toHaveProperty('venuePaymentId')
    expect(parsed).not.toHaveProperty('venueDueCents')
    expect(ticketSchema.safeParse({ ...ticket, venuePayment: null }).success).toBe(true)
  })

  it('let the pass and the group pass say what is still owed at the door', () => {
    const pass = {
      ticketId: id(3),
      credential: 'x'.repeat(43),
      credentialVersion: 1,
      issuedAt: null,
    }

    expect(ticketPassResponseSchema.safeParse({ data: pass }).success).toBe(true)
    expect(
      ticketPassResponseSchema.safeParse({
        data: { ...pass, venuePayment: { dueCents: 2500, paid: false, currency: 'USD' } },
      }).success,
    ).toBe(true)

    const shape = groupPassResponseSchema.shape.data.shape

    expect(shape.unpaidCents.safeParse(5000).success).toBe(true)
    expect(shape.unpaidCents.safeParse(undefined).success).toBe(true)
    expect(shape.unpaidCents.safeParse(-1).success).toBe(false)
  })

  it('let a refund say how its order was paid and what was taken at the door', () => {
    const shape = refundSchema.shape

    expect(shape.paymentMethod.safeParse('AT_VENUE').success).toBe(true)
    expect(shape.paymentMethod.safeParse(undefined).success).toBe(true)
    expect(shape.paidAtDoorCents.safeParse(2500).success).toBe(true)
  })
})

describe('the door answers', () => {
  it('let a preview and a confirmation carry the payment, and leave it out before', () => {
    const preview = admissionPreviewResponseSchema.shape.data.shape.payment

    expect(preview.safeParse(undefined).success).toBe(true)
    expect(preview.safeParse(null).success).toBe(true)
    expect(
      preview.safeParse({
        dueCents: 2500,
        currency: 'USD',
        paid: false,
        booking: { otherUnpaidTickets: 0, otherUnpaidCents: 0 },
      }).success,
    ).toBe(true)

    const result = checkInResponseSchema.shape.data.shape.payment

    expect(
      result.safeParse({ recordedCents: 2500, venuePaymentId: id(1), byThisRequest: true }).success,
    ).toBe(true)
    expect(result.safeParse({ recorded: true }).success).toBe(false)
  })
})

describe('event control', () => {
  it('lets the deletion and the night-cancellation previews count pay-at-the-venue bookings', () => {
    const facts = { orders: 2, ticketsPaidAtDoor: 1, paidAtDoorCents: 2500 }

    expect(atVenueFactsSchema.parse(facts)).toEqual(facts)
    expect(eventDeletionPreviewSchema.shape.atVenue.safeParse(facts).success).toBe(true)
    expect(eventDeletionPreviewSchema.shape.atVenue.safeParse(undefined).success).toBe(true)
    expect(sessionCancellationPreviewSchema.shape.atVenue.safeParse(facts).success).toBe(true)
    expect(atVenueFactsSchema.safeParse({ ...facts, orders: -1 }).success).toBe(false)
  })

  it('gives the administrators’ list the fee and switch columns', () => {
    const shape = platformEventRowSchema.shape

    expect(shape.feeSource.safeParse('EVENT').success).toBe(true)
    expect(shape.feePercentageBps.safeParse(null).success).toBe(true)
    expect(shape.feeFlatCentsPerTicket.safeParse(149).success).toBe(true)
    expect(shape.feeCurrency.safeParse('USD').success).toBe(true)
    expect(shape.venuePaymentEnabled.safeParse(true).success).toBe(true)
    expect(shape.venuePaymentLimit.safeParse(50).success).toBe(true)
    expect(shape.venuePaymentLimit.safeParse(0).success).toBe(false)
  })
})

describe('paymentTerms responses', () => {
  const view = {
    fee: {
      source: 'SITE_DEFAULT',
      percentageBps: 250,
      flatCentsPerTicket: 99,
      currency: 'USD',
      sequence: 0,
      changedAt: null,
      changedByName: null,
      reason: null,
    },
    siteDefault: { currency: 'USD', percentageBps: 250, flatCentsPerTicket: 99 },
    venuePayment: {
      enabled: false,
      limit: null,
      offered: false,
      changedAt: null,
      changedByName: null,
      reason: null,
      hasOrders: false,
      unpaidTickets: 0,
      paidAtDoorTickets: 0,
      paidAtDoorCents: 0,
    },
    eventId: id(1),
    eventStatus: 'ON_SALE',
    isOnline: false,
    soldOnSource: false,
    posted: true,
    historyHasMore: false,
  }

  it('lists fee decisions and switch changes in one history', () => {
    expect(
      paymentTermsAdminResponseSchema.safeParse({
        data: {
          ...view,
          history: [
            {
              kind: 'FEE',
              at: NOW,
              byName: 'Anil',
              reason: 'Partner rate agreed',
              source: 'EVENT',
              percentageBps: 300,
              flatCentsPerTicket: 149,
              currency: 'USD',
              sequence: 1,
            },
            {
              kind: 'VENUE_PAYMENT',
              at: NOW,
              byName: null,
              reason: 'Community event',
              enabled: true,
              limit: 50,
            },
          ],
        },
      }).success,
    ).toBe(true)
  })

  it('holds the history to one page and refuses an entry of another kind', () => {
    const entry = {
      kind: 'VENUE_PAYMENT',
      at: NOW,
      byName: null,
      reason: 'Community event',
      enabled: false,
      limit: null,
    }

    expect(
      paymentTermsAdminResponseSchema.safeParse({
        data: { ...view, history: Array(PAYMENT_TERMS_HISTORY_PAGE + 1).fill(entry) },
      }).success,
    ).toBe(false)
    expect(
      paymentTermsAdminResponseSchema.safeParse({
        data: { ...view, history: [{ ...entry, kind: 'REFERRAL' }] },
      }).success,
    ).toBe(false)
  })
})

describe('referral code responses', () => {
  const code = {
    id: id(1),
    referralCode: 'GARBA-2026',
    label: null,
    scope: 'SELECTED_EVENTS',
    events: [{ id: id(2), title: 'Garba Night', slug: 'garba-night', status: 'ON_SALE' }],
    eventCount: 1,
    expiresAt: null,
    maxUses: 100,
    useCount: 3,
    completedUses: 2,
    waived: [{ currency: 'USD', cents: 1096 }],
    status: 'ON',
    active: true,
    createdBy: { id: id(3), displayName: 'Anil' },
    createdAt: NOW,
    updatedAt: NOW,
  }

  it('names the text referralCode, and drops a field called code', () => {
    const parsed = adminReferralCodeSchema.parse({ ...code, code: 'GARBA-2026' })

    expect(parsed.referralCode).toBe('GARBA-2026')
    expect(parsed).not.toHaveProperty('code')
    expect(adminReferralCodeSchema.safeParse({ ...code, referralCode: 'garba' }).success).toBe(
      false,
    )
  })

  it('shows at most three of the code’s events, and a former administrator as null', () => {
    expect(
      adminReferralCodeSchema.safeParse({ ...code, events: Array(4).fill(code.events[0]) }).success,
    ).toBe(false)
    expect(adminReferralCodeSchema.safeParse({ ...code, createdBy: null }).success).toBe(true)
    expect(adminReferralCodeSchema.safeParse({ ...code, status: 'PAUSED' }).success).toBe(false)
  })

  it('lists a code’s uses without the buyer', () => {
    const use = {
      orderReference: 'DE-ABCDEFGH',
      eventId: id(2),
      eventTitle: 'Garba Night',
      placedAt: NOW,
      paymentMethod: 'CARD',
      orderStatus: 'PAID',
      feeWaivedCents: 548,
      currency: 'USD',
    }
    const parsed = referralUseSchema.parse({
      ...use,
      buyerName: 'A Buyer',
      buyerEmail: 'buyer@example.com',
      userId: id(9),
    })

    expect(Object.keys(parsed).sort()).toEqual(Object.keys(use).sort())
    expect(
      referralCodeDetailResponseSchema.safeParse({
        data: { ...code, uses: [use] },
        pagination: {
          page: 1,
          perPage: 50,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }).success,
    ).toBe(true)
  })

  it('sums a former administrator’s codes under null', () => {
    expect(
      referralAdministratorRowSchema.safeParse({
        administrator: null,
        codes: 2,
        uses: 5,
        completedUses: 4,
        waived: [],
      }).success,
    ).toBe(true)
  })
})

describe('booking fee refund responses', () => {
  const preview = {
    reference: 'DE-ABCDEFGH',
    eventId: id(1),
    eventTitle: 'Garba Night',
    status: 'PAID',
    paymentMethod: 'AT_VENUE',
    currency: 'CAD',
    feesCents: 335,
    feeWaivedCents: 0,
    feeRefundedCents: 0,
    refundableFeeCents: 379,
    taxOnFeeCents: 44,
    disputed: false,
  }

  it('previews an order’s fee figures without the buyer', () => {
    const parsed = platformFeePreviewSchema.parse({ ...preview, buyerName: 'A Buyer' })

    expect(parsed).not.toHaveProperty('buyerName')
  })

  it('answers a refund with the refund and the figures after it', () => {
    const shape = platformFeeRefundResponseSchema.shape.data.shape

    expect(shape.fee.safeParse(preview).success).toBe(true)
    expect(shape.refund).toBeDefined()
  })
})

describe('the organiser’s venue payments report', () => {
  it('lists payments and unpaid bookings with no address', () => {
    const report = {
      currency: 'USD',
      summary: {
        unpaidTickets: 1,
        unpaidCents: 2500,
        paidAtDoorTickets: 1,
        paidAtDoorCents: 2500,
        payments: 1,
        eventEnded: false,
        notPaidByEndTickets: 0,
        notPaidByEndCents: 0,
        paidOnRefundedCents: 0,
      },
      payments: [
        {
          id: id(1),
          recordedAt: NOW,
          nightLabel: null,
          recordedByName: 'Door Steward',
          orderReference: 'DE-ABCDEFGH',
          ticketCount: 1,
          amountCents: 2500,
          via: 'DOOR_TICKET',
          tickets: [{ ticketId: id(2), attendeeName: 'Guest One', amountCents: 2500 }],
        },
      ],
      unpaidOrders: [
        {
          orderReference: 'DE-ABCDEFGH',
          buyerName: 'A Buyer',
          unpaidTickets: 1,
          unpaidCents: 2500,
        },
      ],
      pagination: {
        page: 1,
        perPage: 50,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    }

    expect(venuePaymentsReportResponseSchema.safeParse({ data: report }).success).toBe(true)
    expect(
      venuePaymentsReportResponseSchema.safeParse({
        data: {
          ...report,
          unpaidOrders: [{ ...report.unpaidOrders[0], buyerName: 'buyer@example.com' }],
        },
      }).success,
    ).toBe(false)
    expect(
      venuePaymentsReportResponseSchema.safeParse({
        data: { ...report, payments: [{ ...report.payments[0], via: 'CASH' }] },
      }).success,
    ).toBe(false)
  })
})

describe('the error envelope carries the details SPEC3 refusals name, and no others', () => {
  /**
   * An error envelope with these details.
   *
   * @param {object} details The details.
   * @returns {object} The envelope.
   */
  const envelope = (details) => ({
    error: { code: 'PRICE_CHANGED', message: 'The total changed.', statusCode: 409, details },
  })

  it('takes the new figures of a moved price, the current sequence, a door payment and event ids', () => {
    for (const details of [
      { totalCents: 8578, venueDueCents: 8000, feesCents: 578 },
      { currentSequence: 3 },
      { dueCents: 4000, booking: { otherUnpaidTickets: 1, otherUnpaidCents: 4000 } },
      { eventIds: [id(1), id(2)] },
    ]) {
      expect(
        errorResponseSchema.safeParse(envelope(details)).success,
        JSON.stringify(details),
      ).toBe(true)
    }
  })

  it('refuses a key nobody named, a negative amount and an unknown key inside the booking', () => {
    for (const details of [
      { referralCode: 'WAIVE-12345' },
      { totalCents: -1 },
      { booking: { otherUnpaidTickets: 1, otherUnpaidCents: 4000, buyerName: 'A' } },
      { eventIds: Array.from({ length: 51 }, (_, index) => id(index + 1)) },
    ]) {
      expect(
        errorResponseSchema.safeParse(envelope(details)).success,
        JSON.stringify(details),
      ).toBe(false)
    }
  })
})
