/**
 * Reading an import file and planning it (`lib/import-dataset.js`,
 * SPEC2-XI §5.I-C).
 *
 * The committed files have their own validator (`packages/db/tests/
 * import-dataset.test.js`). These tests hold the run-time rules, because the
 * file an administrator uploads is not that one: since 2026-10-15 a file that
 * still carries a listing link, a ticket link, pictures, a source site,
 * picture hosts or a source name is refused, each field named; a wrong format
 * or source is refused in its own words; a listing priced in another currency
 * than its venue's country sells in is INVALID; each listed price becomes a
 * ticket type (`listingTiers`); and the plan gives every `EventStatus`
 * exactly one action.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { EVENT_STATUSES } from '@desi-event/schemas'
import { IMPORT_PLAN_ACTIONS } from '@desi-event/schemas/imports'
import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { normaliseError, toErrorBody } from '../src/lib/errors.js'
import * as importDataset from '../src/lib/import-dataset.js'
import {
  IMPORT_PROBLEM_LIMIT,
  LISTING_DIGEST_VERSION,
  PLAN_ACTION_BY_STATUS,
  canonicalDigest,
  canonicalJson,
  importInvalid,
  listingCurrency,
  listingDigest,
  listingPriceProblem,
  listingTiers,
  parseImportDataset,
  planActionForStatus,
  planImport,
  planRow,
} from '../src/lib/import-dataset.js'
import { addRows, makeWorld, platformHeldImportFixture } from './helpers/fixtures.js'
import { createPrismaStub } from './helpers/prisma-stub.js'

const COMMITTED = JSON.parse(
  readFileSync(
    new URL('../../../packages/db/data/imports/texas-2026.json', import.meta.url),
    'utf8',
  ),
)

/** The day the file was curated: every listing is still to come. */
const CURATED = new Date('2026-09-30T12:00:00.000Z')

/**
 * A copy of the committed file with one change applied.
 *
 * @param {function(object): void} [change] Edits the copy in place.
 * @returns {object} The copy.
 */
function datasetWith(change = () => {}) {
  const copy = structuredClone(COMMITTED)

  change(copy)

  return copy
}

/** A small valid file: the first two listings. */
function smallDataset() {
  return datasetWith((copy) => {
    copy.events = copy.events.slice(0, 2)
  })
}

/** The parsed committed file. */
function parsedCommitted() {
  const { dataset, problems } = parseImportDataset(COMMITTED)

  expect(problems).toEqual([])

  return dataset
}

