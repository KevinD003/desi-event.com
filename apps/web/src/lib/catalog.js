/**
 * Presentation vocabulary for the event catalogue.
 *
 * The API speaks in `EventCategory` enum members; visitors do not. Everything
 * that turns a machine value into something a person reads — labels, blurbs,
 * the glyph on a poster — lives here so the wording is identical on the home
 * page, the listing and the detail page.
 *
 * @module lib/catalog
 */

/**
 * @typedef {object} CategoryDescriptor
 * @property {string} value The `EventCategory` enum member.
 * @property {string} label Short human label used in filters and badges.
 * @property {string} blurb One line of copy for the category browsing cards.
 * @property {string} glyph A single character used as a decorative poster mark.
 */

/**
 * Every event category, in the order they are offered for browsing.
 *
 * The order is editorial rather than alphabetical: the things the diaspora
 * actually buys tickets for first.
 *
 * @type {ReadonlyArray<CategoryDescriptor>}
 */
export const EVENT_CATEGORIES = Object.freeze([
  {
    value: 'GARBA_DANDIYA',
    label: 'Garba & Dandiya',
    blurb: 'Nine nights, live dhol and a circle that keeps getting wider.',
    glyph: '◉',
  },
  {
    value: 'MUSIC_CONCERT',
    label: 'Live Music',
    blurb: 'Qawwali, ghazal, indie and playback — amplified and in person.',
    glyph: '♪',
  },
  {
    value: 'BOLLYWOOD_NIGHT',
    label: 'Bollywood Nights',
    blurb: 'Filmi floor-fillers from the retro era to last Friday’s release.',
    glyph: '★',
  },
  {
    value: 'CLASSICAL_DANCE',
    label: 'Classical Dance',
    blurb: 'Bharatanatyam, Kathak and Odissi, with live accompaniment.',
    glyph: '❧',
  },
  {
    value: 'COMEDY',
    label: 'Comedy',
    blurb: 'Stand-up that has moved on from jokes about your mother.',
    glyph: '☺',
  },
  {
    value: 'FOOD_FESTIVAL',
    label: 'Food Festivals',
    blurb: 'Chaat, kottu, kulcha and an argument about the best chai.',
    glyph: '❂',
  },
  {
    value: 'CULTURAL_FESTIVAL',
    label: 'Melas & Festivals',
    blurb: 'Diwali, Pongal, Baisakhi and everything the whole family turns up to.',
    glyph: '✺',
  },
  {
    value: 'FILM_SCREENING',
    label: 'Film',
    blurb: 'Restorations, premieres and retrospectives on a real screen.',
    glyph: '▣',
  },
  {
    value: 'THEATRE',
    label: 'Theatre',
    blurb: 'Natak, drama and new writing, often with surtitles.',
    glyph: '⌘',
  },
  {
    value: 'WORKSHOP',
    label: 'Workshops',
    blurb: 'Learn the steps, the beats or the recipe from someone who knows.',
    glyph: '✎',
  },
  {
    value: 'RELIGIOUS',
    label: 'Religious & Devotional',
    blurb: 'Kirtan, bhajan sandhya, langar and community prayer.',
    glyph: '༄',
  },
  {
    value: 'WEDDING_EXPO',
    label: 'Wedding Expos',
    blurb: 'Every vendor for the big day, under one roof.',
    glyph: '❁',
  },
  {
    value: 'NETWORKING',
    label: 'Networking',
    blurb: 'Founders, creatives and the diaspora professional circuit.',
    glyph: '⌬',
  },
  {
    value: 'SPORTS',
    label: 'Sports',
    blurb: 'Gully cricket leagues, kabaddi and box-league football.',
    glyph: '◈',
  },
])

/** Category descriptors keyed by enum value for O(1) lookup. */
const CATEGORY_BY_VALUE = new Map(EVENT_CATEGORIES.map((category) => [category.value, category]))

/** Fallback used for a category the front end has not been taught yet. */
const UNKNOWN_CATEGORY = Object.freeze({
  value: 'UNKNOWN',
  label: 'Event',
  blurb: 'Something worth turning up to.',
  glyph: '◆',
})

