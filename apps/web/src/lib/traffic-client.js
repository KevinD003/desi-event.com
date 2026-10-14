/**
 * Visit beacons, in the browser.
 *
 * Browser-safe and small on purpose: it imports nothing but the visit-counting
 * vocabulary, which itself imports nothing, so a page that counts visits ships
 * no request schema and no capability name.
 *
 * What a beacon says: the event, the kind, the place, and for a page view
 * where it came from — a host name at most, never a URL. It is sent to this
 * site's own origin with `credentials: 'omit'`, so the session cookie does not
 * even travel with it, and it never waits for or reports an answer. Nothing is
 * kept in the browser: no cookie, no storage.
 *
 * Who is not counted is decided by the page, which knows who is looking: the
 * server passes `excludeAll` for staff at The Desi Events and the organisation ids of
 * the viewer's own memberships, and nothing is sent for those.
 *
 * @module lib/traffic-client
 */

import {
  CARD_PLACEMENTS,
  EVENT_ID_PATTERN,
  REFERRER_HOST_PATTERN,
  REFERRER_MARKERS,
} from '@desi-event/schemas/traffic-vocabulary'

/** Where beacons go: this site's own proxy. */
export const TRAFFIC_BEACON_PATH = '/api/v1/traffic/beacons'

/** The kinds a click can report. */
export const CLICK_KINDS = Object.freeze(['CARD_CLICK', 'TICKETS_CLICK', 'SEATS_CLICK'])

/** Page views already sent from this document. */
let viewsInDocument = 0

/**
 * Forget the views sent from this document. Tests only.
 *
 * @returns {void}
 */
export function resetTrafficClient() {
  viewsInDocument = 0
}

/**
 * Note that a page view was sent, so later views in this document are soft
 * navigations within the site.
 *
 * @returns {void}
 */
export function noteViewSent() {
  viewsInDocument += 1
}

/**
 * Whether a place fits a kind: a card is clicked on a listing, and everything
 * else happens on the event page.
 *
 * @param {string} kind The kind.
 * @param {string} placement The place.
 * @returns {boolean} Whether they fit.
 */
function placeFits(kind, placement) {
  return kind === 'CARD_CLICK' ? CARD_PLACEMENTS.includes(placement) : placement === 'EVENT_PAGE'
}

/**
 * Send one beacon and forget it.
 *
 * Never awaited, never throws, never reports: a visit that could not be
 * counted is not the visitor's problem.
 *
 * @param {{eventId: string, kind: string, placement: string, referrer?: string|null}} payload The beacon.
 * @param {{fetchImpl?: Function}} [options] The fetch to use; tests pass one.
 * @returns {void}
 */