describe('parseImportDataset', () => {
  it('reads the committed Texas file with no problem', () => {
    const { dataset, problems } = parseImportDataset(COMMITTED)

    expect(problems).toEqual([])
    expect(dataset.events).toHaveLength(45)
    expect(dataset.source).toBe('SULEKHA')
  })

  it('reads the file as text as well as parsed JSON', () => {
    const { dataset, problems } = parseImportDataset(JSON.stringify(smallDataset()))

    expect(problems).toEqual([])
    expect(dataset.events.map((event) => event.sourceId)).toEqual(
      COMMITTED.events.slice(0, 2).map((event) => event.sourceId),
    )
  })

  it('refuses text that is not JSON, and JSON that is not one object', () => {
    expect(parseImportDataset('{"format": ')).toEqual({
      dataset: null,
      problems: ['The file is not JSON. Upload the .json file itself.'],
    })
    expect(parseImportDataset([COMMITTED]).problems).toEqual([
      'The file must be one JSON object with "format", "source" and "events".',
    ])
    expect(parseImportDataset(null).dataset).toBeNull()
  })

  it('refuses a wrong format and a wrong source, each in its own words and once', () => {
    const { dataset, problems } = parseImportDataset(
      datasetWith((copy) => {
        copy.format = 'desi-event-import/2'
        copy.source = 'EVENTBRITE'
      }),
    )

    expect(dataset).toBeNull()
    expect(problems).toEqual([
      'format: This build reads "desi-event-import/1" files only, and this file does not say it is one.',
      'source: This file names a source this build does not import from.',
    ])
  })

  it.each([
    ['sourceUrl', 'https://events.sulekha.com/a_event-in_houston-tx_402012'],
    ['ticketUrl', 'https://desicomedyfest.com/houston'],
    ['images', [{ url: 'https://usimg.sulekha.io/a.webp', role: 'cover', alt: 'A' }]],
    ['images', []],
  ])('refuses a listing that still carries %s, whatever it holds (2026-10-15)', (field, value) => {
    const { dataset, problems } = parseImportDataset(
      datasetWith((copy) => {
        copy.events[3][field] = value
      }),
    )
    const id = COMMITTED.events[3].sourceId

    expect(dataset).toBeNull()
    expect(problems).toEqual([
      `events[3] (listing ${id}) ${field}: Import files carry no web address and no name of the site the listing came from. Remove this field.`,
    ])
  })

  it.each([
    ['sourceName', 'Sulekha'],
    ['sourceSite', 'https://events.sulekha.com/'],
    ['imageHosts', ['usimg.sulekha.io']],
  ])('refuses a file whose header still carries %s', (field, value) => {
    const { dataset, problems } = parseImportDataset(
      datasetWith((copy) => {
        copy[field] = value
      }),
    )

    expect(dataset).toBeNull()
    expect(problems).toEqual([
      `${field}: Import files carry no web address and no name of the site the listing came from. Remove this field.`,
    ])
  })

  it('refuses a file made before 2026-10-15 field by field, naming no site in any problem', () => {
    const { problems } = parseImportDataset(
      datasetWith((copy) => {
        copy.sourceName = 'Sulekha'
        copy.sourceSite = 'https://events.sulekha.com/'
        copy.imageHosts = ['usimg.sulekha.io']
        copy.events = copy.events.slice(0, 1).map((event) => ({
          ...event,
          sourceUrl: `https://events.sulekha.com/x_${event.sourceId}`,
          ticketUrl: `https://events.sulekha.com/x_${event.sourceId}`,
          images: [],
        }))
      }),
    )

    expect(problems).toHaveLength(6)
    expect(problems.filter((problem) => /sulekha|https?:/iu.test(problem))).toEqual([])
    // And a key that was never part of a file is still the schema's own refusal.
    expect(
      parseImportDataset(datasetWith((copy) => (copy.events[0].organizer = {}))).problems[0],
    ).toMatch(/^events\[0\] \(listing 400132\): Unrecognized key/u)
  })

  it('places a shape problem by listing', () => {
    const { problems } = parseImportDataset(
      datasetWith((copy) => {
        copy.events[2].category = 'GARBA'
        copy.events[2].ticketUrl = 'https://example.org/'
      }),
    )
    const id = COMMITTED.events[2].sourceId

    expect(problems).toHaveLength(2)
    expect(problems[0]).toBe(
      `events[2] (listing ${id}) ticketUrl: Import files carry no web address and no name of the site the listing came from. Remove this field.`,
    )
    expect(problems[1]).toMatch(new RegExp(`^events\\[2\\] \\(listing ${id}\\) category: `, 'u'))
  })

  it('lists at most fifty problems, the last saying how many more there are', () => {
    const { problems } = parseImportDataset(
      datasetWith((copy) => {
        for (const event of copy.events) event.ticketUrl = 'https://example.org/'
        for (const event of copy.events) event.sourceUrl = 'https://example.org/'
      }),
    )

    expect(problems).toHaveLength(IMPORT_PROBLEM_LIMIT)
    expect(problems.at(-1)).toBe('41 more problems are not listed.')
  })

  it('reads a listing in Canada as the file gives it: province, postal code, zone and CAD', () => {
    const toronto = {
      name: 'Harbourfront Hall',
      addressLine1: '235 Queens Quay W',
      city: 'Toronto',
      region: 'ON',
      postalCode: 'M5J 2G8',
      country: 'CA',
    }
    const { dataset, problems } = parseImportDataset(
      datasetWith((copy) => {
        copy.events = copy.events.slice(0, 1).map((event) => ({
          ...event,
          venue: toronto,
          timeZone: 'America/Toronto',
          prices: [{ name: 'Adult', priceCents: 3000, currency: 'CAD', note: null }],
        }))
      }),
    )

    expect(problems).toEqual([])
    expect(dataset.events[0]).toMatchObject({
      venue: toronto,
      timeZone: 'America/Toronto',
      prices: [{ name: 'Adult', priceCents: 3000, currency: 'CAD', note: null }],
    })

    // Every zone the Canadian listings name is one the platform knows.
    for (const timeZone of [
      'America/Toronto',
      'America/Vancouver',
      'America/Edmonton',
      'America/Montreal',
    ]) {
      const parsed = parseImportDataset(
        datasetWith((copy) => {
          copy.events = copy.events.slice(0, 1).map((event) => ({ ...event, timeZone }))
        }),
      )

      expect(parsed.problems, timeZone).toEqual([])
    }

    expect(
      planRow({ listing: dataset.events[0], existing: null, previousDigest: null, now: CURATED }),
    ).toMatchObject({ action: 'CREATE', city: 'Toronto' })
  })

  it('refuses the same listing twice', () => {
    const { problems } = parseImportDataset(
      datasetWith((copy) => {
        copy.events[1] = structuredClone(copy.events[0])
      }),
    )

    expect(problems).toEqual([
      'events[1] (listing 400132) sourceId: Listing 400132 appears more than once.',
    ])
  })
})

