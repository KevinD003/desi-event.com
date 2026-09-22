import { describe, expect, it } from 'vitest'

import {
  authResponseSchema,
  buildPaginationMeta,
  checkInResponseSchema,
  errorResponseSchema,
  eventDetailResponseSchema,
  eventListResponseSchema,
  healthResponseSchema,
  holdResponseSchema,
  okResponseSchema,
  orderResponseSchema,
  organizationResponseSchema,
  paginationMetaSchema,
  myTicketListResponseSchema,
  ticketPassResponseSchema,
  ticketTypeListResponseSchema,
  walletTicketSchema,
} from './responses.js'
import { orderTicketSchema } from './entities.js'
import { ValidationError, parseOrThrow } from './errors.js'

const ids = {
  user: 'ckl1a2b3c4d5e6f7g8h9i0jk',
  org: 'ckl1a2b3c4d5e6f7g8h9i0jl',
  venue: 'ckl1a2b3c4d5e6f7g8h9i0jm',
  event: 'ckl1a2b3c4d5e6f7g8h9i0jn',
  ticketType: 'ckl1a2b3c4d5e6f7g8h9i0jo',
  order: 'ckl1a2b3c4d5e6f7g8h9i0jp',
  orderItem: 'ckl1a2b3c4d5e6f7g8h9i0jq',
  ticket: 'ckl1a2b3c4d5e6f7g8h9i0jr',
}

const publicUser = {
  id: ids.user,
  email: 'priya@example.com',
  displayName: 'Priya Sharma',
  locale: 'en-IN',
  role: 'ORGANIZER',
  emailVerified: true,
}

const eventSummary = {
  id: ids.event,
  organizationId: ids.org,
  title: 'Navratri Nights 2026',
  slug: 'navratri-nights-2026',
  summary: 'Nine nights of garba',
  category: 'GARBA_DANDIYA',
  status: 'PUBLISHED',
  startsAt: '2026-10-01T13:00:00Z',
  endsAt: '2026-10-01T18:30:00Z',
}

const eventDetail = {
  ...eventSummary,
  description: 'Live dhol and professional instructors.',
  timezone: 'Asia/Kolkata',
  isOnline: false,
  languages: ['Gujarati'],
}

describe('buildPaginationMeta', () => {
  it('computes the page count and the navigation flags', () => {
    expect(buildPaginationMeta({ page: 1, perPage: 20, total: 45 })).toEqual({
      page: 1,
      perPage: 20,
      total: 45,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false,
    })
  })

  it('marks the last page correctly', () => {
    expect(buildPaginationMeta({ page: 3, perPage: 20, total: 45 })).toMatchObject({
      totalPages: 3,
      hasNextPage: false,
      hasPreviousPage: true,
    })
  })

  it('handles an exact multiple', () => {
    expect(buildPaginationMeta({ page: 2, perPage: 20, total: 40 })).toMatchObject({
      totalPages: 2,
      hasNextPage: false,
    })
  })

  it('handles an empty result set without claiming a previous page', () => {
    expect(buildPaginationMeta({ page: 1, perPage: 20, total: 0 })).toEqual({
      page: 1,
      perPage: 20,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    })
  })

  it('does not divide by zero', () => {
    expect(buildPaginationMeta({ page: 1, perPage: 0, total: 10 }).totalPages).toBe(0)
  })

  it('produces output that satisfies paginationMetaSchema', () => {
    expect(
      paginationMetaSchema.safeParse(buildPaginationMeta({ page: 2, perPage: 10, total: 31 }))
        .success,
    ).toBe(true)
  })
})

describe('authResponseSchema', () => {
  it('defaults the token type and lifetime', () => {
    expect(authResponseSchema.parse({ token: 'jwt.value.here', user: publicUser })).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: '7d',
    })
  })

  it('never lets a password hash through', () => {
    const parsed = authResponseSchema.parse({
      token: 'jwt',
      user: { ...publicUser, passwordHash: '$2b$10$leak' },
    })
    expect(parsed.user).not.toHaveProperty('passwordHash')
  })

  it('rejects an empty token', () => {
    expect(authResponseSchema.safeParse({ token: '', user: publicUser }).success).toBe(false)
  })
})

