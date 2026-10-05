/**
 * Counting visits against real PostgreSQL.
 *
 * What a stub cannot say: that no column of the four traffic tables can hold
 * an address, an agent, a URL, an account or a time of day; that the dedupe
 * index folds two concurrent arrivals into one row; that two API instances
 * making a new day's salt converge on one; that the beacon route stores a row
 * real Prisma accepts; that the reports read only their organisation's rows;
 * and that deleting an event deletes its visits.
 *
 * Days are added up with `rollUpTrafficDay` for the days this suite counts,
 * not with a whole roll-up run, so this suite never takes the roll-up's lease
 * or purges anybody else's rows.
 *
 * @module @desi-event/api/tests/traffic-integration
 */

import { randomBytes, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import { dayDate as rollupDayDate, rollUpTrafficDay } from '@desi-event/db/traffic-rollup'
import { createInMemoryProviderRegistry } from '@desi-event/providers'

import { buildApp } from '../src/app.js'
import {
  CLIENT_ADDRESS_HEADER,
  daySalt,
  recordTrafficEvent,
  resetTrafficMemory,
  utcDay,
  visitorFromRequest,
} from '../src/lib/traffic.js'
import { platformTraffic, trafficSummary } from '../src/lib/traffic-report.js'
import { testEnv } from './helpers/app.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, when } = await connectTestDatabase('the traffic PostgreSQL suite')

const TAG = `tv${randomUUID().slice(0, 8)}`
const CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const ids = {}

/**
 * A visitor the web tier forwarded from one address.
 *
 * @param {string} address The visitor's address.
 * @param {object} [headers] More headers.
 * @returns {object} The visitor.
 */
function visitorAt(address, headers = {}) {
  return visitorFromRequest({
    ip: '127.0.0.1',
    headers: { 'user-agent': CHROME, [CLIENT_ADDRESS_HEADER]: address, ...headers },
    server: { env: { TRAFFIC_TRUSTED_FORWARDERS: ['127.0.0.1'] } },
  })
}

/**
 * Add one day up, for this suite's days only.
 *
 * @param {Date} at An instant on the day.
 * @returns {Promise<void>}
 */
async function addUp(at) {
  await prisma.$transaction((tx) => rollUpTrafficDay(tx, { day: utcDay(at), now: new Date() }))
}

/**
 * An event in an organisation.
 *
 * @param {string} organizationId Whose.
 * @param {string} key A name for it.
 * @param {string} status Its status.
 * @param {number} startOffsetDays Days from now it starts.
 * @returns {Promise<object>} The event.
 */
function event(organizationId, key, status, startOffsetDays) {
  const startsAt = new Date(Date.now() + startOffsetDays * 86_400_000)

  return prisma.event.create({
    data: {
      organizationId,
      title: `Visits ${key} ${TAG}`,
      slug: `visits-${key}-${TAG}`,
      summary: 'A test event.',
      description: 'A test event for counting visits.',
      category: 'MUSIC_CONCERT',
      status,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 3_600_000),
    },
  })
}

/**
 * A paid order on an event.
 *
 * @param {string} eventId The event.
 * @param {Date} paidAt When it was paid.
 * @returns {Promise<object>} The order.
 */
function paidOrder(eventId, paidAt) {
  return prisma.order.create({
    data: {
      reference: `DE-${randomBytes(4).toString('hex').toUpperCase()}`,
      eventId,
      buyerEmail: `${TAG}@example.com`,
      buyerName: 'Visit Buyer',
      status: 'PAID',
      currency: 'USD',
      subtotalCents: 1000,
      totalCents: 1000,
      paidAt,
    },
  })
}

