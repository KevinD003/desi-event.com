/**
 * "Visit the organiser's website": the tracked redirect.
 *
 * `GET /events/{slug}/website` asks the API where the event's website link
 * goes (`POST /v1/traffic/website-visits`, which only this server may call)
 * and answers a 302 there. The destination never comes from the request: it is
 * the address a Desi-Event administrator approved, answered only while the
 * link is on and the event's page is public, checked again here before a
 * `Location` is built from it. Every other case is the same 404 page, so the
 * route says nothing about an event that is not public.
 *
 * What is answered without asking the API:
 *
 *   - an invalid slug: the 404 page;
 *   - a prefetch or prerender: 503, `no-store`, nothing looked up or counted;
 *   - a request the browser says is not a top-level page (an image, a frame,
 *     a script fetch aimed here): the 404 page.
 *
 * A visit is counted only for a top-level navigation the browser vouches for
 * (`lib/website.js` `isCountableNavigation`); a request with no fetch metadata
 * is served and not counted, and `?count=no` can only stop a count. The API
 * cannot be reached, is over its ceiling or answers something that does not
 * pass the address rules: the "Website link unavailable" page, 503. `HEAD` is
 * 405, so a link checker's HEAD never runs the lookup.
 *
 * No cookie is forwarded: the lookup carries only what the visit beacons
 * carry (`trafficForwardHeaders`), and every answer is `no-store, private`.
 *
 * @module app/events/slug/website/route
 */

import { getApiBaseUrl } from '../../../../lib/api-client.js'
import { trafficForwardHeaders } from '../../../../lib/traffic-forwarding.js'
import {
  isCountableNavigation,
  isPrefetch,
  isServableRequest,
  websiteUrlProblem,
} from '../../../../lib/website.js'

/** Every request is somebody's click: never cached, never prerendered. */
export const dynamic = 'force-dynamic'

/** An event's web address, as the API stores it. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** The longest web address an event has. */
const SLUG_LIMIT = 140

/** How long the lookup may take before the visitor is told it failed. */
const LOOKUP_TIMEOUT_MS = 5000

/** Headers on every answer. */
const NO_STORE = Object.freeze({
  'cache-control': 'no-store, private',
  pragma: 'no-cache',
  'x-robots-tag': 'noindex, nofollow',
})

/** The two pages this route can show. */
export const PAGES = Object.freeze({
  notAvailable: Object.freeze({
    status: 404,
    title: 'Website link not available · Desi-Event',
    heading: 'This website link is not available',
    body: 'The event’s link to the organiser’s website is turned off, or the event’s page is not public. No other site was opened.',
  }),
  unavailable: Object.freeze({
    status: 503,
    title: 'Website link unavailable · Desi-Event',
    heading: 'Website link unavailable',
    body: 'Desi-Event could not look up where this link goes just now. Try again from the event page in a minute.',
  }),
})

/**
 * A minimal page: one heading, one paragraph, a way back. No script and no
 * colour of its own; the slug is written only after it matched {@link SLUG}.
 *
 * @param {object} page One of {@link PAGES}.
 * @param {string|null} slug The event's web address, when it was valid.
 * @param {string|null} [retryAfter] Seconds to pass on, when the API gave some.
 * @returns {Response} The page.
 */
function pageResponse(page, slug, retryAfter = null) {
  const back = slug ? `<li><a href="/events/${slug}">Back to the event</a></li>` : ''
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${page.title}</title>
</head>
<body>
<main>
<h1>${page.heading}</h1>
<p>${page.body}</p>
<ul>
${back}<li><a href="/events">Browse events</a></li>
</ul>
</main>
</body>
</html>
`

  return new Response(html, {
    status: page.status,
    headers: {
      ...NO_STORE,
      'content-type': 'text/html; charset=utf-8',
      ...(retryAfter ? { 'retry-after': retryAfter } : {}),
    },
  })
}

/**
 * A `Retry-After` worth passing on: whole seconds, nothing else.
 *
 * @param {string|null} value The API's header.
 * @returns {string|null} The seconds, or null.
 */
function retryAfterOf(value) {
  return typeof value === 'string' && /^\d{1,6}$/u.test(value.trim()) ? value.trim() : null
}

/**
 * Follow an event's website link.
 *
 * @param {Request} request The incoming request.
 * @param {{params: Promise<{slug: string}>}} context The route's parameters.
 * @returns {Promise<Response>} A 302, the 404 page, or 503.
 */
export async function GET(request, { params }) {
  const { slug } = await params

  if (typeof slug !== 'string' || slug.length > SLUG_LIMIT || !SLUG.test(slug)) {
    return pageResponse(PAGES.notAvailable, null)
  }

  // Fetched ahead of a click: nothing is looked up, nothing is counted.
  if (isPrefetch(request.headers)) {
    return new Response(null, { status: 503, headers: NO_STORE })
  }

  // Only a top-level page is served; an image or a frame aimed here is not.
  if (!isServableRequest(request.headers)) return pageResponse(PAGES.notAvailable, slug)

  const counted = isCountableNavigation(request.headers, new URL(request.url).searchParams)
  let upstream

  try {
    upstream = await fetch(`${getApiBaseUrl()}/v1/traffic/website-visits`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...trafficForwardHeaders(request),
      },
      body: JSON.stringify({ slug, counted }),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })
  } catch {
    return pageResponse(PAGES.unavailable, slug)
  }

  if (upstream.status === 404) return pageResponse(PAGES.notAvailable, slug)

  if (!upstream.ok) {
    return pageResponse(PAGES.unavailable, slug, retryAfterOf(upstream.headers.get('retry-after')))
  }

  const url = (await upstream.json().catch(() => null))?.data?.url

  // The third check of the address: an answer that does not pass the rules
  // is never sent anybody to.
  if (typeof url !== 'string' || websiteUrlProblem(url) !== null) {
    return pageResponse(PAGES.unavailable, slug)
  }

  return new Response(null, {
    status: 302,
    headers: {
      ...NO_STORE,
      location: new URL(url).href,
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  })
}

/**
 * A link checker's HEAD runs no lookup and counts nothing.
 *
 * @returns {Response} 405.
 */
export function HEAD() {
  return new Response(null, { status: 405, headers: { ...NO_STORE, allow: 'GET' } })
}