describe('eventListResponseSchema', () => {
  it('accepts a page of summaries with its metadata', () => {
    const parsed = eventListResponseSchema.parse({
      data: [eventSummary],
      pagination: buildPaginationMeta({ page: 1, perPage: 20, total: 1 }),
    })
    expect(parsed.data).toHaveLength(1)
  })

  it('accepts an empty page', () => {
    expect(
      eventListResponseSchema.safeParse({
        data: [],
        pagination: buildPaginationMeta({ page: 1, perPage: 20, total: 0 }),
      }).success,
    ).toBe(true)
  })

  it('rejects a payload with no pagination block', () => {
    expect(eventListResponseSchema.safeParse({ data: [] }).success).toBe(false)
  })
})

describe('eventDetailResponseSchema', () => {
  it('wraps the event and its relations under data', () => {
    const parsed = eventDetailResponseSchema.parse({
      data: { ...eventDetail, ticketTypes: [] },
    })
    expect(parsed.data.slug).toBe('navratri-nights-2026')
  })

  it('rejects an unwrapped event', () => {
    expect(eventDetailResponseSchema.safeParse(eventDetail).success).toBe(false)
  })
})

describe('orderResponseSchema', () => {
  it('wraps an order with its line items', () => {
    const parsed = orderResponseSchema.parse({
      data: {
        id: ids.order,
        reference: 'DE-8F3K2Q',
        eventId: ids.event,
        buyerEmail: 'priya@example.com',
        buyerName: 'Priya Sharma',
        status: 'PAID',
        currency: 'INR',
        subtotalCents: 299800,
        totalCents: 285938,
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
      },
    })
    expect(parsed.data.items[0].quantity).toBe(2)
    expect(parsed.data.discountCents).toBe(0)
  })
})

describe('ticketTypeListResponseSchema', () => {
  it('folds live availability into each ticket type', () => {
    const parsed = ticketTypeListResponseSchema.parse({
      data: [
        {
          id: ids.ticketType,
          eventId: ids.event,
          name: 'Early Bird',
          priceCents: 149900,
          quantityTotal: 500,
          quantitySold: 120,
          availableQuantity: 375,
          isSoldOut: false,
        },
      ],
    })
    expect(parsed.data[0].availableQuantity).toBe(375)
  })
})

describe('holdResponseSchema and checkInResponseSchema', () => {
  it('describes a hold', () => {
    const parsed = holdResponseSchema.parse({
      data: {
        id: ids.order,
        ticketTypeId: ids.ticketType,
        quantity: 2,
        expiresAt: new Date('2026-08-10T12:10:00Z'),
      },
    })
    expect(parsed.data.expiresAt).toBe('2026-08-10T12:10:00.000Z')
  })

  it('describes a door scan, defaulting alreadyCheckedIn', () => {
    const parsed = checkInResponseSchema.parse({
      data: {
        ticket: { id: ids.ticket, orderItemId: ids.orderItem, code: 'DE-8F3K2Q-01' },
        // Both required and both nullable: a door always gets an answer to
        // "when was this first admitted" and "who does it say", even when the
        // answer is "it has not been" and "nobody wrote a name".
        checkedInAt: null,
        attendeeName: null,
      },
    })
    expect(parsed.data.alreadyCheckedIn).toBe(false)
    expect(parsed.data.ticket.status).toBe('VALID')
  })

  it('carries the first admission time on a re-scan', () => {
    const parsed = checkInResponseSchema.parse({
      data: {
        ticket: { id: ids.ticket, orderItemId: ids.orderItem, code: 'DE-8F3K2Q-01' },
        alreadyCheckedIn: true,
        checkedInAt: '2026-09-16T18:30:00.000Z',
        attendeeName: 'Priya Sharma',
      },
    })

    // What the person on the door actually needs when a pass scans twice: when
    // it went through the first time, not merely that it did.
    expect(parsed.data.checkedInAt).toBe('2026-09-16T18:30:00.000Z')
    expect(parsed.data.attendeeName).toBe('Priya Sharma')
  })
})

describe('errorResponseSchema', () => {
  it('accepts an envelope with issues', () => {
    const parsed = errorResponseSchema.parse({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        issues: [{ path: 'items[0].quantity', code: 'too_small', message: 'Too small' }],
        requestId: 'req_123',
      },
    })
    expect(parsed.error.issues).toHaveLength(1)
  })

  it('accepts a ValidationError serialised with toJSON', () => {
    let thrown
    try {
      parseOrThrow(paginationMetaSchema, {}, 'Bad')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ValidationError)
    expect(errorResponseSchema.safeParse({ error: thrown.toJSON() }).success).toBe(true)
  })

  it('rejects an out-of-range status code and a missing message', () => {
    expect(
      errorResponseSchema.safeParse({ error: { code: 'X', message: 'Y', statusCode: 99 } }).success,
    ).toBe(false)
    expect(errorResponseSchema.safeParse({ error: { code: 'X', statusCode: 400 } }).success).toBe(
      false,
    )
  })
})

