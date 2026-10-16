import { describe, expect, it } from 'vitest'

import { COURTYARD_AREAS } from '../lib/register.js'
import robots, { DISALLOWED } from './robots.js'

/**
 * Whether a robots.txt rule matches a path, as the Robots Exclusion Protocol
 * (RFC 9309) reads one: a prefix match, `*` for any run of characters, and `$`
 * to anchor the end.
 *
 * @param {string} rule A disallow rule.
 * @param {string} pathname A path.
 * @returns {boolean} True when the rule covers the path.
 */
function covers(rule, pathname) {
  const anchored = rule.endsWith('$')
  const pattern = (anchored ? rule.slice(0, -1) : rule)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  // A rule is matched against the path and its query together.
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(pathname)
}

/** Whether any disallow rule covers a path. */
const blocked = (pathname) => DISALLOWED.some((rule) => covers(rule, pathname))

describe('robots.txt', () => {
  const file = robots()

  it('lets every crawler read the public site and points it at the sitemap', () => {
    expect(file.rules).toHaveLength(1)
    expect(file.rules[0]).toMatchObject({ userAgent: '*', allow: '/' })
    expect(file.sitemap).toMatch(/^https?:\/\/[^/]+\/sitemap\.xml$/)
  })

  it.each(COURTYARD_AREAS)('keeps crawlers out of %s and everything under it', (area) => {
    expect(blocked(area)).toBe(true)
    expect(blocked(`${area}/anything/deeper`)).toBe(true)
  })

  it.each([
    '/',
    '/events',
    '/events?category=GARBA_DANDIYA',
    '/events/navratri-garba-2026',
    '/categories',
    '/venues',
    '/venues/rangoli-hall',
    '/organizers',
    // The public organiser profile shares its first letters with the workspace.
    '/organizers/rangoli-collective',
    '/contact',
    '/limitations',
  ])('leaves the public page %s to be crawled', (pathname) => {
    expect(blocked(pathname)).toBe(false)
  })

  it('keeps the steps of buying a ticket, and the API proxy, out of results', () => {
    expect(blocked('/events/navratri-garba-2026/checkout')).toBe(true)
    expect(blocked('/events/navratri-garba-2026/checkout?tier=early')).toBe(true)
    expect(blocked('/events/navratri-garba-2026/seats/session-1')).toBe(true)
    expect(blocked('/api/v1/events')).toBe(true)
  })

  it('does not mistake a lookalike public path for a signed-in area', () => {
    expect(blocked('/tickets-and-passes')).toBe(false)
    expect(blocked('/privacy-policy')).toBe(false)
  })
})