when()('visits against real PostgreSQL', () => {
  beforeAll(async () => {
    const [a, b] = await Promise.all(
      ['a', 'b'].map((key) =>
        prisma.organization.create({
          data: {
            name: `Visits Org ${key.toUpperCase()} ${TAG}`,
            slug: `visits-org-${key}-${TAG}`,
            contactEmail: `${key}-${TAG}@example.com`,
          },
        }),
      ),
    )

    ids.orgA = a.id
    ids.orgB = b.id
    ids.live = (await event(a.id, 'live', 'ON_SALE', 30)).id
    ids.cancelled = (await event(a.id, 'cancelled', 'CANCELLED', 20)).id
    ids.draft = (await event(a.id, 'draft', 'DRAFT', 40)).id
    ids.other = (await event(b.id, 'other', 'PUBLISHED', 10)).id
  })

  beforeEach(() => resetTrafficMemory())

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { buyerEmail: `${TAG}@example.com` } })
    await prisma.event.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } })
    await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } })
    await prisma.$disconnect()
  })

  it('has no column that could hold an address, an agent, a URL, an account or a time of day', async () => {
    const columns = await prisma.$queryRaw`
      SELECT table_name AS "table", column_name AS "column"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN ('TrafficEvent', 'TrafficDaily', 'TrafficSalt', 'TrafficRollupState')`
    const allowed = new Set([
      'TrafficSalt.createdAt',
      'TrafficDaily.computedAt',
      'TrafficRollupState.leaseExpiresAt',
      'TrafficRollupState.lastCompletedAt',
    ])
    const suspicious = columns
      .map(({ table, column }) => `${table}.${column}`)
      .filter((name) =>
        /ip|addr|agent|url|referr|user|account|email|time|at$/iu.test(name.split('.')[1]),
      )
      .filter((name) => !allowed.has(name))

    expect(columns.length).toBeGreaterThan(30)
    expect(suspicious).toEqual([])
  })

  it('folds two arrivals of one visitor in one slot into one row, however they race', async () => {
    const visitor = visitorAt('203.0.113.21')
    const at = new Date()
    const moment = {
      eventId: ids.live,
      kind: 'TICKETS_CLICK',
      placement: 'EVENT_PAGE',
      visitor,
      occurredAt: at,
    }

    const results = await Promise.all([
      recordTrafficEvent(prisma, moment),
      recordTrafficEvent(prisma, moment),
    ])

    expect(results.map((result) => result.recorded).sort()).toEqual([false, true])
    expect(
      await prisma.trafficEvent.count({ where: { eventId: ids.live, kind: 'TICKETS_CLICK' } }),
    ).toBe(1)
  })

  it('converges two instances making a new day’s salt on one, and drops the day before', async () => {
    const day = '2001-02-03'
    const before = new Date('2001-02-02T00:00:00.000Z')

    await prisma.trafficSalt.createMany({
      data: [{ day: before, salt: randomBytes(32).toString('hex') }],
      skipDuplicates: true,
    })
    await prisma.trafficSalt.deleteMany({ where: { day: rollupDayDate(day) } })

    const [first, second] = await Promise.all([daySalt(prisma, day), daySalt(prisma, day)])

    expect(first).toMatch(/^[0-9a-f]{64}$/u)
    expect(second).toBe(first)
    expect(await prisma.trafficSalt.count({ where: { day: rollupDayDate(day) } })).toBe(1)
    expect(await prisma.trafficSalt.count({ where: { day: before } })).toBe(0)

    await prisma.trafficSalt.deleteMany({ where: { day: rollupDayDate(day) } })
  })

  it('counts a cancelled event, which is still public, and never a draft', async () => {
    const visitor = visitorAt('203.0.113.22')

    await expect(
      recordTrafficEvent(prisma, {
        eventId: ids.draft,
        kind: 'PAGE_VIEW',
        placement: 'EVENT_PAGE',
        source: 'DIRECT',
        visitor,
      }),
    ).resolves.toEqual({ recorded: false, reason: 'NOT_PUBLIC' })
    await expect(
      recordTrafficEvent(prisma, {
        eventId: ids.cancelled,
        kind: 'PAGE_VIEW',
        placement: 'EVENT_PAGE',
        source: 'DIRECT',
        visitor,
      }),
    ).resolves.toEqual({ recorded: true, reason: null })
    expect(await prisma.trafficEvent.count({ where: { eventId: ids.draft } })).toBe(0)
  })

  it('stores a beacon through the route as real PostgreSQL takes it, and answers 202', async () => {
    const app = await buildApp({
      prisma,
      providers: createInMemoryProviderRegistry(),
      env: testEnv(),
      rateLimit: { global: { max: 10_000, timeWindow: '1 minute' } },
      processEnv: {},
    })

    try {
      await app.ready()

      for (const [address, extra] of [
        ['203.0.113.23', {}],
        ['203.0.113.24', { 'sec-gpc': '1' }],
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/traffic/beacons',
          headers: {
            'user-agent': CHROME,
            'content-type': 'application/json',
            [CLIENT_ADDRESS_HEADER]: address,
            ...extra,
          },
          payload: {
            eventId: ids.live,
            kind: 'PAGE_VIEW',
            placement: 'EVENT_PAGE',
            referrer: 'l.instagram.com',
          },
        })

        expect(response.statusCode).toBe(202)
        expect(response.json()).toEqual({ data: { accepted: true } })
      }
    } finally {
      await app.close()
    }

    const rows = await prisma.trafficEvent.findMany({
      where: { eventId: ids.live, kind: 'PAGE_VIEW' },
    })

    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.source === 'SOCIAL')).toBe(true)
    expect(rows.map((row) => row.visitorHash === null).sort()).toEqual([false, true])
    expect(rows[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    )
  })

  it('reads one organisation’s visits only, and an event of another matches nothing', async () => {
    const now = new Date()

    await recordTrafficEvent(prisma, {
      eventId: ids.other,
      kind: 'PAGE_VIEW',
      placement: 'EVENT_PAGE',
      source: 'SEARCH',
      visitor: visitorAt('203.0.113.30'),
    })
    await paidOrder(ids.live, now)
    await paidOrder(ids.other, now)
    await addUp(now)

    const own = await trafficSummary(prisma, { organizationId: ids.orgA, now })

    expect(own.totals.views).toBe(3)
    expect(own.totals.ticketClicks).toBe(1)
    expect(own.byEvent.map((row) => row.eventId)).not.toContain(ids.other)
    expect(own.conversion.ordersPaid).toBe(1)
    expect(own.byDay.at(-1)).toMatchObject({ day: utcDay(now), views: 3, ordersPaid: 1 })

    const foreign = await trafficSummary(prisma, {
      organizationId: ids.orgA,
      eventId: ids.other,
      now,
    })

    expect(foreign.event).toBeNull()
    expect(foreign.totals.views).toBe(0)
    expect(foreign.conversion.ordersPaid).toBe(0)
  })

  it('lists both organisations for the platform, with the most viewed first and orders by paid day', async () => {
    const now = new Date()
    const { data, pagination } = await platformTraffic(prisma, {
      q: TAG,
      scope: 'all',
      page: 1,
      perPage: 20,
      now,
    })
    const rows = new Map(data.events.map((row) => [row.eventId, row]))

    expect(pagination.total).toBe(4)
    expect(rows.get(ids.live)).toMatchObject({ views: 2, ticketClicks: 1, ordersPaid: 1 })
    expect(rows.get(ids.other)).toMatchObject({ views: 1, ordersPaid: 1 })
    expect(rows.get(ids.other).organization.id).toBe(ids.orgB)

    const ours = data.top.filter((row) =>
      [ids.live, ids.cancelled, ids.other].includes(row.eventId),
    )

    expect(ours.map((row) => row.eventId).slice(0, 1)).toEqual([ids.live])

    // The public scope leaves the draft out.
    const publicOnly = await platformTraffic(prisma, { q: TAG, scope: 'public', now })

    expect(publicOnly.data.events.map((row) => row.eventId)).not.toContain(ids.draft)
    expect(publicOnly.pagination.total).toBe(3)

    // Yesterday's window has none of today's orders.
    const yesterday = await platformTraffic(prisma, {
      q: TAG,
      scope: 'all',
      from: new Date(now.getTime() - 86_400_000 * 2).toISOString(),
      to: `${utcDay(now)}T00:00:00.000Z`,
      now,
    })

    expect(yesterday.data.events.every((row) => row.ordersPaid === 0 && row.views === 0)).toBe(true)
    expect(yesterday.data.firstDay).toBe(utcDay(new Date(now.getTime() - 86_400_000 * 2)))

    // With no `from`, the window starts at the first day anything was counted
    // (today's rows exist, so it is no later than today), not at nothing.
    expect(data.firstDay).not.toBeNull()
    expect(data.firstDay <= utcDay(now)).toBe(true)

    // A window that ends before anything was counted has no first day.
    const longAgo = await platformTraffic(prisma, {
      q: TAG,
      to: '2001-01-02T00:00:00.000Z',
      now,
    })

    expect(longAgo.data.firstDay).toBeNull()
    expect(longAgo.data.lastDay).toBe('2001-01-01')
  })

  it('deletes an event’s visits with it', async () => {
    const doomed = await event(ids.orgB, 'doomed', 'PUBLISHED', 5)

    await recordTrafficEvent(prisma, {
      eventId: doomed.id,
      kind: 'PAGE_VIEW',
      placement: 'EVENT_PAGE',
      source: 'DIRECT',
      visitor: visitorAt('203.0.113.40'),
    })
    await addUp(new Date())

    expect(await prisma.trafficDaily.count({ where: { eventId: doomed.id } })).toBe(1)

    await prisma.event.delete({ where: { id: doomed.id } })

    expect(await prisma.trafficEvent.count({ where: { eventId: doomed.id } })).toBe(0)
    expect(await prisma.trafficDaily.count({ where: { eventId: doomed.id } })).toBe(0)
  })
})
