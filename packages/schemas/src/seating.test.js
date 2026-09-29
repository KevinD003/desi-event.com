/**
 * The commerce shapes: the seat map a buyer picks from, the nights an event
 * lists, the quote, the organiser's promo codes, and what a ticket, an order
 * and a door say about a night and an online joining link.
 *
 * @module @desi-event/schemas/seating.test
 */

import { describe, expect, it } from 'vitest'

import {
  eventWithRelationsSchema,
  orderItemSchema,
  orderWithItemsSchema,
  promoCodeSchema,
  publicEventSessionSchema,
  sessionSummarySchema,
  ticketTypeSchema,
} from './entities.js'
import { PROMO_QUOTE_REASONS, PROMO_STATUSES, promoQuoteReasonSchema } from './enums.js'
import {
  admissionSessionSchema,
  orderQuoteResponseSchema,
  organiserPromoCodeSchema,
  promoCodeListResponseSchema,
  walletTicketSchema,
} from './responses.js'
import { seatMapResponseSchema, seatMapTierSchema, seatMapZoneSchema } from './seating.js'

const ID = 'ckl1a2b3c4d5e6f7g8h9i0jk'
const OTHER = 'ckl1a2b3c4d5e6f7g8h9i0jl'
const THIRD = 'ckl1a2b3c4d5e6f7g8h9i0jm'

/** A night as a ticket names it. */
const night = {
  id: ID,
  label: 'Night 2',
  startsAt: '2027-10-03T00:30:00.000Z',
  endsAt: '2027-10-03T05:30:00.000Z',
  doorsOpenAt: '2027-10-03T00:00:00.000Z',
  timezone: 'America/Chicago',
}

/** A seat map payload with one section, one row, one seat. */
const seatMap = {
  sessionId: ID,
  eventId: OTHER,
  venueMapVersionId: THIRD,
  label: 'Night 2',
  startsAt: night.startsAt,
  endsAt: night.endsAt,
  doorsOpenAt: night.doorsOpenAt,
  timezone: 'America/Chicago',
  status: 'SCHEDULED',
  salesStartAt: null,
  salesEndAt: null,
  maxSeatsPerOrder: 6,
  zones: [{ id: THIRD, name: 'Front', sortOrder: 1 }],
  tiers: [
    {
      id: OTHER,
      name: 'Front stalls',
      priceCents: 4500,
      currency: 'USD',
      priceZoneId: THIRD,
      minPerOrder: 1,
      maxPerOrder: 6,
      onSale: true,
    },
  ],
  counts: { total: 1, available: 1, held: 0, sold: 0, unavailable: 0 },
  sections: [
    {
      id: ID,
      name: 'Stalls',
      kind: 'SEATED',
      sortOrder: 1,
      rows: [
        {
          id: OTHER,
          label: 'A',
          sortOrder: 1,
          seats: [
            {
              id: THIRD,
              seatId: ID,
              label: 'A12',
              sectionId: ID,
              rowId: OTHER,
              priceZoneId: THIRD,
              sortOrder: 12,
              available: true,
              accessible: true,
              companionOfSeatId: null,
              obstructedView: false,
              restricted: false,
              restrictionNote: null,
              priceCents: null,
              ticketTypeId: OTHER,
            },
          ],
        },
      ],
      seats: [],
    },
  ],
}

describe('the seat map', () => {
  it('names the night, its zones and its tiers', () => {
    const parsed = seatMapResponseSchema.safeParse({ data: seatMap })

    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  })

  it('refuses a per-order ceiling above the platform’s ten, or none', () => {
    expect(
      seatMapResponseSchema.safeParse({ data: { ...seatMap, maxSeatsPerOrder: 11 } }).success,
    ).toBe(false)
    expect(
      seatMapResponseSchema.safeParse({ data: { ...seatMap, maxSeatsPerOrder: 0 } }).success,
    ).toBe(false)
  })

  it('names a zone in words, and a tier with its price and whether it sells now', () => {
    expect(seatMapZoneSchema.safeParse({ id: ID, name: '', sortOrder: 1 }).success).toBe(false)
    expect(seatMapTierSchema.safeParse({ ...seatMap.tiers[0], currency: 'US' }).success).toBe(false)
    expect(seatMapTierSchema.safeParse({ ...seatMap.tiers[0], priceCents: -1 }).success).toBe(false)
    expect(seatMapTierSchema.safeParse({ ...seatMap.tiers[0], onSale: undefined }).success).toBe(
      false,
    )
  })
})

