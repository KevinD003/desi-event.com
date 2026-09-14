/**
 * The web app's data layer.
 *
 * Two things shape every function in this file.
 *
 * The first is that the API is a **separate process that is frequently not
 * running**: during `next build`, in unit tests, on a fresh clone, and any time
 * a deploy of the API lags a deploy of the web app. A ticketing site that
 * answers those moments with a stack trace or an empty grid is worse than one
 * that shows a catalogue, so every read here fails soft: it catches, warns once
 * on the server, and falls back to the curated catalogue in `sample-data.js`.
 * A visitor never sees an error, and the server log always says exactly what
 * went wrong.
 *
 * The second is that the API never gets to decide the shape of the page.
 * Anything that comes back malformed — a missing `data` array, a null body —
 * is treated as a failure and takes the same fallback path, because a
 * half-rendered page is a bug report either way.
 *
 * Fallback never applies to writes. There is no pretending an order was placed.
 *
 * @module lib/api
 */


import { filterEvents, sortByStartDate } from './catalog.js'
import { paginate } from './search-params.js'
import {
  DEFAULT_API_URL,
  getApiBaseUrl,
  getApiClient,
  resetApiClient as resetClientCache,
} from './api-client.js'
import { findSampleEvent, sampleEventSummaries } from './sample-data.js'

// Re-exported so server-side callers keep one import. Client components must
// import from './api-client.js' directly: this module pulls in the fallback
// catalogue, which has no business in a browser bundle.
export { DEFAULT_API_URL, getApiBaseUrl, getApiClient }

/**
 * Discard the memoised client and the logged-warning set.
 *
 * The warning set lives here rather than alongside the client, so resetting the
 * client alone would leave a suite's earlier warnings suppressing its later
 * ones.
 *
 * @returns {void}
 */
export function resetApiClient() {
  resetClientCache()
  warnedKeys.clear()
}

/**
 * How long a single API read may take before the page gives up and renders the
 * fallback. Kept short: a visitor waiting ten seconds for a listing has already
 * left, and a build that blocks on an unreachable host never finishes.
 */
const REQUEST_TIMEOUT_MS = 2500

/** Warning keys already logged, so one dead API does not produce one line per card. */
const warnedKeys = new Set()


/**
 * Log an API failure once per key, on the server only.
 *
 * Repeating the same "connection refused" for every card on the page buries the
 * one line that matters, and the message never reaches the browser console of a
 * visitor who can do nothing about it.
 *
 * @param {string} key Stable key identifying the failing read.
 * @param {unknown} error The caught error.
 * @returns {void}
 */
function warnOnce(key, error) {
  if (warnedKeys.has(key)) return
  warnedKeys.add(key)

  const reason = error instanceof Error ? error.message : String(error)
  console.warn(
    `[desi-event/web] ${key} fell back to the sample catalogue: ${reason} ` +
      `(API at ${getApiBaseUrl()})`,
  )
}

/**
 * Per-call options for an API read.
 *
 * @returns {{signal: AbortSignal}} A call option bag carrying a timeout signal.
 */
