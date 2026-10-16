/**
 * Catalogue facet aggregation.
 *
 * Facets describe the whole catalogue, not the page being displayed. That
 * distinction is the entire point of this module: the filter options used to be
 * derived from one page of results, so a city whose events all fell past the
 * first forty-eight was not merely hidden — it was unselectable, and the
 * catalogue behind it unreachable. Pagination must change which rows a visitor
 * sees, never which options exist.
 *
 * Every count is computed by the database. Loading the table into application
 * memory to count it would work at seed scale and fall over at real scale, and
 * it is the same mistake in a different place.
 *
 * @module @desi-event/api/lib/facets
 */

import { Prisma } from '@desi-event/db'
import { INDEXABLE_STATUSES } from '@desi-event/schemas/lifecycle'
import { isFilterableRegion, subdivisionName } from '@desi-event/schemas/subdivisions'

/**
 * The statuses every facet is counted over: exactly the ones a listing shows.
 *
 * It used to be `PUBLISHED` alone, which was the whole public catalogue before
 * the lifecycle added `ON_SALE`, `SALES_PAUSED` and `SOLD_OUT`. Afterwards it
 * counted only the events whose sales had not opened, so an event dropped out
 * of its category's count at the moment it went on sale. Derived from
 * `INDEXABLE_STATUSES` rather than listed, so the two cannot drift again.
 *
 * @type {ReadonlyArray<string>}
 */
const LISTED_STATUSES = Object.freeze([...INDEXABLE_STATUSES])

/**
 * The scope every facet is computed over, as the response names it.
 *
 * `LISTED` rather than a status: it is a set of statuses, the one a listing
 * uses. A draft is not in it, and counting one would advertise an event nobody
 * can buy into.
 */
export const FACET_SCOPE = Object.freeze({ status: 'LISTED' })

/** The same scope, for Prisma. */
const SCOPE_WHERE = Object.freeze({ status: { in: [...LISTED_STATUSES] } })

/** The same scope, for the raw aggregations. The column is an enum, hence the cast. */
const SCOPE_SQL = Prisma.sql`e."status"::text IN (${Prisma.join(LISTED_STATUSES)})`

/**
 * Count listed events by category, city, state or province, language and
 * format.
 *
 * `regions` nests each state's cities inside it, keyed by country and region
 * as well as by name, so the two Springfields — Illinois and Missouri — are two
 * entries rather than one. `cities` stays as it was, a flat list by name, for
 * callers that read it.
 *
 * Each list is ordered by count, highest first, and a tie by value in byte
 * order. The value carries `COLLATE "C"` rather than the database's default
 * collation: that default is chosen when a database is created and differs
 * between environments (`C.UTF-8` on one, an ICU or glibc locale on another),
 * and the two disagree on, for one, whether `Snake_town` comes before
 * `SnakeXtown`. `"C"` exists in every PostgreSQL, so the order is the same
 * everywhere and a caller can reproduce it by comparing UTF-8 bytes. Display
 * order is the caller's choice; this is only the tie-break that makes the
 * response deterministic.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @returns {Promise<object>} Facet lists plus the scope they were computed over.
 */
