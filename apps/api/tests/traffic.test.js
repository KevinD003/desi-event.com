/**
 * Counting visits, through the routes: the beacon, the platform list, and the
 * `traffic` branch of an organisation's analytics.
 *
 * What the database alone enforces — the CHECKs, the dedupe index under
 * concurrency, the cascade — is in `traffic-integration.test.js`. This file
 * proves what the routes decide: the beacon's one answer, what it reads and
 * keeps, its own limits apart from the site's, who may see which figures, and
 * that no figure carries money or anything about a visitor.
 *
 * @module @desi-event/api/tests/traffic
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLogger } from '@desi-event/logger'

import { MAX_USER_AGENT_LENGTH, resetTrafficMemory } from '../src/lib/traffic.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { makeWorld, passwordHash } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

const CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const OWNER = 'owner@rangoli.example'
const VIEWER = 'finance@rangoli.example'
const OUTSIDER = 'rival@dhol.example'
const ADMIN = 'anil@desi-event.example'
const SUPER_ADMIN = 'ops@desi-event.example'
const MODERATOR = 'maya@desi-event.example'
const SUPPORT = 'help@desi-event.example'
const FINANCE_ADMIN = 'books@desi-event.example'
const SCANNER = 'gate@rangoli.example'

const DAY_MS = 86_400_000

/** Midnight UTC `n` days ago. */
const daysAgo = (n) =>
  new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) - n * DAY_MS)

/** `YYYY-MM-DD` of an instant. */
const dayOf = (date) => date.toISOString().slice(0, 10)

/**
 * One daily row with sums that satisfy every CHECK.
 *
 * @param {string} eventId The event.
 * @param {Date} day Its day.
 * @param {object} figures The counts that differ from zero.
 * @returns {object} A `TrafficDaily` row.
 */
function daily(eventId, day, figures = {}) {
  const views = figures.views ?? 0

  return {
    eventId,
    day,
    views,
    visitors: 0,
    anonymousViews: 0,
    viewsDirect: views,
    viewsInternal: 0,
    viewsSearch: 0,
    viewsSocial: 0,
    viewsOther: 0,
    cardClicks: 0,
    cardClicksHome: 0,
    cardClicksListing: 0,
    cardClicksSearch: 0,
    ticketClicks: 0,
    seatClicks: 0,
    ticketClickVisitors: 0,
    websiteRedirects: 0,
    websiteRedirectVisitors: 0,
    demonstration: false,
    computedAt: new Date(),
    ...figures,
  }
}

/**
 * A platform or organisation account the shared world does not have.
 *
 * @param {string} email The address.
 * @param {string} role The platform role.
 * @returns {Promise<object>} A `User` row.
 */
