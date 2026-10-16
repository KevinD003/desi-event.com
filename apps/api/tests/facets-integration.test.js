/**
 * Facets are computed over the whole catalogue, against a real database.
 *
 * This suite cannot use the in-memory stub: the point of the fix is that the
 * counting happens in SQL rather than in application memory, so proving it
 * requires SQL. It runs against TEST_DATABASE_URL and skips itself when no
 * database is reachable.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPrismaClient } from '@desi-event/db'

import { requireDatabaseOrWarn } from './helpers/database.js'

import { loadEventFacets } from '../src/lib/facets.js'

const CONNECTION =
  process.env.TEST_DATABASE_URL ??
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public'

/** More than the 48 the filter options used to be derived from. */
const EVENT_COUNT = 60

/** Marks every row this suite creates, so cleanup cannot touch anything else. */
const TAG = 'facettest'

/**
 * Three cities with the same number of events, named so that the tie between
 * them is broken differently by byte order and by a locale.
 *
 * The facet SQL breaks a tie on count by value in byte order (`COLLATE "C"`),
 * so `X` (0x58) comes before `_` (0x5F), which comes before `a` (0x61). ICU,
 * and so `String.prototype.localeCompare`, puts punctuation before letters and
 * compares letters before case, which reverses all three. The suite owns these
 * rows, so the case is exercised on every run rather than only when another
 * suite's fixtures happen to be in the database at the moment the facets are
 * read.
 *
 * Listed in the order the API must return them.
 */
const TIE_CITIES = Object.freeze([`${TAG}Xtie`, `${TAG}_tie`, `${TAG}atie`])

/** Events per tie city: equal, so only the value can order them. */
const TIE_EVENTS_PER_CITY = 2

let prisma = null
let reachable = false
let organizationId = null

beforeAll(async () => {
  prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    await prisma.$queryRaw`SELECT 1`
    reachable = true
  } catch {
    reachable = false
  }

  // Throws rather than returning when REQUIRE_DATABASE is set, so a build that
  // asked for the database cannot report a green tick for a suite that skipped.
  requireDatabaseOrWarn('the facets integration suite', reachable, CONNECTION)

  if (!reachable) return

  const organization = await prisma.organization.upsert({
    where: { slug: `${TAG}-org` },
    update: {},
    create: {
      name: 'Facet Test Collective',
      slug: `${TAG}-org`,
      contactEmail: 'facets@example.com',
    },
  })
  organizationId = organization.id

  // Two venues in different cities. The second is used only by events that
  // start late, so it lands beyond any first page.
  const [early, late] = await Promise.all([
    prisma.venue.upsert({
      where: { id: `${TAG}venueearly000000000000` },
      update: {},
      create: {
        id: `${TAG}venueearly000000000000`,
        name: 'Early Hall',
        addressLine1: '1 Early Road',
        city: 'Facetsburg',
        region: 'MH',
        postalCode: '400001',
        country: 'IN',
      },
    }),
    prisma.venue.upsert({
      where: { id: `${TAG}venuelate00000000000000` },
      update: {},
      create: {
        id: `${TAG}venuelate00000000000000`,
        name: 'Late Hall',
        addressLine1: '2 Late Road',
        city: 'Lastchanceton',
        region: 'ON',
        postalCode: 'M5V 1A1',
        country: 'CA',
      },
    }),
  ])

  const tieVenues = await Promise.all(
    TIE_CITIES.map((city, index) =>
      prisma.venue.upsert({
        where: { id: `${TAG}venuetie${index}000000000000000` },
        update: {},
        create: {
          id: `${TAG}venuetie${index}000000000000000`,
          name: `Tie Hall ${index}`,
          addressLine1: `${index + 3} Tie Road`,
          city,
          region: 'MH',
          postalCode: '400001',
          country: 'IN',
        },
      }),
    ),
  )

  const base = new Date('2030-01-01T00:00:00.000Z').getTime()

  for (let index = 0; index < EVENT_COUNT; index += 1) {
    // Only the final five events use the late venue and the rare category, so
    // any implementation that looks at a first page of results will miss them.
    const isLate = index >= EVENT_COUNT - 5

    await prisma.event.upsert({
      where: { slug: `${TAG}-event-${index}` },
      update: {},
      create: {
        organizationId,
        venueId: isLate ? late.id : early.id,
        title: `Facet Event ${index}`,
        slug: `${TAG}-event-${index}`,
        summary: 'Fixture',
        description: 'Fixture event for facet aggregation.',
        category: isLate ? 'SPORTS' : 'COMEDY',
        status: 'PUBLISHED',
        startsAt: new Date(base + index * 86_400_000),
        endsAt: new Date(base + index * 86_400_000 + 7_200_000),
        languages: isLate ? ['Tamil'] : ['Hindi'],
        publishedAt: new Date(base),
      },
    })
  }

  for (const [venueIndex, venue] of tieVenues.entries()) {
    for (let index = 0; index < TIE_EVENTS_PER_CITY; index += 1) {
      const day = EVENT_COUNT + venueIndex * TIE_EVENTS_PER_CITY + index

      await prisma.event.upsert({
        where: { slug: `${TAG}-event-tie-${venueIndex}-${index}` },
        update: {},
        create: {
          organizationId,
          venueId: venue.id,
          title: `Facet Tie Event ${venueIndex}-${index}`,
          slug: `${TAG}-event-tie-${venueIndex}-${index}`,
          summary: 'Fixture',
          description: 'Fixture event for the facet tie-break.',
          category: 'COMEDY',
          status: 'PUBLISHED',
          startsAt: new Date(base + day * 86_400_000),
          endsAt: new Date(base + day * 86_400_000 + 7_200_000),
          languages: ['Hindi'],
          publishedAt: new Date(base),
        },
      })
    }
  }
}, 120_000)

