/**
 * Reading an import file and planning it (`lib/import-dataset.js`,
 * SPEC2-XI §5.I-C).
 *
 * The committed Sulekha file has its own validator (`packages/db/tests/
 * import-dataset.test.js`). These tests hold the run-time rules, because the
 * file an administrator uploads is not that one: a ticket or listing link off
 * events.sulekha.com, a picture host off the list, a wrong format or source
 * are each refused with a sentence that says where; and the plan gives every
 * `EventStatus` exactly one action.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { EVENT_STATUSES } from '@desi-event/schemas'
import { IMPORT_PLAN_ACTIONS } from '@desi-event/schemas/imports'
import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { normaliseError, toErrorBody } from '../src/lib/errors.js'
import {
  IMPORT_PROBLEM_LIMIT,
  IMPORT_SOURCE_HOSTS,
  PLAN_ACTION_BY_STATUS,
  canonicalDigest,
  canonicalJson,
  importInvalid,
  listingDigest,
  parseImportDataset,
  planActionForStatus,
  planImport,
  planRow,
  sourceUrlProblem,
} from '../src/lib/import-dataset.js'
import { addRows, makeWorld, platformHeldImportFixture } from './helpers/fixtures.js'
import { createPrismaStub } from './helpers/prisma-stub.js'

const COMMITTED = JSON.parse(
  readFileSync(
    new URL('../../../packages/db/data/imports/sulekha-texas-2026.json', import.meta.url),
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
  it('reads the committed Sulekha file with no problem', () => {
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
      'source: Only listings from Sulekha ("SULEKHA") can be imported.',
    ])
  })

  it.each([
    ['another site', 'https://desicomedyfest.com/houston'],
    ['plain http', 'http://events.sulekha.com/a_event-in_houston-tx_402012'],
    ['a look-alike host', 'https://events.sulekha.com.example.net/a_402012'],
    ['a sibling host', 'https://www.sulekha.com/a_402012'],
    ['a sign-in', 'https://events.sulekha.com@example.net/a_402012'],
    ['a port', 'https://events.sulekha.com:8443/a_402012'],
    ['no address', 'not a link'],
  ])('refuses a ticket link to %s', (_label, ticketUrl) => {
    const { dataset, problems } = parseImportDataset(
      datasetWith((copy) => {
        copy.events[3].ticketUrl = ticketUrl
      }),
    )
    const id = COMMITTED.events[3].sourceId

    expect(dataset).toBeNull()
    expect(problems).toContain(
      `events[3] (listing ${id}) ticketUrl: Use the listing's own https:// page on events.sulekha.com.`,
    )
  })

  it('refuses a listing link off events.sulekha.com', () => {
    const { problems } = parseImportDataset(
      datasetWith((copy) => {
        copy.events[0].sourceUrl = 'https://example.org/listing_400132'
      }),
    )

    expect(problems).toEqual([
      "events[0] (listing 400132) sourceUrl: Use the listing's own https:// page on events.sulekha.com.",
    ])
  })

  it.each([
    ['another CDN', 'https://d3aew4oo17ml6.cloudfront.net/cdn/events/images/a.webp'],
    ['plain http', 'http://usimg.sulekha.io/cdn/events/images/a.webp'],
    ['a port', 'https://usimg.sulekha.io:8443/cdn/events/images/a.webp'],
    ['a sign-in', 'https://user:secret@usimg.sulekha.io/cdn/events/images/a.webp'],
    ['a trailing dot', 'https://usimg.sulekha.io./cdn/events/images/a.webp'],
    ['an address', 'https://127.0.0.1/cdn/events/images/a.webp'],
  ])('refuses a picture on %s', (_label, url) => {
    const { dataset, problems } = parseImportDataset(
      datasetWith((copy) => {
        copy.events[0].images[1].url = url
      }),
    )

    expect(dataset).toBeNull()
    expect(problems).toContain(
      'events[0] (listing 400132) images[1].url: Pictures are copied only from https:// addresses on usimg.sulekha.io.',
    )
  })

  it('refuses a file that declares another picture host', () => {
    const { problems } = parseImportDataset(
      datasetWith((copy) => {
        copy.imageHosts = ['usimg.sulekha.io', 'd3aew4oo17ml6.cloudfront.net']
      }),
    )

    expect(problems).toEqual([
      'imageHosts[1]: Pictures are copied only from https:// addresses on usimg.sulekha.io.',
    ])
  })

  it('places a shape problem by listing, and still runs the host checks', () => {
    const { problems } = parseImportDataset(
      datasetWith((copy) => {
        copy.events[2].category = 'GARBA'
        copy.events[2].ticketUrl = 'https://example.org/'
      }),
    )
    const id = COMMITTED.events[2].sourceId

    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(new RegExp(`^events\\[2\\] \\(listing ${id}\\) category: `, 'u'))
    expect(problems[1]).toBe(
      `events[2] (listing ${id}) ticketUrl: Use the listing's own https:// page on events.sulekha.com.`,
    )
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

describe('sourceUrlProblem', () => {
  it('allows only https pages on the one listing host', () => {
    expect(IMPORT_SOURCE_HOSTS).toEqual(['events.sulekha.com'])
    expect(sourceUrlProblem(COMMITTED.events[0].sourceUrl)).toBeNull()
    expect(sourceUrlProblem('https://EVENTS.SULEKHA.COM/x_1')).toBeNull()
    expect(sourceUrlProblem('https://events.sulekha.com:443/x_1')).toBeNull()
    expect(sourceUrlProblem('https:events.sulekha.com/x_1')).not.toBeNull()
    expect(sourceUrlProblem(undefined)).not.toBeNull()
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
      imageCount: listing.images.length,
      priceCount: listing.prices.length,
      endTimeListed: listing.endsAt !== null,
    })
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

  it('calls a listing whose ticket link fails the website rules INVALID, with the reason', () => {
    const tokened = { ...listing, ticketUrl: `${listing.ticketUrl}?token=abc` }
    const row = planRow({ listing: tokened, existing: null, previousDigest: null, now: CURATED })

    expect(row.action).toBe('INVALID')
    expect(row.problem).toMatch(/^Its ticket link cannot be used: Take “token” out of the address/u)
    expect(
      planRow({
        listing: tokened,
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
