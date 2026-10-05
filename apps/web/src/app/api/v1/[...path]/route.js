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
 * What it takes away: the session's bearer secret from a sign-in's answer. The
 * API returns it in the body for clients that cannot hold a cookie, and it is
 * the same secret the HttpOnly cookie carries — so passing it through handed
 * page JavaScript exactly what HttpOnly exists to keep from it, and any script
 * that ever ran on this origin could have read a session out of a sign-in. The
 * browser needs only the cookie; nothing in this application reads the token.
 *
 * What this deliberately does not do is add authority. It forwards the caller's
 * cookies and nothing else: no service token, no elevated credential, no
 * rewriting of who the request is from. A proxy that authenticated on the
 * browser's behalf would be a hole in every rule the API enforces.
 *
 * Traffic beacons are forwarded without a session. On `POST traffic/beacons`
 * the cookie, the bearer secret, the CSRF token, any idempotency key and any
 * entity tag are dropped, nothing the API sets as a cookie comes back, and the
 * only things added are the visitor's address, user agent and privacy signals
 * (`lib/traffic-forwarding.js`), which the API believes only from this server
 * and keeps only as a one-day code. A browser-supplied `x-desi-client-address`
 * is never forwarded on any path. `traffic/events`, the platform's list, is a
 * session route like any other.
 *
 * Some API routes are for this server alone and are never forwarded
 * (`SERVER_ONLY_API_PATHS`): counting a visit to an organiser's website is done
 * by the web's own redirect route, so a browser cannot count one by posting it.
 *
 * @module app/api/v1/path/route
 */

import { MEDIA_LIMITS } from '@desi-event/schemas/media'

import { getApiBaseUrl } from '../../../../lib/api-client.js'
import { trafficForwardHeaders } from '../../../../lib/traffic-forwarding.js'

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
  // A picture revalidates by its entity tag; the API decides, after checking
  // who is asking, whether a 304 is the answer.
  'if-none-match',
]

/**
 * API paths this proxy never forwards, whatever the method: routes only this
 * server calls. Each is the path's leading segments.
 *
 * @type {ReadonlyArray<ReadonlyArray<string>>}
 */
export const SERVER_ONLY_API_PATHS = Object.freeze([Object.freeze(['traffic', 'website-visits'])])

/**
 * Request headers a visit beacon never carries upstream: the session, the
 * bearer secret, the CSRF token and anything that would tie one beacon to
 * another request.
 *
 * @type {ReadonlyArray<string>}
 */
export const BEACON_STRIPPED_HEADERS = Object.freeze([
  'cookie',
  'authorization',
  'x-desi-csrf',
  'idempotency-key',
  'if-none-match',
])

/**
 * Whether a path is a route only this server may call.
 *
 * @param {string[]} path The proxied path segments.
 * @returns {boolean} True when it is never forwarded.
 */
export function isServerOnlyPath(path) {
  return SERVER_ONLY_API_PATHS.some((prefix) =>
    prefix.every((segment, index) => path[index] === segment),
  )
}

/**
 * Whether a request is a visit beacon.
 *
 * @param {string} method The HTTP method.
 * @param {string[]} path The proxied path segments.
 * @returns {boolean} True for `POST traffic/beacons`.
 */
export function isBeacon(method, path) {
  return method === 'POST' && path.length === 2 && path[0] === 'traffic' && path[1] === 'beacons'
}

/**
 * The answer for a server-only path: the API's own not-found, without asking it.
 *
 * @returns {Response} A 404 in the API's error shape.
 */
function notFound() {
  return Response.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'There is nothing at this address.',
        statusCode: 404,
      },
    },
    { status: 404, headers: { 'cache-control': 'no-store' } },
  )
}

/**
 * Response headers worth forwarding back.
 *
 * `set-cookie` is the one that matters and is handled separately, because a
 * response can carry several and `Headers.get` flattens them into one string
 * that browsers then misparse.
 *
 * `pragma` travels with `cache-control`: a response that carries a code shown
 * once — an invitation code — says `no-store, private` and `pragma: no-cache`
 * both, for the HTTP/1.0 caches that read only the second.
 *
 * @type {string[]}
 */
const FORWARD_RESPONSE_HEADERS = ['content-type', 'cache-control', 'pragma', 'retry-after']

/**
 * Response headers a picture carries back as well.
 *
 * Its entity tag and length so a browser and the image optimiser can
 * revalidate; `nosniff`, the sandboxing policy and the inline disposition so
 * the bytes are only ever treated as the image they are.
 *
 * @type {string[]}
 */
const FORWARD_MEDIA_RESPONSE_HEADERS = [
  'etag',
  'content-length',
  'x-content-type-options',
  'content-disposition',
  'content-security-policy',
  'last-modified',
]