describe('healthResponseSchema', () => {
  it('accepts a full health report', () => {
    const parsed = healthResponseSchema.parse({
      status: 'ok',
      uptimeSeconds: 12.5,
      version: '0.1.0',
      logLevel: 'info',
      timestamp: new Date('2026-08-10T12:00:00Z'),
      checks: { database: true, redis: true },
    })
    expect(parsed.timestamp).toBe('2026-08-10T12:00:00.000Z')
  })

  it('accepts a minimal report and a degraded one', () => {
    expect(
      healthResponseSchema.safeParse({ status: 'ok', timestamp: '2026-08-10T12:00:00Z' }).success,
    ).toBe(true)
    expect(
      healthResponseSchema.safeParse({
        status: 'degraded',
        timestamp: '2026-08-10T12:00:00Z',
        checks: { redis: false },
      }).success,
    ).toBe(true)
  })

  it('rejects an unknown status', () => {
    expect(
      healthResponseSchema.safeParse({ status: 'fine', timestamp: '2026-08-10T12:00:00Z' }).success,
    ).toBe(false)
  })
})

describe('simple envelopes', () => {
  it('okResponseSchema only accepts true', () => {
    expect(okResponseSchema.parse({ ok: true })).toEqual({ ok: true })
    expect(okResponseSchema.safeParse({ ok: false }).success).toBe(false)
  })

  it('organization and venue envelopes wrap their entity', () => {
    expect(
      organizationResponseSchema.safeParse({
        data: {
          id: ids.org,
          name: 'Rhythm Collective',
          slug: 'rhythm-collective',
          contactEmail: 'hello@rhythm.example',
        },
      }).success,
    ).toBe(true)
  })
})

