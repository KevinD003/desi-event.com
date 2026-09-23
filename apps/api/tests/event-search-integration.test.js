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

import { buildEventQuery } from '../src/routes/events.js'

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
 * @returns {Promise<string[]>} The slugs found, sorted.
 */
async function search(q) {
  const query = listEventsQuerySchema.parse({ q, perPage: '100' })
  const { where, orderBy } = buildEventQuery(query, null)
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
    await prisma.event.upsert({
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
})
