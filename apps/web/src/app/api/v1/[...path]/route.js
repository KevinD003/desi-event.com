/**
 * The same-origin API proxy.
 *
 * The web application and the API are separate processes on separate ports, and
 * the session cookie is `__Host-` prefixed. That prefix is a browser-enforced
 * promise: the cookie is confined to exactly one origin, cannot carry a Domain,
 * and cannot be set by anybody else. It is the strongest cookie guarantee there
 * is, and it means a session minted at `:4000` can never reach a page served
 * from `:3000`.
 *
 * The usual workarounds are all worse. Dropping the prefix and widening the
 * Domain gives up the guarantee. `SameSite=None` with CORS credentials gives up
 * CSRF protection at the cookie layer and leans entirely on the token. Copying
 * the session into `localStorage` puts a bearer secret somewhere any injected
 * script can read.
 *
 * So the browser talks to its own origin, and this route forwards. The cookie
 * belongs to the web origin, `__Host-` keeps all of its meaning, there is no
 * CORS involved at all, and the API keeps its own origin checks because the
 * forwarded request carries the headers it needs to make them.
 *
 * What this deliberately does not do is add authority. It forwards the caller's
 * cookies and nothing else: no service token, no elevated credential, no
 * rewriting of who the request is from. A proxy that authenticated on the
 * browser's behalf would be a hole in every rule the API enforces.
 *
 * @module app/api/v1/path/route
 */

import { getApiBaseUrl } from '../../../../lib/api-client.js'

/** Never cached: every request here is somebody's session. */
export const dynamic = 'force-dynamic'

/**
 * Request headers worth forwarding upstream.
 *
 * An allow-list rather than a copy. `host` must not be forwarded — it would
 * make the API's origin check compare against the wrong host — and neither
 * should hop-by-hop headers. Everything the API actually reads is here.
 *
 * @type {string[]}
 */
const FORWARD_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'cookie',
  'origin',
  'user-agent',
  'x-desi-csrf',
  'idempotency-key',
]

/**
 * Response headers worth forwarding back.
 *
 * `set-cookie` is the one that matters and is handled separately, because a
 * response can carry several and `Headers.get` flattens them into one string
 * that browsers then misparse.
 *
 * @type {string[]}
 */
const FORWARD_RESPONSE_HEADERS = ['content-type', 'cache-control', 'retry-after']

/**
 * Forward one request to the API and return its response.
 *
 * @param {Request} request The incoming request.
 * @param {{params: Promise<{path: string[]}>}} context The route context.
 * @returns {Promise<Response>} The upstream response.
 */
async function forward(request, context) {
  const { path } = await context.params
  const incoming = new URL(request.url)
  const target = `${getApiBaseUrl()}/v1/${path.map(encodeURIComponent).join('/')}${incoming.search}`

  const headers = new Headers()

  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  // The API checks the request's origin against its allow-list. Forwarding the
  // browser's origin unchanged keeps that check meaningful rather than making
  // every proxied request look like it came from the server itself.
  if (!headers.has('origin') && incoming.origin) headers.set('origin', incoming.origin)

  let upstream

  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      redirect: 'manual',
      cache: 'no-store',
    })
  } catch (error) {
    // The API being down is not a 500 in this application: it is a known state
    // with a known shape, and the caller gets something it can render.
    const reason = error instanceof Error ? error.message : String(error)

    console.warn(`[desi-event/web] API proxy could not reach ${getApiBaseUrl()}: ${reason}`)

    return Response.json(
      {
        error: {
          code: 'API_UNREACHABLE',
          message: 'The ticketing service is not responding. Nothing has been changed.',
          statusCode: 503,
        },
      },
      { status: 503 },
    )
  }

  const responseHeaders = new Headers()

  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }

  // Several Set-Cookie headers are normal here — a session and its CSRF token
  // arrive together — and they have to stay separate all the way to the
  // browser, so `getSetCookie` is used rather than `get`.
  for (const cookie of upstream.headers.getSetCookie?.() ?? []) {
    responseHeaders.append('set-cookie', cookie)
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}

export const GET = forward
export const POST = forward
export const PATCH = forward
export const PUT = forward
export const DELETE = forward
