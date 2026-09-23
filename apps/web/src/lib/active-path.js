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

/**
 * The one entry, out of a list, that names the current page.
 *
 * `isActivePath` ignores the query string, which is right for a single link
 * and wrong for a row of them: "All events", "Garba" and "Comedy" all point at
 * `/events`, and before Phase 4 all three carried `aria-current="page"` on
 * every events page — a screen reader was told it was in three places at once.
 *
 * So among the entries whose path matches, the one whose query parameters are
 * all present in the current URL, with the most of them, wins; ties go to the
 * longer path. At most one entry is ever current.
 *
 * @param {ReadonlyArray<{href: string}>} items The entries.
 * @param {string|null|undefined} pathname The current path.
 * @param {URLSearchParams|{get: function(string): (string|null)}|null} [search] The current query.
 * @returns {string|null} The href of the current entry, or null when none is.
 */
export function currentHref(items, pathname, search = null) {
  let best = null
  let bestScore = -1

  for (const item of items) {
    if (!isActivePath(item.href, pathname)) continue

    const [path, query = ''] = item.href.split('?')
    const wanted = [...new URLSearchParams(query)]
    const satisfied = wanted.every(([key, value]) => search?.get?.(key) === value)

    if (!satisfied) continue

    // More matched parameters beat fewer; a longer path beats a shorter one.
    const score = wanted.length * 1000 + path.length

    if (score > bestScore) {
      best = item.href
      bestScore = score
    }
  }

  return best
}