describe('no address rule is left to check (2026-10-15)', () => {
  it('names no host and checks no address, because a file holds none', () => {
    expect(importDataset).not.toHaveProperty('IMPORT_SOURCE_HOSTS')
    expect(importDataset).not.toHaveProperty('sourceUrlProblem')
  })
})

describe('listingTiers and the currency an event sells in', () => {
  const base = parsedCommitted().events[5]

  /**
   * The listing with other prices, at a venue in the country given.
   *
   * @param {object[]} prices The prices.
   * @param {string} [country] The venue's country.
   * @returns {object} The listing.
   */
  function priced(prices, country = 'US') {
    return { ...base, venue: { ...base.venue, country }, prices }
  }

  it('sells in USD in the United States and CAD in Canada, and elsewhere in the prices’ one currency', () => {
    expect(listingCurrency(priced([], 'US'))).toBe('USD')
    expect(listingCurrency(priced([], 'CA'))).toBe('CAD')
    expect(
      listingCurrency(priced([{ name: 'A', priceCents: 100, currency: 'GBP', note: null }], 'GB')),
    ).toBe('GBP')
    expect(listingCurrency(priced([], 'GB'))).toBeNull()
  })

  it('makes one tier per price, named as the page shows it, keyed by that name, closed when sold out', () => {
    expect(
      listingTiers(
        priced([
          {
            name: 'Early Bird (Ends on 10/9)',
            priceCents: 2000,
            currency: 'USD',
            note: 'Sold Out',
          },
          { name: 'Regular', priceCents: 3500, currency: 'USD', note: null },
          { name: 'Kids', priceCents: 0, currency: 'USD', note: 'Under 5' },
        ]),
      ),
    ).toEqual([
      {
        key: 'Early Bird',
        name: 'Early Bird',
        priceCents: 2000,
        currency: 'USD',
        soldOut: true,
        sortOrder: 0,
      },
      {
        key: 'Regular',
        name: 'Regular',
        priceCents: 3500,
        currency: 'USD',
        soldOut: false,
        sortOrder: 1,
      },
      { key: 'Kids', name: 'Kids', priceCents: 0, currency: 'USD', soldOut: false, sortOrder: 2 },
    ])
  })

  it('makes a repeated price one tier, and tells same-named prices apart by their amounts', () => {
    const tiers = listingTiers(
      priced(
        [
          { name: 'Zone 1', priceCents: 7500, currency: 'CAD', note: null },
          { name: 'Zone 1', priceCents: 7500, currency: 'CAD', note: 'Sold Out' },
          { name: 'General Admission', priceCents: 3500, currency: 'CAD', note: null },
          { name: 'General Admission', priceCents: 4500, currency: 'CAD', note: 'Sold Out' },
        ],
        'CA',
      ),
    )

    expect(tiers.map((tier) => [tier.key, tier.priceCents, tier.soldOut, tier.sortOrder])).toEqual([
      // Sold out only when every copy was.
      ['Zone 1', 7500, false, 0],
      ['General Admission (CA$35.00)', 3500, false, 1],
      ['General Admission (CA$45.00)', 4500, true, 2],
    ])
    expect(new Set(tiers.map((tier) => tier.key)).size).toBe(tiers.length)
  })

  it('gives every committed listing unique tier names within the editor’s bounds', () => {
    for (const file of ['texas-2026.json', 'north-america-2026.json']) {
      const { dataset } = parseImportDataset(
        JSON.parse(
          readFileSync(
            new URL(`../../../packages/db/data/imports/${file}`, import.meta.url),
            'utf8',
          ),
        ),
      )

      for (const listing of dataset.events) {
        const tiers = listingTiers(listing)

        expect(new Set(tiers.map((tier) => tier.key)).size, listing.sourceId).toBe(tiers.length)
        for (const tier of tiers) {
          expect(tier.name.length, listing.sourceId).toBeLessThanOrEqual(120)
          expect(tier.currency).toBe(listing.venue.country === 'CA' ? 'CAD' : 'USD')
        }
        expect(listingPriceProblem(listing), listing.sourceId).toBeNull()
      }
    }
  })

  it('says why a listing priced in another currency cannot be sold', () => {
    expect(
      listingPriceProblem(
        priced([{ name: 'Regular', priceCents: 3500, currency: 'USD', note: null }], 'CA'),
      ),
    ).toBe(
      'Its price "Regular" is in USD, but tickets at a venue in CA are sold in CAD. Correct the currency in the file.',
    )
    expect(
      listingPriceProblem(
        priced(
          [
            { name: 'A', priceCents: 100, currency: 'GBP', note: null },
            { name: 'B', priceCents: 100, currency: 'EUR', note: null },
          ],
          'GB',
        ),
      ),
    ).toMatch(/more than one currency \(GBP and EUR\)/u)
  })
})