async function account(email, role) {
  return {
    id: cuid(),
    email,
    passwordHash: await passwordHash(),
    displayName: email.split('@')[0],
    phone: null,
    locale: 'en-IN',
    role,
    emailVerified: true,
    createdAt: new Date('2025-01-02T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
  }
}

/**
 * The shared world, plus visits on three days, a paid order, a deleted event,
 * a scanner, support staff and a finance administrator.
 *
 * @param {object} [options] Variations.
 * @param {object} [options.rateLimit] Limit overrides for the app.
 * @param {object} [options.logger] A logger for the app.
 * @returns {Promise<object>} The harness and its ids.
 */
async function trafficWorld({ rateLimit, logger } = {}) {
  const world = await makeWorld()
  const { seed, ids } = world
  const day1 = daysAgo(3)
  const day2 = daysAgo(2)
  const scanner = await account(SCANNER, 'ORGANIZER')

  const deletedEvent = {
    ...ids.publishedEvent,
    id: cuid(),
    slug: `taken-down-${cuid()}`,
    title: 'Taken Down Mela',
    status: 'DELETED',
    startsAt: new Date(ids.publishedEvent.startsAt.getTime() - DAY_MS),
  }

  seed.event.push(deletedEvent)
  seed.user.push(
    await account(SUPPORT, 'SUPPORT'),
    await account(FINANCE_ADMIN, 'FINANCE_ADMIN'),
    scanner,
  )
  seed.membership.push({
    id: cuid(),
    userId: scanner.id,
    organizationId: ids.organization.id,
    role: 'SCANNER',
    createdAt: new Date('2025-01-02T00:00:00.000Z'),
  })
  seed.trafficDaily = [
    daily(ids.publishedEvent.id, day1, {
      views: 10,
      visitors: 6,
      anonymousViews: 1,
      viewsDirect: 4,
      viewsInternal: 3,
      viewsSearch: 2,
      viewsSocial: 1,
      cardClicks: 5,
      cardClicksHome: 2,
      cardClicksListing: 2,
      cardClicksSearch: 1,
      ticketClicks: 3,
      seatClicks: 1,
      ticketClickVisitors: 3,
      websiteRedirects: 2,
      websiteRedirectVisitors: 2,
    }),
    daily(ids.publishedEvent.id, day2, { views: 4, visitors: 2 }),
    daily(deletedEvent.id, day1, { views: 7, visitors: 5 }),
    // Another organisation's event: never in this organisation's figures.
    daily(ids.onlineEvent.id, day1, { views: 50, visitors: 40 }),
  ]
  seed.order = [
    {
      id: cuid(),
      reference: 'DE-TRAFFIC1',
      eventId: ids.publishedEvent.id,
      userId: ids.attendee.id,
      status: 'PAID',
      currency: 'INR',
      subtotalCents: 100,
      discountCents: 0,
      feesCents: 0,
      taxCents: 0,
      totalCents: 100,
      paidAt: new Date(day1.getTime() + 5 * 3_600_000),
      createdAt: new Date(day1.getTime() + 4 * 3_600_000),
      updatedAt: new Date(day1.getTime() + 5 * 3_600_000),
    },
  ]
  seed.trafficRollupState = [
    {
      id: 'traffic-rollup',
      leaseOwner: null,
      leaseExpiresAt: null,
      lastCompletedAt: new Date(Date.now() - 5 * 60_000),
    },
  ]

  const harness = await createTestApp({ seed, ids, rateLimit, logger })

  return { ...harness, ids: { ...ids, deletedEvent }, day1, day2 }
}

/**
 * Sign in, with a fresh second factor for the accounts that hold one.
 *
 * @param {object} app The app.
 * @param {string} email Who.
 * @returns {Promise<object>} Request headers.
 */
async function asUser(app, email) {
  const headers = bearer(await signIn(app, email))

  if (app.testEnrolledEmails.has(email)) await stepUp(app, email, headers)

  return headers
}

/**
 * Send one beacon.
 *
 * @param {object} app The app.
 * @param {object} body The beacon.
 * @param {object} [options] Request options.
 * @param {object} [options.headers] Extra headers.
 * @param {string} [options.remoteAddress] The socket's address.
 * @returns {Promise<object>} The response.
 */
function beacon(app, body, { headers = {}, remoteAddress } = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/traffic/beacons',
    headers: { 'user-agent': CHROME, 'content-type': 'application/json', ...headers },
    payload: body,
    ...(remoteAddress ? { remoteAddress } : {}),
  })
}

/** A page view of an event, from a forwarded visitor address. */
const viewOf = (eventId) => ({
  eventId,
  kind: 'PAGE_VIEW',
  placement: 'EVENT_PAGE',
  referrer: null,
})

const FROM_VISITOR = { 'x-desi-client-address': '203.0.113.9' }

beforeEach(() => resetTrafficMemory())