/**
 * The largest request body the proxy will buffer: one picture at the upload
 * limit, and room for nothing else. Everything else the API takes is far
 * smaller.
 *
 * @type {number}
 */
export const PROXY_BODY_LIMIT_BYTES = MEDIA_LIMITS.maxBytes + 64 * 1024

/**
 * The answer for a body over the limit, before the API is contacted.
 *
 * @returns {Response} A 413 in the API's error shape.
 */
function tooLarge() {
  return Response.json(
    {
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The upload is larger than 10 MB. Save a smaller copy and try again.',
        statusCode: 413,
      },
    },
    { status: 413 },
  )
}

/**
 * Read a request body, refusing to buffer more than `limit` bytes.
 *
 * A declared `Content-Length` over the limit is refused without reading
 * anything. A body that lies about its length, or declares none, is read until
 * it passes the limit and then abandoned.
 *
 * @param {Request} request The incoming request.
 * @param {number} limit The most bytes to accept.
 * @returns {Promise<Uint8Array|undefined|null>} The bytes, `undefined` for no body, or null when over the limit.
 */
export async function readBoundedBody(request, limit) {
  const declared = Number(request.headers.get('content-length'))

  if (Number.isFinite(declared) && declared > limit) return null
  if (!request.body) return undefined

  const reader = request.body.getReader()
  const chunks = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done) break

    total += value.byteLength

    if (total > limit) {
      await reader.cancel().catch(() => {})
      return null
    }

    chunks.push(value)
  }

  const body = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return body
}

/**
 * A sign-in's answer, without the session's bearer secret.
 *
 * Only for the `auth` routes and only for JSON — the answers that establish a
 * session (sign-in, the second-factor step, account creation) are the ones
 * that carry `token`. Everything else streams through untouched.
 *
 * @param {Response} upstream The API's response.
 * @param {string[]} path The proxied path segments.
 * @returns {Promise<ReadableStream|string|null>} The body to send on.
 */
export async function withoutBearerSecret(upstream, path) {
  if (path[0] !== 'auth') return upstream.body

  const type = upstream.headers.get('content-type') ?? ''

  if (!type.includes('application/json')) return upstream.body

  const text = await upstream.text()
  let body

  try {
    body = JSON.parse(text)
  } catch {
    return text
  }

  if (!body || typeof body !== 'object' || typeof body.token !== 'string') return text

  const { token: _token, ...rest } = body

  return JSON.stringify(rest)
}

/**
 * Forward one request to the API and return its response.
 *
 * @param {Request} request The incoming request.
 * @param {{params: Promise<{path: string[]}>}} context The route context.
 * @returns {Promise<Response>} The upstream response.
 */
async function forward(request, context) {
  const { path } = await context.params

  if (isServerOnlyPath(path)) return notFound()

  const beacon = isBeacon(request.method, path)
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

  // A visit is counted without a session: the cookie, the bearer secret and
  // the CSRF token never travel with a beacon, and the only things added are
  // the visitor's address and privacy signals, which the API believes only
  // from this server's address and keeps only as a one-day code.
  if (beacon) {
    for (const name of BEACON_STRIPPED_HEADERS) headers.delete(name)

    for (const [name, value] of Object.entries(trafficForwardHeaders(request))) {
      headers.set(name, value)
    }
  }

  let body

  if (!['GET', 'HEAD'].includes(request.method)) {
    body = await readBoundedBody(request, PROXY_BODY_LIMIT_BYTES)

    // Refused here, before the API is asked: nothing past the limit is worth
    // buffering, and the API would refuse it anyway.
    if (body === null) return tooLarge()
  }

  let upstream

  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
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

  if (path[0] === 'media') {
    for (const name of FORWARD_MEDIA_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name)
      if (value) responseHeaders.set(name, value)
    }

    // Always, whatever the API said: picture bytes are never sniffed into
    // something else.
    responseHeaders.set('x-content-type-options', 'nosniff')
  }

  // Several Set-Cookie headers are normal here — a session and its CSRF token
  // arrive together — and they have to stay separate all the way to the
  // browser, so `getSetCookie` is used rather than `get`. A beacon sets none:
  // whatever the API said, a visit leaves nothing behind in the browser.
  for (const cookie of beacon ? [] : (upstream.headers.getSetCookie?.() ?? [])) {
    responseHeaders.append('set-cookie', cookie)
  }

  return new Response(await withoutBearerSecret(upstream, path), {
    status: upstream.status,
    headers: responseHeaders,
  })
}

export const GET = forward
export const POST = forward
export const PATCH = forward
export const PUT = forward
export const DELETE = forward
