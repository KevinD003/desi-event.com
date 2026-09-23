/**
 * Data for the three public directories: categories, venues and organisers.
 *
 * Each directory answers "what is there to browse", and each has to answer it
 * from what the API actually holds, because a directory that lists something
 * the catalogue does not have is a dead end with a friendly face. The three
 * sources differ, and the differences are the reason this module exists:
 *
 * - **Categories** come from the facet counts, which the database computes over
 *   every listed event: the statuses a listing shows (`INDEXABLE_STATUSES` —
 *   published, on sale, sales paused, sold out), with no date check. The
 *   vocabulary is the web app's own (`EVENT_CATEGORIES`), so every category is
 *   listed — one with nothing in it says so in words rather than disappearing —
 *   and the count is the facet's, never a number worked out here.
 * - **Venues** come from `GET /v1/venues`, asked anonymously, so the directory
 *   is the shared venues every visitor would see, not one organiser's private
 *   records. There is no sample fallback for venues: when the read fails, the
 *   page says the directory could not be loaded rather than drawing an empty
 *   list that reads as "there are no venues".
 * - **Organisers** have no list endpoint. They are derived, as the sitemap
 *   derives its organiser URLs, from the public event listing — narrowed to
 *   events that have not started yet, because that is what the organiser's own
 *   page counts as "upcoming" — in a bounded walk through its pages, collecting
 *   distinct organisers. The bound is reported rather than hidden, so a page
 *   built from the first five hundred events says that is what it is.
 *
 * Nothing here ranks. The directories are in editorial or alphabetical order,
 * never by count: a count sorted into a league table becomes a claim about
 * popularity that the data does not make.
 *
 * @module lib/directory
 */

