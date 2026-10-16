/**
 * The request proxy (Next.js 16's name for middleware).
 *
 * It does two things. It copies the request's path and query onto the
 * request as a header, so a server layout — which Next.js never tells which
 * page it wraps — can read it. The root layout uses it to choose the page's colour register;
 * the signed-in area layouts use it to send somebody to sign in and bring them
 * back to the page they asked for, not to the top of the area.
 *
 * It decides nothing about access. Every area layout reads the session itself
 * and the API authorises every request again; a proxy that tried to gate
 * pages would be a second, weaker copy of those checks.
 *
 * The header is always set, never merely forwarded, so a value a browser sent
 * under the same name is overwritten before anything reads it.
 *
 * And it answers an address whose percent-escapes do not decode
 * (`/events/%E0%A4%A`, a link cut off mid-character) with the site's own page
 * for it, `/bad-address`, still as a `400`. Left alone, Next.js fails to
 * decode the route's parameter and answers with its own bare, unbranded
 * "400 | Bad Request" document. The visitor's address bar keeps what they
 * typed; nothing from it is read or shown.
 *
 * @module proxy
 */

import { NextResponse } from 'next/server'

import { REQUEST_PATH_HEADER } from './lib/request-path-header.js'

/** The site's page for an address that cannot be read. */
export const BAD_ADDRESS_PATH = '/bad-address'

/**
 * Whether a path's percent-escapes fail to decode.
 *
 * @param {string} pathname The path, as requested.
 * @returns {boolean} True when it cannot be decoded.
 */
export function isMalformedPath(pathname) {
  try {
    decodeURIComponent(pathname)

    return false
  } catch {
    return true
  }
}

/**
 * The site's page for an unreadable address, answered with `400`.
 *
 * A rewrite alone would render the page with `200`: a page cannot set its
 * own status in the App Router. So the proxy renders it with an ordinary
 * request to its own origin, carrying the visitor's cookies so the header
 * still says who is signed in, and answers with that document and `400`. If
 * that request fails, the rewrite is still the visitor's best page, at
 * `200`.
 *
 * @param {object} request The incoming `NextRequest`.
 * @param {Headers} forwarded The request's headers, to continue with.
 * @returns {Promise<object>} The response.
 */
async function badAddress(request, forwarded) {
  const target = request.nextUrl.clone()

  target.pathname = BAD_ADDRESS_PATH
  target.search = ''
  forwarded.set(REQUEST_PATH_HEADER, BAD_ADDRESS_PATH)

  try {
    const page = await fetch(target, {
      headers: { cookie: request.headers.get('cookie') ?? '', accept: 'text/html' },
      cache: 'no-store',
    })

    if (page.ok) {
      return new NextResponse(page.body, {
        status: 400,
        headers: {
          'content-type': page.headers.get('content-type') ?? 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    }
  } catch {
    // Fall through to the rewrite below.
  }

  return NextResponse.rewrite(target, { request: { headers: forwarded } })
}

/**
 * Record the path for the layouts, or send an unreadable address to the page
 * that says so.
 *
 * @param {object} request The incoming `NextRequest`.
 * @returns {object} A `NextResponse` that continues the request with the header set.
 */
export function proxy(request) {
  const forwarded = new Headers(request.headers)
  const { pathname, search } = request.nextUrl

  if (isMalformedPath(pathname)) return badAddress(request, forwarded)

  forwarded.set(REQUEST_PATH_HEADER, `${pathname}${search}`)

  return NextResponse.next({ request: { headers: forwarded } })
}

export const config = {
  // Pages only. The API proxy, built assets, image optimisation and anything
  // with a file extension (icons, the manifest, the sitemap) have no layout to
  // inform, and running on them would only add latency.
  matcher: ['/((?!api/|_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)'],
}
