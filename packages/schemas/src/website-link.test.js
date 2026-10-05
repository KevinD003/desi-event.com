/**
 * The website link's request and response shapes: the administrators' list,
 * the web tier's lookup, the decision's answer and the event detail's keys.
 */

import { describe, expect, it } from 'vitest'

import { eventWithRelationsSchema } from './entities.js'
import {
  WEBSITE_LINK_STATES,
  websiteLinkListQuerySchema,
  websiteVisitRequestSchema,
} from './requests.js'
import {
  websiteLinkListResponseSchema,
  websiteLinkRowSchema,
  websiteRedirectResponseSchema,
  websiteVisitResponseSchema,
} from './responses.js'

const ID = 'ckv9w1p0a0000qz0l7h2k3m4n'

/** The switch as an insider reads it, off and never decided. */
const OFF = Object.freeze({
  enabled: false,
  pending: true,
  decidedUrl: null,
  submittedAt: '2026-09-30T10:00:00.000Z',
  changedAt: null,
  reason: null,
  changedByName: null,
  websiteProblem: null,
})

describe('websiteLinkListQuerySchema', () => {
  it('defaults to the waiting list and pages like every list', () => {
    expect(websiteLinkListQuerySchema.parse({})).toMatchObject({
      state: 'waiting',
      page: 1,
    })
  })

  it('takes each of the five states and nothing else', () => {
    expect(WEBSITE_LINK_STATES).toEqual(['waiting', 'drafts', 'on', 'off', 'all'])

    for (const state of WEBSITE_LINK_STATES) {
      expect(websiteLinkListQuerySchema.parse({ state }).state).toBe(state)
    }

    expect(websiteLinkListQuerySchema.safeParse({ state: 'pending' }).success).toBe(false)
  })

  it('reads a blank search as none, and bounds and cleans a real one', () => {
    expect(websiteLinkListQuerySchema.parse({ q: '   ' }).q).toBeUndefined()
    expect(websiteLinkListQuerySchema.parse({ q: ' garba ' }).q).toBe('garba')
    expect(websiteLinkListQuerySchema.safeParse({ q: 'a' }).success).toBe(false)
    expect(websiteLinkListQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false)
    expect(websiteLinkListQuerySchema.safeParse({ q: 'ga\u0000rba' }).success).toBe(false)
  })
})

describe('websiteVisitRequestSchema', () => {
  it('takes a slug and whether to count, and nothing else', () => {
    expect(websiteVisitRequestSchema.parse({ slug: 'Garba-Night', counted: true })).toEqual({
      slug: 'garba-night',
      counted: true,
    })
    expect(websiteVisitRequestSchema.safeParse({ slug: 'garba-night' }).success).toBe(false)
    // Strict: a destination in the body is refused, never read.
    expect(
      websiteVisitRequestSchema.safeParse({
        slug: 'garba-night',
        counted: true,
        url: 'https://evil.example/',
      }).success,
    ).toBe(false)
    expect(websiteVisitRequestSchema.safeParse({ slug: '../admin', counted: true }).success).toBe(
      false,
    )
  })
})

describe('the website link responses', () => {
  it('answers a lookup with one address and nothing else', () => {
    expect(
      websiteVisitResponseSchema.safeParse({ data: { url: 'https://a.example/' } }).success,
    ).toBe(true)
    expect(
      websiteVisitResponseSchema.safeParse({
        data: { url: 'https://a.example/', eventId: ID },
      }).success,
    ).toBe(false)
  })

  it('carries each list row in full, strictly', () => {
    const row = {
      eventId: ID,
      slug: 'garba-night',
      title: 'Garba night',
      status: 'ON_SALE',
      organizationName: 'Rangoli',
      organizationVerified: true,
      websiteUrl: 'https://a.example/',
      websiteHost: 'a.example',
      websiteDecidedUrl: null,
      websiteSubmittedAt: '2026-09-30T10:00:00.000Z',
      pagePublic: true,
      redirect: OFF,
    }

    expect(websiteLinkRowSchema.safeParse(row).success).toBe(true)
    expect(websiteLinkRowSchema.safeParse({ ...row, websiteUrl: null }).success).toBe(true)
    expect(websiteLinkRowSchema.safeParse({ ...row, organizerEmail: 'x@y.z' }).success).toBe(false)
    expect(
      websiteLinkListResponseSchema.safeParse({
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

  it('answers a decision with the switch and what the public page shows', () => {
    const answer = {
      data: {
        eventId: ID,
        websiteUrl: 'https://a.example/',
        websiteLink: { host: 'a.example' },
        redirect: { ...OFF, enabled: true, pending: false, decidedUrl: 'https://a.example/' },
      },
    }

    expect(websiteRedirectResponseSchema.safeParse(answer).success).toBe(true)
    expect(
      websiteRedirectResponseSchema.safeParse({
        data: { ...answer.data, websiteLink: { host: 'a.example', url: 'https://a.example/' } },
      }).success,
    ).toBe(false)
  })
})

describe('the event detail website keys', () => {
  /** The smallest event detail the schema accepts. */
  const detail = {
    id: ID,
    organizationId: ID,
    title: 'Garba night',
    slug: 'garba-night',
    summary: 'Dance',
    description: 'All night.',
    category: 'GARBA_DANDIYA',
    status: 'PUBLISHED',
    startsAt: '2027-03-01T18:00:00.000Z',
    endsAt: '2027-03-01T22:00:00.000Z',
    timezone: 'America/Chicago',
    isOnline: false,
  }

  it('always carries websiteLink, null by default, and leaves the insider keys absent', () => {
    const parsed = eventWithRelationsSchema.parse(detail)

    expect(parsed.websiteLink).toBeNull()
    expect(parsed).not.toHaveProperty('websiteUrl')
    expect(parsed).not.toHaveProperty('websiteRedirect')
  })

  it('carries the host only, never an address, in websiteLink', () => {
    expect(
      eventWithRelationsSchema.parse({ ...detail, websiteLink: { host: 'a.example' } }).websiteLink,
    ).toEqual({ host: 'a.example' })
    expect(
      eventWithRelationsSchema.safeParse({
        ...detail,
        websiteLink: { host: 'a.example', url: 'https://a.example/' },
      }).success,
    ).toBe(false)
  })

  it('passes the insider keys through when the presenter gives them', () => {
    const parsed = eventWithRelationsSchema.parse({
      ...detail,
      websiteUrl: 'https://a.example/',
      websiteRedirect: OFF,
    })

    expect(parsed.websiteUrl).toBe('https://a.example/')
    expect(parsed.websiteRedirect).toEqual(OFF)
  })
})
