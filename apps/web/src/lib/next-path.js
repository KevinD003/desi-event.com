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
 *
 * The check before Phase 4 caught the first and let the others through.
 *
 * @module lib/next-path
 */

/** Where somebody goes when there is no usable `next`: their own account. */
export const DEFAULT_NEXT_PATH = '/account'

/** Longer than any path this site serves, and short enough to not be a payload. */
const MAX_LENGTH = 512

/**
 * A same-site path to continue to, or the default.
 *
 * @param {unknown} value A `next` query parameter, untrusted.
 * @param {string} [fallback] Where to go when the value is not usable.
 * @returns {string} A path beginning with a single `/`.
 */
export function safeNextPath(value, fallback = DEFAULT_NEXT_PATH) {
  if (typeof value !== 'string') return fallback
  if (value.length === 0 || value.length > MAX_LENGTH) return fallback
  if (!value.startsWith('/')) return fallback

  // Anything a URL parser would strip or rewrite is refused outright rather
  // than cleaned: a `next` that needs cleaning did not come from this site.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback
  if (value.startsWith('//')) return fallback

  // Resolve it against a throwaway origin and insist nothing moved. This is
  // the browser's own reading, so it catches whatever the checks above did
  // not think of.
  let resolved

  try {
    resolved = new URL(value, 'https://desi-event.invalid')
  } catch {
    return fallback
  }

  if (resolved.origin !== 'https://desi-event.invalid') return fallback

  // Sending somebody back to sign in after signing in is a loop, not a place.
  if (resolved.pathname === '/sign-in' || resolved.pathname.startsWith('/sign-in/')) return fallback

  return `${resolved.pathname}${resolved.search}${resolved.hash}`
}

/**
 * The sign-in link that comes back to a given path.
 *
 * @param {string|null|undefined} path Where the person was going.
 * @returns {string} `/sign-in`, with `next` when there is somewhere to return to.
 */
export function signInHref(path) {
  const next = safeNextPath(path, '')

  if (!next || next === '/') return '/sign-in'

  return `/sign-in?next=${encodeURIComponent(next)}`
}
