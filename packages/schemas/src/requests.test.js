import { describe, expect, it } from 'vitest'

import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from './primitives.js'
import {
  checkInRequestSchema,
  createEventRequestSchema,
  createHoldRequestSchema,
  createOrderRequestSchema,
  createPromoCodeRequestSchema,
  createTicketTypeRequestSchema,
  idParamSchema,
  joinWaitlistRequestSchema,
  listEventsQuerySchema,
  loginRequestSchema,
  publishEventRequestSchema,
  registerRequestSchema,
  slugParamSchema,
  updateEventRequestSchema,
  updateTicketTypeRequestSchema,
} from './requests.js'
import { createVenueRequestSchema } from './venues.js'

const ORG_ID = 'ckl1a2b3c4d5e6f7g8h9i0jl'
const EVENT_ID = 'ckl1a2b3c4d5e6f7g8h9i0jn'
const TT_ID = 'ckl1a2b3c4d5e6f7g8h9i0jo'
const TT_ID_2 = 'ckl1a2b3c4d5e6f7g8h9i0jp'

/**
 * Collect the issue paths of a failed parse, so assertions can name the field
 * that was rejected rather than matching on message text.
 *
 * @param {object} result A Zod safeParse result.
 * @returns {string[]} Dotted issue paths.
 */
function issuePaths(result) {
  return result.error.issues.map((issue) => issue.path.join('.'))
}

const validEvent = {
  organizationId: ORG_ID,
  title: 'Navratri Nights 2026',
  summary: 'Nine nights of garba',
  description: 'Live dhol and professional instructors.',
  category: 'GARBA_DANDIYA',
  startsAt: '2026-10-01T13:00:00Z',
  endsAt: '2026-10-01T18:30:00Z',
}

const validTicketType = {
  eventId: EVENT_ID,
  name: 'Early Bird',
  priceCents: 149900,
  quantityTotal: 500,
}

describe('registerRequestSchema', () => {
  it('normalises the email and applies defaults', () => {
    expect(
      registerRequestSchema.parse({
        email: '  Priya@Example.COM ',
        password: 'garba-nights-2026',
        displayName: '  Priya Sharma  ',
      }),
    ).toEqual({
      email: 'priya@example.com',
      password: 'garba-nights-2026',
      displayName: 'Priya Sharma',
      locale: 'en-IN',
      role: 'ATTENDEE',
    })
  })

  it('allows an organizer to self-register but not an admin', () => {
    expect(registerRequestSchema.parse({ ...base(), role: 'ORGANIZER' }).role).toBe('ORGANIZER')
    expect(registerRequestSchema.safeParse({ ...base(), role: 'SUPER_ADMIN' }).success).toBe(false)
  })

  it('rejects a short password and a malformed email', () => {
    expect(issuePaths(registerRequestSchema.safeParse({ ...base(), password: 'short' }))).toEqual([
      'password',
    ])
    expect(issuePaths(registerRequestSchema.safeParse({ ...base(), email: 'nope' }))).toEqual([
      'email',
    ])
  })

  it('rejects a blank display name', () => {
    expect(issuePaths(registerRequestSchema.safeParse({ ...base(), displayName: '   ' }))).toEqual([
      'displayName',
    ])
  })

  /**
   * A minimal valid registration body.
   *
   * @returns {object} Fresh body so tests cannot mutate a shared object.
   */
  function base() {
    return { email: 'a@b.com', password: 'longenough', displayName: 'A' }
  }
})

describe('loginRequestSchema', () => {
  it('accepts any non-empty password so old accounts can still sign in', () => {
    expect(loginRequestSchema.parse({ email: 'A@B.com', password: 'x' })).toEqual({
      email: 'a@b.com',
      password: 'x',
    })
  })

  it('rejects an empty password', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false)
  })
})

