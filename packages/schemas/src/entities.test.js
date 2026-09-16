import { describe, expect, it } from 'vitest'

import {
  auditLogSchema,
  eventSchema,
  eventSummarySchema,
  eventWithRelationsSchema,
  membershipSchema,
  orderItemSchema,
  orderSchema,
  orderWithItemsSchema,
  organizationSchema,
  paymentSchema,
  promoCodeSchema,
  publicUserSchema,
  ticketHoldSchema,
  ticketSchema,
  ticketTypeSchema,
  userSchema,
  venueSchema,
  waitlistEntrySchema,
} from './entities.js'

const ids = {
  user: 'ckl1a2b3c4d5e6f7g8h9i0jk',
  org: 'ckl1a2b3c4d5e6f7g8h9i0jl',
  venue: 'ckl1a2b3c4d5e6f7g8h9i0jm',
  event: 'ckl1a2b3c4d5e6f7g8h9i0jn',
  ticketType: 'ckl1a2b3c4d5e6f7g8h9i0jo',
  order: 'ckl1a2b3c4d5e6f7g8h9i0jp',
  orderItem: 'ckl1a2b3c4d5e6f7g8h9i0jq',
  ticket: 'ckl1a2b3c4d5e6f7g8h9i0jr',
  promo: 'ckl1a2b3c4d5e6f7g8h9i0js',
}

/** A row exactly as Prisma returns it: real Dates, nulls for absent columns. */
const prismaUser = {
  id: ids.user,
  email: 'Priya@Example.com',
  passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
  displayName: 'Priya Sharma',
  phone: null,
  locale: 'en-IN',
  role: 'ORGANIZER',
  emailVerified: true,
  createdAt: new Date('2026-01-05T09:00:00Z'),
  updatedAt: new Date('2026-01-06T09:00:00Z'),
}

const prismaEvent = {
  id: ids.event,
  organizationId: ids.org,
  venueId: ids.venue,
  title: 'Navratri Nights 2026',
  slug: 'navratri-nights-2026',
  summary: 'Nine nights of garba',
  description: 'Live dhol, professional garba instructors and a food bazaar.',
  category: 'GARBA_DANDIYA',
  status: 'PUBLISHED',
  startsAt: new Date('2026-10-01T13:00:00Z'),
  endsAt: new Date('2026-10-01T18:30:00Z'),
  timezone: 'Asia/Kolkata',
  coverImageUrl: null,
  isOnline: false,
  onlineUrl: null,
  languages: ['Gujarati', 'Hindi'],
  publishedAt: new Date('2026-08-01T10:00:00Z'),
  createdAt: new Date('2026-07-01T10:00:00Z'),
  updatedAt: new Date('2026-08-01T10:00:00Z'),
}

const prismaTicketType = {
  id: ids.ticketType,
  eventId: ids.event,
  name: 'Early Bird',
  description: null,
  priceCents: 149900,
  currency: 'INR',
  quantityTotal: 500,
  quantitySold: 120,
  minPerOrder: 1,
  maxPerOrder: 10,
  salesStartAt: null,
  salesEndAt: new Date('2026-09-30T18:29:59Z'),
  status: 'ON_SALE',
  sortOrder: 0,
  createdAt: new Date('2026-07-01T10:00:00Z'),
  updatedAt: new Date('2026-07-01T10:00:00Z'),
}

const prismaOrder = {
  id: ids.order,
  reference: 'DE-8F3K2Q',
  eventId: ids.event,
  userId: ids.user,
  buyerEmail: 'priya@example.com',
  buyerName: 'Priya Sharma',
  status: 'PAID',
  currency: 'INR',
  subtotalCents: 299800,
  discountCents: 29980,
  feesCents: 16118,
  taxCents: 0,
  totalCents: 285938,
  promoCodeId: ids.promo,
  expiresAt: null,
  paidAt: new Date('2026-08-10T12:00:00Z'),
  cancelledAt: null,
  createdAt: new Date('2026-08-10T11:55:00Z'),
  updatedAt: new Date('2026-08-10T12:00:00Z'),
}