function callOptions() {
  return { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
}

/**
 * Run an API read, falling back to locally curated data on any failure.
 *
 * @param {string} key Stable key used for the warning and for de-duplicating it.
 * @param {Function} read Async function performing the API call; must return the finished result.
 * @param {Function} fallback Synchronous function producing the offline result.
 * @returns {Promise<object>} The API result, or the fallback result.
 */
async function readOrFallback(key, read, fallback) {
  try {
    const result = await read()

    if (result === undefined || result === null) {
      throw new Error('the API returned an empty payload')
    }

    return result
  } catch (error) {
    warnOnce(key, error)

    return fallback()
  }
}

/**
 * @typedef {object} EventListResult
 * @property {object[]} events Event summaries for the requested page.
 * @property {object} pagination Page counters: page, perPage, total, totalPages, hasNextPage, hasPreviousPage.
 * @property {boolean} usedFallback True when the curated catalogue was rendered because the API could not be reached.
 */

/**
 * Load a page of the event catalogue.
 *
 * @param {object} [filters] Listing filters.
 * @param {string} [filters.category] An `EventCategory` enum member.
 * @param {string} [filters.city] Exact city name.
 * @param {string} [filters.q] Free-text query.
 * @param {number} [filters.page] 1-based page number.
 * @param {number} [filters.perPage] Page size.
 * @param {object} [options] Overrides.
 * @param {object} [options.client] API client to use; defaults to the shared one.
 * @returns {Promise<EventListResult>} The page, whether it came from the API or the fallback.
 */
export async function loadEventList(filters = {}, options = {}) {
  const { category, city, q, page = 1, perPage = 12 } = filters

  return readOrFallback(
    'events.list',
    async () => {
      const client = options.client ?? getApiClient()
      const response = await client.events.list(
        {
          page,
          perPage,
          sort: 'startsAt:asc',
          status: 'PUBLISHED',
          ...(category ? { category } : {}),
          ...(city ? { city } : {}),
          ...(q ? { q } : {}),
        },
        callOptions(),
      )

      if (!Array.isArray(response?.data)) {
        throw new Error('events.list returned no data array')
      }

      return { events: response.data, pagination: response.pagination, usedFallback: false }
    },
    () => {
      const matching = sortByStartDate(filterEvents(sampleEventSummaries(), { category, city, q }))
      const { items, pagination } = paginate(matching, { page, perPage })

      return { events: items, pagination, usedFallback: true }
    },
  )
}

/**
 * @typedef {object} EventDetailResult
 * @property {object|null} event The event with venue, organiser and ticket types attached, or `null` when no such event exists.
 * @property {boolean} usedFallback True when the curated catalogue answered instead of the API.
 */

/**
 * Load one event by slug, with everything the detail page needs.
 *
 * A genuine 404 from the API is not a failure to fall back from — but the
 * fallback catalogue is still consulted, because during local development the
 * API frequently has an empty database while the sample slugs are exactly the
 * ones linked from the listing.
 *
 * @param {string} slug The event slug from the URL.
 * @param {object} [options] Overrides.
 * @param {object} [options.client] API client to use; defaults to the shared one.
 * @returns {Promise<EventDetailResult>} The event, or `{ event: null }` when it is unknown everywhere.
 */
export async function loadEventBySlug(slug, options = {}) {
  return readOrFallback(
    'events.get',
    async () => {
      const client = options.client ?? getApiClient()
      const response = await client.events.get({ slug }, callOptions())

      if (!response?.data?.slug) {
        throw new Error('events.get returned no event')
      }

      return { event: withTicketTypeAvailability(response.data), usedFallback: false }
    },
    () => ({ event: findSampleEvent(slug), usedFallback: true }),
  )
}

/**
 * Load every event summary the catalogue holds, for the home page.
 *
 * Deliberately NOT used to build filter options any more. Filter options come
 * from {@link loadCatalogueFacets}, which counts in the database: deriving them
 * from a page of results meant a city whose events all fell past the first
 * forty-eight was not merely hidden but unselectable.
 *
 * @param {object} [options] Overrides.
 * @param {object} [options.client] API client to use; defaults to the shared one.
 * @returns {Promise<EventListResult>} Up to one page of 48 summaries, unfiltered.
 */
export async function loadCatalogueOverview(options = {}) {
  return loadEventList({ page: 1, perPage: 48 }, options)
}

/** Facet lists used when the API cannot be reached. */
const FALLBACK_FACETS = Object.freeze({
  scope: { status: 'PUBLISHED', total: 0 },
  categories: [],
  cities: [],
  languages: [],
  formats: [],
})

/**
 * Load filter facets, counted over the complete catalogue.
 *
 * @param {object} [options] Overrides.
 * @param {object} [options.client] API client to use; defaults to the shared one.
 * @returns {Promise<{facets: object, usedFallback: boolean}>} Facet counts, and whether the API answered.
 */
export async function loadCatalogueFacets(options = {}) {
  /**
   * Tally a list of values into facet entries.
   *
   * @param {string[]} values Raw values.
   * @returns {Array<{value: string, count: number}>} Counted, deterministically ordered.
   */
  const count = (values) => {
    const tally = new Map()
    for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1)

    return [...tally.entries()]
      .map(([value, n]) => ({ value, count: n }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
  }

  return readOrFallback(
    'facets',
    async () => {
      const client = options.client ?? getApiClient()
      const response = await client.events.facets()

      return { facets: response.data, usedFallback: false }
    },
    () => {
      // Derive what we can from the sample catalogue so the selects are not
      // empty when the API is down.
      const events = sampleEventSummaries()

      return {
        facets: {
          ...FALLBACK_FACETS,
          scope: { status: 'PUBLISHED', total: events.length },
          categories: count(events.map((event) => event.category)),
          cities: count(events.map((event) => event.city).filter(Boolean)),
        },
        usedFallback: true,
      }
    },
  )
}


/**
 * Derive the availability fields a ticket tier needs for display.
 *
 * `GET /v1/events/:slug` returns plain ticket type rows, while
 * `GET /v1/events/:eventId/ticket-types` folds live availability in. Rather
 * than making the detail page issue two requests, the missing fields are
 * derived here from the columns the row already carries, and any value the API
 * did supply wins.
 *
 * @param {object} event An event with a `ticketTypes` array.
 * @returns {object} The same event with `availableQuantity` and `isSoldOut` present on every tier.
 */
export function withTicketTypeAvailability(event) {
  const ticketTypes = (event?.ticketTypes ?? []).map((tier) => {
    const remaining = Math.max(0, (tier.quantityTotal ?? 0) - (tier.quantitySold ?? 0))
    const availableQuantity = tier.availableQuantity ?? remaining
    const isSoldOut = tier.isSoldOut ?? (tier.status !== 'ON_SALE' || availableQuantity === 0)

    return { ...tier, availableQuantity: isSoldOut ? 0 : availableQuantity, isSoldOut }
  })

  return { ...event, ticketTypes }
}