describe('importInvalid', () => {
  it('answers 422 IMPORT_INVALID with every problem listed, at most fifty', () => {
    const problems = Array.from({ length: 60 }, (_, index) => `problem ${index}`)
    const body = toErrorBody(normaliseError(importInvalid(problems)), 'req-1')

    expect(body.error).toMatchObject({ code: 'IMPORT_INVALID', statusCode: 422 })
    expect(body.error.problems).toEqual(problems.slice(0, 50))
  })
})

describe('canonical digests', () => {
  it('ignores key order and changes with any value', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: 'x' }] })).toBe(
      '{"a":[2,{"c":"x","d":null}],"b":1}',
    )
    expect(canonicalDigest({ a: 1, b: 2 })).toBe(canonicalDigest({ b: 2, a: 1 }))
    expect(canonicalDigest({ a: 1 })).not.toBe(canonicalDigest({ a: 2 }))
    expect(canonicalDigest({ a: 1 })).toMatch(/^[0-9a-f]{64}$/u)
  })
})

describe('planActionForStatus', () => {
  it('maps every EventStatus to exactly one plan action', () => {
    expect(new Set(Object.keys(PLAN_ACTION_BY_STATUS))).toEqual(new Set(EVENT_STATUSES))

    for (const status of EVENT_STATUSES) {
      const action = planActionForStatus(status)

      expect(IMPORT_PLAN_ACTIONS, status).toContain(action)
      expect(
        IMPORT_PLAN_ACTIONS.filter((candidate) => candidate === action),
        status,
      ).toHaveLength(1)
    }
  })

  it('updates drafts, keeps posted events, and skips decided and deleted ones', () => {
    for (const status of ['DRAFT', 'CHANGES_REQUIRED', 'REVIEW_PENDING']) {
      expect(planActionForStatus(status)).toBe('UPDATE_DRAFT')
    }
    for (const status of PUBLICLY_VISIBLE_STATUSES) {
      expect(planActionForStatus(status)).toBe('POSTED_KEPT')
    }
    for (const status of ['APPROVED', 'REJECTED', 'ARCHIVED']) {
      expect(planActionForStatus(status)).toBe('SKIPPED_DECIDED')
    }
    expect(planActionForStatus('DELETED')).toBe('SKIPPED_DELETED')
  })

  it('refuses a status it does not know rather than importing over it', () => {
    expect(() => planActionForStatus('LIVE_ON_MARS')).toThrow(/No import plan action/u)
    expect(() => planActionForStatus('toString')).toThrow(/No import plan action/u)
  })
})