describe('userSchema', () => {
  it('parses a Prisma row and normalises dates and email', () => {
    const parsed = userSchema.parse(prismaUser)
    expect(parsed.email).toBe('priya@example.com')
    expect(parsed.createdAt).toBe('2026-01-05T09:00:00.000Z')
    expect(parsed.phone).toBeNull()
  })

  it('applies column defaults when a trimmed payload omits them', () => {
    const parsed = userSchema.parse({
      id: ids.user,
      email: 'a@b.com',
      passwordHash: 'hash',
      displayName: 'A',
    })
    expect(parsed).toMatchObject({ locale: 'en-IN', role: 'ATTENDEE', emailVerified: false })
  })

  it('rejects an unknown role', () => {
    expect(userSchema.safeParse({ ...prismaUser, role: 'SUPERUSER' }).success).toBe(false)
  })

  it('requires the password hash', () => {
    const { passwordHash: _ignored, ...rest } = prismaUser
    expect(userSchema.safeParse(rest).success).toBe(false)
  })
})

describe('publicUserSchema', () => {
  it('drops the password hash even when one is supplied', () => {
    const parsed = publicUserSchema.parse(prismaUser)
    expect(parsed).not.toHaveProperty('passwordHash')
    expect(parsed).not.toHaveProperty('updatedAt')
    expect(parsed.displayName).toBe('Priya Sharma')
  })
})

describe('organizationSchema', () => {
  it('parses a row and defaults the payout currency', () => {
    const parsed = organizationSchema.parse({
      id: ids.org,
      name: 'Rhythm Collective',
      slug: 'rhythm-collective',
      description: null,
      contactEmail: 'hello@rhythm.example',
      websiteUrl: 'https://rhythm.example',
      verified: true,
    })
    expect(parsed.payoutCurrency).toBe('INR')
  })

  it('rejects an invalid slug', () => {
    expect(
      organizationSchema.safeParse({
        id: ids.org,
        name: 'X',
        slug: 'Not A Slug',
        contactEmail: 'a@b.com',
      }).success,
    ).toBe(false)
  })
})

describe('venueSchema', () => {
  it('parses a row and defaults the country', () => {
    const parsed = venueSchema.parse({
      id: ids.venue,
      name: 'GMDC Ground',
      addressLine1: 'University Road',
      addressLine2: null,
      city: 'Ahmedabad',
      region: 'Gujarat',
      postalCode: '380015',
      latitude: 23.0359,
      longitude: 72.5455,
      capacity: 20000,
    })
    expect(parsed.country).toBe('IN')
  })

  it('rejects out-of-range coordinates', () => {
    expect(
      venueSchema.safeParse({
        id: ids.venue,
        name: 'X',
        addressLine1: 'Y',
        city: 'Z',
        region: 'R',
        postalCode: '1',
        latitude: 120,
      }).success,
    ).toBe(false)
  })
})

describe('eventSchema', () => {
  it('parses a Prisma row into ISO timestamps', () => {
    const parsed = eventSchema.parse(prismaEvent)
    expect(parsed.startsAt).toBe('2026-10-01T13:00:00.000Z')
    expect(parsed.publishedAt).toBe('2026-08-01T10:00:00.000Z')
    expect(parsed.languages).toEqual(['Gujarati', 'Hindi'])
  })

  it('strips relations Prisma may have included', () => {
    const parsed = eventSchema.parse({ ...prismaEvent, organization: { id: ids.org } })
    expect(parsed).not.toHaveProperty('organization')
  })

  it('defaults status, timezone, isOnline and languages', () => {
    const parsed = eventSchema.parse({
      id: ids.event,
      organizationId: ids.org,
      title: 'T',
      slug: 't',
      summary: 'S',
      description: 'D',
      category: 'COMEDY',
      startsAt: '2026-10-01T13:00:00Z',
      endsAt: '2026-10-01T15:00:00Z',
    })
    expect(parsed).toMatchObject({
      status: 'DRAFT',
      timezone: 'Asia/Kolkata',
      isOnline: false,
      languages: [],
    })
  })

  it('rejects an unknown category and a bad timezone', () => {
    expect(eventSchema.safeParse({ ...prismaEvent, category: 'DISCO' }).success).toBe(false)
    expect(eventSchema.safeParse({ ...prismaEvent, timezone: 'Asia/Atlantis' }).success).toBe(false)
  })
})