describe('POST /v1/traffic/beacons', () => {
  it('answers the same 202 whether or not anything was counted', async () => {
    const { app, prisma, ids } = await trafficWorld()
    const cases = [
      ['counted', viewOf(ids.publishedEvent.id), FROM_VISITOR],
      ['a repeat', viewOf(ids.publishedEvent.id), FROM_VISITOR],
      ['a draft', viewOf(ids.draftEvent.id), FROM_VISITOR],
      ['a deleted event', viewOf(ids.deletedEvent.id), FROM_VISITOR],
      ['an unknown event', viewOf('cnosuchevent000000000001'), FROM_VISITOR],
      [
        'a robot',
        viewOf(ids.publishedEvent.id),
        { ...FROM_VISITOR, 'user-agent': 'Googlebot/2.1' },
      ],
      [
        // What the web tier forwards for a longer agent: cut to one past the
        // maximum, from another visitor, so only the length can keep it out.
        'an overlong agent, as the web tier forwards it',
        viewOf(ids.publishedEvent.id),
        {
          'x-desi-client-address': '203.0.113.77',
          'user-agent': `Mozilla/5.0 ${'x'.repeat(600)}`.slice(0, MAX_USER_AGENT_LENGTH + 1),
        },
      ],
      ['no address', viewOf(ids.publishedEvent.id), {}],
    ]

    for (const [name, body, headers] of cases) {
      const response = await beacon(app, body, { headers })

      expect(response.statusCode, name).toBe(202)
      expect(response.json(), name).toEqual({ data: { accepted: true } })
      expect(response.headers['cache-control'], name).toBe('no-store, private')
      expect(response.headers['set-cookie'], name).toBeUndefined()
    }

    // Only the first was stored.
    expect(prisma._store.trafficEvent).toHaveLength(1)
    expect(prisma._store.trafficEvent[0]).toMatchObject({
      eventId: ids.publishedEvent.id,
      kind: 'PAGE_VIEW',
      source: 'DIRECT',
    })
  })

  it('refuses a body with any key it does not keep, and a foreign Origin', async () => {
    const { app, ids } = await trafficWorld()

    for (const extra of ['url', 'ip', 'userAgent', 'referrerUrl']) {
      const response = await beacon(
        app,
        { ...viewOf(ids.publishedEvent.id), [extra]: 'x' },
        {
          headers: FROM_VISITOR,
        },
      )

      expect(response.statusCode, extra).toBe(400)
    }

    const forged = await beacon(app, viewOf(ids.publishedEvent.id), {
      headers: { ...FROM_VISITOR, origin: 'https://evil.example' },
    })

    expect(forged.statusCode).toBe(403)
  })

  it('reads no session: a cookie or a bearer token sent with a beacon is ignored', async () => {
    const { app, prisma, ids } = await trafficWorld()
    const token = await signIn(app, OWNER)
    let sessionReads = 0
    const findUnique = prisma.session.findUnique

    prisma.session.findUnique = async (...args) => {
      sessionReads += 1
      return findUnique(...args)
    }

    const response = await beacon(app, viewOf(ids.publishedEvent.id), {
      headers: { ...FROM_VISITOR, authorization: `Bearer ${token}`, cookie: `de_session=${token}` },
    })

    expect(response.statusCode).toBe(202)
    expect(sessionReads).toBe(0)
    expect(prisma._store.trafficEvent).toHaveLength(1)
  })

  it('keeps a visitor code for an ordinary browser, and none under Global Privacy Control', async () => {
    const { app, prisma, ids } = await trafficWorld()

    await beacon(app, viewOf(ids.publishedEvent.id), { headers: FROM_VISITOR })
    await beacon(app, viewOf(ids.publishedEvent.id), {
      headers: { 'x-desi-client-address': '203.0.113.10', 'sec-gpc': '1' },
    })

    const [coded, uncoded] = prisma._store.trafficEvent

    expect(coded.visitorHash).toMatch(/^[0-9a-f]{32}$/u)
    expect(uncoded.visitorHash).toBeNull()
    expect(uncoded.dedupeKey).toBeNull()
  })

  it('believes a forwarded address from the web server, and only from it', async () => {
    const { app, prisma, ids } = await trafficWorld()

    // From loopback, a trusted forwarder: two addresses, two visitors.
    await beacon(app, viewOf(ids.publishedEvent.id), { headers: FROM_VISITOR })
    await beacon(app, viewOf(ids.publishedEvent.id), {
      headers: { 'x-desi-client-address': '203.0.113.77' },
    })

    expect(new Set(prisma._store.trafficEvent.map((row) => row.visitorHash)).size).toBe(2)

    // From anywhere else the header is ignored: one caller, one visitor.
    await beacon(app, viewOf(ids.onlineEvent.id), {
      headers: { 'x-desi-client-address': '198.51.100.1' },
      remoteAddress: '203.0.113.5',
    })
    await beacon(app, viewOf(ids.onlineEvent.id), {
      headers: { 'x-desi-client-address': '198.51.100.2' },
      remoteAddress: '203.0.113.5',
    })

    expect(
      prisma._store.trafficEvent.filter((row) => row.eventId === ids.onlineEvent.id),
    ).toHaveLength(1)
  })

  it('classifies a page view’s referrer and stores the category, not the host', async () => {
    const { app, prisma, ids } = await trafficWorld()

    await beacon(
      app,
      { ...viewOf(ids.publishedEvent.id), referrer: 'www.google.com' },
      {
        headers: FROM_VISITOR,
      },
    )

    expect(prisma._store.trafficEvent[0].source).toBe('SEARCH')
    expect(JSON.stringify(prisma._store.trafficEvent)).not.toContain('google')
  })

  it('limits each visitor on its own budget, and leaves another visitor alone', async () => {
    const { app, ids } = await trafficWorld({
      rateLimit: { global: { max: 10_000, timeWindow: '1 minute' }, trafficBeacon: { max: 2 } },
    })
    const send = (address) =>
      beacon(app, viewOf(ids.publishedEvent.id), {
        headers: { 'x-desi-client-address': address },
      })

    expect((await send('203.0.113.9')).statusCode).toBe(202)
    expect((await send('203.0.113.9')).statusCode).toBe(202)

    const third = await send('203.0.113.9')

    expect(third.statusCode).toBe(429)
    expect(third.headers['retry-after']).toBeDefined()
    expect(third.json().error.code).toBe('RATE_LIMITED')
    expect((await send('203.0.113.10')).statusCode).toBe(202)
  })

  it('does not spend the site-wide budget', async () => {
    const { app, ids } = await trafficWorld({
      rateLimit: { global: { max: 5, timeWindow: '1 minute' } },
    })

    for (let i = 0; i < 20; i += 1) {
      const response = await beacon(app, viewOf(ids.publishedEvent.id), {
        headers: { 'x-desi-client-address': `203.0.113.${i + 1}` },
      })

      expect(response.statusCode).toBe(202)
    }

    const listing = await app.inject({ method: 'GET', url: '/v1/events' })

    expect(listing.statusCode).toBe(200)
    expect(Number(listing.headers['x-ratelimit-remaining'])).toBe(4)
  })

  it('answers and drops beacons past this process’s ceiling, warning once a minute', async () => {
    const chunks = []
    const logger = createLogger({
      name: 'api',
      level: 'warn',
      destination: { write: (chunk) => chunks.push(String(chunk)) },
    })
    const { app, prisma, ids } = await trafficWorld({
      logger,
      rateLimit: {
        global: { max: 10_000, timeWindow: '1 minute' },
        trafficBeacon: { processMax: 2 },
      },
    })

    for (let i = 0; i < 5; i += 1) {
      const response = await beacon(app, viewOf(ids.publishedEvent.id), {
        headers: { 'x-desi-client-address': `203.0.113.${i + 1}` },
      })

      expect(response.statusCode).toBe(202)
    }

    expect(prisma._store.trafficEvent).toHaveLength(2)

    const warnings = chunks
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((line) => /over this process/u.test(line.msg))

    expect(warnings).toHaveLength(1)
    expect(chunks.join('')).not.toContain('203.0.113.')
  })
})

