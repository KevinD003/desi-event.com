import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  AUTOMATED_AGENT_PATTERN,
  CLIENT_ADDRESS_HEADER,
  EVENT_CEILING_PER_MINUTE,
  PUBLIC_STATUS_TTL_MS,
  clientAddressOf,
  createTokenBucket,
  daySalt,
  isAutomatedAgent,
  privacySignal,
  recordTrafficEvent,
  resetTrafficMemory,
  slotOf,
  visitorFromRequest,
  visitorRateKey,
} from './traffic.js'

const CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'
const CUBOT =
  'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

const FORWARDERS = ['127.0.0.1', '::1', '::ffff:127.0.0.1']
const PUBLIC_EVENT = 'cevent00000000000000001'
const DRAFT_EVENT = 'cevent00000000000000002'
const OTHER_EVENT = 'cevent00000000000000003'
const SEPARATOR = String.fromCharCode(31)

/**
 * A request as Fastify presents it.
 *
 * @param {object} [options] Shape.
 * @param {string} [options.ip] The socket's address.
 * @param {object} [options.headers] Request headers.
 * @returns {object} The request.
 */
function request({ ip = '127.0.0.1', headers = {} } = {}) {
  return {
    ip,
    headers: { 'user-agent': CHROME, ...headers },
    server: { env: { TRAFFIC_TRUSTED_FORWARDERS: FORWARDERS } },
  }
}

/**
 * A visitor forwarded by the web tier from one address.
 *
 * @param {string} address The visitor's address.
 * @param {object} [headers] More headers.
 * @returns {object} The visitor.
 */
function visitorAt(address, headers = {}) {
  return visitorFromRequest(request({ headers: { [CLIENT_ADDRESS_HEADER]: address, ...headers } }))
}

/**
 * A small fake database: events with a status, the salt table and the raw
 * table with its unique dedupe digest.
 *
 * @returns {object} The fake, with its tables and a query count.
 */
function fakeDb() {
  const events = new Map([
    [PUBLIC_EVENT, 'ON_SALE'],
    [DRAFT_EVENT, 'DRAFT'],
    [OTHER_EVENT, 'COMPLETED'],
  ])
  const salts = new Map()
  const rows = []
  const calls = { eventReads: 0, writes: 0 }

  return {
    events,
    salts,
    rows,
    calls,
    event: {
      findUnique: async ({ where }) => {
        calls.eventReads += 1
        return events.has(where.id) ? { status: events.get(where.id) } : null
      },
    },
    trafficSalt: {
      createMany: async ({ data }) => {
        const [row] = data
        const key = row.day.toISOString()

        if (salts.has(key)) return { count: 0 }

        salts.set(key, row.salt)
        return { count: 1 }
      },
      deleteMany: async ({ where }) => {
        let count = 0

        for (const key of [...salts.keys()]) {
          if (new Date(key) < where.day.lt) {
            salts.delete(key)
            count += 1
          }
        }

        return { count }
      },
      findUnique: async ({ where }) => {
        const salt = salts.get(where.day.toISOString())
        return salt ? { day: where.day, salt } : null
      },
    },
    trafficEvent: {
      createMany: async ({ data }) => {
        calls.writes += 1
        const [row] = data

        if (row.dedupeKey && rows.some((existing) => existing.dedupeKey === row.dedupeKey)) {
          return { count: 0 }
        }

        rows.push(row)
        return { count: 1 }
      },
    },
  }
}

const AT = new Date('2026-10-01T09:05:00.000Z')

beforeEach(() => resetTrafficMemory())