describe('planRow', () => {
  const dataset = parsedCommitted()
  const listing = dataset.events[5]
  const digest = listingDigest(listing)

  /**
   * An import record in a status.
   *
   * @param {string} status The event's status.
   * @param {object} [extra] Overrides.
   * @returns {object} The record as planImport selects it.
   */
  function existing(status, extra = {}) {
    return {
      eventId: 'cevent000000001',
      reassignedAt: null,
      event: { status, organization: { platformHeldSource: 'SULEKHA' } },
      ...extra,
    }
  }

  it('creates a listing not imported before, and carries what the page shows', () => {
    const row = planRow({ listing, existing: null, previousDigest: null, now: CURATED })

    expect(row).toEqual({
      sourceId: listing.sourceId,
      title: listing.title,
      startsAt: listing.startsAt,
      city: listing.venue.city,
      action: 'CREATE',
      eventId: null,
      eventStatus: null,
      resubmit: false,
      updatable: false,
      contentDigest: digest,
      problem: null,
      importNotes: listing.importNotes,
      priceCount: listingTiers(listing).length,
      soldOutCount: listingTiers(listing).filter((tier) => tier.soldOut).length,
      currency: 'USD',
      endTimeListed: listing.endsAt !== null,
    })
  })

  it('counts the ticket types applying makes, a repeated price once, so a plan never promises more', () => {
    const general = { name: 'General', priceCents: 2500, currency: 'USD', note: null }
    const repeated = {
      ...listing,
      prices: [
        general,
        { ...general },
        { ...general, name: 'VIP', priceCents: 6000, note: 'Sold Out' },
      ],
    }
    const row = planRow({ listing: repeated, existing: null, previousDigest: null, now: CURATED })

    expect(repeated.prices).toHaveLength(3)
    expect([row.priceCount, row.soldOutCount]).toEqual([2, 1])
    expect(listingTiers(repeated).map((tier) => tier.name)).toEqual(['General', 'VIP'])
  })

  it('takes a listing’s digest with the version of what applying writes, so older copies read as changed', () => {
    expect(LISTING_DIGEST_VERSION).toBe('tiers-1')
    expect(digest).toBe(canonicalDigest({ version: 'tiers-1', listing }))
    expect(digest).not.toBe(canonicalDigest(listing))
  })

  it('skips a listing whose start has come, new or not', () => {
    const at = new Date(listing.startsAt)

    expect(planRow({ listing, existing: null, previousDigest: null, now: at }).action).toBe(
      'SKIPPED_PAST',
    )
    expect(
      planRow({ listing, existing: existing('REVIEW_PENDING'), previousDigest: null, now: at })
        .action,
    ).toBe('SKIPPED_PAST')
    expect(
      planRow({
        listing,
        existing: null,
        previousDigest: null,
        now: new Date(at.getTime() - 1),
      }).action,
    ).toBe('CREATE')
  })

  it('gives every status, its listing changed, the one action the table names', () => {
    for (const status of EVENT_STATUSES) {
      const row = planRow({
        listing,
        existing: existing(status),
        previousDigest: '0'.repeat(64),
        now: CURATED,
      })

      expect(row.action, status).toBe(planActionForStatus(status))
      expect(row.eventStatus).toBe(status)
      expect(row.updatable).toBe(row.action === 'POSTED_KEPT')
    }
  })

  it('calls an unchanged listing UNCHANGED, and still sends a draft for review', () => {
    const unchanged = (status) =>
      planRow({ listing, existing: existing(status), previousDigest: digest, now: CURATED })

    expect(unchanged('DRAFT')).toMatchObject({ action: 'UNCHANGED', resubmit: true })
    expect(unchanged('CHANGES_REQUIRED')).toMatchObject({ action: 'UNCHANGED', resubmit: true })
    expect(unchanged('REVIEW_PENDING')).toMatchObject({ action: 'UNCHANGED', resubmit: false })
    expect(unchanged('PUBLISHED')).toMatchObject({ action: 'UNCHANGED', updatable: false })
    // A decided or deleted event is skipped whatever its content.
    expect(unchanged('APPROVED').action).toBe('SKIPPED_DECIDED')
    expect(unchanged('DELETED').action).toBe('SKIPPED_DELETED')
  })

  it('skips an event moved to an organiser, by the stamp or by its organisation', () => {
    expect(
      planRow({
        listing,
        existing: existing('PUBLISHED', { reassignedAt: new Date('2026-09-30T13:00:00Z') }),
        previousDigest: digest,
        now: CURATED,
      }).action,
    ).toBe('SKIPPED_REASSIGNED')
    expect(
      planRow({
        listing,
        existing: {
          ...existing('DRAFT'),
          event: { status: 'DRAFT', organization: { platformHeldSource: null } },
        },
        previousDigest: null,
        now: CURATED,
      }).action,
    ).toBe('SKIPPED_REASSIGNED')
  })

  it('calls a listing priced in another currency than its venue’s country INVALID, with the reason', () => {
    const euros = {
      ...listing,
      prices: listing.prices.length
        ? listing.prices.map((price) => ({ ...price, currency: 'EUR' }))
        : [{ name: 'Regular', priceCents: 1000, currency: 'EUR', note: null }],
    }
    const row = planRow({ listing: euros, existing: null, previousDigest: null, now: CURATED })

    expect(row.action).toBe('INVALID')
    expect(row.problem).toMatch(/is in EUR, but tickets at a venue in US are sold in USD/u)
    expect(
      planRow({
        listing: euros,
        existing: existing('DRAFT'),
        previousDigest: null,
        now: CURATED,
      }).action,
    ).toBe('INVALID')
  })
})