describe('what a beacon leaves in the log', () => {
  it('logs a beacon it could not store by event, kind and code only, and still answers 202', async () => {
    const chunks = []
    const logger = createLogger({
      name: 'api',
      level: 'debug',
      destination: { write: (chunk) => chunks.push(String(chunk)) },
    })
    const { app, prisma, ids } = await trafficWorld({ logger })
    const address = '198.51.100.123'
    const agent = `${CHROME} DistinctiveVisitor/9`

    // One stored, so its code exists to look for; then the store fails.
    await beacon(app, viewOf(ids.publishedEvent.id), {
      headers: { 'x-desi-client-address': address, 'user-agent': agent },
    })

    const [stored] = prisma._store.trafficEvent

    prisma.trafficEvent.createMany = async () => {
      throw Object.assign(new Error('connection reset'), { code: 'P1017' })
    }

    const failed = await beacon(
      app,
      { ...viewOf(ids.publishedEvent.id), referrer: 'news.distinctive-referrer.example' },
      {
        headers: {
          'x-desi-client-address': '198.51.100.124',
          'user-agent': agent,
        },
      },
    )

    expect(failed.statusCode).toBe(202)
    expect(failed.json()).toEqual({ data: { accepted: true } })

    const log = chunks.join('')
    const warning = log
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((line) => line.msg === 'traffic beacon not counted')

    expect(warning).toMatchObject({
      eventId: ids.publishedEvent.id,
      kind: 'PAGE_VIEW',
      code: 'P1017',
    })

    for (const needle of [
      address,
      '198.51.100.124',
      'DistinctiveVisitor',
      'distinctive-referrer',
      stored.visitorHash,
      stored.dedupeKey,
    ]) {
      expect(log.includes(needle), needle).toBe(false)
    }
  })
})

