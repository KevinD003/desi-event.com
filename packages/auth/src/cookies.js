/**
 * Cookie policy, CSRF, and the origin check that does the real work.
 *
 * Phase 1 authenticated with a bearer token in a header, which is immune to CSRF
 * for the boring reason that a browser will not attach it on its own. Phase 2
 * moves the attendee session into a cookie, because a cookie survives a page
 * reload, cannot be read by injected script, and is what a server-rendered
 * commerce flow needs. That trade buys back the cross-site request forgery
 * problem, so this module is where it is answered — three ways, because each one
 * has a case it does not cover:
 *
 *   1. **`SameSite`.** The browser refuses to attach the session cookie to a
 *      cross-site POST at all. This is the strongest of the three and the one
 *      that needs no application code — but it is the browser's promise, not
 *      ours, and `Lax` (which the session cookie needs, so that following a link
 *      from an email works) still attaches on a cross-site top-level GET.
 *   2. **An origin check on every unsafe method.** `Origin`, falling back to
 *      `Referer`, must be a host this deployment expects. This is what catches a
 *      forged POST from another site, and unlike a token it cannot be
 *      accidentally disabled by a form that forgot a hidden field.
 *   3. **A double-submit token.** A random value in a readable cookie that the
 *      client must echo in a header. This catches the case where the origin is
 *      absent or stripped — some privacy tooling removes it — and it is the part
 *      a single-page app implements.
 *
 * All three, because a CSRF defence that is one thing is a CSRF defence with one
 * bug in it.
 *
 * @module @desi-event/auth/cookies
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Methods that do not change state and therefore need no CSRF defence.
 *
 * `HEAD` and `OPTIONS` are here for the same reason as `GET`. Anything not in
 * this set is checked, including methods nobody has written a route for yet —
 * the default is to check, not to skip.
 *
 * @type {Set<string>}
 */
export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Cookie names.
 *
 * The `__Host-` prefix is a browser-enforced promise: the browser will only
 * accept the cookie if it is `Secure`, has `Path=/`, and carries no `Domain`
 * attribute — which together mean a subdomain cannot set or overwrite it. That
 * closes cookie-tossing from a compromised sibling host. It requires HTTPS, so
 * the unprefixed name is used when the deployment is not secure, i.e. local
 * development over plain HTTP.
 *
 * @param {boolean} secure Whether the deployment serves over HTTPS.
 * @returns {{session: string, csrf: string}} The cookie names to use.
 */
export function cookieNames(secure) {
  return secure
    ? { session: '__Host-desi_session', csrf: '__Host-desi_csrf' }
    : { session: 'desi_session', csrf: 'desi_csrf' }
}

/**
 * Attributes for the session cookie.
 *
 * `httpOnly` so injected script cannot read it. `sameSite: 'lax'` rather than
 * `strict` because a buyer who follows a link from a confirmation email arrives
 * by a cross-site top-level GET and should still be signed in; `strict` would
 * show them a signed-out page and they would sign in again, which teaches
 * exactly the wrong reflex. The gap that `lax` leaves — a cross-site GET — is
 * covered by not changing state on GET, which the contract enforces.
 *
 * @param {object} options Options.
 * @param {boolean} options.secure Whether the deployment serves over HTTPS.
 * @param {number} options.maxAgeSeconds Cookie lifetime.
 * @returns {object} Attributes for Fastify's cookie API.
 */
export function sessionCookieOptions({ secure, maxAgeSeconds }) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
    // No `domain`: __Host- forbids it, and without it the cookie is confined to
    // exactly this host rather than shared with every subdomain.
  }
}

/**
 * Attributes for the CSRF cookie.
 *
 * Not `httpOnly`, on purpose and only here: the whole mechanism is that the
 * client reads this value and echoes it in a header, which script cannot do to a
 * cookie it cannot read. It carries no authority of its own — knowing it lets
 * you make a request *with your own session*, which you could do anyway.
 *
 * `sameSite: 'strict'` because, unlike the session cookie, nothing legitimate
 * needs this one attached on a cross-site navigation.
 *
 * @param {object} options Options.
 * @param {boolean} options.secure Whether the deployment serves over HTTPS.
 * @param {number} options.maxAgeSeconds Cookie lifetime.
 * @returns {object} Attributes for Fastify's cookie API.
 */