import { ACCESSIBILITY_FEATURES } from '@desi-event/schemas'
import { INDEXABLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { accessibilityLabel } from './accessibility.js'
import { getApiClient, loadEventList } from './api.js'
import { EVENT_CATEGORIES } from './catalog.js'
import { buildEventsHref } from './search-params.js'

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * @typedef {object} CategoryEntry
 * @property {string} value The `EventCategory` enum member.
 * @property {string} label Short human label.
 * @property {string} blurb One line of copy.
 * @property {string} glyph Decorative mark.
 * @property {string} href The filtered listing for this category.
 * @property {number|null} count Listed events in it, or `null` when the counts could not be read.
 */

/**
 * Every category, in editorial order, with the facet's count for each.
 *
 * The facet query groups by category, so a category with no listed events is
 * simply absent from it; absent here means zero. A facet payload with no
 * category list at all is a different thing — the counts are unknown, not
 * zero — and is reported as such, so the page does not tell somebody that
 * every category is empty because a response was malformed.
 *
 * A facet value the web app has no descriptor for is left out: the listing
 * drops unknown categories from its URL, so a link to one would open the
 * unfiltered listing under a label that promised a filter.
 *
 * @param {object|null|undefined} facets The `facets` object from `loadCatalogueFacets`.
 * @returns {{categories: CategoryEntry[], countsKnown: boolean}} The directory.
 */
export function describeCategoryDirectory(facets) {
  const entries = Array.isArray(facets?.categories) ? facets.categories : null
  const counts = new Map()

  for (const entry of entries ?? []) {
    const count = Number(entry?.count)

    if (typeof entry?.value === 'string' && Number.isFinite(count)) {
      counts.set(entry.value, Math.max(0, Math.trunc(count)))
    }
  }

  return {
    countsKnown: entries !== null,
    categories: EVENT_CATEGORIES.map((category) => ({
      ...category,
      href: buildEventsHref({ category: category.value }),
      count: entries === null ? null : (counts.get(category.value) ?? 0),
    })),
  }
}

/**
 * How a category's count reads.
 *
 * @param {number|null|undefined} count The facet count, or `null` when unknown.
 * @returns {string|null} "12 events", "1 event", "Nothing listed right now", or `null` when unknown.
 */
export function categoryCountLabel(count) {
  if (count === null || count === undefined || !Number.isFinite(count)) return null
  if (count <= 0) return 'Nothing listed right now'
  if (count === 1) return '1 event'

  return `${count.toLocaleString('en-IN')} events`
}

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------

/** Venues asked for per page. Large, because the accessibility filter thins each page. */
export const VENUES_PER_PAGE = 48

/** `listVenuesQuerySchema` accepts at most this many accessibility claims at once. */
export const MAX_ACCESSIBILITY_FILTERS = 6

/** `listVenuesQuerySchema` caps `city` at this many characters. */
const MAX_CITY_LENGTH = 120

/** Highest page a URL may ask for; beyond it is a hand-edited URL, not a visitor. */
const MAX_PAGE = 1000

/**
 * How long the venue read may take. Matches `lib/api.js`: a visitor waiting
 * longer than this for a directory has already gone elsewhere.
 */
const REQUEST_TIMEOUT_MS = 2500

/**
 * @typedef {object} VenueFilters
 * @property {string} city The city to match exactly (the API compares whole names, ignoring case), or `''`.
 * @property {string[]} accessibility Claims every listed venue must assert, in vocabulary order, at most six.
 * @property {string[]} leftOut Claims that were ticked but not applied, because only six fit.
 * @property {number} page 1-based page number.
 */

/**
 * Every value of one query parameter, as strings.
 *
 * @param {Record<string, string|string[]|undefined>} searchParams Resolved search parameters.
 * @param {string} key Parameter name.
 * @returns {string[]} The values, possibly empty.
 */
function readAll(searchParams, key) {
  const raw = searchParams?.[key]
  const values = Array.isArray(raw) ? raw : [raw]

  return values.filter((value) => typeof value === 'string')
}

/**
 * Turn the `/venues` query string into the filters the API will accept.
 *
 * Anything the API would refuse is corrected here rather than sent: an unknown
 * claim is dropped, a city longer than the API allows is cut, and a seventh
 * claim is left out and named, so the page can say which ones were not applied
 * instead of answering with a validation error.
 *
 * @param {Record<string, string|string[]|undefined>} [searchParams] Resolved search parameters.
 * @returns {VenueFilters} Normalised filters.
 */
export function parseVenueFilters(searchParams = {}) {
  const city = (readAll(searchParams, 'city')[0] ?? '').trim().slice(0, MAX_CITY_LENGTH)
  const ticked = new Set(readAll(searchParams, 'accessibility').map((value) => value.trim()))
  const known = ACCESSIBILITY_FEATURES.filter((code) => ticked.has(code))
  const pageNumber = Number.parseInt(readAll(searchParams, 'page')[0] ?? '', 10)

  return {
    city,
    accessibility: known.slice(0, MAX_ACCESSIBILITY_FILTERS),
    leftOut: known.slice(MAX_ACCESSIBILITY_FILTERS),
    page: Number.isFinite(pageNumber) && pageNumber >= 1 ? Math.min(pageNumber, MAX_PAGE) : 1,
  }
}

/**
 * Build a `/venues` href for a set of filters.
 *
 * @param {Partial<VenueFilters>} [filters] Filters to encode.
 * @returns {string} A root-relative href; `/venues` when nothing is set.
 */
export function buildVenuesHref(filters = {}) {
  const search = new URLSearchParams()

  if (filters.city) search.set('city', filters.city)
  for (const code of filters.accessibility ?? []) search.append('accessibility', code)
  if (filters.page && filters.page > 1) search.set('page', String(filters.page))

  const query = search.toString()

  return query === '' ? '/venues' : `/venues?${query}`
}

/**
 * Whether any narrowing filter is set.
 *
 * @param {Partial<VenueFilters>} [filters] Filter state.
 * @returns {boolean} True when the directory is showing a subset.
 */
export function hasVenueFilters(filters = {}) {
  return Boolean(filters.city) || (filters.accessibility ?? []).length > 0
}

/**
 * The venues a directory may link to.
 *
 * A venue with no slug has no public page to link to, and one merged into
 * another is not a venue anybody can choose any more — the API already leaves
 * merged rows out of this listing, and this says so again rather than trusting
 * it, because a link to a merged record is a link to a page about a different
 * place.
 *
 * @param {object[]} venues Venue summaries from `GET /v1/venues`.
 * @returns {object[]} Those with a slug, a name and no merge pointer.
 */
export function listableVenues(venues) {
  return (venues ?? []).filter(
    (venue) =>
      typeof venue?.slug === 'string' &&
      venue.slug.trim() !== '' &&
      typeof venue.name === 'string' &&
      venue.name.trim() !== '' &&
      !venue.mergedIntoVenueId,
  )
}

/**
 * A two-letter country code as a country name.
 *
 * @param {string|null|undefined} code An ISO 3166-1 alpha-2 code.
 * @returns {string|null} "India", or the code itself when it cannot be named.
 */
function countryName(code) {
  if (typeof code !== 'string' || code.trim() === '') return null

  const trimmed = code.trim().toUpperCase()

  if (!/^[A-Z]{2}$/.test(trimmed)) return code.trim()

  try {
    return new Intl.DisplayNames(['en-IN'], { type: 'region' }).of(trimmed) ?? trimmed
  } catch {
    return trimmed
  }
}

/**
 * Where a venue is, as one line: city, then region and country when present.
 *
 * A region that repeats the city ("Singapore, Singapore") is said once.
 *
 * @param {object} venue A venue summary.
 * @returns {string} "Mumbai, Maharashtra, India".
 */
export function venuePlace(venue) {
  const parts = []

  for (const part of [venue?.city, venue?.region, countryName(venue?.country)]) {
    if (typeof part !== 'string' || part.trim() === '') continue
    if (parts.some((existing) => existing.toLowerCase() === part.trim().toLowerCase())) continue

    parts.push(part.trim())
  }

  return parts.join(', ')
}

/**
 * The accessibility claims a venue asserts, in the words its own page uses.
 *
 * Only what the venue asserts: an absent claim is not shown as "no", because
 * a venue that has not said whether it has a hearing loop has not said it
 * lacks one.
 *
 * @param {object} venue A venue summary.
 * @returns {string[]} Readable claims, deduplicated, in the order the venue gave them.
 */
export function venueAccessibilityLabels(venue) {
  const features = venue?.accessibility?.features

  if (!Array.isArray(features)) return []

  return [...new Set(features.filter((code) => typeof code === 'string'))].map((code) =>
    accessibilityLabel(code),
  )
}

/**
 * Whether a venue has written a free-text accessibility note.
 *
 * The note travels in the summary beside the claims, and a venue can publish
 * one without ticking any claim ("Accessible entrance at Gate 3; ring the
 * bell"). A card that looked only at the claims would call that venue silent,
 * which its own page contradicts.
 *
 * @param {object} venue A venue summary.
 * @returns {boolean} True when there is a non-blank note.
 */
export function venueHasAccessibilityNote(venue) {
  const note = venue?.accessibility?.note

  return typeof note === 'string' && note.trim() !== ''
}

/**
 * The refusal drawn when this server could not get an answer it can use.
 *
 * A 503 reads, through `describeApiRefusal`, as "The service could not finish
 * this. It may be momentary; try again." — which is what happened.
 */
const UPSTREAM_UNAVAILABLE = Object.freeze({
  status: 503,
  code: 'UPSTREAM_UNAVAILABLE',
  retryAfterSeconds: null,
})

/**
 * A failed read reduced to what the refusal vocabulary reads.
 *
 * The status and the code, and nothing else. The client's error message names
 * the request URL, and nothing that names an endpoint is drawn on a page.
 *
 * The vocabulary is written for a request the visitor's browser made, and this
 * read is made by the web server, anonymously. So only the answers that mean
 * the same thing here pass through unchanged: a 429 (wait, then try again) and
 * a 5xx (our side failed). Everything else is our side failing too, and is
 * drawn as such. No response at all — the API down, or the timeout firing —
 * would otherwise read "Nothing reached Desi-Event … Check your connection",
 * when the visitor's request did reach Desi-Event and their connection is
 * fine. A 401 or 403 would offer a sign-in or say "not for this account" to a
 * visitor on a public page who asked for neither, and a 400 would tell them to
 * check what they entered when the filters were already corrected before
 * sending.
 *
 * @param {unknown} error What the client threw.
 * @returns {{status: number, code: string|null, retryAfterSeconds: number|null}} The refusal.
 */
function refusalOf(error) {
  const status = Number.isInteger(error?.status) ? error.status : 0
  const code = typeof error?.code === 'string' ? error.code : null

  if (status === 429) {
    return {
      status,
      code,
      retryAfterSeconds: Number.isFinite(error?.retryAfterSeconds) ? error.retryAfterSeconds : null,
    }
  }

  if (status >= 500) return { status, code, retryAfterSeconds: null }

  return { ...UPSTREAM_UNAVAILABLE }
}

/**
 * @typedef {object} VenueDirectoryResult
 * @property {boolean} ok Whether the API answered with a usable listing.
 * @property {object[]} [venues] Listable venues on this page.
 * @property {{page: number, hasNextPage: boolean}} [pagination] Where this page sits.
 * @property {{status: number, code: string|null, retryAfterSeconds: number|null}} [error] The refusal, when `ok` is false.
 */

/**
 * Read one page of the venue directory.
 *
 * Asked through the shared, anonymous client, so every visitor is shown the
 * same shared venues and nobody's private venue records.
 *
 * Fails closed rather than soft: unlike the event reads in `lib/api.js` there
 * is no curated catalogue to fall back to, and an empty list drawn in place of
 * a failure would tell a visitor there are no venues.
 *
 * @param {VenueFilters} filters What to ask for.
 * @param {object} [options] Overrides.
 * @param {object} [options.client] API client to use; defaults to the shared one.
 * @returns {Promise<VenueDirectoryResult>} The page, or the refusal.
 */
export async function loadVenueDirectory(filters, options = {}) {
  const { city = '', accessibility = [], page = 1 } = filters ?? {}

  try {
    const client = options.client ?? getApiClient()
    const response = await client.venues.list(
      {
        ...(city ? { city } : {}),
        ...(accessibility.length > 0 ? { accessibility } : {}),
        page,
        perPage: VENUES_PER_PAGE,
      },
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    )

    if (!Array.isArray(response?.data) || !response?.pagination) {
      throw Object.assign(new Error('venues.list returned no listing'), {
        status: 502,
        code: 'MALFORMED_RESPONSE',
      })
    }

    return {
      ok: true,
      venues: listableVenues(response.data),
      pagination: {
        page: Number.isInteger(response.pagination.page) ? response.pagination.page : page,
        hasNextPage: response.pagination.hasNextPage === true,
      },
    }
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 0
    const code = typeof error?.code === 'string' ? error.code : null

    // What actually came back, status and code only: the message carries the
    // request URL. The page is shown the refusal as `refusalOf` words it.
    console.warn(
      `[desi-event/web] the venue directory could not be read (status ${status}, ${code ?? 'no code'})`,
    )

    return { ok: false, error: refusalOf(error) }
  }
}

// ---------------------------------------------------------------------------
// Organisers
// ---------------------------------------------------------------------------

/**
 * How much of the event listing the organiser directory reads.
 *
 * `perPage` is `MAX_PER_PAGE` in `@desi-event/schemas/primitives`, the most
 * `listEventsQuerySchema` accepts (the unit test holds it to that); five pages
 * of it is five hundred events, which is five round trips on a page that
 * renders per request.
 */
export const ORGANIZER_SCAN = Object.freeze({ maxPages: 5, perPage: 100 })

/**
 * Build the page reader the organiser directory walks: upcoming listed events.
 *
 * `loadEventList` is the public listing as `/events` shows it, which has no
 * date bound. The organiser's own page counts only events that have not
 * started yet ("Upcoming events", in every listed status), so a directory
 * built from the undated listing would list an organiser whose only events are
 * behind them, and give a count their page does not show. This asks the same
 * listing for the same statuses — no `status`, so the API's public set applies
 * to this anonymous read — from `now` on. `now` is fixed once per walk, so
 * every page of it answers the same question.
 *
 * When the read fails, the page comes from `loadEventList`'s own fallback, with
 * the failure handed to it through a client that only rethrows it. That keeps
 * the sample catalogue, its paging and its once-per-process warning in one
 * place, and costs no second request to an API that has just failed; asking
 * the undated listing instead could answer with live events of a different
 * scope and mix them into the walk.
 *
 * @param {object} [options] Overrides.
 * @param {object} [options.client] API client to use; defaults to the shared, anonymous one.
 * @param {Date} [options.now] The instant "upcoming" starts from.
 * @returns {Function} A reader taking `{ page, perPage }`, with `loadEventList`'s result shape.
 */
export function upcomingEventReader(options = {}) {
  const startsAfter = (options.now ?? new Date()).toISOString()

  /**
   * Read one page of upcoming listed events.
   *
   * @param {{page: number, perPage: number}} request Which page, and how big.
   * @returns {Promise<object>} `{ events, pagination, usedFallback }`, as `loadEventList` answers.
   */
  return async function readUpcomingEvents({ page, perPage }) {
    try {
      const client = options.client ?? getApiClient()
      const response = await client.events.list(
        { page, perPage, sort: 'startsAt:asc', startsAfter },
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      )

      if (!Array.isArray(response?.data)) {
        throw new Error('events.list returned no data array')
      }

      return { events: response.data, pagination: response.pagination, usedFallback: false }
    } catch (error) {
      // A client whose only answer is this failure: `loadEventList` logs it and
      // goes straight to its sample fallback, without a second request.
      const rethrow = {
        events: {
          list: async () => {
            throw error
          },
        },
      }

      return loadEventList({ page, perPage }, { client: rethrow })
    }
  }
}

/**
 * @typedef {object} OrganizerEntry
 * @property {string} slug The organiser's slug.
 * @property {string} name The organiser's name, as the event listing gives it.
 * @property {number} eventCount Distinct upcoming listed events of theirs that were read.
 */

/**
 * @typedef {object} OrganizerDirectory
 * @property {OrganizerEntry[]} organizers Distinct organisers, by name.
 * @property {number} eventsRead Distinct listed events the directory was built from.
 * @property {number|null} totalListed How many events the listing said it holds, when it said.
 * @property {boolean} truncated True when the walk stopped before the end of the listing.
 * @property {boolean} interrupted True when it stopped because a page could not be read from the same source as the first.
 * @property {boolean} usedFallback True when the events came from the curated sample catalogue.
 */

/** Names compared the way an Indian-English reader alphabetises them. */
const NAME_ORDER = new Intl.Collator('en-IN', { sensitivity: 'base', numeric: true })

/**
 * Derive the organiser directory from the public event listing.
 *
 * Walks at most `maxPages` pages of `perPage` upcoming events and collects
 * each distinct `organizationSlug` with how many listed events it has. Events
 * are counted once each by slug, because a listing that shifts between two
 * page reads can hand the same event over twice.
 *
 * Every page must come from the same place as the first. The reader falls
 * back to the sample catalogue whenever a read fails, so a failure on page
 * three would otherwise splice sample organisers into a live directory — and
 * the paginator over the sample catalogue clamps, so it would hand back page
 * one again. When the source changes mid-walk the walk stops, keeps what the
 * first source said, and reports that it was cut short.
 *
 * An event in a status the public listing should never serve is skipped rather
 * than trusted, as the sitemap does, and so is one with no organiser slug: it
 * has no page to link to.
 *
 * @param {object} [options] Overrides.
 * @param {Function} [options.load] A page reader with `loadEventList`'s signature and result shape; defaults to `upcomingEventReader()`.
 * @param {number} [options.maxPages] Most pages to read.
 * @param {number} [options.perPage] Events per page.
 * @returns {Promise<OrganizerDirectory>} The directory, and how complete it is.
 */
export async function deriveOrganizers(options = {}) {
  const {
    load = upcomingEventReader(),
    maxPages = ORGANIZER_SCAN.maxPages,
    perPage = ORGANIZER_SCAN.perPage,
  } = options

  /** @type {Map<string, OrganizerEntry>} */
  const bySlug = new Map()
  const seen = new Set()
  let usedFallback = false
  let totalListed = null
  let reachedEnd = false
  let interrupted = false

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await load({ page, perPage })
    const fromFallback = result?.usedFallback === true

    if (page === 1) {
      usedFallback = fromFallback
      totalListed = Number.isInteger(result?.pagination?.total) ? result.pagination.total : null
    } else if (fromFallback !== usedFallback) {
      interrupted = true
      break
    }

    for (const event of Array.isArray(result?.events) ? result.events : []) {
      const key = event?.slug ?? event?.id

      if (typeof key !== 'string' || seen.has(key)) continue
      seen.add(key)

      if (event.status && !INDEXABLE_STATUSES.has(event.status)) continue

      const slug = typeof event.organizationSlug === 'string' ? event.organizationSlug.trim() : ''
      const name = typeof event.organizationName === 'string' ? event.organizationName.trim() : ''

      if (slug === '' || name === '') continue

      const entry = bySlug.get(slug) ?? { slug, name, eventCount: 0 }
      entry.eventCount += 1
      bySlug.set(slug, entry)
    }

    if (result?.pagination?.hasNextPage !== true) {
      reachedEnd = true
      break
    }
  }

  const organizers = [...bySlug.values()].sort(
    (left, right) => NAME_ORDER.compare(left.name, right.name) || (left.slug < right.slug ? -1 : 1),
  )

  return {
    organizers,
    eventsRead: seen.size,
    totalListed,
    truncated: !reachedEnd,
    interrupted,
    usedFallback,
  }
}

/**
 * How an organiser's count reads.
 *
 * "Upcoming", because that is what was counted, and what the organiser's own
 * page lists under that heading.
 *
 * @param {number} count Upcoming listed events.
 * @returns {string} "1 upcoming event listed", "3 upcoming events listed".
 */
export function organizerCountLabel(count) {
  return count === 1
    ? '1 upcoming event listed'
    : `${count.toLocaleString('en-IN')} upcoming events listed`
}