describe('what the response schemas refuse to carry', () => {
  /** Every forbidden item, planted on one hostile payload. */
  const FORBIDDEN = Object.freeze({
    ownerUserId: 'usr_somebody',
    credential: 'THE-ACTUAL-BEARER-SECRET',
    credentialHash: 'd'.repeat(64),
    credentialVersion: 7,
    credentialIssuedAt: '2026-01-01T00:00:00.000Z',
    buyerEmail: 'buyer@example.test',
    transferToken: 'RAW-TRANSFER-TOKEN',
    tokenHash: 'e'.repeat(64),
    guestToken: 'RAW-GUEST-TOKEN',
    guestTokenHash: 'f'.repeat(64),
    providerRef: 'pi_live_should_never_be_here',
    connectedAccountId: 'acct_should_never_be_here',
    providerPayoutId: 'po_should_never_be_here',
    internalNotes: 'an internal note',
    auditMetadata: { actorId: 'usr_admin' },
  })

  /** A minimal valid wallet row, so only the planted keys are in question. */
  const wallet = {
    id: 'c1aaaaaaaaaaaaaaaaaaaaaaa',
    orderItemId: 'c1bbbbbbbbbbbbbbbbbbbbbbb',
    code: 'DE-ABCD-1234',
    attendeeName: 'Priya Sharma',
    status: 'VALID',
    checkedInAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    holderRelationship: 'PURCHASED',
    admits: true,
    admissionRefusal: null,
    orderReference: 'DE-BUYER1',
    event: {
      id: 'c1ccccccccccccccccccccccc',
      slug: 'garba-night',
      title: 'Garba Night',
      startsAt: '2026-10-01T14:00:00.000Z',
      endsAt: '2026-10-01T19:00:00.000Z',
      timezone: 'Asia/Kolkata',
      status: 'ON_SALE',
      cancelledAt: null,
    },
    venue: { name: 'Hall', city: 'Pune', region: 'MH', country: 'IN' },
    isOnline: false,
    tier: { id: 'c1ddddddddddddddddddddddd', name: 'General admission' },
    seat: null,
    pendingTransfer: null,
    revokedAt: null,
    revokedReason: null,
  }

  it('strips every forbidden key from a wallet row', () => {
    // Not "the presenter does not add them" — this is the second layer. Even a
    // presenter that regressed and handed the raw row through would produce a
    // payload with none of these on it, because Zod strips what it does not
    // declare rather than erroring on it.
    const parsed = walletTicketSchema.parse({ ...wallet, ...FORBIDDEN })

    for (const key of Object.keys(FORBIDDEN)) {
      expect(parsed[key], `${key} survived the schema`).toBeUndefined()
    }

    expect(JSON.stringify(parsed)).not.toContain('THE-ACTUAL-BEARER-SECRET')
    expect(JSON.stringify(parsed)).not.toContain('RAW-TRANSFER-TOKEN')
    expect(JSON.stringify(parsed)).not.toContain('buyer@example.test')
  })

  it('strips them from the list response, not merely from one row', () => {
    const parsed = myTicketListResponseSchema.parse({
      data: [{ ...wallet, ...FORBIDDEN }],
      pagination: {
        page: 1,
        perPage: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })

    expect(JSON.stringify(parsed)).not.toContain('THE-ACTUAL-BEARER-SECRET')
    expect(parsed.data[0].credentialHash).toBeUndefined()
  })

  it('strips a raw token planted inside the pending transfer', () => {
    const parsed = walletTicketSchema.parse({
      ...wallet,
      pendingTransfer: {
        id: 'c1eeeeeeeeeeeeeeeeeeeeeee',
        toEmailMasked: 'p****a@example.com',
        expiresAt: '2026-02-01T00:00:00.000Z',
        token: 'RAW-TRANSFER-TOKEN',
        tokenHash: 'e'.repeat(64),
        toEmail: 'priya@example.com',
      },
    })

    expect(parsed.pendingTransfer.token).toBeUndefined()
    expect(parsed.pendingTransfer.tokenHash).toBeUndefined()
    expect(parsed.pendingTransfer.toEmail).toBeUndefined()
    expect(JSON.stringify(parsed)).not.toContain('priya@example.com')
  })

  it('refuses an unmasked recipient address outright', () => {
    // The one place the schema does more than strip. Masking is a single call
    // in a single presenter; a schema that accepted `z.string()` would notice
    // nothing at all if that call were dropped, and the failure would be a
    // harvestable recipient list. Now it is a 500 instead.
    const unmasked = walletTicketSchema.safeParse({
      ...wallet,
      pendingTransfer: {
        id: 'c1eeeeeeeeeeeeeeeeeeeeeee',
        toEmailMasked: 'priya@example.com',
        expiresAt: '2026-02-01T00:00:00.000Z',
      },
    })

    expect(unmasked.success).toBe(false)
  })

  it('strips every forbidden key from an order ticket', () => {
    const parsed = orderTicketSchema.parse({
      id: 'c1aaaaaaaaaaaaaaaaaaaaaaa',
      orderItemId: 'c1bbbbbbbbbbbbbbbbbbbbbbb',
      code: 'DE-ABCD-1234',
      attendeeName: null,
      status: 'TRANSFERRED',
      checkedInAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      purchaserHolding: 'TRANSFERRED_AWAY',
      supersededByLaterTicket: false,
      ...FORBIDDEN,
    })

    for (const key of Object.keys(FORBIDDEN)) {
      expect(parsed[key], `${key} survived the schema`).toBeUndefined()
    }
  })

  it('will not accept an ownership classification it does not know', () => {
    // A Boolean could be flipped by a typo and stay valid. An enum cannot.
    const wrong = orderTicketSchema.safeParse({
      id: 'c1aaaaaaaaaaaaaaaaaaaaaaa',
      orderItemId: 'c1bbbbbbbbbbbbbbbbbbbbbbb',
      code: 'DE-ABCD-1234',
      status: 'VALID',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      purchaserHolding: 'MAYBE',
      supersededByLaterTicket: false,
    })

    expect(wrong.success).toBe(false)
  })

  it('carries no credential on the pass response beyond the one field that is its job', () => {
    const parsed = ticketPassResponseSchema.parse({
      data: {
        ticketId: 'c1aaaaaaaaaaaaaaaaaaaaaaa',
        credential: 'THE-ACTUAL-BEARER-SECRET',
        credentialVersion: 2,
        issuedAt: '2026-01-01T00:00:00.000Z',
        credentialHash: 'd'.repeat(64),
        ownerUserId: 'usr_somebody',
        attendeeName: 'Priya Sharma',
      },
    })

    expect(parsed.data.credential).toBe('THE-ACTUAL-BEARER-SECRET')
    // Everything else about the ticket is somewhere else. A payload that mixed
    // a secret with the things a screen wants to show is a payload something
    // eventually caches.
    expect(parsed.data.credentialHash).toBeUndefined()
    expect(parsed.data.ownerUserId).toBeUndefined()
    expect(parsed.data.attendeeName).toBeUndefined()
  })
})