describe('createEventRequestSchema', () => {
  it('accepts a valid event and fills the defaults', () => {
    const parsed = createEventRequestSchema.parse(validEvent)
    expect(parsed).toMatchObject({
      status: 'DRAFT',
      timezone: 'Asia/Kolkata',
      isOnline: false,
      languages: [],
    })
  })

  it('rejects endsAt equal to startsAt', () => {
    const result = createEventRequestSchema.safeParse({
      ...validEvent,
      endsAt: validEvent.startsAt,
    })
    expect(result.success).toBe(false)
    expect(issuePaths(result)).toEqual(['endsAt'])
  })

  it('rejects endsAt before startsAt', () => {
    const result = createEventRequestSchema.safeParse({
      ...validEvent,
      endsAt: '2026-09-30T13:00:00Z',
    })
    expect(result.success).toBe(false)
    expect(result.error.issues[0].message).toMatch(/strictly after/)
  })

  it('compares instants, not strings, when offsets differ', () => {
    // 23:00+05:30 is 17:30Z, so an 18:00Z finish is valid even though the
    // string '...T18:00:00Z' sorts before '...T23:00:00+05:30'.
    expect(
      createEventRequestSchema.safeParse({
        ...validEvent,
        startsAt: '2026-10-01T23:00:00+05:30',
        endsAt: '2026-10-01T18:00:00Z',
      }).success,
    ).toBe(true)

    // 00:00+05:30 on the 2nd is 18:30Z on the 1st: the same instant as endsAt.
    expect(
      createEventRequestSchema.safeParse({
        ...validEvent,
        startsAt: '2026-10-02T00:00:00+05:30',
        endsAt: '2026-10-01T18:30:00Z',
      }).success,
    ).toBe(false)
  })

  it('accepts a one-second window', () => {
    expect(
      createEventRequestSchema.safeParse({
        ...validEvent,
        endsAt: '2026-10-01T13:00:01Z',
      }).success,
    ).toBe(true)
  })

  it('requires onlineUrl for an online event', () => {
    expect(
      issuePaths(createEventRequestSchema.safeParse({ ...validEvent, isOnline: true })),
    ).toEqual(['onlineUrl'])
    expect(
      createEventRequestSchema.safeParse({
        ...validEvent,
        isOnline: true,
        onlineUrl: 'https://stream.example/live',
      }).success,
    ).toBe(true)
  })

  it('rejects an unknown category and an unknown timezone', () => {
    expect(createEventRequestSchema.safeParse({ ...validEvent, category: 'DISCO' }).success).toBe(
      false,
    )
    expect(
      createEventRequestSchema.safeParse({ ...validEvent, timezone: 'Asia/Atlantis' }).success,
    ).toBe(false)
  })

  it('accepts a date-only window from a simple form', () => {
    const parsed = createEventRequestSchema.parse({
      ...validEvent,
      startsAt: '2026-10-01',
      endsAt: '2026-10-02',
    })
    expect(parsed.startsAt).toBe('2026-10-01T00:00:00.000Z')
  })
})

describe('updateEventRequestSchema', () => {
  it('accepts a single field without inventing defaults', () => {
    expect(updateEventRequestSchema.parse({ title: 'Renamed' })).toEqual({ title: 'Renamed' })
  })

  it('never silently resets status, timezone, isOnline or languages', () => {
    const parsed = updateEventRequestSchema.parse({ summary: 'New summary' })
    expect(parsed).not.toHaveProperty('status')
    expect(parsed).not.toHaveProperty('timezone')
    expect(parsed).not.toHaveProperty('isOnline')
    expect(parsed).not.toHaveProperty('languages')
  })

  it('rejects an empty body', () => {
    const result = updateEventRequestSchema.safeParse({})
    expect(result.success).toBe(false)
    expect(result.error.issues[0].message).toMatch(/at least one field/)
  })

  it('still enforces the window when both ends are supplied', () => {
    const result = updateEventRequestSchema.safeParse({
      startsAt: '2026-10-02T00:00:00Z',
      endsAt: '2026-10-01T00:00:00Z',
    })
    expect(issuePaths(result)).toEqual(['endsAt'])
  })

  it('does not fire the window check when only one end is supplied', () => {
    expect(updateEventRequestSchema.safeParse({ endsAt: '2026-10-01T00:00:00Z' }).success).toBe(
      true,
    )
  })

  it('refuses to move an event between organisations', () => {
    expect(updateEventRequestSchema.parse({ organizationId: ORG_ID, title: 'X' })).toEqual({
      title: 'X',
    })
  })
})

describe('publishEventRequestSchema', () => {
  it('accepts a status change', () => {
    expect(publishEventRequestSchema.parse({ status: 'PUBLISHED' }).status).toBe('PUBLISHED')
  })

  it('rejects an unknown status', () => {
    expect(publishEventRequestSchema.safeParse({ status: 'LIVE' }).success).toBe(false)
  })
})

