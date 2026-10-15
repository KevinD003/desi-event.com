/**
 * An import makes no outbound request (2026-10-15).
 *
 * The owner asked for "no contact at all" with the site the listings came
 * from. The source scan in `security-regression.test.js` holds `apps/api/src`
 * to no network client and no `fetch`. This drives the import itself —
 * planning both committed files, applying a plan in the United States and in
 * Canada, approving and publishing it, which opens sales — with every way out
 * of the process watched: `fetch`, `http` and `https` requests, raw and TLS
 * sockets, and name lookups. Any call fails the test, whatever it was for. A
 * control shows the watch sees a request when one is made.
 *
 * Against the Prisma stub, so nothing here opens a socket of its own either.
 */

import dns from 'node:dns'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import net from 'node:net'
import tls from 'node:tls'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'

const ANIL = 'anil@desi-event.example'

/** Every way out of the process this test watches. */
const EXITS = [
  [globalThis, 'fetch', 'fetch'],
  [http, 'request', 'http.request'],
  [http, 'get', 'http.get'],
  [https, 'request', 'https.request'],
  [https, 'get', 'https.get'],
  [net, 'connect', 'net.connect'],
  [net, 'createConnection', 'net.createConnection'],
  [tls, 'connect', 'tls.connect'],
  [dns, 'lookup', 'dns.lookup'],
  [dns, 'resolve', 'dns.resolve'],
  [dns.promises, 'lookup', 'dns.promises.lookup'],
]

/** What was asked of each, while watched. */
let calls = []

beforeEach(() => {
  calls = []

  for (const [owner, name, label] of EXITS) {
    vi.spyOn(owner, name).mockImplementation((...args) => {
      calls.push(`${label}(${String(args[0]).slice(0, 80)})`)
      throw new Error(`${label} was called during an import`)
    })
  }

  // The named exports of `node:*` follow the objects once synced.
  syncBuiltinESMExports()
})

afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
})

/**
 * One listing, eighteen days out, at a venue in the country given.
 *
 * @param {string} sourceId The listing's id.
 * @param {'US'|'CA'} country Where its venue is.
 * @returns {object} The listing.
 */
function listing(sourceId, country) {
  const startsAt = new Date(Date.now() + 18 * 86_400_000)

  startsAt.setUTCSeconds(0, 0)

  const canada = country === 'CA'

  return {
    sourceId,
    scrapedAt: '2026-10-15T00:00:00Z',
    title: `Diwali Mela ${sourceId}`,
    category: 'CULTURAL_FESTIVAL',
    sourceCategory: 'DIWALI',
    summary: 'A Diwali mela with food stalls and a stage.',
    description: 'Stalls, music and fireworks.',
    startsAt: startsAt.toISOString(),
    endsAt: null,
    timeZone: canada ? 'America/Toronto' : 'America/Chicago',
    venue: canada
      ? {
          name: 'Toronto Hall',
          addressLine1: '1 Front St W',
          city: 'Toronto',
          region: 'ON',
          postalCode: 'M5J 2X5',
          country: 'CA',
        }
      : {
          name: 'Plano Hall',
          addressLine1: '1 Main St',
          city: 'Plano',
          region: 'TX',
          postalCode: '75074',
          country: 'US',
        },
    performers: [],
    presentedBy: 'Mela Collective',
    languages: ['Hindi'],
    prices: [
      { name: 'General', priceCents: 2500, currency: canada ? 'CAD' : 'USD', note: null },
      { name: 'VIP', priceCents: 6000, currency: canada ? 'CAD' : 'USD', note: 'Sold Out' },
    ],
    priceText: null,
    ageRestriction: null,
    dressCode: null,
    parking: null,
    faq: [],
    importNotes: [],
  }
}

/**
 * Sign in as the platform administrator, with a second factor.
 *
 * @param {object} app The app.
 * @returns {Promise<object>} The headers.
 */
async function administrator(app) {
  const headers = bearer(await signIn(app, ANIL))

  await stepUp(app, ANIL, headers)

  return headers
}

describe('an import makes no outbound request', () => {
  it('sees a request when one is made (the control)', () => {
    expect(() => globalThis.fetch('https://example.com/')).toThrow(
      'fetch was called during an import',
    )
    expect(() => https.get('https://example.com/')).toThrow()
    expect(calls).toEqual(['fetch(https://example.com/)', 'https.get(https://example.com/)'])
  })

  it('plans both committed files, then applies, approves and publishes a US and a Canadian listing, with no request at all', async () => {
    const { app, prisma } = await createTestApp({
      rateLimit: { global: { max: 10_000, timeWindow: '1 minute' }, eventImport: { max: 1000 } },
    })
    const headers = await administrator(app)

    // Planning each committed file.
    for (const file of ['sulekha-north-america-2026.json', 'sulekha-texas-2026.json']) {
      const dataset = JSON.parse(
        readFileSync(new URL(`../../../packages/db/data/imports/${file}`, import.meta.url), 'utf8'),
      )
      const planned = await app.inject({
        method: 'POST',
        url: '/v1/platform/imports',
        headers,
        payload: { fileName: file, dataset },
      })

      expect(planned.statusCode, planned.body).toBe(201)
    }

    // Applying and approving a file of two listings.
    const dataset = {
      format: 'desi-event-import/1',
      source: 'SULEKHA',
      collectedFrom: '2026-10-15T00:00:00Z',
      collectedTo: '2026-10-15T00:00:00Z',
      curatedOn: '2026-10-15',
      events: [listing('903001', 'US'), listing('903002', 'CA')],
    }
    const planned = await app.inject({
      method: 'POST',
      url: '/v1/platform/imports',
      headers,
      payload: { fileName: 'two.json', dataset },
    })
    const run = planned.json().data

    expect(
      run.rows.map((row) => [row.action, row.currency, row.priceCount, row.soldOutCount]),
    ).toEqual([
      ['CREATE', 'USD', 2, 1],
      ['CREATE', 'CAD', 2, 1],
    ])

    const applied = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/apply`,
      headers,
      payload: { planDigest: run.planDigest },
    })

    expect(applied.statusCode, applied.body).toBe(200)

    const rows = applied.json().data.rows
    const approved = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/approve`,
      headers,
      payload: {
        items: rows.map((row) => ({ eventId: row.event.id, revision: row.event.revision })),
      },
    })

    expect(approved.statusCode, approved.body).toBe(200)
    expect(approved.json().data.results.map((result) => [result.outcome, result.status])).toEqual([
      ['PUBLISHED', 'ON_SALE'],
      ['PUBLISHED', 'ON_SALE'],
    ])

    // And the public pages read with no request either, and link nowhere.
    for (const row of rows) {
      const page = await app.inject({ method: 'GET', url: `/v1/events/${row.event.slug}` })

      expect(page.statusCode).toBe(200)
      expect(page.json().data.websiteLink).toBeNull()
    }

    expect(prisma._store.ticketType.filter((tier) => tier.importKey).length).toBe(4)
    expect(calls).toEqual([])

    await app.close()
  })
})
