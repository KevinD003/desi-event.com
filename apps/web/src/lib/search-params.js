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

import { isCalendarDay } from '@desi-event/schemas/calendar-days'

import { EVENT_CATEGORIES } from './catalog.js'

/** Default page size for the listing. */
export const DEFAULT_PER_PAGE = 12

/** Largest page size a URL may ask for, mirroring the API's own cap. */
const MAX_PER_PAGE = 48

/** Category values the listing will accept from a URL. */
const KNOWN_CATEGORIES = new Set(EVENT_CATEGORIES.map((category) => category.value))

/** Longest free-text query accepted, matching `listEventsQuerySchema`. */
const MAX_QUERY_LENGTH = 120

/** Longest language name accepted, matching `listEventsQuerySchema`. */
const MAX_LANGUAGE_LENGTH = 60

/**
 * A state or province as the URL carries it: its whole ISO 3166-2 code, the
 * country and the subdivision together (`US-TX`, `CA-ON`). One value, because
 * one select submits one value; the API is sent the two halves.
 */
const REGION_PATTERN = /^[A-Z]{2}-[A-Z0-9]{1,3}$/u

/**
 * The "When" choices: any time (empty), the four named spans the API reads
 * where each event is, and `dates`, which uses the From and To days.
 */
export const WHEN_OPTIONS = Object.freeze(['today', 'weekend', 'week', 'month', 'dates'])

/** The "Format" choices besides either. */
export const FORMAT_OPTIONS = Object.freeze(['in_person', 'online'])

/**
 * Whether text holds a C0, DEL or C1 control character, which the API refuses
 * in a filter.
 *
 * @param {string} text The value.
 * @returns {boolean} True when it does.
 */
function hasControlCharacter(text) {
  return [...text].some((character) => {
    const code = character.codePointAt(0)

    return code < 0x20 || (code >= 0x7f && code <= 0x9f)
  })
}

/**
 * @typedef {object} EventFilters
 * @property {string} category Selected `EventCategory`, or an empty string for all.
 * @property {string} region Selected state or province as `US-TX`, or an empty string for all.
 * @property {string} city Selected city, or an empty string for all.
 * @property {string} q Free-text query, trimmed; may be empty.
 * @property {string} language Selected language, or an empty string for any.
 * @property {string} when One of {@link WHEN_OPTIONS}, or an empty string for any time.
 * @property {string} from The first day, `YYYY-MM-DD`, when `when` is `dates`; otherwise empty.
 * @property {string} to The last day, `YYYY-MM-DD`, when `when` is `dates`; otherwise empty.
 * @property {string} format `in_person`, `online`, or an empty string for either.
 * @property {boolean} free Only events whose "from" price is $0.
 * @property {boolean} onSale Only events with tickets on sale now.
 * @property {number} page 1-based page number.
 * @property {number} perPage Page size.
 */
/**
 * Read one value out of a Next.js `searchParams` object.
 *
 * A repeated query parameter arrives as an array; the first value wins, because
 * `?city=Edison&city=Houston` is a malformed link rather than a request for two
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
 * Read a switch a checkbox submits as `true`.
 *
 * @param {string} value Raw parameter value.
 * @returns {boolean} True only for `true`.
 */
function readSwitch(value) {
  return value.toLowerCase() === 'true'
}

/**
 * Read the When choice and its days.
 *
 * Days typed into From and To with When left at "Any time" mean those days,
 * which is what a visitor without JavaScript gets when they fill them in. A
 * named span chosen beside them wins and the days are dropped: the form
 * clears them when a span is chosen, so a URL carrying both was edited by
 * hand. Days that do not exist are dropped, and a range typed backwards is
 * turned round rather than refused.
 *
 * @param {Record<string, string|string[]|undefined>} searchParams Resolved search parameters.
 * @returns {{when: string, from: string, to: string}} The choice.
 */
function readWhen(searchParams) {
  const asked = readParam(searchParams, 'when').toLowerCase()
  const known = WHEN_OPTIONS.includes(asked) ? asked : ''
  let from = readParam(searchParams, 'from')
  let to = readParam(searchParams, 'to')

  if (!isCalendarDay(from)) from = ''
  if (!isCalendarDay(to)) to = ''

  if (known !== '' && known !== 'dates') return { when: known, from: '', to: '' }
  if (from === '' && to === '') return { when: known, from: '', to: '' }
  if (from !== '' && to !== '' && to < from) [from, to] = [to, from]

  return { when: 'dates', from, to }
}

/**
 * Turn Next.js `searchParams` into the listing's filter state.
 *
 * Every value is checked against the shape the form can produce, and dropped
 * when it does not fit, so a hand-edited URL cannot put the page into a state
 * where a select shows a value it has no option for. Whether a state, city or
 * language is one the catalogue has is checked against its facets by
 * {@link reconcileFilters}, which needs them.
 *
 * @param {Record<string, string|string[]|undefined>} [searchParams] Resolved search parameters.
 * @returns {EventFilters} Normalised filter state.
 */
