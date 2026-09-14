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

/**
 * The scope every facet is computed over.
 *
 * Published events only: a draft is not part of the public catalogue, and
 * counting one would advertise an event nobody can buy into.
 */
export const FACET_SCOPE = Object.freeze({ status: 'PUBLISHED' })

/**
 * Count published events by category, city, language and format.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @returns {Promise<object>} Facet lists plus the scope they were computed over.
 */
export async function loadEventFacets(prisma) {
  const [categories, cities, languages, formats, total] = await Promise.all([
    prisma.$queryRaw(Prisma.sql`
      SELECT e."category"::text AS value, count(*)::int AS count
      FROM "Event" e
      WHERE e."status" = 'PUBLISHED'
      GROUP BY e."category"
      ORDER BY count DESC, value ASC
    `),

    // Joined rather than denormalised: the city lives on the venue, and an
    // online event has none.
    prisma.$queryRaw(Prisma.sql`
      SELECT v."city" AS value, count(*)::int AS count
      FROM "Event" e
      JOIN "Venue" v ON v."id" = e."venueId"
      WHERE e."status" = 'PUBLISHED'
      GROUP BY v."city"
      ORDER BY count DESC, value ASC
    `),

    // `languages` is an array column, so each element is counted separately.
    prisma.$queryRaw(Prisma.sql`
      SELECT language AS value, count(*)::int AS count
      FROM "Event" e, unnest(e."languages") AS language
      WHERE e."status" = 'PUBLISHED'
      GROUP BY language
      ORDER BY count DESC, value ASC
    `),

    prisma.$queryRaw(Prisma.sql`
      SELECT CASE WHEN e."isOnline" THEN 'online' ELSE 'in_person' END AS value,
             count(*)::int AS count
      FROM "Event" e
      WHERE e."status" = 'PUBLISHED'
      GROUP BY e."isOnline"
      ORDER BY count DESC, value ASC
    `),

    prisma.event.count({ where: FACET_SCOPE }),
  ])

  return {
    scope: { status: FACET_SCOPE.status, total },
    categories: normalise(categories),
    cities: normalise(cities),
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