describe('eventSummarySchema', () => {
  it('accepts the denormalised card fields', () => {
    const parsed = eventSummarySchema.parse({
      id: ids.event,
      organizationId: ids.org,
      title: 'Navratri Nights 2026',
      slug: 'navratri-nights-2026',
      summary: 'Nine nights of garba',
      category: 'GARBA_DANDIYA',
      status: 'PUBLISHED',
      startsAt: new Date('2026-10-01T13:00:00Z'),
      endsAt: new Date('2026-10-01T18:30:00Z'),
      city: 'Ahmedabad',
      minPriceCents: 149900,
      currency: 'inr',
      soldOut: false,
    })
    expect(parsed.currency).toBe('INR')
    expect(parsed.startsAt).toBe('2026-10-01T13:00:00.000Z')
  })

  it('rejects a float price', () => {
    expect(
      eventSummarySchema.safeParse({
        id: ids.event,
        organizationId: ids.org,
        title: 'T',
        slug: 't',
        summary: 'S',
        category: 'COMEDY',
        status: 'PUBLISHED',
        startsAt: '2026-10-01T13:00:00Z',
        endsAt: '2026-10-01T15:00:00Z',
        minPriceCents: 1499.5,
      }).success,
    ).toBe(false)
  })
})

describe('ticketTypeSchema', () => {
  it('parses a Prisma row', () => {
    const parsed = ticketTypeSchema.parse(prismaTicketType)
    expect(parsed.priceCents).toBe(149900)
    expect(parsed.salesEndAt).toBe('2026-09-30T18:29:59.000Z')
    expect(parsed.salesStartAt).toBeNull()
  })

  it('rejects a negative price and a float price', () => {
    expect(ticketTypeSchema.safeParse({ ...prismaTicketType, priceCents: -1 }).success).toBe(false)
    expect(ticketTypeSchema.safeParse({ ...prismaTicketType, priceCents: 1.5 }).success).toBe(false)
  })

  it('allows a free ticket', () => {
    expect(ticketTypeSchema.parse({ ...prismaTicketType, priceCents: 0 }).priceCents).toBe(0)
  })
})

describe('ticketHoldSchema', () => {
  it('parses a hold and defaults its status', () => {
    const parsed = ticketHoldSchema.parse({
      id: ids.order,
      ticketTypeId: ids.ticketType,
      quantity: 2,
      expiresAt: new Date('2026-08-10T12:10:00Z'),
    })
    expect(parsed.status).toBe('ACTIVE')
    expect(parsed).not.toHaveProperty('orderId')
    expect(parsed.expiresAt).toBe('2026-08-10T12:10:00.000Z')
  })

  it('requires an expiry', () => {
    expect(
      ticketHoldSchema.safeParse({ id: ids.order, ticketTypeId: ids.ticketType, quantity: 1 })
        .success,
    ).toBe(false)
  })
})

describe('order schemas', () => {
  it('parses an order row with every money column as integer cents', () => {
    const parsed = orderSchema.parse(prismaOrder)
    expect(parsed.totalCents).toBe(285938)
    expect(parsed.paidAt).toBe('2026-08-10T12:00:00.000Z')
    expect(parsed.reference).toBe('DE-8F3K2Q')
  })

  it('rejects fractional money', () => {
    expect(orderSchema.safeParse({ ...prismaOrder, totalCents: 2859.38 }).success).toBe(false)
  })

  it('parses an order item', () => {
    expect(
      orderItemSchema.parse({
        id: ids.orderItem,
        orderId: ids.order,
        ticketTypeId: ids.ticketType,
        quantity: 2,
        unitPriceCents: 149900,
        subtotalCents: 299800,
      }).subtotalCents,
    ).toBe(299800)
  })

  it('composes items and tickets in orderWithItemsSchema', () => {
    const parsed = orderWithItemsSchema.parse({
      ...prismaOrder,
      items: [
        {
          id: ids.orderItem,
          orderId: ids.order,
          ticketTypeId: ids.ticketType,
          quantity: 2,
          unitPriceCents: 149900,
          subtotalCents: 299800,
        },
      ],
    })
    expect(parsed.items).toHaveLength(1)
    expect(parsed.tickets).toBeUndefined()
  })

  it('defaults items to an empty array', () => {
    expect(orderWithItemsSchema.parse(prismaOrder).items).toEqual([])
  })
})

describe('ticketSchema', () => {
  it('upper-cases the code and defaults the status', () => {
    const parsed = ticketSchema.parse({
      id: ids.ticket,
      orderItemId: ids.orderItem,
      code: 'de-8f3k2q-01',
      attendeeName: null,
      checkedInAt: null,
    })
    expect(parsed.code).toBe('DE-8F3K2Q-01')
    expect(parsed.status).toBe('VALID')
  })
})

