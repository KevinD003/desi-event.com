/**
 * The listing search, against a real database.
 *
 * The in-memory stub reads a `where` clause generously; Prisma does not. A
 * search that reaches into the venue and the organiser has to be proved on
 * PostgreSQL, where an event with no venue at all (an online one) must neither
 * break the query nor match a venue word. It runs against TEST_DATABASE_URL and
 * skips itself when no database is reachable.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPrismaClient } from '@desi-event/db'
import { listEventsQuerySchema } from '@desi-event/schemas'

import { requireDatabaseOrWarn } from './helpers/database.js'

import { EVENT_COVER_INCLUDE } from '../src/lib/event-media.js'
import { databaseErrorCode, normaliseError } from '../src/lib/errors.js'
import { EVENT_SUMMARY_SELECT, toEventSummary } from '../src/lib/presenters.js'
import { buildEventQuery, resolveSearchTerms } from '../src/routes/events.js'

const CONNECTION =
  process.env.TEST_DATABASE_URL ??
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public'

/** Marks every row this suite creates, so cleanup cannot touch anything else. */
const TAG = 'searchtest'

let prisma = null
let reachable = false

/**
 * Run a listing search the way `GET /v1/events` does, for an anonymous visitor.
 *
 * Narrowed to this suite's own organiser so whatever else the database holds
 * cannot change the answer.
 *
 * @param {string} q The search text.
 * @param {object} [options] Options.
 * @param {boolean} [options.resolve] Resolve venues and organisers first, as the route does; false filters through the relations, the path a word naming too many of them takes.
 * @returns {Promise<string[]>} The slugs found, sorted.
 */
async function search(q, { resolve = true } = {}) {
  const query = listEventsQuerySchema.parse({ q, perPage: '100' })
  const resolved = resolve ? await resolveSearchTerms(prisma, query.q) : []
  const { where, orderBy } = buildEventQuery(query, null, { search: resolved })
  const rows = await prisma.event.findMany({
    where: { AND: [where, { organization: { slug: `${TAG}-org` } }] },
    orderBy,
    select: { slug: true },
  })

  return rows.map((row) => row.slug).sort()
}

beforeAll(async () => {
  prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    await prisma.$queryRaw`SELECT 1`
    reachable = true
  } catch {
    reachable = false
  }

  requireDatabaseOrWarn('the event search integration suite', reachable, CONNECTION)

  if (!reachable) return

  const organization = await prisma.organization.upsert({
    where: { slug: `${TAG}-org` },
    update: {},
    create: {
      name: 'Quillfeather Raas Society',
      slug: `${TAG}-org`,
      contactEmail: 'search@example.com',
    },
  })

  const venue = await prisma.venue.upsert({
    where: { id: `${TAG}venue0000000000000000` },
    update: {},
    create: {
      id: `${TAG}venue0000000000000000`,
      name: 'Juniperwick Hall',
      addressLine1: '1 Juniper Road',
      city: 'Marigoldton',
      region: 'TX',
      postalCode: '77001',
      country: 'US',
    },
  })

  const base = new Date('2031-10-01T00:00:00.000Z').getTime()
  const events = [
    // At the venue, with "garba" only in its own text.
    { slug: `${TAG}-garba-night`, title: 'Garba Night', venueId: venue.id, isOnline: false },
    // Same venue, no "garba" anywhere.
    { slug: `${TAG}-dhol-evening`, title: 'Dhol Evening', venueId: venue.id, isOnline: false },
    // Online: no venue, so a venue or city word can never match it.
    { slug: `${TAG}-online-class`, title: 'Garba Steps Online', venueId: null, isOnline: true },
  ]

  for (const [index, event] of events.entries()) {
    const row = await prisma.event.upsert({
      where: { slug: event.slug },
      update: {},
      create: {
        organizationId: organization.id,
        venueId: event.venueId,
        isOnline: event.isOnline,
        title: event.title,
        slug: event.slug,
        summary: 'Fixture',
        description: 'Fixture event for the listing search.',
        category: 'GARBA_DANDIYA',
        status: 'PUBLISHED',
        startsAt: new Date(base + index * 86_400_000),
        endsAt: new Date(base + index * 86_400_000 + 7_200_000),
        languages: ['Gujarati'],
        publishedAt: new Date(base),
      },
    })

    // Tiers a card has to read correctly: the one it prices from, a cheaper
    // guest list it must ignore, and one whose sales have not opened.
    const tiers = [
      { name: 'General', priceCents: 2_500, status: 'ON_SALE' },
      { name: 'Guest list', priceCents: 0, status: 'ON_SALE', visibility: 'HIDDEN' },
      {
        name: 'Late',
        priceCents: 3_500,
        status: 'ON_SALE',
        salesStartAt: new Date('2031-09-01T00:00:00.000Z'),
      },
    ]

    for (const tier of tiers) {
      const existing = await prisma.ticketType.findFirst({
        where: { eventId: row.id, name: tier.name },
      })

      if (!existing) {
        await prisma.ticketType.create({
          data: { eventId: row.id, currency: 'USD', quantityTotal: 100, ...tier },
        })
      }
    }
  }
}, 120_000)