describe('listEventsQuerySchema', () => {
  it('applies pagination defaults', () => {
    expect(listEventsQuerySchema.parse({})).toEqual({
      page: DEFAULT_PAGE,
      perPage: DEFAULT_PER_PAGE,
      sort: 'startsAt:asc',
    })
  })

  it('coerces the strings a URL carries', () => {
    const parsed = listEventsQuerySchema.parse({
      page: '3',
      perPage: '50',
      isOnline: 'true',
    })
    expect(parsed).toMatchObject({ page: 3, perPage: 50, isOnline: true })
  })

  it('accepts every documented filter', () => {
    const parsed = listEventsQuerySchema.parse({
      category: 'GARBA_DANDIYA',
      status: 'PUBLISHED',
      city: '  Ahmedabad ',
      q: '  garba  ',
      startsAfter: '2026-09-01',
      startsBefore: '2026-11-01',
      organizationId: ORG_ID,
      sort: 'startsAt:desc',
    })
    expect(parsed.city).toBe('Ahmedabad')
    expect(parsed.q).toBe('garba')
    expect(parsed.startsAfter).toBe('2026-09-01T00:00:00.000Z')
    expect(parsed.startsBefore).toBe('2026-11-01T00:00:00.000Z')
  })

  it('caps perPage', () => {
    expect(listEventsQuerySchema.parse({ perPage: String(MAX_PER_PAGE) }).perPage).toBe(
      MAX_PER_PAGE,
    )
    expect(issuePaths(listEventsQuerySchema.safeParse({ perPage: '101' }))).toEqual(['perPage'])
  })

  it('rejects a non-numeric or zero page', () => {
    expect(issuePaths(listEventsQuerySchema.safeParse({ page: 'two' }))).toEqual(['page'])
    expect(issuePaths(listEventsQuerySchema.safeParse({ page: '0' }))).toEqual(['page'])
  })

  it('rejects an inverted date window', () => {
    const result = listEventsQuerySchema.safeParse({
      startsAfter: '2026-11-01',
      startsBefore: '2026-09-01',
    })
    expect(issuePaths(result)).toEqual(['startsBefore'])
  })

  it('rejects an equal date window', () => {
    expect(
      listEventsQuerySchema.safeParse({ startsAfter: '2026-09-01', startsBefore: '2026-09-01' })
        .success,
    ).toBe(false)
  })

  it('allows either bound on its own', () => {
    expect(listEventsQuerySchema.safeParse({ startsAfter: '2026-09-01' }).success).toBe(true)
    expect(listEventsQuerySchema.safeParse({ startsBefore: '2026-09-01' }).success).toBe(true)
  })

  it('rejects an empty search term, an unknown category and an unknown sort', () => {
    expect(listEventsQuerySchema.safeParse({ q: '   ' }).success).toBe(false)
    expect(listEventsQuerySchema.safeParse({ category: 'DISCO' }).success).toBe(false)
    expect(listEventsQuerySchema.safeParse({ sort: 'price:asc' }).success).toBe(false)
  })
})

describe('createVenueRequestSchema', () => {
  it('accepts a venue', () => {
    expect(
      createVenueRequestSchema.parse({
        name: 'GMDC Ground',
        addressLine1: 'University Road',
        city: 'Ahmedabad',
        region: 'Gujarat',
        postalCode: '380015',
        capacity: 20000,
      }).capacity,
    ).toBe(20000)
  })

  it('rejects a missing city', () => {
    expect(
      issuePaths(
        createVenueRequestSchema.safeParse({
          name: 'X',
          addressLine1: 'Y',
          region: 'R',
          postalCode: '1',
        }),
      ),
    ).toEqual(['city'])
  })
})