export function sendTrafficBeacon(payload, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const body = {
      eventId: payload.eventId,
      kind: payload.kind,
      placement: payload.placement,
      ...(payload.kind === 'PAGE_VIEW' ? { referrer: payload.referrer ?? null } : {}),
    }
    const pending = fetchImpl(TRAFFIC_BEACON_PATH, {
      method: 'POST',
      keepalive: true,
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    pending?.catch?.(() => {})
  } catch {
    // Nothing to do: the visit is simply not counted.
  }
}

/**
 * Whether this page view is the one the browser landed on.
 *
 * A view after a navigation inside the site keeps the landing page's
 * `document.referrer`, which would credit, say, a search engine with a click
 * on the home page. So only the first view of a document that was itself
 * loaded at this path may name an outside referrer.
 *
 * @param {object} params Inputs.
 * @param {{name?: string}|undefined} params.navigationEntry The document's navigation timing entry.
 * @param {string} params.pathname The current path.
 * @returns {boolean} Whether the browser landed here.
 */
export function landedHere({ navigationEntry, pathname }) {
  if (viewsInDocument > 0 || !navigationEntry?.name) return false

  try {
    return new URL(navigationEntry.name).pathname === pathname
  } catch {
    return false
  }
}

/**
 * What a page view says about where it came from.
 *
 * @param {object} params Inputs.
 * @param {string} params.referrer `document.referrer`.
 * @param {string} params.origin This site's origin.
 * @param {boolean} params.landed Whether the browser landed on this page.
 * @returns {string|null} `SAME_SITE`, `OTHER_SITE`, a host name, or null for none.
 */
export function beaconReferrer({ referrer, origin, landed }) {
  if (!landed) return REFERRER_MARKERS.SAME_SITE
  if (!referrer) return null

  let url

  try {
    url = new URL(referrer)
  } catch {
    return REFERRER_MARKERS.OTHER_SITE
  }

  if (url.origin === origin) return REFERRER_MARKERS.SAME_SITE

  const host = url.hostname.toLowerCase()

  return REFERRER_HOST_PATTERN.test(host) ? host : REFERRER_MARKERS.OTHER_SITE
}

/**
 * The beacon a click on a marked link makes, or null.
 *
 * Only the primary button's click and the middle button's `auxclick` (opening
 * in a new tab) count; a keyboard's Enter on a link fires `click` too.
 *
 * @param {MouseEvent} event The click.
 * @param {{excludeAll?: boolean, excludedOrganizationIds?: string[]}} [excluded] Who is not counted.
 * @returns {{eventId: string, kind: string, placement: string}|null} The beacon.
 */
export function clickBeacon(event, { excludeAll = false, excludedOrganizationIds = [] } = {}) {
  if (excludeAll || !event) return null

  const primary = event.type === 'click' && event.button === 0
  const middle = event.type === 'auxclick' && event.button === 1

  if (!primary && !middle) return null

  const element = event.target?.closest?.('[data-traffic-kind]')

  if (!element) return null

  const kind = element.getAttribute('data-traffic-kind')
  const eventId = element.getAttribute('data-traffic-event')
  const placement = element.getAttribute('data-traffic-placement')
  const organizationId = element.getAttribute('data-traffic-organization')

  if (!CLICK_KINDS.includes(kind)) return null
  if (typeof eventId !== 'string' || !EVENT_ID_PATTERN.test(eventId)) return null
  if (!placeFits(kind, placement)) return null
  if (organizationId && excludedOrganizationIds.includes(organizationId)) return null

  return { eventId, kind, placement }
}

/**
 * The `data-*` attributes a server-rendered link carries so a click on it is
 * counted, or none when the event cannot be counted.
 *
 * @param {object} params Inputs.
 * @param {string} params.kind A click kind.
 * @param {string} params.eventId The event.
 * @param {string} [params.organizationId] Whose event it is, so its own team is not counted.
 * @param {string} params.placement Where the link is.
 * @returns {Record<string, string>} The attributes.
 */
export function trafficAttributes({ kind, eventId, organizationId, placement }) {
  if (!CLICK_KINDS.includes(kind)) return {}
  if (typeof eventId !== 'string' || !EVENT_ID_PATTERN.test(eventId)) return {}
  if (!placeFits(kind, placement)) return {}

  return {
    'data-traffic-kind': kind,
    'data-traffic-event': eventId,
    'data-traffic-placement': placement,
    ...(organizationId ? { 'data-traffic-organization': organizationId } : {}),
  }
}

/**
 * Run `callback` once the page is really shown: straight away, or when a
 * prerendered page is activated. A prerendered page nobody opens sends nothing.
 *
 * @param {Document} doc The document.
 * @param {function(): void} callback What to run.
 * @returns {function(): void} Cancels a callback still waiting.
 */
export function whenShown(doc, callback) {
  if (doc?.prerendering === true) {
    const run = () => callback()

    doc.addEventListener('prerenderingchange', run, { once: true })

    return () => doc.removeEventListener('prerenderingchange', run)
  }

  if (doc?.visibilityState === 'prerender') {
    const run = () => {
      if (doc.visibilityState !== 'visible') return

      doc.removeEventListener('visibilitychange', run)
      callback()
    }

    doc.addEventListener('visibilitychange', run)

    return () => doc.removeEventListener('visibilitychange', run)
  }

  callback()

  return () => {}
}