describe('a database that cannot store beacons', () => {
  it('warns once a minute for each error code, counting the failures it held back', async () => {
    const chunks = []
    const logger = createLogger({
      name: 'api',
      level: 'warn',
      destination: { write: (chunk) => chunks.push(String(chunk)) },
    })
    const { app, prisma, ids } = await trafficWorld({ logger })
    let fault = Object.assign(new Error('connection reset'), { code: 'P1017' })

    prisma.trafficEvent.createMany = async () => {
      throw fault
    }

    /** Every `traffic beacon not counted` line so far. */
    const faultLines = () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((line) => line.msg === 'traffic beacon not counted')
        .map(({ code, heldBack }) => ({ code, heldBack }))

    let address = 0
    const failing = async () => {
      address += 1

      const response = await beacon(app, viewOf(ids.publishedEvent.id), {
        headers: { 'x-desi-client-address': `198.51.100.${address}` },
      })

      expect(response.statusCode).toBe(202)
    }

    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-01T12:00:05.000Z') })

    try {
      // Five failures in one minute: one line.
      for (let i = 0; i < 5; i += 1) await failing()

      expect(faultLines()).toEqual([{ code: 'P1017', heldBack: 0 }])

      // Another code in the same minute has a line of its own.
      fault = Object.assign(new Error('timed out'), { code: 'P2024' })
      await failing()
      await failing()

      expect(faultLines()).toEqual([
        { code: 'P1017', heldBack: 0 },
        { code: 'P2024', heldBack: 0 },
      ])

      // The next minute's first failure reports the four held back.
      vi.setSystemTime(Date.parse('2026-10-01T12:01:05.000Z'))
      fault = Object.assign(new Error('connection reset'), { code: 'P1017' })
      await failing()

      expect(faultLines()).toEqual([
        { code: 'P1017', heldBack: 0 },
        { code: 'P2024', heldBack: 0 },
        { code: 'P1017', heldBack: 4 },
      ])
    } finally {
      vi.useRealTimers()
    }

    expect(prisma._store.trafficEvent).toHaveLength(0)
    expect(chunks.join('')).not.toContain('198.51.100.')
  })
})