describe('paymentSchema', () => {
  it('parses a payment row', () => {
    const parsed = paymentSchema.parse({
      id: ids.order,
      orderId: ids.order,
      provider: 'in-memory',
      providerRef: 'pi_123',
      status: 'SUCCEEDED',
      amountCents: 285938,
      currency: 'INR',
      failureCode: null,
    })
    expect(parsed.status).toBe('SUCCEEDED')
  })

  it('defaults the status to INITIATED', () => {
    expect(
      paymentSchema.parse({
        id: ids.order,
        orderId: ids.order,
        provider: 'in-memory',
        amountCents: 100,
      }).status,
    ).toBe('INITIATED')
  })
})

describe('promoCodeSchema', () => {
  it('accepts a percentage code expressed in basis points', () => {
    const parsed = promoCodeSchema.parse({
      id: ids.promo,
      organizationId: ids.org,
      code: 'garba10',
      type: 'PERCENTAGE',
      value: 1000,
    })
    expect(parsed.code).toBe('GARBA10')
    expect(parsed.active).toBe(true)
    expect(parsed.redemptionCount).toBe(0)
  })

  it('rejects a percentage above 100%', () => {
    const result = promoCodeSchema.safeParse({
      id: ids.promo,
      organizationId: ids.org,
      code: 'TOOMUCH',
      type: 'PERCENTAGE',
      value: 10_001,
    })
    expect(result.success).toBe(false)
    expect(result.error.issues[0].path).toEqual(['value'])
  })

  it('allows a large FIXED_AMOUNT, which is cents rather than basis points', () => {
    expect(
      promoCodeSchema.parse({
        id: ids.promo,
        organizationId: ids.org,
        code: 'FLAT500',
        type: 'FIXED_AMOUNT',
        value: 50_000,
      }).value,
    ).toBe(50_000)
  })
})

describe('waitlistEntrySchema and auditLogSchema', () => {
  it('defaults waitlist quantity and notified flag', () => {
    const parsed = waitlistEntrySchema.parse({
      id: ids.order,
      eventId: ids.event,
      email: 'Fan@Example.com',
    })
    expect(parsed).toMatchObject({ quantity: 1, notified: false, email: 'fan@example.com' })
  })

  it('accepts arbitrary audit metadata', () => {
    const parsed = auditLogSchema.parse({
      id: ids.order,
      actorId: null,
      action: 'event.published',
      entityType: 'Event',
      entityId: ids.event,
      metadata: { from: 'DRAFT', to: 'PUBLISHED' },
    })
    expect(parsed.metadata).toEqual({ from: 'DRAFT', to: 'PUBLISHED' })
  })
})

describe('membershipSchema', () => {
  it('defaults the role to VIEWER', () => {
    expect(
      membershipSchema.parse({ id: ids.org, userId: ids.user, organizationId: ids.org }).role,
    ).toBe('VIEWER')
  })
})

describe('eventWithRelationsSchema', () => {
  it('nests venue, organization and ticket types', () => {
    const parsed = eventWithRelationsSchema.parse({
      ...prismaEvent,
      venue: {
        id: ids.venue,
        name: 'GMDC Ground',
        addressLine1: 'University Road',
        city: 'Ahmedabad',
        region: 'Gujarat',
        postalCode: '380015',
      },
      organization: {
        id: ids.org,
        name: 'Rhythm Collective',
        slug: 'rhythm-collective',
        contactEmail: 'hello@rhythm.example',
      },
      ticketTypes: [prismaTicketType],
    })

    expect(parsed.venue.city).toBe('Ahmedabad')
    expect(parsed.ticketTypes).toHaveLength(1)
    expect(parsed.organization.name).toBe('Rhythm Collective')
    // Finding NF-14: the nested organisation is the public summary, not the
    // row, so an account contact address offered here does not come back out.
    expect(parsed.organization).not.toHaveProperty('contactEmail')
    expect(parsed.organization).not.toHaveProperty('payoutCurrency')
  })

  it('defaults ticketTypes to an empty array and allows a null venue', () => {
    const parsed = eventWithRelationsSchema.parse({ ...prismaEvent, venue: null })
    expect(parsed.ticketTypes).toEqual([])
    expect(parsed.venue).toBeNull()
  })
})
