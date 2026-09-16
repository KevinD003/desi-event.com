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

/**
 * Call the API through the same-origin proxy.
 *
 * @param {string} path An API path beginning `/v1/`.
 * @param {object} [options] Fetch options.
 * @returns {Promise<Response>} The response.
 */
export function apiFetch(path, options = {}) {
  const method = (options.method ?? 'GET').toUpperCase()
  const headers = new Headers(options.headers ?? {})

  if (options.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

  if (MUTATING.includes(method)) {
    const token = readCsrfToken()

    if (token) headers.set('x-desi-csrf', token)
  }

  return fetch(`/api${path}`, { ...options, method, headers })
}
