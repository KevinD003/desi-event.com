/**
 * Where to send somebody after they sign in.
 *
 * A `next` parameter is how a deep link survives the trip through sign-in: a
 * person who opened `/tickets/abc` signed out should land back on
 * `/tickets/abc`, not at the top of the site. It is also the classic open
 * redirect. Whatever a link put in `next` is handed to `redirect()`, and a
 * value that leaves the site turns the sign-in page into somebody else's
 * phishing hop with this site's name on it.
 *
 * So only a path on this site is accepted, and "a path on this site" is
 * checked the way a browser will read it rather than the way it looks:
 *
 * - `//evil.example` is protocol-relative: another host.
 * - `/\evil.example` becomes `//evil.example` in every browser, because the
 *   URL parser treats a backslash as a slash in an http(s) path.
 * - `/\t/evil.example` and `/\n/evil.example` become `//evil.example`, because
 *   the parser strips tabs and newlines before it reads the URL.
 * - `/.//evil.example`, `/%2e%2e//evil.example` and `/a/..//evil.example`
 *   become `//evil.example`, because the parser collapses dot segments, plain
 *   or percent-encoded. Only the resolved path shows it.
 *
 * The check before Phase 4 caught the first and let the others through.
 *
 * The links to sign in and to create an account carry `next` the same way,
 * through `signInHref` and `registerHref`. Drawn on sign-in or account
 * creation itself — the header is on every page — they carry the destination
 * that page already has, rather than the page.
 *
 * @module lib/next-path
 */

/** Where somebody goes when there is no usable `next`: their own account. */
export const DEFAULT_NEXT_PATH = '/account'

/** Longer than any path this site serves, and short enough to not be a payload. */
const MAX_LENGTH = 512

/** The throwaway origin a path is resolved against; never served. */
const ORIGIN = 'https://desi-event.invalid'

/** Where somebody signs in or makes an account: never a place to come back to. */
const AUTH_PAGES = Object.freeze(['/sign-in', '/register'])

/**
 * The page for an address that could not be read (`src/proxy.js`): never a
 * place to come back to either. The server renders it at its own path and
 * the browser shows the unreadable one, so carrying either as `next` would
 * also draw two different sign-in links for one page.
 */
const DEAD_ENDS = Object.freeze(['/bad-address'])

/**
 * Whether a path leads nowhere worth returning to: a dead end, or a path
 * whose percent-escapes do not decode.
 *
 * @param {string} path The path, query and all.
 * @param {URL} resolved It, resolved.
 * @returns {boolean} True when it is not a place to come back to.
 */
function isDeadEnd(path, resolved) {
  if (DEAD_ENDS.includes(resolved.pathname)) return true

  try {
    decodeURIComponent(path.split(/[?#]/u)[0])

    return false
  } catch {
    return true
  }
}

/**
 * Whether a pathname is sign-in or account creation, or somewhere under them.
 *
 * @param {string} pathname A resolved pathname.
 * @returns {boolean} True for an auth page.
 */
function isAuthPage(pathname) {
  return AUTH_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`))
}

/**
 * A value resolved as a path on this site, or nothing.
 *
 * @param {unknown} value Untrusted.
 * @returns {URL|null} The value resolved against `ORIGIN`, when it stays there.
 */
function sameSite(value) {
  if (typeof value !== 'string') return null
  if (value.length === 0 || value.length > MAX_LENGTH) return null
  if (!value.startsWith('/')) return null

  // Anything a URL parser would strip or rewrite is refused outright rather
  // than cleaned: a `next` that needs cleaning did not come from this site.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null
  if (value.startsWith('//')) return null

  // Resolve it against a throwaway origin and insist nothing moved. This is
  // the browser's own reading, so it catches whatever the checks above did
  // not think of.
  let resolved

  try {
    resolved = new URL(value, ORIGIN)
  } catch {
    return null
  }

  if (resolved.origin !== ORIGIN) return null

  // The origin cannot move, but the path still can: dot segments collapse
  // `/.//evil.example` to `//evil.example`, which is what would be handed on.
  if (resolved.pathname.startsWith('//')) return null

  return resolved
}

/**
 * A same-site path to continue to, or the default.
 *
 * @param {unknown} value A `next` query parameter, untrusted.
 * @param {string} [fallback] Where to go when the value is not usable.
 * @returns {string} A path beginning with a single `/`.
 */
export function safeNextPath(value, fallback = DEFAULT_NEXT_PATH) {
  const resolved = sameSite(value)

  if (!resolved) return fallback

  // Sending somebody back to sign in after signing in is a loop, not a place.
  if (resolved.pathname === '/sign-in' || resolved.pathname.startsWith('/sign-in/')) return fallback

  return `${resolved.pathname}${resolved.search}${resolved.hash}`
}

/**
 * Where a link to sign in or to create an account should come back to.
 *
 * From an ordinary page, that page. From sign-in or account creation, the
 * `next` that page is already carrying: wrapping the page itself would send
 * somebody back to an auth page they had finished with, and dropping it would
 * lose the checkout they came from. An auth page is never the destination,
 * and neither is the home page, which is where a bare link lands anyway.
 *
 * @param {string|null|undefined} path The page the link is drawn on, untrusted.
 * @returns {string} A same-site path, or `''` when there is nothing to carry.
 */
function returnPath(path) {
  const here = sameSite(path)

  if (!here) return ''
  if (isDeadEnd(path, here)) return ''

  const next = safeNextPath(isAuthPage(here.pathname) ? here.searchParams.get('next') : path, '')

  if (!next || next === '/') return ''
  if (isAuthPage(new URL(next, ORIGIN).pathname)) return ''

  return next
}

/**
 * The sign-in link that comes back to a given path.
 *
 * @param {string|null|undefined} path Where the person was going.
 * @returns {string} `/sign-in`, with `next` when there is somewhere to return to.
 */
export function signInHref(path) {
  const next = returnPath(path)

  return next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'
}

/**
 * The account-creation link that comes back to a given path.
 *
 * The same `next`, under the same rules, as `signInHref`: the register page
 * checks it again with `safeNextPath` and goes there once the account exists.
 *
 * @param {string|null|undefined} path Where the person was going.
 * @returns {string} `/register`, with `next` when there is somewhere to return to.
 */
export function registerHref(path) {
  const next = returnPath(path)

  return next ? `/register?next=${encodeURIComponent(next)}` : '/register'
}
