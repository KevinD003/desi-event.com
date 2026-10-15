/**
 * Calling the API from the browser, with the CSRF token attached.
 *
 * The API authenticates a browser by cookie, and a cookie is sent by the
 * browser whether or not the page meant to send it — which is what CSRF is. So
 * every mutating request has to prove it came from a page that could *read* the
 * response to a previous one: the server sets a token in a readable cookie, and
 * the page echoes it in a header. An attacker's page can cause the cookie to be
 * sent but cannot read it, so it cannot produce the header.
 *
 * That is the whole reason this module exists rather than calling `fetch`
 * directly. Forgetting the header does not fail loudly at build time; it fails
 * at runtime with a 403 that looks like a permissions problem, which is exactly
 * how it presented the first time.
 *
 * @module lib/api-fetch
 */

/**
 * Cookie names the API may have used for the CSRF token.
 *
 * `__Host-` when the deployment is served over HTTPS, bare over loopback HTTP
 * where the prefix is not permitted. Both are checked rather than the
 * environment being consulted, because the page should not have to know how it
 * was served.
 *
 * @type {string[]}
 */
const CSRF_COOKIES = ['__Host-desi_csrf', 'desi_csrf']

/** Methods that change something, and therefore need the token. */
const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE']

/**
 * Read the CSRF token from the document's cookies.
 *
 * @returns {string|null} The token, or null when there is none.
 */
export function readCsrfToken() {
  if (typeof document === 'undefined') return null

  for (const name of CSRF_COOKIES) {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))

    if (match) return decodeURIComponent(match[1])
  }

  return null
}

/** Methods that carry no body. A precondition for one travels in the query string. */
const BODILESS = ['GET', 'HEAD', 'DELETE']

/**
 * Serialise a query object, dropping absent values.
 *
 * @param {Record<string, unknown>|undefined} query The values.
 * @returns {string} `?a=1&b=2`, or an empty string when nothing is left.
 */
export function toQueryString(query) {
  if (!query) return ''

  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue

    params.append(key, String(value))
  }

  const text = params.toString()

  return text ? `?${text}` : ''
}

/**
 * Call the API through the same-origin proxy.
 *
 * A body on a GET, HEAD or DELETE is refused with a `TypeError` rather than
 * sent. The API reads those methods' preconditions from the query string, and a
 * DELETE whose revision travelled in a body was refused with a 400 however it
 * was called — the Remove button that never removed anything. Throwing here
 * makes that mistake fail in the first unit test rather than in front of an
 * organiser. Pass `query` instead.
 *
 * @param {string} path An API path beginning `/v1/`.
 * @param {object} [options] Fetch options, plus `query`.
 * @param {Record<string, unknown>} [options.query] Query-string values; null and undefined are dropped.
 * @returns {Promise<Response>} The response.
 * @throws {TypeError} When a body is given with GET, HEAD or DELETE.
 */
export function apiFetch(path, options = {}) {
  const { query, ...init } = options
  const method = (init.method ?? 'GET').toUpperCase()

  if (BODILESS.includes(method) && init.body !== undefined && init.body !== null) {
    throw new TypeError(
      `apiFetch: a ${method} request carries no body; send ${path} its values as \`query\`.`,
    )
  }

  return send(`${path}${toQueryString(query)}`, init, method)
}

/**
 * Send one request, with the CSRF token on anything that changes something.
 *
 * @param {string} target The API path, with any query string.
 * @param {object} options Fetch options.
 * @param {string} method The upper-case method.
 * @returns {Promise<Response>} The response.
 */
function send(target, options, method) {
  const headers = new Headers(options.headers ?? {})

  if (options.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  if (MUTATING.includes(method)) {
    const token = readCsrfToken()

    if (token) headers.set('x-desi-csrf', token)
  }

  return fetch(`/api${target}`, { ...options, method, headers })
}