export async function loadEventFacets(prisma) {
  const [categories, cities, places, languages, formats, total] = await Promise.all([
    prisma.$queryRaw(Prisma.sql`
      SELECT e."category"::text COLLATE "C" AS value, count(*)::int AS count
      FROM "Event" e
      WHERE ${SCOPE_SQL}
      GROUP BY e."category"
      ORDER BY count DESC, value ASC
    `),

    // Joined rather than denormalised: the city lives on the venue, and an
    // online event has none.
    prisma.$queryRaw(Prisma.sql`
      SELECT v."city" COLLATE "C" AS value, count(*)::int AS count
      FROM "Event" e
      JOIN "Venue" v ON v."id" = e."venueId"
      WHERE ${SCOPE_SQL}
      GROUP BY v."city"
      ORDER BY count DESC, value ASC
    `),

    // By country, region and city together. The country and region are read
    // trimmed and in capitals, so a venue an organiser typed as `us` / `tx`
    // counts with Texas (venue writes store both that way since 2026-10-16,
    // and 20261016140000_venue_region_codes rewrote the rows before then).
    prisma.$queryRaw(Prisma.sql`
      SELECT upper(btrim(v."country")) COLLATE "C" AS country,
             upper(btrim(v."region")) COLLATE "C" AS region,
             v."city" COLLATE "C" AS city,
             count(*)::int AS count
      FROM "Event" e
      JOIN "Venue" v ON v."id" = e."venueId"
      WHERE ${SCOPE_SQL}
      GROUP BY 1, 2, 3
      ORDER BY count DESC, city ASC
    `),

    // `languages` is an array column, so each element is counted separately.
    prisma.$queryRaw(Prisma.sql`
      SELECT language COLLATE "C" AS value, count(*)::int AS count
      FROM "Event" e, unnest(e."languages") AS language
      WHERE ${SCOPE_SQL}
      GROUP BY language
      ORDER BY count DESC, value ASC
    `),

    prisma.$queryRaw(Prisma.sql`
      SELECT CASE WHEN e."isOnline" THEN 'online' ELSE 'in_person' END COLLATE "C" AS value,
             count(*)::int AS count
      FROM "Event" e
      WHERE ${SCOPE_SQL}
      GROUP BY e."isOnline"
      ORDER BY count DESC, value ASC
    `),

    prisma.event.count({ where: SCOPE_WHERE }),
  ])

  return {
    scope: { status: FACET_SCOPE.status, total },
    categories: normalise(categories),
    cities: normalise(cities),
    regions: nestRegions(places),
    languages: normalise(languages),
    formats: normalise(formats),
  }
}

/**
 * Coerce raw rows into the response shape.
 *
 * `count(*)` comes back as a BigInt on some drivers even with a cast, and a
 * BigInt does not survive JSON serialisation.
 *
 * @param {unknown} rows Raw query rows.
 * @returns {Array<{value: string, count: number}>} Clean facet entries.
 */
function normalise(rows) {
  if (!Array.isArray(rows)) return []

  return rows
    .filter((row) => row?.value !== null && row?.value !== undefined)
    .map((row) => ({ value: String(row.value), count: Number(row.count) }))
}

/**
 * Compare two strings by their UTF-8 bytes, the order `COLLATE "C"` uses.
 *
 * @param {string} a One value.
 * @param {string} b The other.
 * @returns {number} Negative, zero or positive.
 */
function byteOrder(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

/**
 * Fold (country, region, city) counts into regions, each with its cities.
 *
 * The rows arrive ordered by count, then city in byte order, and each region
 * keeps its cities in that order. Regions are ordered the same way: by their
 * total, then by country and region code in byte order. A region that is not a
 * subdivision code ({@link isFilterableRegion}) is left out.
 *
 * @param {unknown} rows Raw query rows: `{country, region, city, count}`.
 * @returns {Array<{country: string, region: string, name: string, count: number, cities: Array<{value: string, count: number}>}>} One entry per state or province.
 */
function nestRegions(rows) {
  if (!Array.isArray(rows)) return []

  /** @type {Map<string, {country: string, region: string, name: string, count: number, cities: Array<{value: string, count: number}>}>} */
  const regions = new Map()

  for (const row of rows) {
    if (!row || row.city === null || row.city === undefined) continue

    const country = String(row.country ?? '')
    const region = String(row.region ?? '')

    // A region that is not a code (`NEW JERSEY`, typed before venue writes
    // stored codes) would be a State/Province option that filters nothing:
    // the listing reads a state back only as `US-NJ`. It is left out of the
    // regions; its city is still in `cities`, and its events still list.
    if (!isFilterableRegion(country, region)) continue

    const key = `${country}\u0000${region}`
    let entry = regions.get(key)

    if (!entry) {
      entry = { country, region, name: subdivisionName(country, region), count: 0, cities: [] }
      regions.set(key, entry)
    }

    const count = Number(row.count)
    entry.count += count
    entry.cities.push({ value: String(row.city), count })
  }

  return [...regions.values()].sort(
    (a, b) => b.count - a.count || byteOrder(a.country, b.country) || byteOrder(a.region, b.region),
  )
}
