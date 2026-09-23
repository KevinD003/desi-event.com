/**
 * Which visual register a page is drawn in.
 *
 * Two registers share one set of token names (see
 * `packages/config/src/tailwind.css`). **Editorial Marigold** is the public
 * site: discovery, event pages, checkout, sign-in. **Quiet Courtyard** is every
 * area somebody signs in to use: their tickets and account, and every organiser
 * and operations screen. The register is a property of the whole page, header
 * and all, so it is decided here from the path and set once on `<body>`.
 *
 * A pure function of the path, with no session read. Which register a page is
 * drawn in says nothing about who may see it — the area layouts and the API
 * decide that — so there is nothing here to get wrong in a way that matters
 * beyond colour.
 *
 * @module lib/register
 */

import { isActivePath } from './active-path.js'

/**
 * The areas drawn in the courtyard register.
 *
 * Matched at a segment boundary, so `/organizer` is courtyard and the public
 * organiser profile at `/organizers/…` is not.
 *
 * @type {ReadonlyArray<string>}
 */
export const COURTYARD_AREAS = Object.freeze([
  '/account',
  '/tickets',
  '/organizer',
  '/analytics',
  '/finance',
  '/operations',
  '/moderation',
  '/privacy',
  '/retention',
])

/**
 * The register for a path.
 *
 * @param {string|null|undefined} pathname The request path, without the query.
 * @returns {'courtyard'|'editorial'} The register.
 */
export function registerFor(pathname) {
  return COURTYARD_AREAS.some((area) => isActivePath(area, pathname)) ? 'courtyard' : 'editorial'
}
