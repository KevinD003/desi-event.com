import { describe, expect, it } from 'vitest'

import { DEFAULT_NEXT_PATH, safeNextPath, signInHref } from './next-path.js'

describe('safeNextPath', () => {
  it.each([
    '/tickets',
    '/tickets/ckl1a2b3c4d5e6f7g8h9i0ja',
    '/events?category=COMEDY&city=Toronto',
    '/organizer/events/abc#tiers',
  ])('keeps the same-site path %s', (path) => {
    expect(safeNextPath(path)).toBe(path)
  })

  it.each([
    ['protocol-relative', '//evil.example/phish'],
    ['backslash, which a browser reads as a slash', '/\\evil.example'],
    ['backslash after the slash', '/\\/evil.example'],
    ['a tab the URL parser strips', '/\t/evil.example'],
    ['a newline the URL parser strips', '/\n/evil.example'],
    ['a carriage return', '/\r/evil.example'],
    ['an absolute URL', 'https://evil.example/'],
    ['a scheme with no slashes', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,hello'],
    ['a relative path', 'tickets'],
    ['an empty string', ''],
    ['a path too long to be one', `/${'a'.repeat(600)}`],
    ['a NUL byte', '/tickets\u0000'],
  ])('refuses %s', (_name, value) => {
    expect(safeNextPath(value)).toBe(DEFAULT_NEXT_PATH)
  })

  it.each([undefined, null, 42, ['/tickets'], { next: '/tickets' }])(
    'refuses a value that is not a string: %j',
    (value) => {
      expect(safeNextPath(value)).toBe(DEFAULT_NEXT_PATH)
    },
  )

  it('does not send somebody back to sign in after they have signed in', () => {
    expect(safeNextPath('/sign-in')).toBe(DEFAULT_NEXT_PATH)
    expect(safeNextPath('/sign-in?next=/tickets')).toBe(DEFAULT_NEXT_PATH)
  })

  it('returns the path as the browser would resolve it, dot segments and all', () => {
    expect(safeNextPath('/tickets/../account')).toBe('/account')
  })

  it('takes a caller-supplied fallback', () => {
    expect(safeNextPath('//evil.example', '/events')).toBe('/events')
  })

  it('lands on the account page by default, not the organiser workspace', () => {
    // Before Phase 4 the default was `/organizer/events`, so an attendee who
    // signed in from the header was dropped into a workspace they had no use
    // for.
    expect(DEFAULT_NEXT_PATH).toBe('/account')
  })
})

describe('signInHref', () => {
  it('carries the page somebody was on', () => {
    expect(signInHref('/tickets/abc')).toBe('/sign-in?next=%2Ftickets%2Fabc')
  })

  it('keeps the query, encoded', () => {
    expect(signInHref('/events?city=Toronto')).toBe('/sign-in?next=%2Fevents%3Fcity%3DToronto')
  })

  it('adds nothing for the home page or an unusable path', () => {
    expect(signInHref('/')).toBe('/sign-in')
    expect(signInHref(null)).toBe('/sign-in')
    expect(signInHref('//evil.example')).toBe('/sign-in')
  })
})