describe('createTicketTypeRequestSchema', () => {
  it('accepts a ticket type and fills defaults', () => {
    expect(createTicketTypeRequestSchema.parse(validTicketType)).toEqual({
      ...validTicketType,
      currency: 'INR',
      minPerOrder: 1,
      maxPerOrder: 10,
      status: 'DRAFT',
      sortOrder: 0,
    })
  })

  it('rejects a negative price', () => {
    expect(
      issuePaths(createTicketTypeRequestSchema.safeParse({ ...validTicketType, priceCents: -100 })),
    ).toEqual(['priceCents'])
  })

  it('rejects a fractional price, because money is integer cents', () => {
    expect(
      createTicketTypeRequestSchema.safeParse({ ...validTicketType, priceCents: 1499.5 }).success,
    ).toBe(false)
  })

  it('accepts a free ticket type', () => {
    expect(
      createTicketTypeRequestSchema.parse({ ...validTicketType, priceCents: 0 }).priceCents,
    ).toBe(0)
  })

  it('rejects maxPerOrder below minPerOrder', () => {
    const result = createTicketTypeRequestSchema.safeParse({
      ...validTicketType,
      minPerOrder: 4,
      maxPerOrder: 2,
    })
    expect(issuePaths(result)).toEqual(['maxPerOrder'])
  })

  it('accepts maxPerOrder equal to minPerOrder', () => {
    expect(
      createTicketTypeRequestSchema.safeParse({
        ...validTicketType,
        minPerOrder: 4,
        maxPerOrder: 4,
      }).success,
    ).toBe(true)
  })

  it('rejects minPerOrder above the total inventory', () => {
    expect(
      issuePaths(
        createTicketTypeRequestSchema.safeParse({
          ...validTicketType,
          quantityTotal: 2,
          minPerOrder: 5,
          maxPerOrder: 6,
        }),
      ),
    ).toEqual(['minPerOrder'])
  })

  it('rejects a zero inventory', () => {
    expect(
      issuePaths(createTicketTypeRequestSchema.safeParse({ ...validTicketType, quantityTotal: 0 })),
    ).toContain('quantityTotal')
  })

  it('rejects a sales window that ends before it starts', () => {
    expect(
      issuePaths(
        createTicketTypeRequestSchema.safeParse({
          ...validTicketType,
          salesStartAt: '2026-09-30T00:00:00Z',
          salesEndAt: '2026-09-01T00:00:00Z',
        }),
      ),
    ).toEqual(['salesEndAt'])
  })
})

describe('updateTicketTypeRequestSchema', () => {
  it('accepts a partial update without inventing defaults', () => {
    expect(updateTicketTypeRequestSchema.parse({ priceCents: 99900 })).toEqual({
      priceCents: 99900,
    })
  })

  it('rejects an empty body', () => {
    expect(updateTicketTypeRequestSchema.safeParse({}).success).toBe(false)
  })

  it('still enforces the per-order bounds', () => {
    expect(
      issuePaths(updateTicketTypeRequestSchema.safeParse({ minPerOrder: 6, maxPerOrder: 2 })),
    ).toEqual(['maxPerOrder'])
  })

  it('drops an attempt to move the ticket type to another event', () => {
    expect(updateTicketTypeRequestSchema.parse({ eventId: EVENT_ID, name: 'VIP' })).toEqual({
      name: 'VIP',
    })
  })
})

describe('createHoldRequestSchema', () => {
  it('accepts a hold request and coerces the TTL', () => {
    expect(
      createHoldRequestSchema.parse({ ticketTypeId: TT_ID, quantity: 2, ttlSeconds: '900' }),
    ).toEqual({ ticketTypeId: TT_ID, quantity: 2, ttlSeconds: 900 })
  })

  it('rejects a zero quantity and an out-of-range TTL', () => {
    expect(
      issuePaths(createHoldRequestSchema.safeParse({ ticketTypeId: TT_ID, quantity: 0 })),
    ).toEqual(['quantity'])
    expect(
      issuePaths(
        createHoldRequestSchema.safeParse({ ticketTypeId: TT_ID, quantity: 1, ttlSeconds: 5 }),
      ),
    ).toEqual(['ttlSeconds'])
  })
})

describe('createOrderRequestSchema', () => {
  const validOrder = {
    eventId: EVENT_ID,
    buyerEmail: 'Priya@Example.com',
    buyerName: 'Priya Sharma',
    items: [{ ticketTypeId: TT_ID, quantity: 2 }],
  }

  it('accepts an order and normalises email and promo code', () => {
    const parsed = createOrderRequestSchema.parse({ ...validOrder, promoCode: 'garba10' })
    expect(parsed.buyerEmail).toBe('priya@example.com')
    expect(parsed.promoCode).toBe('GARBA10')
  })

  it('requires at least one item', () => {
    const result = createOrderRequestSchema.safeParse({ ...validOrder, items: [] })
    expect(issuePaths(result)).toEqual(['items'])
    expect(result.error.issues[0].message).toMatch(/at least one item/)
  })

  it('requires the items key at all', () => {
    const { items: _ignored, ...rest } = validOrder
    expect(issuePaths(createOrderRequestSchema.safeParse(rest))).toEqual(['items'])
  })

  it('rejects the same ticket type appearing twice', () => {
    const result = createOrderRequestSchema.safeParse({
      ...validOrder,
      items: [
        { ticketTypeId: TT_ID, quantity: 1 },
        { ticketTypeId: TT_ID, quantity: 3 },
      ],
    })
    expect(issuePaths(result)).toEqual(['items.1.ticketTypeId'])
  })

  it('allows different ticket types on separate lines', () => {
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        items: [
          { ticketTypeId: TT_ID, quantity: 1 },
          { ticketTypeId: TT_ID_2, quantity: 3 },
        ],
      }).success,
    ).toBe(true)
  })

  it('rejects a zero or negative line quantity', () => {
    expect(
      issuePaths(
        createOrderRequestSchema.safeParse({
          ...validOrder,
          items: [{ ticketTypeId: TT_ID, quantity: 0 }],
        }),
      ),
    ).toEqual(['items.0.quantity'])
  })

  it('rejects a malformed ticket type id', () => {
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        items: [{ ticketTypeId: 'nope', quantity: 1 }],
      }).success,
    ).toBe(false)
  })
})