export function parseEventFilters(searchParams = {}) {
  const category = readParam(searchParams, 'category').toUpperCase()
  const region = readParam(searchParams, 'region').toUpperCase()
  const language = readParam(searchParams, 'language')
  const format = readParam(searchParams, 'format').toLowerCase()

  return {
    category: KNOWN_CATEGORIES.has(category) ? category : '',
    region: REGION_PATTERN.test(region) ? region : '',
    city: readParam(searchParams, 'city'),
    q: readParam(searchParams, 'q').slice(0, MAX_QUERY_LENGTH),
    language:
      language.length <= MAX_LANGUAGE_LENGTH && !hasControlCharacter(language) ? language : '',
    ...readWhen(searchParams),
    format: FORMAT_OPTIONS.includes(format) ? format : '',
    free: readSwitch(readParam(searchParams, 'free')),
    onSale: readSwitch(readParam(searchParams, 'onSale')),
    page: readPositiveInt(readParam(searchParams, 'page'), 1, 1000),
    perPage: readPositiveInt(readParam(searchParams, 'perPage'), DEFAULT_PER_PAGE, MAX_PER_PAGE),
  }
}

/**
 * A region facet's value in the URL.
 *
 * @param {{country: string, region: string}} entry A `regions` facet entry.
 * @returns {string} `US-TX`.
 */
export function regionValue(entry) {
  return `${entry.country}-${entry.region}`
}

/**
 * The choice spelled as the catalogue spells it, or nothing.
 *
 * @param {string[]} choices What the select offers.
 * @param {string} value What the URL said.
 * @returns {string} The matching choice, or an empty string.
 */
function sameText(choices, value) {
  if (!value) return ''

  const wanted = value.toLowerCase()

  return choices.find((choice) => choice.toLowerCase() === wanted) ?? ''
}

/**
 * The cities the City select offers: the chosen state's, or every city the
 * catalogue has when no state is chosen.
 *
 * @param {object} facets The catalogue's facets: `regions` and `cities`.
 * @param {string} region The chosen state as `US-TX`, or an empty string.
 * @returns {string[]} City names, A to Z.
 */
export function citiesFor(facets, region) {
  const regions = Array.isArray(facets?.regions) ? facets.regions : []
  const chosen = region ? regions.find((entry) => regionValue(entry) === region) : null
  const entries = chosen ? chosen.cities : Array.isArray(facets?.cities) ? facets.cities : []

  return [...new Set(entries.map((entry) => entry.value))].sort((a, b) => a.localeCompare(b))
}

/**
 * Hold the filters to what the catalogue offers.
 *
 * A state the facets do not list is dropped. A city must be one of the chosen
 * state's cities — the City select lists only those — or, with no state, one
 * of the catalogue's; a city from somewhere else is dropped rather than
 * finding nothing, which is what happens when a visitor without JavaScript
 * changes the state and submits with the old city still chosen. A city or a
 * language typed in another case takes the catalogue's spelling.
 *
 * @param {EventFilters} filters Parsed filters.
 * @param {object} [facets] The catalogue's facets: `regions`, `cities`, `languages`.
 * @returns {EventFilters} The filters, every value one a select offers.
 */
export function reconcileFilters(filters, facets = {}) {
  const regions = Array.isArray(facets?.regions) ? facets.regions : []
  const region = regions.some((entry) => regionValue(entry) === filters.region)
    ? filters.region
    : ''
  const languages = (Array.isArray(facets?.languages) ? facets.languages : []).map(
    (entry) => entry.value,
  )

  return {
    ...filters,
    region,
    city: sameText(citiesFor(facets, region), filters.city),
    language: sameText(languages, filters.language),
  }
}

/**
 * Build the `/events` href for a set of filters.
 *
 * Empty filters and the default page are left out of the query string, so the
 * canonical listing URL stays `/events` rather than `/events?category=&city=&page=1`.
 * The order is fixed, so one set of filters is one URL.
 *
 * @param {Partial<EventFilters>} [filters] Filters to encode.
 * @returns {string} A root-relative href.
 */
export function buildEventsHref(filters = {}) {
  const search = new URLSearchParams()
  const days = !filters.when || filters.when === 'dates'

  if (filters.category) search.set('category', filters.category)
  if (filters.region) search.set('region', filters.region)
  if (filters.city) search.set('city', filters.city)
  if (filters.language) search.set('language', filters.language)
  if (filters.when) search.set('when', filters.when)
  if (days && filters.from) search.set('from', filters.from)
  if (days && filters.to) search.set('to', filters.to)
  if (filters.format) search.set('format', filters.format)
  if (filters.free) search.set('free', 'true')
  if (filters.onSale) search.set('onSale', 'true')
  if (filters.q) search.set('q', filters.q)
  if (filters.page && filters.page > 1) search.set('page', String(filters.page))
  if (filters.perPage && filters.perPage !== DEFAULT_PER_PAGE) {
    search.set('perPage', String(filters.perPage))
  }

  const query = search.toString()

  return query === '' ? '/events' : `/events?${query}`
}

/**
 * How many of the filters behind the "More filters" disclosure are chosen,
 * so the disclosure starts open and says so.
 *
 * @param {Partial<EventFilters>} [filters] Filter state.
 * @returns {number} The count; "Choose dates" with no day chosen is not one.
 */
export function countMoreFilters(filters = {}) {
  return [
    filters.when && (filters.when !== 'dates' || filters.from || filters.to),
    filters.language,
    filters.format,
    filters.free,
    filters.onSale,
  ].filter(Boolean).length
}

/**
 * Whether any narrowing filter is active.
 *
 * @param {Partial<EventFilters>} [filters] Filter state.
 * @returns {boolean} True when the listing is showing a subset of the catalogue.
 */
export function hasActiveFilters(filters = {}) {
  return Boolean(
    filters.category ||
    filters.region ||
    filters.city ||
    filters.q ||
    countMoreFilters(filters) > 0,
  )
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