/**
 * Look up the descriptor for a category.
 *
 * An unrecognised value yields a neutral descriptor rather than throwing: a new
 * category added by the API should show up as a plain "Event", never as a blank
 * page.
 *
 * @param {string} value An `EventCategory` enum member.
 * @returns {CategoryDescriptor} The descriptor, or a neutral fallback.
 */
export function categoryDescriptor(value) {
  return CATEGORY_BY_VALUE.get(value) ?? UNKNOWN_CATEGORY
}

/**
 * The human label for a category.
 *
 * @param {string} value An `EventCategory` enum member.
 * @returns {string} A short label such as `Garba & Dandiya`.
 */
export function categoryLabel(value) {
  return categoryDescriptor(value).label
}

/**
 * The categories that actually have events in a given set, in browsing order.
 *
 * Offering a filter that returns nothing is worse than not offering it, so the
 * browsing grid is built from the catalogue rather than from the enum.
 *
 * @param {object[]} events Event summaries.
 * @returns {object[]} Category descriptors, each with a `count` of its matching events.
 */
export function categoriesWithEvents(events) {
  const counts = new Map()

  for (const event of events ?? []) {
    counts.set(event.category, (counts.get(event.category) ?? 0) + 1)
  }

  return EVENT_CATEGORIES.filter((category) => counts.has(category.value)).map((category) => ({
    ...category,
    count: counts.get(category.value),
  }))
}

/**
 * Turn facet counts into browsing descriptors, in editorial order.
 *
 * Takes counts computed over the whole catalogue rather than over a page of
 * results, so a category whose events all start later than the current page
 * still appears. Categories with no events are still omitted: offering a filter
 * that returns nothing is worse than not offering it.
 *
 * @param {Array<{value: string, count: number}>} facets Category facet counts.
 * @returns {object[]} Category descriptors carrying their counts.
 */
export function describeCategories(facets) {
  const counts = new Map((facets ?? []).map((entry) => [entry.value, entry.count]))

  return EVENT_CATEGORIES.filter((category) => counts.has(category.value)).map((category) => ({
    ...category,
    count: counts.get(category.value),
  }))
}

/**
 * The cities represented in a set of events, alphabetically.
 *
 * @param {object[]} events Event summaries.
 * @returns {string[]} Unique, sorted city names.
 */
export function citiesWithEvents(events) {
  const cities = new Set((events ?? []).map((event) => event.city).filter(Boolean))

  return [...cities].sort((a, b) => a.localeCompare(b))
}

/**
 * Whether an event matches a free-text query.
 *
 * Matching is deliberately generous — title, summary, city, venue and organiser
 * all count — because a visitor searching "garba toronto" is describing an
 * event, not naming one.
 *
 * @param {object} event An event summary.
 * @param {string} query Raw search text.
 * @returns {boolean} True when the event matches.
 */
function matchesQuery(event, query) {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true

  const haystack = [
    event.title,
    event.summary,
    event.city,
    event.venueName,
    event.organizationName,
    categoryLabel(event.category),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return needle.split(/\s+/).every((term) => haystack.includes(term))
}

/**
 * Apply the listing filters to a set of event summaries.
 *
 * This mirrors what `GET /v1/events` does server-side, so the fallback
 * catalogue behaves like the real one: the same filters narrow it the same way.
 *
 * @param {object[]} events Event summaries to filter.
 * @param {object} [filters] Active filters.
 * @param {string} [filters.category] An `EventCategory` enum member.
 * @param {string} [filters.city] Exact city name.
 * @param {string} [filters.q] Free-text query.
 * @returns {object[]} The matching events, in input order.
 */
export function filterEvents(events, filters = {}) {
  const { category, city, q } = filters

  return (events ?? []).filter((event) => {
    if (category && event.category !== category) return false
    if (city && event.city !== city) return false
    if (q && !matchesQuery(event, q)) return false

    return true
  })
}

/**
 * Sort event summaries by start date, soonest first.
 *
 * @param {object[]} events Event summaries.
 * @returns {object[]} A new array in start-date order.
 */
export function sortByStartDate(events) {
  return [...(events ?? [])].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
}
