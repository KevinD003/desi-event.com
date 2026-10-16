import { describe, expect, it } from 'vitest'

import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from './primitives.js'
import {
  admissionEventsQuerySchema,
  admissionPreviewRequestSchema,
  checkInRequestSchema,
  groupAdmissionPreviewRequestSchema,
  groupCheckInRequestSchema,
  createEventRequestSchema,
  createHoldRequestSchema,
  createOrderRequestSchema,
  attendeeNameSchema,
  createPromoCodeRequestSchema,
  createSessionRequestSchema,
  createTicketTypeRequestSchema,
  idParamSchema,
  listPromoCodesQuerySchema,
  organizationPromoCodeParamSchema,
  quoteOrderRequestSchema,
  updateSessionRequestSchema,
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

  it('registers attendees only: an organiser, an administrator or any staff role is refused', () => {
    expect(registerRequestSchema.parse({ ...base(), role: 'ATTENDEE' }).role).toBe('ATTENDEE')
    expect(registerRequestSchema.parse(base()).role).toBe('ATTENDEE')

    for (const role of [
      'ORGANIZER',
      'ADMIN',
      'SUPER_ADMIN',
      'MODERATOR',
      'SUPPORT',
      'FINANCE_ADMIN',
    ]) {
      const result = registerRequestSchema.safeParse({ ...base(), role })

      expect(result.success, role).toBe(false)
      expect(result.error.issues[0].path).toEqual(['role'])
      expect(result.error.issues[0].message).toBe(
        'Accounts are created as attendees. Organisers join by invitation from the team at The Desi Events.',
      )
    }
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

  it('refuses an external cover address and names the upload route instead', () => {
    for (const schema of [updateEventRequestSchema, createEventRequestSchema]) {
      const result = schema.safeParse({
        ...validEvent,
        coverImageUrl: 'https://tracker.example/pixel.png',
      })

      expect(result.success).toBe(false)

      const issue = result.error.issues.find((entry) => entry.path[0] === 'coverImageUrl')

      expect(issue.message).toBe(
        'Cover pictures are uploaded with POST /v1/events/:id/media; an external image address is not accepted.',
      )
    }
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

  it('still refuses every price sort, with the new filters beside it', () => {
    for (const sort of ['price:asc', 'price:desc', 'minPriceCents:asc']) {
      expect(issuePaths(listEventsQuerySchema.safeParse({ sort, free: 'true' }))).toEqual(['sort'])
    }
  })

  it('accepts where, what and when filters as a URL carries them', () => {
    const parsed = listEventsQuerySchema.parse({
      country: 'US',
      region: '  tx ',
      city: 'Frisco',
      language: ' Hindi ',
      free: 'true',
      onSale: 'false',
      fromDate: '2026-10-17',
      toDate: '2026-10-18',
    })

    expect(parsed).toMatchObject({
      country: 'US',
      region: 'tx',
      city: 'Frisco',
      language: 'Hindi',
      free: true,
      onSale: false,
      fromDate: '2026-10-17',
      toDate: '2026-10-18',
    })
  })

  it('takes a country only as two capital letters', () => {
    expect(listEventsQuerySchema.safeParse({ country: 'CA' }).success).toBe(true)
    for (const country of ['ca', 'USA', 'U', 'C1', '']) {
      expect(issuePaths(listEventsQuerySchema.safeParse({ country }))).toEqual(['country'])
    }
  })

  it('refuses an empty or control-character region or language', () => {
    expect(issuePaths(listEventsQuerySchema.safeParse({ region: '   ' }))).toEqual(['region'])
    expect(issuePaths(listEventsQuerySchema.safeParse({ region: 'T\u0000X' }))).toEqual(['region'])
    expect(issuePaths(listEventsQuerySchema.safeParse({ language: '' }))).toEqual(['language'])
    expect(issuePaths(listEventsQuerySchema.safeParse({ language: 'Hin\u0007di' }))).toEqual([
      'language',
    ])
  })

  it('reads free and onSale as booleans and refuses anything else', () => {
    expect(listEventsQuerySchema.parse({ free: 'false', onSale: 'true' })).toMatchObject({
      free: false,
      onSale: true,
    })
    expect(issuePaths(listEventsQuerySchema.safeParse({ free: 'cheap' }))).toEqual(['free'])
    expect(issuePaths(listEventsQuerySchema.safeParse({ onSale: 'now' }))).toEqual(['onSale'])
  })

  it('takes calendar days that exist, and one day as the same day twice', () => {
    expect(
      listEventsQuerySchema.safeParse({ fromDate: '2026-10-17', toDate: '2026-10-17' }).success,
    ).toBe(true)
    expect(listEventsQuerySchema.safeParse({ fromDate: '2028-02-29' }).success).toBe(true)
    for (const date of [
      '2026-02-30',
      '2026-13-01',
      '17/10/2026',
      '2026-10-17T00:00:00Z',
      '1969-12-31',
    ]) {
      expect(issuePaths(listEventsQuerySchema.safeParse({ fromDate: date }))).toEqual(['fromDate'])
    }
  })

  it('takes a named span of days, and only the four it knows', () => {
    for (const when of ['today', 'weekend', 'week', 'month']) {
      expect(listEventsQuerySchema.parse({ when }).when).toBe(when)
    }
    expect(issuePaths(listEventsQuerySchema.safeParse({ when: 'tonight' }))).toEqual(['when'])
  })

  it('refuses a last day before the first', () => {
    expect(
      issuePaths(listEventsQuerySchema.safeParse({ fromDate: '2026-10-18', toDate: '2026-10-17' })),
    ).toEqual(['toDate'])
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
  it('accepts a ticket type and fills defaults, leaving a currency it was not given to the server', () => {
    // No fixed currency: the route prices a tier in the event's own, and a
    // literal default is how a tier on a dollar event came to be in rupees.
    expect(createTicketTypeRequestSchema.parse(validTicketType)).toEqual({
      ...validTicketType,
      minPerOrder: 1,
      maxPerOrder: 10,
      status: 'DRAFT',
      sortOrder: 0,
    })
    expect(createTicketTypeRequestSchema.parse({ ...validTicketType, currency: 'USD' })).toEqual(
      expect.objectContaining({ currency: 'USD' }),
    )
    expect(
      createTicketTypeRequestSchema.safeParse({ ...validTicketType, currency: 'dollars' }).success,
    ).toBe(false)
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

  it('accepts a name per ticket, trimmed, for a tier in the order', () => {
    const parsed = createOrderRequestSchema.parse({
      ...validOrder,
      attendees: [
        { ticketTypeId: TT_ID, name: '  Asha Patel ' },
        { ticketTypeId: TT_ID, name: 'Ravi Patel' },
      ],
    })

    expect(parsed.attendees.map((attendee) => attendee.name)).toEqual(['Asha Patel', 'Ravi Patel'])
  })

  it('refuses more general-admission names than tickets', () => {
    expect(
      issuePaths(
        createOrderRequestSchema.safeParse({
          ...validOrder,
          attendees: [
            { ticketTypeId: TT_ID, name: 'One' },
            { ticketTypeId: TT_ID, name: 'Two' },
            { ticketTypeId: TT_ID, name: 'Three' },
          ],
        }),
      ),
    ).toEqual(['attendees.2'])
  })

  it('refuses a name for a tier that is not in the order', () => {
    expect(
      issuePaths(
        createOrderRequestSchema.safeParse({
          ...validOrder,
          attendees: [{ ticketTypeId: TT_ID_2, name: 'Stray' }],
        }),
      ),
    ).toEqual(['attendees.0.ticketTypeId'])
  })

  it('refuses two names for one seat, and leaves seated counts to the server', () => {
    const seat = 'ckl1a2b3c4d5e6f7g8h9i0zz'

    expect(
      issuePaths(
        createOrderRequestSchema.safeParse({
          ...validOrder,
          attendees: [
            { ticketTypeId: TT_ID, eventSeatId: seat, name: 'One' },
            { ticketTypeId: TT_ID, eventSeatId: seat, name: 'Two' },
          ],
        }),
      ),
    ).toEqual(['attendees.1.eventSeatId'])
  })

  it('refuses an address as a name', () => {
    expect(
      createOrderRequestSchema.safeParse({
        ...validOrder,
        attendees: [{ ticketTypeId: TT_ID, name: 'asha@example.com' }],
      }).success,
    ).toBe(false)
  })

  it('takes an expected total as a whole number of cents, never negative', () => {
    expect(
      createOrderRequestSchema.parse({ ...validOrder, expectedTotalCents: 4210 }),
    ).toMatchObject({
      expectedTotalCents: 4210,
    })
    expect(
      issuePaths(createOrderRequestSchema.safeParse({ ...validOrder, expectedTotalCents: -1 })),
    ).toEqual(['expectedTotalCents'])
    expect(
      issuePaths(createOrderRequestSchema.safeParse({ ...validOrder, expectedTotalCents: 12.5 })),
    ).toEqual(['expectedTotalCents'])
  })
})

describe('attendeeNameSchema', () => {
  it('trims and keeps an ordinary name', () => {
    expect(attendeeNameSchema.parse('  Meera Iyer  ')).toBe('Meera Iyer')
  })

  it('caps a name at 100 characters and refuses a blank one', () => {
    expect(attendeeNameSchema.safeParse('a'.repeat(100)).success).toBe(true)
    expect(attendeeNameSchema.safeParse('a'.repeat(101)).success).toBe(false)
    expect(attendeeNameSchema.safeParse('   ').success).toBe(false)
  })

  it('refuses an email address anywhere in the name', () => {
    expect(attendeeNameSchema.safeParse('Meera meera@example.com').success).toBe(false)
  })

  it('refuses control characters', () => {
    for (const text of ['Meera\u0000', 'Me\tera', 'Meera\u007f', 'Mee\u0085ra']) {
      expect(attendeeNameSchema.safeParse(text).success, JSON.stringify(text)).toBe(false)
    }
  })
})

describe('quoteOrderRequestSchema', () => {
  const quote = { eventId: EVENT_ID, items: [{ ticketTypeId: TT_ID, quantity: 2 }] }

  it('accepts lines, holds and a code, and normalises the code', () => {
    const parsed = quoteOrderRequestSchema.parse({
      ...quote,
      promoCode: ' save10 ',
      holdIds: [TT_ID_2],
    })

    expect(parsed.promoCode).toBe('SAVE10')
    expect(parsed.holdIds).toEqual([TT_ID_2])
  })

  it('carries nothing about the buyer', () => {
    const parsed = quoteOrderRequestSchema.parse({ ...quote, buyerEmail: 'a@example.com' })

    expect(parsed).not.toHaveProperty('buyerEmail')
  })

  it('refuses an empty basket and a repeated tier', () => {
    expect(issuePaths(quoteOrderRequestSchema.safeParse({ ...quote, items: [] }))).toEqual([
      'items',
    ])
    expect(
      issuePaths(
        quoteOrderRequestSchema.safeParse({
          ...quote,
          items: [
            { ticketTypeId: TT_ID, quantity: 1 },
            { ticketTypeId: TT_ID, quantity: 1 },
          ],
        }),
      ),
    ).toEqual(['items.1.ticketTypeId'])
  })
})

describe('session labels', () => {
  const session = {
    revision: 3,
    startsAt: '2026-10-03T23:30:00Z',
    endsAt: '2026-10-04T04:30:00Z',
    timezone: 'America/Chicago',
  }

  it('accepts a short label, trimmed', () => {
    expect(createSessionRequestSchema.parse({ ...session, label: ' Night 1 ' }).label).toBe(
      'Night 1',
    )
  })

  it('reads a blank label as none, and lets an update clear it', () => {
    expect(createSessionRequestSchema.parse({ ...session, label: '  ' }).label).toBeNull()
    expect(updateSessionRequestSchema.parse({ revision: 3, label: null })).toEqual({
      revision: 3,
      label: null,
    })
  })

  it('refuses a label over 60 characters or with control characters', () => {
    expect(
      createSessionRequestSchema.safeParse({ ...session, label: 'n'.repeat(61) }).success,
    ).toBe(false)
    expect(
      createSessionRequestSchema.safeParse({ ...session, label: 'Night\u00001' }).success,
    ).toBe(false)
  })
})

describe('admissionPreviewRequestSchema', () => {
  const credential = 'a'.repeat(43)

  it('upper-cases the printed code', () => {
    expect(admissionPreviewRequestSchema.parse({ code: 'de-8f3k2q-01' })).toEqual({
      code: 'DE-8F3K2Q-01',
    })
  })

  it('accepts the secure pass on its own, with the event the door expects', () => {
    expect(admissionPreviewRequestSchema.parse({ credential, expectedEventId: EVENT_ID })).toEqual({
      credential,
      expectedEventId: EVENT_ID,
    })
  })

  it('refuses a request that presents nothing, or presents both', () => {
    // Exactly one: two presentations would leave the server choosing which to
    // believe, and the method it records follows from the choice.
    expect(admissionPreviewRequestSchema.safeParse({}).success).toBe(false)
    expect(
      admissionPreviewRequestSchema.safeParse({ credential, code: 'DE-8F3K2Q-01' }).success,
    ).toBe(false)
  })

  it('refuses a pass that is not base64url and an empty code', () => {
    // The scanner sends what it read. Anything else is either a broken device
    // or somebody probing, and neither should reach a database lookup.
    expect(
      admissionPreviewRequestSchema.safeParse({ credential: `${'a'.repeat(40)}+/=` }).success,
    ).toBe(false)
    expect(admissionPreviewRequestSchema.safeParse({ code: '' }).success).toBe(false)
  })

  it.each([
    ['method', { method: 'QR_SCAN' }],
    ['eventId', { eventId: EVENT_ID }],
    ['previewReference', { previewReference: 'x'.repeat(40) }],
  ])('refuses %s rather than ignoring it', (_key, extra) => {
    // Strict, so a client that thinks it can choose one of these is told so.
    expect(
      admissionPreviewRequestSchema.safeParse({ code: 'DE-8F3K2Q-01', ...extra }).success,
    ).toBe(false)
  })
})

describe('checkInRequestSchema', () => {
  const credential = 'a'.repeat(43)
  const previewReference = `${'a'.repeat(40)}.${'b'.repeat(43)}`

  it('needs the reference the preview returned', () => {
    expect(checkInRequestSchema.safeParse({ code: 'DE-8F3K2Q-01' }).success).toBe(false)
    expect(checkInRequestSchema.parse({ code: 'de-8f3k2q-01', previewReference })).toEqual({
      code: 'DE-8F3K2Q-01',
      previewReference,
    })
  })

  it('accepts the secure pass with a gate and a self-reported device name', () => {
    expect(
      checkInRequestSchema.parse({
        credential,
        previewReference,
        gate: 'North',
        deviceId: 'ipad-3',
      }),
    ).toEqual({ credential, previewReference, gate: 'North', deviceId: 'ipad-3' })
    expect(
      checkInRequestSchema.parse({
        credential,
        previewReference,
        gate: ' North Gate ',
        deviceId: ' ipad 3 ',
      }),
    ).toEqual({ credential, previewReference, gate: 'North Gate', deviceId: 'ipad 3' })
  })

  it.each([
    ['a NUL in the gate', { gate: 'North\u0000' }],
    ['a tab inside the gate', { gate: 'North\tGate' }],
    ['a NUL in the device name', { deviceId: '\u0000ipad' }],
    ['DEL in the device name', { deviceId: 'ipad\u007f' }],
  ])('refuses %s, which the database would refuse as a 500', (_name, extra) => {
    expect(checkInRequestSchema.safeParse({ credential, previewReference, ...extra }).success).toBe(
      false,
    )
  })

  it('refuses a request that presents nothing, or presents both', () => {
    expect(checkInRequestSchema.safeParse({ previewReference, gate: 'North' }).success).toBe(false)
    expect(
      checkInRequestSchema.safeParse({ credential, code: 'DE-8F3K2Q-01', previewReference })
        .success,
    ).toBe(false)
  })

  it('refuses a reference with characters a signed one never has', () => {
    expect(
      checkInRequestSchema.safeParse({ code: 'DE-8F3K2Q-01', previewReference: 'a b.c' }).success,
    ).toBe(false)
    expect(
      checkInRequestSchema.safeParse({ code: 'DE-8F3K2Q-01', previewReference: 'short' }).success,
    ).toBe(false)
  })

  it.each([
    ['method', { method: 'MANUAL_CODE' }],
    ['checkedInAt', { checkedInAt: '2026-01-01T10:00:00.000Z' }],
    ['force', { force: true }],
    ['eventId', { eventId: EVENT_ID }],
  ])('refuses %s: the server decides it, not the client', (_key, extra) => {
    // `force` used to re-stamp an admission, `checkedInAt` to backdate one, and
    // a client-chosen method would make the record say whatever the scanner
    // liked. Each was stripped silently once; now each is a 400.
    expect(
      checkInRequestSchema.safeParse({ code: 'DE-8F3K2Q-01', previewReference, ...extra }).success,
    ).toBe(false)
  })

  it('takes the night the door is admitting to as an id, and nothing else in its place', () => {
    // Chosen at the door like the event, and checked by the server against the
    // ticket's own night and the event's nights: on an event of more than one
    // night a ticket for another is refused, and one good for every night is
    // admitted once on each.
    expect(
      checkInRequestSchema.parse({
        code: 'DE-8F3K2Q-01',
        previewReference,
        eventSessionId: EVENT_ID,
      }).eventSessionId,
    ).toBe(EVENT_ID)
    expect(
      admissionPreviewRequestSchema.parse({ code: 'DE-8F3K2Q-01', eventSessionId: EVENT_ID })
        .eventSessionId,
    ).toBe(EVENT_ID)

    for (const night of ['Night 2', '', 7, null]) {
      expect(
        checkInRequestSchema.safeParse({
          code: 'DE-8F3K2Q-01',
          previewReference,
          eventSessionId: night,
        }).success,
        String(night),
      ).toBe(false)
      expect(
        admissionPreviewRequestSchema.safeParse({ code: 'DE-8F3K2Q-01', eventSessionId: night })
          .success,
        String(night),
      ).toBe(false)
    }
  })
})

describe('group door requests', () => {
  const groupCredential = `G1.${'A'.repeat(43)}`
  const groupCode = 'DEG-ABCDEFGH2345'
  const previewReference = `${'a'.repeat(40)}.${'b'.repeat(43)}`
  const ticketIds = [EVENT_ID, TT_ID]

  it('takes the night the door is admitting to, as a single lookup does', () => {
    expect(
      groupAdmissionPreviewRequestSchema.parse({ code: groupCode, eventSessionId: EVENT_ID })
        .eventSessionId,
    ).toBe(EVENT_ID)
    expect(
      groupCheckInRequestSchema.parse({
        code: groupCode,
        previewReference,
        ticketIds,
        eventSessionId: EVENT_ID,
      }).eventSessionId,
    ).toBe(EVENT_ID)
    expect(
      groupCheckInRequestSchema.safeParse({
        code: groupCode,
        previewReference,
        ticketIds,
        eventSessionId: 'Night 2',
      }).success,
    ).toBe(false)
  })

  it('accepts a group QR or a typed group code, upper-casing the code', () => {
    expect(groupAdmissionPreviewRequestSchema.parse({ credential: groupCredential })).toEqual({
      credential: groupCredential,
    })
    expect(groupAdmissionPreviewRequestSchema.parse({ code: ' deg-abcdefgh2345 ' })).toEqual({
      code: groupCode,
    })
  })

  it('refuses no presentation, or two', () => {
    expect(groupAdmissionPreviewRequestSchema.safeParse({}).success).toBe(false)
    expect(
      groupAdmissionPreviewRequestSchema.safeParse({ credential: groupCredential, code: groupCode })
        .success,
    ).toBe(false)
    expect(groupCheckInRequestSchema.safeParse({ previewReference, ticketIds }).success).toBe(false)
    expect(
      groupCheckInRequestSchema.safeParse({
        credential: groupCredential,
        code: groupCode,
        previewReference,
        ticketIds,
      }).success,
    ).toBe(false)
  })

  it('refuses a ticket pass or a ticket code where a group one is expected', () => {
    // The shapes are disjoint by construction: a ticket credential has no `.`,
    // a ticket code no `DEG-` prefix and twelve-character body.
    expect(
      groupAdmissionPreviewRequestSchema.safeParse({ credential: 'a'.repeat(43) }).success,
    ).toBe(false)
    expect(
      groupAdmissionPreviewRequestSchema.safeParse({ code: 'DET-ABCDEFGH234567' }).success,
    ).toBe(false)
    expect(groupAdmissionPreviewRequestSchema.safeParse({ code: 'DEG-ABCDEFGH234O' }).success).toBe(
      false,
    )
    expect(
      groupAdmissionPreviewRequestSchema.safeParse({ credential: `G1.${'A'.repeat(42)}` }).success,
    ).toBe(false)
  })

  it.each([
    ['method', { method: 'QR_SCAN' }],
    ['ticketIds', { ticketIds: [EVENT_ID] }],
    ['previewReference', { previewReference }],
  ])('refuses %s on a group preview rather than ignoring it', (_key, extra) => {
    expect(
      groupAdmissionPreviewRequestSchema.safeParse({ code: groupCode, ...extra }).success,
    ).toBe(false)
  })

  it('confirms an explicit selection of one to fifty tickets, each named once', () => {
    expect(
      groupCheckInRequestSchema.parse({
        code: groupCode,
        previewReference,
        ticketIds,
        gate: 'North',
      }),
    ).toEqual({ code: groupCode, previewReference, ticketIds, gate: 'North' })
    expect(
      groupCheckInRequestSchema.safeParse({ code: groupCode, previewReference, ticketIds: [] })
        .success,
    ).toBe(false)
    expect(
      groupCheckInRequestSchema.safeParse({
        code: groupCode,
        previewReference,
        ticketIds: Array.from({ length: 51 }, () => EVENT_ID),
      }).success,
    ).toBe(false)
    expect(
      groupCheckInRequestSchema.safeParse({
        code: groupCode,
        previewReference,
        ticketIds: [EVENT_ID, EVENT_ID],
      }).success,
    ).toBe(false)
    expect(groupCheckInRequestSchema.safeParse({ code: groupCode, ticketIds }).success).toBe(false)
  })

  it.each([
    ['method', { method: 'MANUAL_CODE' }],
    ['checkedInAt', { checkedInAt: '2026-01-01T10:00:00.000Z' }],
    ['groupPassId', { groupPassId: EVENT_ID }],
  ])('refuses %s on a group confirmation', (_key, extra) => {
    expect(
      groupCheckInRequestSchema.safeParse({
        code: groupCode,
        previewReference,
        ticketIds,
        ...extra,
      }).success,
    ).toBe(false)
  })

  it.each([
    ['a NUL in the gate', { gate: 'North\u0000' }],
    ['a newline inside the gate', { gate: 'North\nGate' }],
    ['a NUL in the device name', { deviceId: 'ipad\u00003' }],
    ['a C1 control in the device name', { deviceId: 'ipad\u009b3' }],
  ])('refuses %s on a group confirmation', (_name, extra) => {
    expect(
      groupCheckInRequestSchema.safeParse({
        code: groupCode,
        previewReference,
        ticketIds,
        ...extra,
      }).success,
    ).toBe(false)
  })
})

describe('admissionEventsQuerySchema', () => {
  it('takes an organisation and a search, both optional', () => {
    expect(admissionEventsQuerySchema.parse({})).toEqual({})
    expect(admissionEventsQuerySchema.parse({ organizationId: ORG_ID, q: '  garba ' })).toEqual({
      organizationId: ORG_ID,
      q: 'garba',
    })
  })

  it('bounds the search and refuses anything else', () => {
    expect(admissionEventsQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false)
    expect(admissionEventsQuerySchema.safeParse({ q: '   ' }).success).toBe(false)
    expect(admissionEventsQuerySchema.safeParse({ organizationId: 'not a cuid' }).success).toBe(
      false,
    )
    expect(admissionEventsQuerySchema.safeParse({ page: '2' }).success).toBe(false)
  })

  it.each([
    ['NUL', 'gar\u0000ba'],
    ['a tab', 'gar\tba'],
    ['DEL', 'garba\u007f'],
    ['a C1 control', 'gar\u0085ba'],
  ])('refuses a search with %s in it, which the database would refuse as a 500', (_name, q) => {
    expect(admissionEventsQuerySchema.safeParse({ q }).success).toBe(false)
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
  // The organisation is the path's (`/v1/organizations/:id/promo-codes`), so
  // the body no longer names one.
  const base = { code: 'GARBA10', type: 'PERCENTAGE', value: 1000 }

  it('accepts a percentage code in basis points', () => {
    expect(createPromoCodeRequestSchema.parse(base)).toMatchObject({ value: 1000, active: true })
  })

  it('never takes the organisation from the body', () => {
    expect(
      createPromoCodeRequestSchema.parse({ ...base, organizationId: ORG_ID }),
    ).not.toHaveProperty('organizationId')
  })

  it('rejects a percentage above 100%', () => {
    expect(issuePaths(createPromoCodeRequestSchema.safeParse({ ...base, value: 10_001 }))).toEqual([
      'value',
    ])
  })

  it('allows a fixed amount larger than 10000 cents, in a named currency', () => {
    expect(
      createPromoCodeRequestSchema.safeParse({
        ...base,
        type: 'FIXED_AMOUNT',
        value: 50_000,
        currency: 'usd',
      }).success,
    ).toBe(true)
  })

  it('requires a currency for a fixed amount and refuses one for a percentage', () => {
    expect(
      issuePaths(
        createPromoCodeRequestSchema.safeParse({ ...base, type: 'FIXED_AMOUNT', value: 500 }),
      ),
    ).toEqual(['currency'])
    expect(
      issuePaths(createPromoCodeRequestSchema.safeParse({ ...base, currency: 'USD' })),
    ).toEqual(['currency'])
  })

  it('caps a fixed amount at 100,000.00', () => {
    const fixed = { ...base, type: 'FIXED_AMOUNT', currency: 'USD' }

    expect(createPromoCodeRequestSchema.safeParse({ ...fixed, value: 10_000_000 }).success).toBe(
      true,
    )
    expect(
      issuePaths(createPromoCodeRequestSchema.safeParse({ ...fixed, value: 10_000_001 })),
    ).toEqual(['value'])
  })

  it('needs at least one redemption when a cap is set', () => {
    expect(
      issuePaths(createPromoCodeRequestSchema.safeParse({ ...base, maxRedemptions: 0 })),
    ).toEqual(['maxRedemptions'])
    expect(createPromoCodeRequestSchema.parse({ ...base, maxRedemptions: null })).toMatchObject({
      maxRedemptions: null,
    })
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

describe('promo code listing and path parameters', () => {
  it('filters by event and status, and pages', () => {
    expect(
      listPromoCodesQuerySchema.parse({ eventId: EVENT_ID, status: 'PAUSED', page: '2' }),
    ).toMatchObject({ eventId: EVENT_ID, status: 'PAUSED', page: 2 })
    expect(listPromoCodesQuerySchema.safeParse({ status: 'EXPIRED' }).success).toBe(false)
  })

  it('names the organisation and the code', () => {
    expect(organizationPromoCodeParamSchema.parse({ id: ORG_ID, promoCodeId: TT_ID })).toEqual({
      id: ORG_ID,
      promoCodeId: TT_ID,
    })
    expect(organizationPromoCodeParamSchema.safeParse({ id: ORG_ID }).success).toBe(false)
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