afterAll(async () => {
  if (prisma && reachable) {
    await prisma.event.deleteMany({ where: { slug: { startsWith: `${TAG}-event-` } } })
    await prisma.venue.deleteMany({ where: { id: { startsWith: TAG } } })
    await prisma.organization.deleteMany({ where: { slug: `${TAG}-org` } })
  }

  if (prisma) await prisma.$disconnect()
})

describe('facets cover the complete eligible set', () => {
  it('counts more events than any single page holds', async () => {
    if (!reachable) return

    const facets = await loadEventFacets(prisma)

    expect(facets.scope.status).toBe('LISTED')
    expect(facets.scope.total).toBeGreaterThanOrEqual(EVENT_COUNT)
  })

  it('includes a city that only appears beyond the first page', async () => {
    if (!reachable) return

    const facets = await loadEventFacets(prisma)
    const late = facets.cities.find((entry) => entry.value === 'Lastchanceton')

    // This is the regression. The filter options used to come from one page of
    // 48 events ordered by start date; these five start last, so the city was
    // absent from the select and its events were unreachable through filtering.
    expect(late).toBeDefined()
    expect(late.count).toBe(5)
  })

  it('includes a category and a language that only appear in the latest events', async () => {
    if (!reachable) return

    const facets = await loadEventFacets(prisma)

    // The seeded catalogue may already contain these values, so the assertion
    // is that this suite's five late events are counted on top of whatever was
    // there — not that the totals equal five exactly.
    expect(
      facets.categories.find((entry) => entry.value === 'SPORTS')?.count,
    ).toBeGreaterThanOrEqual(5)
    expect(facets.languages.find((entry) => entry.value === 'Tamil')?.count).toBeGreaterThanOrEqual(
      5,
    )
  })

  it('counts the bulk category too, so the totals reconcile', async () => {
    if (!reachable) return

    const facets = await loadEventFacets(prisma)

    expect(
      facets.categories.find((entry) => entry.value === 'COMEDY')?.count,
    ).toBeGreaterThanOrEqual(EVENT_COUNT - 5)
  })

  it('orders facets deterministically: count descending, then value', async () => {
    if (!reachable) return

    const facets = await loadEventFacets(prisma)

    // The SQL's `value COLLATE "C"` compares UTF-8 bytes, so this does too.
    // `localeCompare` would not: it orders `_` before letters, which made this
    // assertion fail whenever another suite's `Snake_town` and `SnakeXtown`
    // happened to share a count.
    const byBytes = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))

    for (const list of [facets.categories, facets.cities, facets.languages, facets.formats]) {
      const sorted = [...list].sort((a, b) => b.count - a.count || byBytes(a.value, b.value))
      expect(list).toEqual(sorted)
    }
  })

  it('breaks a tie on count by value in byte order, whatever the database collation', async () => {
    if (!reachable) return

    const facets = await loadEventFacets(prisma)
    const ties = facets.cities.filter((entry) => TIE_CITIES.includes(entry.value))

    // Byte order, not ICU's `_tie`, `atie`, `Xtie`, and not left to the
    // database's default collation, which differs between environments.
    expect(ties).toEqual(TIE_CITIES.map((value) => ({ value, count: TIE_EVENTS_PER_CITY })))
  })

  it('excludes draft events from the public facet universe', async () => {
    if (!reachable) return

    /**
     * Sentinel thrown to roll the transaction back once the assertions pass.
     *
     * Rolling back rather than setting the status back afterwards: a restore is
     * a second write, and between the two the event is a draft that every other
     * reader of this database can see.
     */
    class Rollback extends Error {}

    // One REPEATABLE READ snapshot for both reads.
    //
    // `loadEventFacets` counts the whole catalogue, which is the behaviour
    // being tested, so a before-and-after difference is only -1 if nothing else
    // publishes an event in between. Something else does:
    // `event-lifecycle-integration.test.js` runs in the same vitest worker pool
    // against the same database and publishes events of its own. Under READ
    // COMMITTED the second read sees its commits and the difference is -1 plus
    // whatever it did, which is a failure that appears perhaps one run in three.
    //
    // The assertion is unchanged — the universe must shrink by exactly one —
    // and what changes is that both counts come from one snapshot, so the
    // difference is this test's own write and nothing else's.
    await expect(
      prisma.$transaction(
        async (tx) => {
          const before = await loadEventFacets(tx)
          const publishedComedy = before.categories.find((entry) => entry.value === 'COMEDY').count

          await tx.event.update({
            where: { slug: `${TAG}-event-0` },
            data: { status: 'DRAFT' },
          })

          const after = await loadEventFacets(tx)

          // Exactly one fewer: a draft is not part of the public catalogue, and
          // counting one would advertise an event nobody can buy into.
          expect(after.categories.find((entry) => entry.value === 'COMEDY').count).toBe(
            publishedComedy - 1,
          )
          expect(after.scope.total).toBe(before.scope.total - 1)

          throw new Rollback()
        },
        { isolationLevel: 'RepeatableRead' },
      ),
    ).rejects.toBeInstanceOf(Rollback)

    // And the event is still published, because nothing was committed.
    const restored = await prisma.event.findUnique({ where: { slug: `${TAG}-event-0` } })

    expect(restored.status).toBe('PUBLISHED')
  })
})

describe('facets count every status a listing shows', () => {
  it('keeps counting an event after its organiser opens sales', async () => {
    if (!reachable) return

    // The defect: facets counted PUBLISHED alone, so an event dropped out of
    // its category the moment it went ON_SALE. Rolled back, like the draft
    // case above, so no other test sees the change.
    class Rollback extends Error {}

    await expect(
      prisma.$transaction(
        async (tx) => {
          const before = await loadEventFacets(tx)
          const comedy = before.categories.find((entry) => entry.value === 'COMEDY').count

          await tx.event.update({
            where: { slug: `${TAG}-event-0` },
            data: { status: 'ON_SALE', salesOpenedAt: new Date() },
          })

          const after = await loadEventFacets(tx)

          expect(after.categories.find((entry) => entry.value === 'COMEDY').count).toBe(comedy)
          expect(after.scope.total).toBe(before.scope.total)

          throw new Rollback()
        },
        { isolationLevel: 'RepeatableRead' },
      ),
    ).rejects.toBeInstanceOf(Rollback)
  })
})