describe('GET /v1/traffic/events', () => {
  it('needs a session', async () => {
    const { app } = await trafficWorld()

    expect((await app.inject({ method: 'GET', url: '/v1/traffic/events' })).statusCode).toBe(401)
  })

  it.each([
    ['an owner', OWNER],
    ['a moderator', MODERATOR],
    ['support staff', SUPPORT],
    ['a finance administrator', FINANCE_ADMIN],
  ])('refuses %s', async (_name, email) => {
    const { app } = await trafficWorld()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/traffic/events',
      headers: await asUser(app, email),
    })

    expect(response.statusCode).toBe(403)
  })

  it.each([
    ['the platform administrator', ADMIN],
    ['a super administrator', SUPER_ADMIN],
  ])(
    'lists every organisation’s public events for %s, newest start first',
    async (_name, email) => {
      const { app, ids } = await trafficWorld()

      const response = await app.inject({
        method: 'GET',
        url: '/v1/traffic/events',
        headers: await asUser(app, email),
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store, private')

      const { data, pagination } = response.json()
      const listed = data.events.map((row) => row.eventId)

      expect(listed).toContain(ids.publishedEvent.id)
      expect(listed).toContain(ids.onlineEvent.id)
      expect(listed).not.toContain(ids.draftEvent.id)
      expect(listed).not.toContain(ids.reviewPendingEvent.id)
      expect(pagination.total).toBe(data.events.length)

      const starts = data.events.map((row) => Date.parse(row.startsAt))

      expect([...starts].sort((a, b) => b - a)).toEqual(starts)
    },
  )

  it('includes drafts and deleted events, marked, when asked for all', async () => {
    const { app, ids } = await trafficWorld()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/traffic/events?scope=all',
      headers: await asUser(app, ADMIN),
    })
    const rows = new Map(response.json().data.events.map((row) => [row.eventId, row]))

    expect(rows.has(ids.draftEvent.id)).toBe(true)
    expect(rows.get(ids.deletedEvent.id)).toMatchObject({ deleted: true, views: 7, visitors: 5 })
    expect(rows.get(ids.publishedEvent.id).deleted).toBe(false)
  })

  it('finds events by their organiser’s name', async () => {
    const { app, ids } = await trafficWorld()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/traffic/events?q=${encodeURIComponent(ids.otherOrganization.name.slice(0, 5))}`,
      headers: await asUser(app, ADMIN),
    })
    const listed = response.json().data.events.map((row) => row.eventId)

    expect(listed).toContain(ids.onlineEvent.id)
    expect(listed).not.toContain(ids.publishedEvent.id)
  })

  it('sums each event’s window and ranks the most viewed across the platform', async () => {
    const { app, ids } = await trafficWorld()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/traffic/events?scope=all',
      headers: await asUser(app, ADMIN),
    })
    const { data } = response.json()
    const published = data.events.find((row) => row.eventId === ids.publishedEvent.id)

    expect(published).toMatchObject({
      views: 14,
      visitors: 8,
      cardClicks: 5,
      ticketClicks: 3,
      seatClicks: 1,
      websiteRedirects: 2,
      ordersPaid: 1,
      websiteLinkOn: false,
      organization: { id: ids.organization.id, name: ids.organization.name },
    })
    expect(data.top.map((row) => row.eventId)).toEqual([
      ids.onlineEvent.id,
      ids.publishedEvent.id,
      ids.deletedEvent.id,
    ])
    expect(data.updatedAt).not.toBeNull()
    expect(data.stale).toBe(false)
  })

  it('starts an open window at the first day counted, and an asked one where it was asked', async () => {
    const { app, prisma, day1 } = await trafficWorld()
    const headers = await asUser(app, ADMIN)
    const list = async (query = '') =>
      (await app.inject({ method: 'GET', url: `/v1/traffic/events${query}`, headers })).json().data

    // No `from`: the earliest daily row anywhere, as the organiser branch does.
    expect((await list()).firstDay).toBe(dayOf(day1))
    expect((await list('?scope=all')).firstDay).toBe(dayOf(day1))

    const from = encodeURIComponent(daysAgo(6).toISOString())

    expect((await list(`?from=${from}`)).firstDay).toBe(dayOf(daysAgo(6)))

    // A window that ends before anything was counted has no first day.
    const to = encodeURIComponent(daysAgo(5).toISOString())

    expect((await list(`?to=${to}`)).firstDay).toBeNull()

    // Nothing counted at all: none either.
    prisma._store.trafficDaily.length = 0

    expect((await list()).firstDay).toBeNull()
  })

  it('carries no money, no buyer and nothing about a visitor', async () => {
    const { app } = await trafficWorld()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/traffic/events?scope=all',
      headers: await asUser(app, SUPER_ADMIN),
    })

    const keys = []
    const walk = (value) => {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          keys.push(key)
          walk(child)
        }
      }
    }

    walk(response.json())

    expect(keys.length).toBeGreaterThan(20)
    expect(
      keys.filter((key) => /cents|amount|email|hash|dedupe|address|agent/iu.test(key)),
    ).toEqual([])
    expect(response.body).not.toContain('priya')
  })
})

describe('the traffic branch of GET /v1/analytics/summary', () => {
  /**
   * Read the summary for an organisation.
   *
   * @param {object} app The app.
   * @param {object} headers Who asks.
   * @param {string} query The query string.
   * @returns {Promise<object>} The response.
   */
  function summary(app, headers, query) {
    return app.inject({ method: 'GET', url: `/v1/analytics/summary?${query}`, headers })
  }

  it('gives an owner its own events’ visits, by day, source and place, and nobody else’s', async () => {
    const { app, ids, day1, day2 } = await trafficWorld()
    const from = encodeURIComponent(daysAgo(4).toISOString())

    const response = await summary(
      app,
      await asUser(app, OWNER),
      `organizationId=${ids.organization.id}&currency=INR&from=${from}`,
    )

    expect(response.statusCode).toBe(200)

    const { traffic, organizationName } = response.json().data

    expect(organizationName).toBe(ids.organization.name)
    expect(traffic.totals).toEqual({
      views: 21,
      visitors: 13,
      anonymousViews: 1,
      cardClicks: 5,
      ticketClicks: 3,
      seatClicks: 1,
      ticketClickVisitors: 3,
      websiteRedirects: 2,
      websiteRedirectVisitors: 2,
    })
    expect(traffic.sources).toEqual([
      { source: 'DIRECT', views: 15 },
      { source: 'INTERNAL', views: 3 },
      { source: 'SEARCH', views: 2 },
      { source: 'SOCIAL', views: 1 },
      { source: 'OTHER', views: 0 },
    ])
    expect(traffic.cardPlacements).toEqual([
      { placement: 'HOME', clicks: 2 },
      { placement: 'LISTING', clicks: 2 },
      { placement: 'SEARCH', clicks: 1 },
    ])
    // Zero-filled from `from` to today, and the paid order on its day.
    expect(traffic.firstDay).toBe(dayOf(daysAgo(4)))
    expect(traffic.byDay.map((day) => day.day)).toEqual(
      [4, 3, 2, 1, 0].map((n) => dayOf(daysAgo(n))),
    )
    expect(traffic.byDay.find((day) => day.day === dayOf(day1))).toMatchObject({
      views: 17,
      ordersPaid: 1,
    })
    expect(traffic.byDay.find((day) => day.day === dayOf(day2)).views).toBe(4)
    expect(traffic.byDay[0]).toMatchObject({ views: 0, visitors: 0, ordersPaid: 0 })

    const listed = traffic.byEvent.map((row) => row.eventId)

    expect(listed).toContain(ids.publishedEvent.id)
    expect(listed).not.toContain(ids.onlineEvent.id)
    // A deleted event is listed, marked, with the visits it had.
    expect(traffic.byEvent.find((row) => row.eventId === ids.deletedEvent.id)).toMatchObject({
      deleted: true,
      views: 7,
    })
    expect(traffic.conversion).toEqual({
      visitors: 13,
      ticketClickVisitors: 3,
      ordersPaid: 1,
      visitorToOrderPercent: 7.7,
    })
    expect(traffic.updatedAt).not.toBeNull()
    expect(traffic.stale).toBe(false)
    expect(traffic.includesDemonstration).toBe(false)
    expect(traffic.event).toBeNull()
  })

  it('narrows to one event, and an event of another organisation matches nothing', async () => {
    const { app, ids } = await trafficWorld()
    const headers = await asUser(app, OWNER)

    const own = (
      await summary(
        app,
        headers,
        `organizationId=${ids.organization.id}&eventId=${ids.publishedEvent.id}`,
      )
    ).json().data.traffic

    expect(own.event).toMatchObject({
      id: ids.publishedEvent.id,
      title: ids.publishedEvent.title,
      deleted: false,
      websiteLinkOn: false,
      // The switch as the event's team reads it: never decided, nothing waiting.
      websiteRedirect: {
        enabled: false,
        pending: false,
        decidedUrl: null,
        submittedAt: null,
        changedAt: null,
        reason: null,
        changedByName: null,
        websiteProblem: null,
      },
    })
    expect(own.totals.views).toBe(14)
    expect(own.byEvent).toEqual([])

    const foreign = (
      await summary(
        app,
        headers,
        `organizationId=${ids.organization.id}&eventId=${ids.onlineEvent.id}`,
      )
    ).json().data.traffic

    expect(foreign.event).toBeNull()
    expect(foreign.totals.views).toBe(0)
    expect(foreign.conversion.visitorToOrderPercent).toBeNull()
  })

  it('gives a viewer the visits but not the money', async () => {
    const { app, ids } = await trafficWorld()

    const response = await summary(
      app,
      await asUser(app, VIEWER),
      `organizationId=${ids.organization.id}`,
    )
    const { data } = response.json()

    expect(response.statusCode).toBe(200)
    expect(data.money).toBeNull()
    expect(data.traffic.totals.views).toBeGreaterThan(0)
  })

  it('refuses a scanner and another organisation’s owner', async () => {
    const { app, ids } = await trafficWorld()

    for (const email of [SCANNER, OUTSIDER]) {
      const response = await summary(
        app,
        await asUser(app, email),
        `organizationId=${ids.organization.id}`,
      )

      expect(response.statusCode, email).toBe(403)
    }
  })

  it('lets the platform administrator read any organisation’s visits, never its money', async () => {
    const { app, ids } = await trafficWorld()

    const response = await summary(
      app,
      await asUser(app, ADMIN),
      `organizationId=${ids.otherOrganization.id}`,
    )
    const { data } = response.json()

    expect(response.statusCode).toBe(200)
    expect(data.organizationName).toBe(ids.otherOrganization.name)
    expect(data.moneyWithheld).toBe('CAPABILITY')
    expect(data.money).toBeNull()
    expect(data.traffic.totals.views).toBe(50)
  })

  it('says when the figures include demonstration rows, and when they are stale or never added up', async () => {
    const { app, prisma, ids } = await trafficWorld()
    const headers = await asUser(app, OWNER)

    prisma._store.trafficDaily[1].demonstration = true
    prisma._store.trafficRollupState[0].lastCompletedAt = new Date(Date.now() - 3 * 3_600_000)

    const stale = (await summary(app, headers, `organizationId=${ids.organization.id}`)).json().data
      .traffic

    expect(stale.includesDemonstration).toBe(true)
    expect(stale.stale).toBe(true)

    prisma._store.trafficRollupState[0].lastCompletedAt = null

    const never = (await summary(app, headers, `organizationId=${ids.organization.id}`)).json().data
      .traffic

    expect(never.updatedAt).toBeNull()
    expect(never.stale).toBe(false)
  })

  it('names no visitor code, digest or referring site anywhere', async () => {
    const { app, ids } = await trafficWorld()

    const response = await summary(
      app,
      await asUser(app, OWNER),
      `organizationId=${ids.organization.id}`,
    )

    expect(response.body).not.toMatch(/visitorHash|dedupeKey|salt|referrer|fingerprint/iu)
  })
})