afterAll(async () => {
  if (prisma && reachable) {
    await prisma.event.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } })
    await prisma.venue.deleteMany({ where: { id: { startsWith: TAG } } })
    await prisma.organization.deleteMany({ where: { slug: `${TAG}-org` } })
  }

  if (prisma) await prisma.$disconnect()
})

describe('the listing search on PostgreSQL', () => {
  it('refuses a NUL in the search before the database, and answers 400 if one ever reaches it', async () => {
    if (!reachable) return

    // The schema is the first line: the listing never sends this to PostgreSQL.
    expect(listEventsQuerySchema.safeParse({ q: 'gar\u0000ba' }).success).toBe(false)

    // The second: had it got past, PostgreSQL refuses the byte (22021), and the
    // error handler answers that as a bad request rather than a fault.
    const query = {
      ...listEventsQuerySchema.parse({ q: 'garba', perPage: '100' }),
      q: 'gar\u0000ba',
    }
    const { where } = buildEventQuery(query, null, { search: [] })
    const refused = await prisma.event.findMany({ where, select: { slug: true } }).then(
      () => null,
      (error) => error,
    )

    expect(refused).not.toBeNull()
    expect(databaseErrorCode(refused)).toBe('22021')
    expect(normaliseError(refused, { exposeInternals: false })).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    })
  })

  it("matches the event's own text", async () => {
    if (!reachable) return

    expect(await search('garba')).toEqual([`${TAG}-garba-night`, `${TAG}-online-class`])
  })

  it("matches the venue's name and city, and never an event with no venue", async () => {
    if (!reachable) return

    const atVenue = [`${TAG}-dhol-evening`, `${TAG}-garba-night`]

    expect(await search('juniperwick')).toEqual(atVenue)
    expect(await search('MARIGOLDTON')).toEqual(atVenue)
  })

  it("matches the organiser's name", async () => {
    if (!reachable) return

    expect(await search('quillfeather')).toHaveLength(3)
  })

  it('needs every word to match somewhere', async () => {
    if (!reachable) return

    expect(await search('garba marigoldton')).toEqual([`${TAG}-garba-night`])
    expect(await search('garba nowhereville')).toEqual([])
  })

  it('answers the same through the relations as through the resolved ids', async () => {
    if (!reachable) return

    for (const q of ['garba', 'juniperwick', 'marigoldton', 'quillfeather', 'garba marigoldton']) {
      expect(await search(q, { resolve: false })).toEqual(await search(q))
    }
  })
})

describe('what the listing asks PostgreSQL for', () => {
  it('gives each card the same from the selected columns as from the whole row', async () => {
    if (!reachable) return

    const where = { slug: { startsWith: `${TAG}-` } }
    const orderBy = [{ startsAt: 'asc' }, { id: 'asc' }]
    const options = {
      feeConfigFor: () => ({ percentageBps: 590, flatCents: 99, currency: 'USD' }),
      now: new Date('2031-06-01T12:00:00.000Z'),
    }
    const [selected, whole] = await Promise.all([
      prisma.event.findMany({ where, orderBy, select: EVENT_SUMMARY_SELECT }),
      // What the listing loaded before: every column of the event and of each
      // relation, and the approved cover.
      prisma.event.findMany({
        where,
        orderBy,
        include: { venue: true, organization: true, ticketTypes: true, ...EVENT_COVER_INCLUDE },
      }),
    ])

    expect(selected).toHaveLength(3)
    expect(selected.map((row) => toEventSummary(row, options))).toEqual(
      whole.map((row) => toEventSummary(row, options)),
    )
    // And the columns a card never shows were not fetched.
    expect(selected[0]).not.toHaveProperty('description')
    expect(selected[0].organization).not.toHaveProperty('contactEmail')
  })

  it('has an index for every branch of the search, and none of them keeps a pending list', async () => {
    if (!reachable) return

    // `Event_venueId_idx` lets a word that names a venue join the bitmap
    // instead of sending the whole OR to a scan of every event. A trigram index
    // with `fastupdate` on keeps a pending list that every search reads, and
    // the planner stops using it once the list grows. Both are in migration
    // 20260929110000_search_index_upkeep, and Prisma's schema cannot say
    // `fastupdate`, so this is where its loss would be noticed.
    const indexes = await prisma.$queryRawUnsafe(
      `SELECT c.relname AS name, c.reloptions AS options, pg_get_indexdef(c.oid) AS definition
         FROM pg_class c
        WHERE c.relkind = 'i'
          AND c.relname IN ('Event_venueId_idx', 'Event_title_trgm_idx', 'Event_summary_trgm_idx',
                            'Event_description_trgm_idx', 'Venue_name_trgm_idx',
                            'Venue_city_trgm_idx', 'Organization_name_trgm_idx')
        ORDER BY c.relname`,
    )
    const byName = Object.fromEntries(indexes.map((index) => [index.name, index]))

    expect(Object.keys(byName)).toHaveLength(7)
    expect(byName.Event_venueId_idx.definition).toMatch(/USING btree \("venueId"\)$/)

    for (const name of Object.keys(byName).filter((name) => name.endsWith('_trgm_idx'))) {
      expect(byName[name].options, name).toEqual(['fastupdate=off'])
    }
  })
})
