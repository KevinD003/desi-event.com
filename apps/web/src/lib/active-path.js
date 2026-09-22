/**
 * Which navigation entry is the current one.
 *
 * Its own module, and deliberately so. The client component that renders the
 * navigation needs this function and nothing else from the navigation layer;
 * `lib/navigation.js` reaches `lib/session.js`, which imports `next/headers`,
 * and a client component that transitively imports `next/headers` fails the
 * build. Splitting the pure predicate out keeps the browser bundle free of the
 * server-only read while leaving one implementation of the rule.
 *
 * @module lib/active-path
 */

/**
 * Whether a path is the active one, for `aria-current`.
 *
 * Prefix matching, so `/organizer/events/abc` still marks the `Events` entry —
 * but anchored at a segment boundary, because a naive `startsWith` would let
 * `/privacy-policy` light up `/privacy`. The root is compared exactly for the
 * same reason: every path starts with a slash.
 *
 * @param {string} href The entry's destination, query string and all.
 * @param {string|null|undefined} pathname The current path.
 * @returns {boolean} True when the entry should be marked current.
 */
export function isActivePath(href, pathname) {
  if (!pathname) return false

  const target = href.split('?')[0]

  if (target === '/') return pathname === '/'
  if (pathname === target) return true

  return pathname.startsWith(`${target}/`)
}
