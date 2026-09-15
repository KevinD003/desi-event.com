/**
 * The XML sitemap.
 *
 * Only events the API reports as `PUBLISHED` are listed. A draft, a private
 * listing, one withdrawn by moderation, a cancelled-and-removed night and a
 * deleted row are all simply absent from that response, so none of them can
 * reach the sitemap — and the fallback catalogue is deliberately *not*
 * consulted here. Everywhere else on the site a dead API is answered with the
 * sample catalogue so a visitor still sees a page; a sitemap built the same way
 * would be publishing URLs that do not exist, which is the one place that
 * trade-off is wrong.
 *
 * @module app/sitemap
 */

import { getApiClient } from '../lib/api-client.js'

/** Generated per request: the catalogue changes far more often than deploys do. */
export const dynamic = 'force-dynamic'

/** Where this deployment is served from. Mirrors the root layout. */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000'

/** How long the whole sitemap build may take before it gives up on the API. */
const REQUEST_TIMEOUT_MS = 4000

/** Events requested per page. */
const PAGE_SIZE = 200

/** Hard stop, so a misreporting API cannot spin this forever. */
const MAX_PAGES = 50

/**
 * Routes that exist regardless of what the catalogue holds.
 *
 * Checkout is not among them: it is a step in a flow, carries `noindex`, and
 * is meaningless without a chosen quantity.
 *
 * @returns {object[]} Sitemap entries for the static routes.
 */
function staticRoutes() {
  return [
    { url: `${siteUrl}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${siteUrl}/events`, changeFrequency: 'daily', priority: 0.9 },
  ]
}

/**
 * Every published event, walked page by page, and the organisers behind them.
 *
 * Organiser pages are derived from the same walk rather than listed separately,
 * and that is the rule rather than a convenience: an organiser with nothing
 * published has a page that says so, and a sitemap entry for it would be an
 * invitation to index an empty listing.
 *
 * @returns {Promise<object[]>} Sitemap entries, or an empty list when the API cannot be reached.
 */
async function publishedEvents() {
  const client = getApiClient()
  const entries = []
  const organizers = new Set()
  const venues = new Set()

  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await client.events.list(
        { page, perPage: PAGE_SIZE, sort: 'startsAt:asc', status: 'PUBLISHED' },
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      )

      if (!Array.isArray(response?.data)) {
        throw new Error('events.list returned no data array')
      }

      for (const event of response.data) {
        if (!event?.slug) continue

        entries.push({
          url: `${siteUrl}/events/${event.slug}`,
          lastModified: event.updatedAt ? new Date(event.updatedAt) : undefined,
          changeFrequency: 'daily',
          priority: 0.8,
        })

        // Deduplicated by slug: an organiser with forty events is one page.
        if (event.organizationSlug) organizers.add(event.organizationSlug)
        if (event.venueSlug) venues.add(event.venueSlug)
      }

      if (!response.pagination?.hasNextPage) break
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(
      `[desi-event/web] sitemap listed static routes only: ${reason}. ` +
        'Event URLs are omitted rather than guessed.',
    )

    return []
  }

  for (const slug of organizers) {
    entries.push({
      url: `${siteUrl}/organizers/${slug}`,
      changeFrequency: 'weekly',
      priority: 0.6,
    })
  }

  // Venues change far less often than listings do: an address and a set of
  // accessibility claims are close to static once somebody has checked them.
  for (const slug of venues) {
    entries.push({ url: `${siteUrl}/venues/${slug}`, changeFrequency: 'monthly', priority: 0.5 })
  }

  return entries
}

/**
 * Build the sitemap.
 *
 * @returns {Promise<object[]>} Sitemap entries for Next.js to serialise.
 */
export default async function sitemap() {
  return [...staticRoutes(), ...(await publishedEvents())]
}
