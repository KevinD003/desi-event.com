import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  analyticsTrafficSchema,
  trafficBeaconResponseSchema,
  trafficEventListResponseSchema,
} from './responses.js'
import { trafficBeaconRequestSchema, trafficEventsQuerySchema, utcDaySchema } from './traffic.js'
import * as barrel from './index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const EVENT = 'cevent00000000000000001'

/**
 * Parse a beacon and say whether it was accepted.
 *
 * @param {object} body A beacon body.
 * @returns {boolean} Whether it parsed.
 */
function accepts(body) {
  return trafficBeaconRequestSchema.safeParse(body).success
}

/**
 * The paths of the issues a refused beacon carries.
 *
 * @param {object} body A beacon body.
 * @returns {string[]} The dotted issue paths.
 */
function issuePaths(body) {
  const result = trafficBeaconRequestSchema.safeParse(body)

  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
}

describe('a traffic beacon', () => {
  it.each([
    null,
    'SAME_SITE',
    'OTHER_SITE',
    'www.google.com',
    'l.instagram.com',
    'xn--bcher-kva.example',
  ])('accepts a page view whose referrer is %s', (referrer) => {
    expect(accepts({ eventId: EVENT, kind: 'PAGE_VIEW', placement: 'EVENT_PAGE', referrer })).toBe(
      true,
    )
  })

  it('accepts a page view that says nothing about its referrer', () => {
    expect(accepts({ eventId: EVENT, kind: 'PAGE_VIEW', placement: 'EVENT_PAGE' })).toBe(true)
  })

  it.each(['HOME', 'LISTING', 'SEARCH'])('accepts a card click on %s', (placement) => {
    expect(accepts({ eventId: EVENT, kind: 'CARD_CLICK', placement })).toBe(true)
  })

  it.each(['TICKETS_CLICK', 'SEATS_CLICK'])('accepts %s on the event page', (kind) => {
    expect(accepts({ eventId: EVENT, kind, placement: 'EVENT_PAGE' })).toBe(true)
  })

  it('refuses a card click on the event page, and a ticket click on a listing', () => {
    expect(issuePaths({ eventId: EVENT, kind: 'CARD_CLICK', placement: 'EVENT_PAGE' })).toEqual([
      'placement',
    ])
    expect(issuePaths({ eventId: EVENT, kind: 'TICKETS_CLICK', placement: 'LISTING' })).toEqual([
      'placement',
    ])
  })

  it('refuses an organiser-page placement, which is not counted', () => {
    expect(accepts({ eventId: EVENT, kind: 'CARD_CLICK', placement: 'ORGANISER_PAGE' })).toBe(false)
  })

  it('refuses a website visit from a browser: only the server counts those', () => {
    expect(accepts({ eventId: EVENT, kind: 'WEBSITE_REDIRECT', placement: 'EVENT_PAGE' })).toBe(
      false,
    )
  })

  it('requires a placement', () => {
    expect(issuePaths({ eventId: EVENT, kind: 'PAGE_VIEW' })).toContain('placement')
  })

  it('refuses a referrer on a click, even a null one', () => {
    expect(
      issuePaths({ eventId: EVENT, kind: 'CARD_CLICK', placement: 'HOME', referrer: null }),
    ).toEqual(['referrer'])
    expect(
      issuePaths({
        eventId: EVENT,
        kind: 'TICKETS_CLICK',
        placement: 'EVENT_PAGE',
        referrer: 'SAME_SITE',
      }),
    ).toEqual(['referrer'])
  })

  it.each([
    'https://google.com',
    'google.com/search?q=x',
    'google.com:443',
    'user@google.com',
    'GOOGLE.COM',
    'a..b',
    '',
    '203.0.113.9 ',
  ])('refuses the referrer %j, which is not a bare lower-case host', (referrer) => {
    expect(accepts({ eventId: EVENT, kind: 'PAGE_VIEW', placement: 'EVENT_PAGE', referrer })).toBe(
      false,
    )
  })

  it.each(['url', 'ip', 'userAgent', 'referrerUrl', 'visitorHash', 'organizationId'])(
    'refuses an extra key, %s, so a client cannot start sending what is not kept',
    (key) => {
      expect(
        accepts({ eventId: EVENT, kind: 'PAGE_VIEW', placement: 'EVENT_PAGE', [key]: 'x' }),
      ).toBe(false)
    },
  )

  it.each(['', 'C123', 'cevent', `${EVENT} `, 'cevent0000000000000000000000000001', '../x'])(
    'refuses the event reference %j',
    (eventId) => {
      expect(accepts({ eventId, kind: 'PAGE_VIEW', placement: 'EVENT_PAGE' })).toBe(false)
    },
  )
})

describe('the platform list query', () => {
  it('defaults to public events and the first page', () => {
    const query = trafficEventsQuerySchema.parse({})

    expect(query.scope).toBe('public')
    expect(query.page).toBe(1)
  })

  it('takes every filter as a URL carries it', () => {
    const query = trafficEventsQuerySchema.parse({
      q: '  garba  ',
      scope: 'all',
      organizationId: 'corg000000000000000001',
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
      page: '2',
      perPage: '50',
    })

    expect(query).toMatchObject({ q: 'garba', scope: 'all', page: 2, perPage: 50 })
  })

  it.each(['gar\u0000ba', 'gar\u0007ba', 'line\nbreak'])(
    'refuses a search with a control character (%j)',
    (q) => {
      expect(trafficEventsQuerySchema.safeParse({ q }).success).toBe(false)
    },
  )

  it('refuses an unknown scope and an overlong search', () => {
    expect(trafficEventsQuerySchema.safeParse({ scope: 'everything' }).success).toBe(false)
    expect(trafficEventsQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false)
  })
})