describe('checkInRequestSchema', () => {
  it('upper-cases the scanned code', () => {
    // `force` used to default here and is gone: with an attendance row that is
    // unique per ticket, the only thing it could mean is "rewrite the admission
    // record", and a record whoever holds the scanner can rewrite is not one.
    expect(checkInRequestSchema.parse({ code: 'de-8f3k2q-01' })).toEqual({
      code: 'DE-8F3K2Q-01',
    })
  })

  it('accepts the scanned pass on its own', () => {
    const credential = 'a'.repeat(43)

    expect(checkInRequestSchema.parse({ credential })).toEqual({ credential })
  })

  it('rejects an empty code', () => {
    expect(checkInRequestSchema.safeParse({ code: '' }).success).toBe(false)
  })

  it('rejects a request that presents nothing', () => {
    expect(checkInRequestSchema.safeParse({ gate: 'North' }).success).toBe(false)
  })

  it('rejects a pass that is not base64url', () => {
    // The scanner sends what it read. Anything else is either a broken device
    // or somebody probing, and neither should reach a database lookup.
    expect(checkInRequestSchema.safeParse({ credential: `${'a'.repeat(40)}+/=` }).success).toBe(
      false,
    )
  })
})

describe('joinWaitlistRequestSchema', () => {
  it('defaults the quantity to one', () => {
    expect(
      joinWaitlistRequestSchema.parse({ eventId: EVENT_ID, email: 'Fan@Example.com' }),
    ).toEqual({ eventId: EVENT_ID, email: 'fan@example.com', quantity: 1 })
  })

  it('rejects an absurd quantity', () => {
    expect(
      joinWaitlistRequestSchema.safeParse({ eventId: EVENT_ID, email: 'a@b.com', quantity: 500 })
        .success,
    ).toBe(false)
  })
})

describe('createPromoCodeRequestSchema', () => {
  const base = { organizationId: ORG_ID, code: 'GARBA10', type: 'PERCENTAGE', value: 1000 }

  it('accepts a percentage code in basis points', () => {
    expect(createPromoCodeRequestSchema.parse(base)).toMatchObject({ value: 1000, active: true })
  })

  it('rejects a percentage above 100%', () => {
    expect(issuePaths(createPromoCodeRequestSchema.safeParse({ ...base, value: 10_001 }))).toEqual([
      'value',
    ])
  })

  it('allows a fixed amount larger than 10000 cents', () => {
    expect(
      createPromoCodeRequestSchema.safeParse({ ...base, type: 'FIXED_AMOUNT', value: 50_000 })
        .success,
    ).toBe(true)
  })

  it('rejects a zero value', () => {
    expect(createPromoCodeRequestSchema.safeParse({ ...base, value: 0 }).success).toBe(false)
  })

  it('rejects an inverted validity window', () => {
    expect(
      issuePaths(
        createPromoCodeRequestSchema.safeParse({
          ...base,
          startsAt: '2026-10-01T00:00:00Z',
          endsAt: '2026-09-01T00:00:00Z',
        }),
      ),
    ).toEqual(['endsAt'])
  })
})

describe('path parameter schemas', () => {
  it('validates an id parameter', () => {
    expect(idParamSchema.parse({ id: EVENT_ID })).toEqual({ id: EVENT_ID })
    expect(idParamSchema.safeParse({ id: '../../etc/passwd' }).success).toBe(false)
  })

  it('validates a slug parameter', () => {
    expect(slugParamSchema.parse({ slug: 'Navratri-2026' })).toEqual({ slug: 'navratri-2026' })
    expect(slugParamSchema.safeParse({ slug: 'not a slug' }).success).toBe(false)
  })
})
