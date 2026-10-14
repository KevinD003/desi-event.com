/**
 * The words visit counting uses, shared by the API, the worker's roll-up and
 * the browser.
 *
 * No imports, on purpose: a client component that sends a beacon imports this
 * module and nothing else from the schemas package, so the browser never pulls
 * in zod or a request schema to spell a placement. Served at
 * `@desi-event/schemas/traffic-vocabulary`. The database spells the same words
 * in the `TrafficEventKind`, `TrafficPlacement` and `TrafficSource` enums
 * (migration `20260930130000_event_traffic_analytics`), and `enums.test.js`
 * holds the two together.
 *
 * @module @desi-event/schemas/traffic-vocabulary
 */

/** Every kind of counted moment, as the database spells it. */
export const TRAFFIC_EVENT_KINDS = Object.freeze({
  PAGE_VIEW: 'PAGE_VIEW',
  CARD_CLICK: 'CARD_CLICK',
  TICKETS_CLICK: 'TICKETS_CLICK',
  SEATS_CLICK: 'SEATS_CLICK',
  WEBSITE_REDIRECT: 'WEBSITE_REDIRECT',
})

/** The kinds a browser may report. WEBSITE_REDIRECT is counted by the server alone. */
export const TRAFFIC_BEACON_KINDS = Object.freeze([
  'PAGE_VIEW',
  'CARD_CLICK',
  'TICKETS_CLICK',
  'SEATS_CLICK',
])

/**
 * Where a counted moment happened: one of the three places an event's card is
 * shown, or the event's own page. An organiser's page is not counted.
 */
export const TRAFFIC_PLACEMENTS = Object.freeze(['HOME', 'LISTING', 'SEARCH', 'EVENT_PAGE'])

/** Where an event card can be clicked. */
export const CARD_PLACEMENTS = Object.freeze(['HOME', 'LISTING', 'SEARCH'])

/** Where a page view came from, as a category. Never the referring address. */
export const TRAFFIC_SOURCES = Object.freeze(['DIRECT', 'INTERNAL', 'SEARCH', 'SOCIAL', 'OTHER'])

/** What the browser may say about where a view came from. Never a URL. */
export const REFERRER_MARKERS = Object.freeze({ SAME_SITE: 'SAME_SITE', OTHER_SITE: 'OTHER_SITE' })

/** A lower-case host name, as `new URL(...).hostname` gives it: no scheme, port, path or credentials. */
export const REFERRER_HOST_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * The shape of an event id: a cuid, as Prisma writes it. Shared so a beacon, a
 * query and a route parameter refuse the same things.
 */
export const EVENT_ID_PATTERN = /^[a-z][a-z0-9]{7,31}$/

/** Each source in words. */
export const TRAFFIC_SOURCE_LABELS = Object.freeze({
  DIRECT: 'Straight to the page',
  INTERNAL: 'The Desi Events pages',
  SEARCH: 'Search engines',
  SOCIAL: 'Social networks',
  OTHER: 'Other websites',
})

/** What each source covers, in a sentence. */
export const TRAFFIC_SOURCE_DESCRIPTIONS = Object.freeze({
  DIRECT: 'No referring site: typed in, bookmarked, or opened from an app or an email.',
  INTERNAL: 'The home page, the events list, search and organiser pages on this site.',
  SEARCH: 'Google, Bing, DuckDuckGo and other search engines.',
  SOCIAL: 'Facebook, Instagram, WhatsApp, X, YouTube and other social networks.',
  OTHER: 'Any other website that linked to the event.',
})

/** Each place a card is clicked, in words. */
export const CARD_PLACEMENT_LABELS = Object.freeze({
  HOME: 'Home page',
  LISTING: 'Events list',
  SEARCH: 'Search results',
})