describe('utcDaySchema', () => {
  it('takes a day and nothing else', () => {
    expect(utcDaySchema.safeParse('2026-10-01').success).toBe(true)
    expect(utcDaySchema.safeParse('2026-10-01T00:00:00Z').success).toBe(false)
    expect(utcDaySchema.safeParse('1 Oct 2026').success).toBe(false)
  })
})

/**
 * A traffic branch with every list at its required length.
 *
 * @param {object} [overrides] Fields to replace.
 * @returns {object} A traffic branch.
 */
function trafficBranch(overrides = {}) {
  const zero = {
    views: 0,
    visitors: 0,
    anonymousViews: 0,
    cardClicks: 0,
    ticketClicks: 0,
    seatClicks: 0,
    ticketClickVisitors: 0,
    websiteRedirects: 0,
    websiteRedirectVisitors: 0,
  }

  return {
    timeZone: 'UTC',
    firstDay: null,
    lastDay: '2026-10-01',
    updatedAt: null,
    stale: false,
    includesDemonstration: false,
    totals: zero,
    sources: ['DIRECT', 'INTERNAL', 'SEARCH', 'SOCIAL', 'OTHER'].map((source) => ({
      source,
      views: 0,
    })),
    cardPlacements: ['HOME', 'LISTING', 'SEARCH'].map((placement) => ({ placement, clicks: 0 })),
    byDay: [],
    seriesTruncated: false,
    byEvent: [],
    conversion: { visitors: 0, ticketClickVisitors: 0, ordersPaid: 0, visitorToOrderPercent: null },
    event: null,
    ...overrides,
  }
}

describe('the traffic answers', () => {
  it('accepts a whole traffic branch', () => {
    expect(analyticsTrafficSchema.safeParse(trafficBranch()).success).toBe(true)
  })

  it('has every source and every card place, and no organiser page', () => {
    const fourSources = trafficBranch().sources.slice(0, 4)
    const organiserPage = [
      ...trafficBranch().cardPlacements,
      { placement: 'ORGANISER_PAGE', clicks: 0 },
    ]

    expect(analyticsTrafficSchema.safeParse(trafficBranch({ sources: fourSources })).success).toBe(
      false,
    )
    expect(
      analyticsTrafficSchema.safeParse(trafficBranch({ cardPlacements: organiserPage })).success,
    ).toBe(false)
  })

  it('caps the per-day series at 366 days', () => {
    const day = {
      day: '2026-10-01',
      views: 0,
      visitors: 0,
      cardClicks: 0,
      ticketClicks: 0,
      seatClicks: 0,
      websiteRedirects: 0,
      ordersPaid: 0,
    }

    expect(
      analyticsTrafficSchema.safeParse(trafficBranch({ byDay: Array(366).fill(day) })).success,
    ).toBe(true)
    expect(
      analyticsTrafficSchema.safeParse(trafficBranch({ byDay: Array(367).fill(day) })).success,
    ).toBe(false)
  })

  it('says the beacon was accepted and nothing else', () => {
    expect(trafficBeaconResponseSchema.safeParse({ data: { accepted: true } }).success).toBe(true)
    expect(trafficBeaconResponseSchema.safeParse({ data: { accepted: false } }).success).toBe(false)
  })

  it('names no visitor code, digest, salt, address, agent or referrer anywhere in its shape', () => {
    const forbidden = /hash|dedupe|salt|address|agent|referr|fingerprint|cents|amount|email/iu

    /**
     * Every key of a zod object schema, however deeply nested.
     *
     * @param {object} schema A zod schema.
     * @param {string[]} keys Collected so far.
     * @returns {string[]} The keys.
     */
    function keysOf(schema, keys = []) {
      const def = schema?._zod?.def ?? schema?.def

      if (!def) return keys
      if (def.type === 'object') {
        for (const [key, child] of Object.entries(def.shape)) {
          keys.push(key)
          keysOf(child, keys)
        }
      }
      if (def.type === 'array') keysOf(def.element, keys)
      if (def.type === 'nullable' || def.type === 'optional') keysOf(def.innerType, keys)
      if (def.type === 'pipe') keysOf(def.out, keys)

      return keys
    }

    for (const schema of [analyticsTrafficSchema, trafficEventListResponseSchema]) {
      const keys = keysOf(schema)

      expect(keys.length).toBeGreaterThan(20)
      expect(keys.filter((key) => forbidden.test(key))).toEqual([])
    }
  })
})

describe('the module', () => {
  it('does not import the response schemas, so the barrel has no cycle through it', () => {
    const source = readFileSync(path.join(here, 'traffic.js'), 'utf8')

    expect(source).not.toMatch(/from '\.\/responses\.js'/u)
  })

  it('is on the barrel', () => {
    expect(barrel.trafficBeaconRequestSchema).toBe(trafficBeaconRequestSchema)
    expect(barrel.trafficEventsQuerySchema).toBe(trafficEventsQuerySchema)
    expect(barrel.analyticsTrafficSchema).toBe(analyticsTrafficSchema)
  })
})
