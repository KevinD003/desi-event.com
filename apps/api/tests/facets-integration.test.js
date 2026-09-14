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

import { loadEventFacets } from '../src/lib/facets.js'

const CONNECTION =
  process.env.TEST_DATABASE_URL ??
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public'

/** More than the 48 the filter options used to be derived from. */
const EVENT_COUNT = 60

/** Marks every row this suite creates, so cleanup cannot touch anything else. */
const TAG = 'facettest'

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
    return
  }

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

    expect(facets.scope.status).toBe('PUBLISHED')
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

    for (const list of [facets.categories, facets.cities, facets.languages, facets.formats]) {
      const sorted = [...list].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      expect(list).toEqual(sorted)
    }
  })

  it('excludes draft events from the public facet universe', async () => {
    if (!reachable) return

    const before = await loadEventFacets(prisma)
    const publishedComedy = before.categories.find((entry) => entry.value === 'COMEDY').count

    await prisma.event.update({
      where: { slug: `${TAG}-event-0` },
      data: { status: 'DRAFT' },
    })

    const after = await loadEventFacets(prisma)

    // Exactly one fewer: a draft is not part of the public catalogue, and
    // counting one would advertise an event nobody can buy into.
    expect(after.categories.find((entry) => entry.value === 'COMEDY').count).toBe(
      publishedComedy - 1,
    )
    expect(after.scope.total).toBe(before.scope.total - 1)

    await prisma.event.update({
      where: { slug: `${TAG}-event-0` },
      data: { status: 'PUBLISHED' },
    })
  })
})
