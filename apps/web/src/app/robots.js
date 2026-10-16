/**
 * `robots.txt`, served at `/robots.txt`.
 *
 * What it says: crawl the public site — the home page, the listings, every
 * event, venue, organiser and category page — and find all of them through
 * the sitemap. Leave alone everything a visitor has to sign in to use, the
 * API proxy, and the steps of buying a ticket, which are one visitor's basket
 * rather than a page anybody could land on from a search.
 *
 * What it is not: a lock. Every signed-in area is closed by its layout and
 * by the API whatever a crawler does, and the signed-in layouts already say
 * `noindex`. This only saves a well-behaved crawler the trip, and keeps
 * checkout and seat-picker URLs, with their query strings, out of results.
 *
 * @module app/robots
 */

import { COURTYARD_AREAS } from '../lib/register.js'

/** Where this deployment is served from. Mirrors the root layout. */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://127.0.0.1:3000'

/**
 * Paths no crawler needs: every signed-in area, the API, and the buying steps
 * under an event.
 *
 * A robots.txt rule is a prefix, so `/organizer` alone would also close the
 * public organiser profiles at `/organizers/…`. Each area is therefore two
 * rules: the page itself, anchored with `$`, and everything under it, after
 * its slash.
 */
export const DISALLOWED = Object.freeze([
  ...COURTYARD_AREAS.flatMap((area) => [`${area}$`, `${area}/`]),
  '/api/',
  '/events/*/checkout',
  '/events/*/seats/',
])

/**
 * The rules.
 *
 * @returns {object} Next's robots shape.
 */
export default function robots() {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [...DISALLOWED] }],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  }
}