describe('planImport', () => {
  /**
   * A stub with the platform-held import fixture (listing 402059, REVIEW_PENDING).
   *
   * @param {object} [options] Fixture options.
   * @returns {Promise<{prisma: object, fixture: object}>} The stub and the fixture.
   */
  async function importWorld(options) {
    const { seed, ids } = await makeWorld()
    const fixture = platformHeldImportFixture(ids, options)

    addRows(seed, fixture.rows)

    return { prisma: createPrismaStub(seed), fixture }
  }

  it('plans every listing in file order: new ones created, the imported one updated', async () => {
    const { prisma, fixture } = await importWorld()
    const dataset = parsedCommitted()
    const { rows, planDigest } = await planImport(prisma, { dataset, now: CURATED })

    expect(rows.map((row) => row.sourceId)).toEqual(dataset.events.map((event) => event.sourceId))
    expect(planDigest).toMatch(/^[0-9a-f]{64}$/u)
    expect(planDigest).toBe(canonicalDigest(rows))

    const imported = rows.find((row) => row.sourceId === '402059')

    // The fixture run's stored dataset has no copy of the listing: changed.
    expect(imported).toMatchObject({
      action: 'UPDATE_DRAFT',
      eventId: fixture.event.id,
      eventStatus: 'REVIEW_PENDING',
    })
    expect(rows.filter((row) => row.action === 'CREATE')).toHaveLength(44)
  })

  it('calls the listing UNCHANGED once the run that wrote it holds the same copy', async () => {
    const { prisma, fixture } = await importWorld()
    const dataset = parsedCommitted()

    await prisma.eventImportRun.update({ where: { id: fixture.run.id }, data: { dataset } })

    const { rows } = await planImport(prisma, { dataset, now: CURATED })

    expect(rows.find((row) => row.sourceId === '402059')).toMatchObject({
      action: 'UNCHANGED',
      resubmit: false,
    })
  })

  it('gives the same digest for the same plan and another when anything in it moves', async () => {
    const { prisma, fixture } = await importWorld()
    const dataset = parsedCommitted()
    const first = await planImport(prisma, { dataset, now: CURATED })
    const again = await planImport(prisma, { dataset, now: CURATED })

    expect(again.planDigest).toBe(first.planDigest)

    // A moderator approves it in between: the plan the administrator read is stale.
    await prisma.event.update({ where: { id: fixture.event.id }, data: { status: 'APPROVED' } })

    const decided = await planImport(prisma, { dataset, now: CURATED })

    expect(decided.rows.find((row) => row.sourceId === '402059').action).toBe('SKIPPED_DECIDED')
    expect(decided.planDigest).not.toBe(first.planDigest)

    // Time passes: listings that have started are skipped, and the digest moves again.
    const later = new Date('2026-10-05T12:00:00.000Z')
    const passed = await planImport(prisma, { dataset, now: later })
    const started = dataset.events.filter((event) => Date.parse(event.startsAt) <= later.getTime())

    expect(started.length).toBeGreaterThan(0)
    expect(passed.rows.filter((row) => row.action === 'SKIPPED_PAST')).toHaveLength(started.length)
    expect(passed.planDigest).not.toBe(decided.planDigest)
  })

  it('skips the listing once its event is deleted or moved to an organiser', async () => {
    const dataset = parsedCommitted()

    {
      const { prisma } = await importWorld({ status: 'DELETED' })
      const { rows } = await planImport(prisma, { dataset, now: CURATED })

      expect(rows.find((row) => row.sourceId === '402059').action).toBe('SKIPPED_DELETED')
    }

    {
      const { prisma, fixture } = await importWorld({ status: 'PUBLISHED' })

      await prisma.eventImportItem.update({
        where: { id: fixture.item.id },
        data: { reassignedAt: new Date('2026-09-30T13:00:00.000Z') },
      })

      const { rows } = await planImport(prisma, { dataset, now: CURATED })

      expect(rows.find((row) => row.sourceId === '402059').action).toBe('SKIPPED_REASSIGNED')
    }
  })

  it('keeps a posted imported event unless the administrator chooses to update it', async () => {
    const { prisma } = await importWorld({ status: 'ON_SALE' })
    const { rows } = await planImport(prisma, { dataset: parsedCommitted(), now: CURATED })

    expect(rows.find((row) => row.sourceId === '402059')).toMatchObject({
      action: 'POSTED_KEPT',
      updatable: true,
    })
  })
})