describe('isAutomatedAgent', () => {
  it.each([
    ['an empty agent', ''],
    ['a missing agent', undefined],
    ['headless Chrome', 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/130.0.0.0 Safari/537.36'],
    ['curl', 'curl/8.4.0'],
    ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    [
      'a crawler that only says compatible',
      'Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com)',
    ],
    ['Facebook’s link preview', 'facebookexternalhit/1.1'],
    ['Slack’s link preview', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['an uptime robot', 'Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)'],
    ['Python', 'python-requests/2.32.3'],
    ['a 600-character agent', `Mozilla/5.0 ${'x'.repeat(600)}`],
  ])('treats %s as not a person', (_name, agent) => {
    expect(isAutomatedAgent(agent)).toBe(true)
  })

  it.each([
    ['desktop Chrome', CHROME],
    ['Safari on an iPhone', SAFARI_IOS],
    ['Firefox', FIREFOX],
    ['a Cubot phone, whose model ends in "bot"', CUBOT],
    ['a browser on a device called a monitor', `${CHROME} SmartMonitor/2`],
  ])('treats %s as a person', (_name, agent) => {
    expect(isAutomatedAgent(agent)).toBe(false)
  })

  it('has no bare "monitor" in its pattern', () => {
    expect(AUTOMATED_AGENT_PATTERN.source).not.toMatch(/\|monitor\|/u)
  })
})

describe('privacySignal', () => {
  it('honours Global Privacy Control and Do Not Track', () => {
    expect(privacySignal({ 'sec-gpc': '1' })).toBe(true)
    expect(privacySignal({ dnt: '1' })).toBe(true)
    expect(privacySignal({ dnt: '0' })).toBe(false)
    expect(privacySignal({})).toBe(false)
  })
})

describe('clientAddressOf', () => {
  it('believes the forwarded address only from a listed forwarder', () => {
    expect(clientAddressOf(request({ headers: { [CLIENT_ADDRESS_HEADER]: '203.0.113.9' } }))).toBe(
      '203.0.113.9',
    )
    expect(
      clientAddressOf(
        request({ ip: '::ffff:127.0.0.1', headers: { [CLIENT_ADDRESS_HEADER]: '2001:DB8::1' } }),
      ),
    ).toBe('2001:db8::1')
  })

  it.each(['1.2.3.4, 5.6.7.8', 'abc', '', '203.0.113.9:443'])(
    'ignores the forwarded value %j and counts no address',
    (value) => {
      expect(clientAddressOf(request({ headers: { [CLIENT_ADDRESS_HEADER]: value } }))).toBeNull()
    },
  )

  it('counts a forwarder that sent no address as having none', () => {
    expect(clientAddressOf(request())).toBeNull()
  })

  it('takes anybody else as their own address, whatever header they send', () => {
    expect(
      clientAddressOf(
        request({ ip: '198.51.100.7', headers: { [CLIENT_ADDRESS_HEADER]: '203.0.113.9' } }),
      ),
    ).toBe('198.51.100.7')
  })
})

describe('visitorFromRequest', () => {
  it('makes an identifiable visitor of a browser with an address', () => {
    const visitor = visitorAt('203.0.113.9')

    expect(visitor).toMatchObject({ bot: false, identifiable: true, privacySignal: false })
    expect(visitor.rateKey).toMatch(/^[0-9a-f]{32}$/u)
  })

  it.each([
    ['Global Privacy Control', { 'sec-gpc': '1' }],
    ['Do Not Track', { dnt: '1' }],
    ['a robot', { 'user-agent': 'Googlebot/2.1' }],
  ])('makes no code under %s', (_name, headers) => {
    expect(visitorAt('203.0.113.9', headers).identifiable).toBe(false)
  })

  it('makes no code and no rate key without an address', () => {
    const visitor = visitorFromRequest(request())

    expect(visitor.identifiable).toBe(false)
    expect(visitor.rateKey).toBeNull()
  })

  it('serialises to two booleans, and keeps neither the address nor the agent in a key', () => {
    const visitor = visitorAt('203.0.113.9')

    expect(JSON.stringify(visitor)).toBe('{"bot":false,"identifiable":true}')
    expect(Object.keys(visitor).sort()).toEqual(['bot', 'identifiable', 'privacySignal', 'rateKey'])

    for (const value of Object.values(visitor)) {
      expect(String(value)).not.toContain('203.0.113.9')
      expect(String(value)).not.toContain('Chrome')
    }
  })

  it('keys the limiter on the address and the browser together', () => {
    const one = visitorRateKey(request({ headers: { [CLIENT_ADDRESS_HEADER]: '203.0.113.9' } }))
    const sameAgain = visitorAt('203.0.113.9').rateKey
    const otherBrowser = visitorAt('203.0.113.9', { 'user-agent': FIREFOX }).rateKey
    const otherAddress = visitorAt('203.0.113.10').rateKey

    expect(sameAgain).toBe(one)
    expect(otherBrowser).not.toBe(one)
    expect(otherAddress).not.toBe(one)
  })
})

describe('slotOf', () => {
  it('folds page views into half hours and everything else into ten minutes', () => {
    expect(slotOf(new Date('2026-10-01T09:29:59Z'), 'PAGE_VIEW')).toBe(540)
    expect(slotOf(new Date('2026-10-01T09:30:00Z'), 'PAGE_VIEW')).toBe(570)
    expect(slotOf(new Date('2026-10-01T09:09:59Z'), 'CARD_CLICK')).toBe(540)
    expect(slotOf(new Date('2026-10-01T09:10:00Z'), 'WEBSITE_REDIRECT')).toBe(550)
  })
})

describe('daySalt', () => {
  it('makes one salt a day, deletes earlier days’ when it makes a new one, and remembers it', async () => {
    const db = fakeDb()

    db.salts.set(new Date('2026-09-30T00:00:00.000Z').toISOString(), 'a'.repeat(64))

    const first = await daySalt(db, '2026-10-01')
    const again = await daySalt(db, '2026-10-01')

    expect(first).toMatch(/^[0-9a-f]{64}$/u)
    expect(again).toBe(first)
    expect([...db.salts.keys()]).toEqual(['2026-10-01T00:00:00.000Z'])
  })
})

describe('recordTrafficEvent', () => {
  const view = (visitor, overrides = {}) => ({
    eventId: PUBLIC_EVENT,
    kind: 'PAGE_VIEW',
    placement: 'EVENT_PAGE',
    source: 'DIRECT',
    visitor,
    occurredAt: AT,
    ...overrides,
  })

  it('records a page view of a public event, with exactly the columns it may keep', async () => {
    const db = fakeDb()

    await expect(recordTrafficEvent(db, view(visitorAt('203.0.113.9')))).resolves.toEqual({
      recorded: true,
      reason: null,
    })
    expect(Object.keys(db.rows[0]).sort()).toEqual(
      ['day', 'dedupeKey', 'eventId', 'kind', 'placement', 'source', 'visitorHash'].sort(),
    )
    expect(db.rows[0]).toMatchObject({
      eventId: PUBLIC_EVENT,
      kind: 'PAGE_VIEW',
      placement: 'EVENT_PAGE',
      source: 'DIRECT',
      day: new Date('2026-10-01T00:00:00.000Z'),
    })
    expect(db.rows[0].visitorHash).toMatch(/^[0-9a-f]{32}$/u)
    expect(db.rows[0].dedupeKey).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('stores no time of day, address or agent anywhere in the row', async () => {
    const db = fakeDb()

    await recordTrafficEvent(db, view(visitorAt('203.0.113.9')))

    const stored = JSON.stringify(db.rows[0])

    expect(stored).not.toContain('09:05')
    expect(stored).not.toContain('203.0.113.9')
    expect(stored).not.toContain('Chrome')
  })

  it('keys the dedupe digest with the day’s salt, so it cannot be recomputed from the row', async () => {
    const db = fakeDb()

    await recordTrafficEvent(db, view(visitorAt('203.0.113.9')))

    const [row] = db.rows
    const day = '2026-10-01'

    for (let slot = 0; slot < 1440; slot += 30) {
      const unkeyed = createHash('sha256')
        .update([row.eventId, day, row.kind, row.placement, slot, row.visitorHash].join(SEPARATOR))
        .digest('hex')

      expect(unkeyed).not.toBe(row.dedupeKey)
    }
  })

  it('answers NOT_PUBLIC for a draft, a deleted event and an unknown id', async () => {
    const db = fakeDb()

    db.events.set(OTHER_EVENT, 'DELETED')

    for (const eventId of [DRAFT_EVENT, OTHER_EVENT, 'cnosuchevent000000000001']) {
      await expect(
        recordTrafficEvent(db, view(visitorAt('203.0.113.9'), { eventId })),
      ).resolves.toEqual({ recorded: false, reason: 'NOT_PUBLIC' })
    }

    expect(db.rows).toHaveLength(0)
  })

  it('remembers a status for a minute, unknown ids included, so a flood costs one query', async () => {
    const db = fakeDb()

    for (let i = 0; i < 5; i += 1) {
      await recordTrafficEvent(
        db,
        view(visitorAt('203.0.113.9'), { eventId: 'cnosuchevent000000000001' }),
      )
    }

    expect(db.calls.eventReads).toBe(1)

    await recordTrafficEvent(
      db,
      view(visitorAt('203.0.113.9'), {
        eventId: 'cnosuchevent000000000001',
        occurredAt: new Date(AT.getTime() + PUBLIC_STATUS_TTL_MS + 1),
      }),
    )

    expect(db.calls.eventReads).toBe(2)
  })

  it('answers BOT for a robot, and NO_ADDRESS before reading anything when no address came', async () => {
    const db = fakeDb()

    await expect(
      recordTrafficEvent(db, view(visitorAt('203.0.113.9', { 'user-agent': 'curl/8' }))),
    ).resolves.toEqual({ recorded: false, reason: 'BOT' })
    await expect(recordTrafficEvent(db, view(visitorFromRequest(request())))).resolves.toEqual({
      recorded: false,
      reason: 'NO_ADDRESS',
    })
    expect(db.calls.eventReads).toBe(0)
    expect(db.rows).toHaveLength(0)
  })

  it('folds one visitor’s repeats in a slot, and counts them again in the next', async () => {
    const db = fakeDb()
    const visitor = visitorAt('203.0.113.9')

    await recordTrafficEvent(db, view(visitor))
    await expect(
      recordTrafficEvent(db, view(visitor, { occurredAt: new Date('2026-10-01T09:29:00Z') })),
    ).resolves.toEqual({ recorded: false, reason: 'DUPLICATE' })
    await expect(
      recordTrafficEvent(db, view(visitor, { occurredAt: new Date('2026-10-01T09:30:00Z') })),
    ).resolves.toEqual({ recorded: true, reason: null })
    expect(db.rows).toHaveLength(2)
  })

  it('folds repeats without a code in memory, with no code stored', async () => {
    const db = fakeDb()
    const visitor = visitorAt('203.0.113.9', { 'sec-gpc': '1' })

    await expect(recordTrafficEvent(db, view(visitor))).resolves.toEqual({
      recorded: true,
      reason: null,
    })
    await expect(recordTrafficEvent(db, view(visitor))).resolves.toEqual({
      recorded: false,
      reason: 'DUPLICATE',
    })
    await expect(
      recordTrafficEvent(db, view(visitor, { occurredAt: new Date('2026-10-01T09:31:00Z') })),
    ).resolves.toEqual({ recorded: true, reason: null })
    expect(db.rows.map((row) => [row.visitorHash, row.dedupeKey])).toEqual([
      [null, null],
      [null, null],
    ])
  })

  it('makes the code differ across events and across days for one person', async () => {
    const db = fakeDb()

    db.events.set(OTHER_EVENT, 'ON_SALE')

    await recordTrafficEvent(db, view(visitorAt('203.0.113.9')))
    await recordTrafficEvent(db, view(visitorAt('203.0.113.9'), { eventId: OTHER_EVENT }))
    await recordTrafficEvent(
      db,
      view(visitorAt('203.0.113.9'), { occurredAt: new Date('2026-10-02T09:05:00.000Z') }),
    )

    const codes = new Set(db.rows.map((row) => row.visitorHash))

    expect(codes.size).toBe(3)
  })

  it('stops at the ceiling for one event in a minute, and starts again the next minute', async () => {
    const db = fakeDb()

    for (let i = 0; i < EVENT_CEILING_PER_MINUTE; i += 1) {
      const result = await recordTrafficEvent(
        db,
        view(
          visitorAt(`10.${Math.floor(i / 65536) % 256}.${Math.floor(i / 256) % 256}.${i % 256}`),
        ),
      )

      expect(result.recorded).toBe(true)
    }

    await expect(recordTrafficEvent(db, view(visitorAt('203.0.113.200')))).resolves.toEqual({
      recorded: false,
      reason: 'CEILING',
    })
    await expect(
      recordTrafficEvent(
        db,
        view(visitorAt('203.0.113.200'), { occurredAt: new Date(AT.getTime() + 60_000) }),
      ),
    ).resolves.toEqual({ recorded: true, reason: null })
  })

  it('holds the ceiling when beacons for one event arrive together', async () => {
    const db = fakeDb()
    const extra = 5
    const results = await Promise.all(
      Array.from({ length: EVENT_CEILING_PER_MINUTE + extra }, (_, i) =>
        recordTrafficEvent(
          db,
          view(visitorAt(`10.${Math.floor(i / 256) % 256}.${i % 256}.${Math.floor(i / 65536)}`)),
        ),
      ),
    )

    expect(results.filter((result) => result.recorded)).toHaveLength(EVENT_CEILING_PER_MINUTE)
    expect(results.filter((result) => result.reason === 'CEILING')).toHaveLength(extra)
    expect(db.rows).toHaveLength(EVENT_CEILING_PER_MINUTE)
  })

  it('records a click with no source, on a card place', async () => {
    const db = fakeDb()

    await recordTrafficEvent(
      db,
      view(visitorAt('203.0.113.9'), { kind: 'CARD_CLICK', placement: 'HOME', source: 'SEARCH' }),
    )

    expect(db.rows[0]).toMatchObject({ kind: 'CARD_CLICK', placement: 'HOME', source: null })
  })

  it.each([
    [{ placement: undefined }],
    [{ kind: 'CARD_CLICK', placement: 'EVENT_PAGE' }],
    [{ kind: 'TICKETS_CLICK', placement: 'HOME' }],
    [{ kind: 'NOT_A_KIND' }],
    [{ source: null }],
  ])('refuses a moment that cannot exist: %j', async (overrides) => {
    await expect(
      recordTrafficEvent(fakeDb(), view(visitorAt('203.0.113.9'), overrides)),
    ).rejects.toThrow(TypeError)
  })

  it('throws a database fault for its caller to log', async () => {
    const db = fakeDb()
    const fault = Object.assign(new Error('connection lost'), { code: 'P1017' })

    db.trafficEvent.createMany = async () => {
      throw fault
    }

    await expect(recordTrafficEvent(db, view(visitorAt('203.0.113.9')))).rejects.toBe(fault)
  })
})

describe('createTokenBucket', () => {
  it('spends its capacity, refills evenly, and warns once a minute', () => {
    const bucket = createTokenBucket({ capacity: 3 })
    const t = Date.parse('2026-10-01T09:00:00.000Z')

    expect([bucket.take(t), bucket.take(t), bucket.take(t), bucket.take(t)]).toEqual([
      true,
      true,
      true,
      false,
    ])
    expect(bucket.take(t + 20_000)).toBe(true)
    expect(bucket.take(t + 20_000)).toBe(false)
    expect(bucket.warnDue(t)).toBe(true)
    expect(bucket.warnDue(t + 30_000)).toBe(false)
    expect(bucket.warnDue(t + 60_000)).toBe(true)
  })

  it('refuses a capacity that is not a positive whole number', () => {
    expect(() => createTokenBucket({ capacity: 0 })).toThrow(TypeError)
  })
})
