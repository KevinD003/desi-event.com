/**
 * The request proxy (Next.js 16's name for middleware).
 *
 * It does one thing: copy the request's path and query onto the request as a
 * header, so a server layout — which Next.js never tells which page it wraps —
 * can read it. The root layout uses it to choose the page's colour register;
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
 * @module proxy
 */

import { NextResponse } from 'next/server'

import { REQUEST_PATH_HEADER } from './lib/request-path-header.js'

/**
 * Record the path for the layouts.
 *
 * @param {object} request The incoming `NextRequest`.
 * @returns {object} A `NextResponse` that continues the request with the header set.
 */
export function proxy(request) {
  const forwarded = new Headers(request.headers)
  const { pathname, search } = request.nextUrl

  forwarded.set(REQUEST_PATH_HEADER, `${pathname}${search}`)

  return NextResponse.next({ request: { headers: forwarded } })
}

export const config = {
  // Pages only. The API proxy, built assets, image optimisation and anything
  // with a file extension (icons, the manifest, the sitemap) have no layout to
  // inform, and running on them would only add latency.
  matcher: ['/((?!api/|_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)'],
}