export function csrfCookieOptions({ secure, maxAgeSeconds }) {
  return {
    httpOnly: false,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

/**
 * Attributes that delete a cookie.
 *
 * A browser only replaces a cookie when the name, path and domain all match, so
 * clearing one has to restate them. Getting this wrong leaves the old cookie in
 * place and the session apparently un-endable.
 *
 * @param {boolean} secure Whether the deployment serves over HTTPS.
 * @returns {object} Attributes for Fastify's `clearCookie`.
 */
export function clearCookieOptions(secure) {
  return { path: '/', secure, sameSite: 'lax', httpOnly: true, maxAge: 0 }
}

/**
 * A new CSRF token.
 *
 * @returns {string} 256 bits, base64url.
 */
export function issueCsrfToken() {
  return randomBytes(32).toString('base64url')
}

/**
 * Whether the echoed CSRF token matches the cookie.
 *
 * @param {string|undefined|null} cookieValue The value from the CSRF cookie.
 * @param {string|undefined|null} headerValue The value echoed in the header.
 * @returns {boolean} True when both are present and identical.
 */
export function csrfTokenMatches(cookieValue, headerValue) {
  if (typeof cookieValue !== 'string' || typeof headerValue !== 'string') return false
  if (cookieValue.length === 0 || cookieValue.length !== headerValue.length) return false

  return timingSafeEqual(Buffer.from(cookieValue, 'utf8'), Buffer.from(headerValue, 'utf8'))
}

/**
 * The origin a request claims to come from.
 *
 * `Origin` is the right header and is sent on every cross-origin request that
 * can change state. `Referer` is the fallback, reduced to its origin, for the
 * cases where `Origin` is absent. Both are attacker-controlled in the sense that
 * a non-browser client can say anything — which is fine, because the threat this
 * addresses is a *browser* being made to send a request, and a browser sets these
 * itself.
 *
 * @param {Record<string, string|string[]|undefined>} headers The request headers.
 * @returns {{origin: string|null, source: string|null}} The origin and which header it came from.
 */
export function requestOrigin(headers) {
  const read = (name) => {
    const value = headers?.[name]
    const single = Array.isArray(value) ? value[0] : value

    return typeof single === 'string' && single.trim() !== '' ? single.trim() : null
  }

  const origin = read('origin')

  // Firefox and some privacy tooling send the literal "null" for a request from
  // an opaque origin — a sandboxed iframe or a `data:` document. That is not a
  // trustworthy origin and must not be treated as one.
  if (origin && origin !== 'null') return { origin, source: 'origin' }

  const referer = read('referer')

  if (referer) {
    try {
      return { origin: new URL(referer).origin, source: 'referer' }
    } catch {
      return { origin: null, source: 'referer' }
    }
  }

  return { origin: null, source: null }
}

/**
 * Whether a state-changing request may proceed.
 *
 * The rules, in order:
 *
 *   - A safe method is always allowed. Nothing behind a safe method changes
 *     state, which is a property the API contract enforces separately.
 *   - A request with no origin and no referer is allowed *only* when it carries
 *     no cookie authority. A server-to-server caller with a bearer token sends
 *     neither header and is not a CSRF risk, because nothing is attached on its
 *     behalf. A cookie-authenticated request with no origin is refused.
 *   - Otherwise the origin must be one this deployment expects.
 *
 * @param {object} request A description of the request.
 * @param {string} request.method The HTTP method.
 * @param {Record<string, string|string[]|undefined>} request.headers The headers.
 * @param {boolean} [request.cookieAuthenticated] Whether the caller's authority came from a cookie.
 * @param {string[]} allowedOrigins Origins this deployment serves.
 * @returns {{allowed: boolean, reason: string|null, origin: string|null}} The decision.
 */
export function checkOrigin({ method, headers, cookieAuthenticated = true }, allowedOrigins) {
  if (SAFE_METHODS.has(String(method).toUpperCase())) {
    return { allowed: true, reason: null, origin: null }
  }

  const { origin } = requestOrigin(headers)

  if (origin === null) {
    return cookieAuthenticated
      ? { allowed: false, reason: 'origin_missing', origin: null }
      : { allowed: true, reason: null, origin: null }
  }

  if (!allowedOrigins.includes(origin)) {
    return { allowed: false, reason: 'origin_not_allowed', origin }
  }

  return { allowed: true, reason: null, origin }
}

/**
 * The origins a deployment serves, derived from its configured URLs.
 *
 * Derived rather than configured separately, so there is no second list to fall
 * out of date with the first. Each URL is reduced to its origin, which is what a
 * browser sends.
 *
 * @param {string[]} urls Configured site and API URLs.
 * @returns {string[]} Distinct origins, in the order first seen.
 */
export function allowedOriginsFrom(urls) {
  const origins = []

  for (const url of urls) {
    if (typeof url !== 'string' || url.trim() === '') continue

    try {
      const { origin } = new URL(url)
      if (!origins.includes(origin)) origins.push(origin)
    } catch {
      // A malformed configured URL contributes no origin. Validation elsewhere
      // is what complains about it; silently widening the allow-list would be
      // the wrong way to react to it here.
    }
  }

  return origins
}
