/**
 * Reading and writing the listing's filter state, which lives in the URL.
 *
 * The URL is the only store of filter state: it survives a reload, it can be
 * shared, the back button works, and the server component can render the right
 * results on the first response instead of after a round trip. Everything here
 * is pure so both the server page and the client filter form can use it.
 *
 * @module lib/search-params
 */

import { EVENT_CATEGORIES } from './catalog.js'

/** Default page size for the listing. */
export const DEFAULT_PER_PAGE = 12

/** Largest page size a URL may ask for, mirroring the API's own cap. */
const MAX_PER_PAGE = 48

/** Category values the listing will accept from a URL. */
const KNOWN_CATEGORIES = new Set(EVENT_CATEGORIES.map((category) => category.value))

/** Longest free-text query accepted, matching `listEventsQuerySchema`. */
const MAX_QUERY_LENGTH = 120

/**
 * @typedef {object} EventFilters
 * @property {string} category Selected `EventCategory`, or an empty string for all.
 * @property {string} city Selected city, or an empty string for all.
 * @property {string} q Free-text query, trimmed; may be empty.
 * @property {number} page 1-based page number.
 * @property {number} perPage Page size.
 */

/**
 * Read one value out of a Next.js `searchParams` object.
 *
 * A repeated query parameter arrives as an array; the first value wins, because
 * `?city=Mumbai&city=London` is a malformed link rather than a request for two
 * cities.
 *
 * @param {Record<string, string|string[]|undefined>} searchParams Resolved search parameters.
 * @param {string} key Parameter name.
 * @returns {string} The value, trimmed, or an empty string when absent.
 */
function readParam(searchParams, key) {
  const raw = searchParams?.[key]
  const value = Array.isArray(raw) ? raw[0] : raw

  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Parse a positive integer from a query parameter.
 *
 * @param {string} value Raw parameter value.
 * @param {number} fallback Value used when the parameter is absent or nonsense.
 * @param {number} max Upper bound.
 * @returns {number} A clamped integer.
 */
function readPositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed < 1) return fallback

  return Math.min(parsed, max)
}

/**
 * Turn Next.js `searchParams` into the listing's filter state.
 *
 * Unknown categories are dropped rather than passed through, so a hand-edited
 * URL cannot put the page into a state where the filter form shows a value the
 * select has no option for.
 *
 * @param {Record<string, string|string[]|undefined>} [searchParams] Resolved search parameters.
 * @returns {EventFilters} Normalised filter state.
 */
export function parseEventFilters(searchParams = {}) {
  const category = readParam(searchParams, 'category').toUpperCase()

  return {
    category: KNOWN_CATEGORIES.has(category) ? category : '',
    city: readParam(searchParams, 'city'),
    q: readParam(searchParams, 'q').slice(0, MAX_QUERY_LENGTH),
    page: readPositiveInt(readParam(searchParams, 'page'), 1, 1000),
    perPage: readPositiveInt(readParam(searchParams, 'perPage'), DEFAULT_PER_PAGE, MAX_PER_PAGE),
  }
}

/**
 * Build the `/events` href for a set of filters.
 *
 * Empty filters and the default page are left out of the query string, so the
 * canonical listing URL stays `/events` rather than `/events?category=&city=&page=1`.
 *
 * @param {Partial<EventFilters>} [filters] Filters to encode.
 * @returns {string} A root-relative href.
 */
export function buildEventsHref(filters = {}) {
  const search = new URLSearchParams()

  if (filters.category) search.set('category', filters.category)
  if (filters.city) search.set('city', filters.city)
  if (filters.q) search.set('q', filters.q)
  if (filters.page && filters.page > 1) search.set('page', String(filters.page))
  if (filters.perPage && filters.perPage !== DEFAULT_PER_PAGE) {
    search.set('perPage', String(filters.perPage))
  }

  const query = search.toString()

  return query === '' ? '/events' : `/events?${query}`
}

/**
 * Whether any narrowing filter is active.
 *
 * @param {Partial<EventFilters>} [filters] Filter state.
 * @returns {boolean} True when the listing is showing a subset of the catalogue.
 */
export function hasActiveFilters(filters = {}) {
  return Boolean(filters.category || filters.city || filters.q)
}

/**
 * Slice a list of events into one page.
 *
 * The fallback catalogue has no server to paginate it, so the page does it in
 * memory and reports the same `pagination` block the API would have returned.
 *
 * @param {object[]} events All matching events.
 * @param {object} pagination Page selection.
 * @param {number} pagination.page 1-based page number.
 * @param {number} pagination.perPage Page size.
 * @returns {{items: object[], pagination: {page: number, perPage: number, total: number, totalPages: number, hasNextPage: boolean, hasPreviousPage: boolean}}} The page and its counters.
 */
export function paginate(events, { page, perPage }) {
  const all = events ?? []
  const total = all.length
  const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0
  const safePage = totalPages === 0 ? 1 : Math.min(Math.max(page, 1), totalPages)
  const start = (safePage - 1) * perPage

  return {
    items: all.slice(start, start + perPage),
    pagination: {
      page: safePage,
      perPage,
      total,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPreviousPage: safePage > 1 && totalPages > 0,
    },
  }
}