describe('nights', () => {
  it('labels a night, or leaves the date to label it', () => {
    expect(sessionSummarySchema.parse(night).label).toBe('Night 2')
    expect(sessionSummarySchema.parse({ ...night, label: null }).label).toBeNull()
    expect(sessionSummarySchema.safeParse({ ...night, label: 'N'.repeat(61) }).success).toBe(false)
  })

  it('lists a night publicly with its sales window, and a seat count only for a seat map', () => {
    const listed = {
      ...night,
      status: 'SCHEDULED',
      salesStartAt: null,
      salesEndAt: null,
      hasSeatMap: false,
      seatsAvailable: null,
    }

    expect(publicEventSessionSchema.safeParse(listed).success).toBe(true)
    expect(
      publicEventSessionSchema.safeParse({ ...listed, hasSeatMap: true, seatsAvailable: -1 })
        .success,
    ).toBe(false)
  })

  it('gives an event no nights by default, and its tiers their night and zone', () => {
    const event = eventWithRelationsSchema.shape.sessions.parse(undefined)
    expect(event).toEqual([])

    const tier = ticketTypeSchema.shape
    expect(tier.eventSessionId.parse(ID)).toBe(ID)
    expect(tier.priceZoneId.parse(null)).toBeNull()
  })

  it('says which night a door is looking at, or none', () => {
    expect(
      admissionSessionSchema.parse({
        label: null,
        startsAt: night.startsAt,
        endsAt: night.endsAt,
        timezone: night.timezone,
      }),
    ).toMatchObject({ label: null })
    expect(admissionSessionSchema.parse(null)).toBeNull()
  })
})

describe('what an order line and a ticket carry', () => {
  it('names a line’s tier and night, and drops the staged names', () => {
    const line = orderItemSchema.parse({
      id: ID,
      orderId: OTHER,
      ticketTypeId: THIRD,
      quantity: 2,
      unitPriceCents: 1000,
      subtotalCents: 2000,
      ticketTypeName: 'General',
      session: night,
      attendeeNames: ['Asha Patel'],
    })

    expect(line.ticketTypeName).toBe('General')
    expect(line.session.label).toBe('Night 2')
    expect(line).not.toHaveProperty('attendeeNames')
  })

  it('carries a joining link on an order only as a URL', () => {
    const shape = orderWithItemsSchema.shape.onlineJoinUrl

    expect(shape.parse('https://stream.example.com/room')).toBe('https://stream.example.com/room')
    expect(shape.parse(null)).toBeNull()
    expect(shape.safeParse('not a link').success).toBe(false)
  })

  it('gives a wallet ticket its night and, while it admits, the joining link', () => {
    expect(walletTicketSchema.shape.session.parse(night)).toMatchObject({ id: ID })
    expect(walletTicketSchema.shape.onlineJoinUrl.parse(null)).toBeNull()
  })

  it('carries a fixed-amount code’s currency', () => {
    expect(promoCodeSchema.shape.currency.parse('USD')).toBe('USD')
    expect(promoCodeSchema.shape.currency.parse(null)).toBeNull()
  })
})

describe('the quote', () => {
  const quote = {
    currency: 'USD',
    subtotalCents: 9000,
    discountCents: 900,
    feesCents: 500,
    taxCents: 0,
    totalCents: 8600,
    lines: [
      {
        ticketTypeId: ID,
        name: 'General',
        sessionId: null,
        quantity: 2,
        unitPriceCents: 4500,
        subtotalCents: 9000,
        discountCents: 900,
      },
    ],
    promo: {
      code: 'SAVE10',
      applied: true,
      reason: null,
      type: 'PERCENTAGE',
      percentBps: 1000,
      amountCents: null,
    },
    pricedAt: '2027-01-01T00:00:00.000Z',
  }

  it('reads what the server would charge, and why a code gave nothing', () => {
    expect(orderQuoteResponseSchema.safeParse({ data: quote }).success).toBe(true)
    expect(
      orderQuoteResponseSchema.safeParse({
        data: {
          ...quote,
          discountCents: 0,
          promo: {
            ...quote.promo,
            applied: false,
            reason: 'UNKNOWN',
            type: null,
            percentBps: null,
          },
        },
      }).success,
    ).toBe(true)
    expect(orderQuoteResponseSchema.safeParse({ data: { ...quote, promo: null } }).success).toBe(
      true,
    )
  })

  it('has one reason for every rejection the pricing package names, plus UNKNOWN', () => {
    expect(PROMO_QUOTE_REASONS).toEqual([
      'UNKNOWN',
      'INACTIVE',
      'NOT_STARTED',
      'EXPIRED',
      'EXHAUSTED',
      'CURRENCY_MISMATCH',
      'CURRENCY_MISSING',
    ])
    expect(promoQuoteReasonSchema.safeParse('TOO_LATE').success).toBe(false)
  })
})

describe('the organiser’s promo codes', () => {
  const row = {
    id: ID,
    organizationId: OTHER,
    eventId: null,
    code: 'SAVE10',
    type: 'PERCENTAGE',
    value: 1000,
    currency: null,
    maxRedemptions: 50,
    redemptionCount: 3,
    startsAt: null,
    endsAt: null,
    active: true,
    createdAt: '2027-01-01T00:00:00.000Z',
    status: 'ACTIVE',
    event: null,
    ordersCount: 3,
  }

  it('lists a code with its computed status and how many orders name it', () => {
    expect(organiserPromoCodeSchema.safeParse(row).success).toBe(true)
    expect(
      promoCodeListResponseSchema.safeParse({
        data: [row],
        pagination: {
          page: 1,
          perPage: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }).success,
    ).toBe(true)
  })

  it('knows five statuses and no others', () => {
    expect(PROMO_STATUSES).toEqual(['ACTIVE', 'PAUSED', 'SCHEDULED', 'ENDED', 'USED_UP'])
    expect(organiserPromoCodeSchema.safeParse({ ...row, status: 'LIVE' }).success).toBe(false)
  })
})
