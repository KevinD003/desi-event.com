import { describe, expect, it } from 'vitest'

import { DEFAULT_NEXT_PATH, registerHref, safeNextPath, signInHref } from './next-path.js'

/**
 * Paths that start with one slash but resolve to two: the URL parser collapses
 * the dot segments, plain or percent-encoded, and leaves `//evil.example`,
 * which a browser reads as another host.
 */
const DOT_SEGMENT_ESCAPES = [
  '/.//evil.example',
  '/..//evil.example',
  '/%2e//evil.example',
  '/%2E%2E//evil.example',
  '/a/..//evil.example',
]

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

  it.each(DOT_SEGMENT_ESCAPES)('refuses %s, which resolves to another host', (value) => {
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

  it('from sign-in or account creation, carries the destination that page already has', () => {
    // The header's "Sign in" is drawn on both pages. Wrapping the page itself
    // in `next` would send somebody back to an auth page they had finished
    // with; dropping it would lose the checkout they came from.
    expect(signInHref('/sign-in?next=%2Ftickets')).toBe('/sign-in?next=%2Ftickets')
    expect(signInHref('/register?next=%2Fevents%2Fqawwali%2Fcheckout')).toBe(
      '/sign-in?next=%2Fevents%2Fqawwali%2Fcheckout',
    )
    expect(signInHref('/register')).toBe('/sign-in')
  })

  it('drops an auth page’s own next when it would leave the site or loop', () => {
    expect(signInHref('/register?next=%2F%2Fevil.example')).toBe('/sign-in')
    expect(signInHref('/sign-in?next=%2Fregister%3Fnext%3D%252Ftickets')).toBe('/sign-in')
  })

  it.each(DOT_SEGMENT_ESCAPES)(
    'carries nothing for %s, which resolves to another host',
    (value) => {
      expect(signInHref(value)).toBe('/sign-in')
      expect(signInHref(`/register?next=${encodeURIComponent(value)}`)).toBe('/sign-in')
    },
  )
})

describe('registerHref', () => {
  it('carries the page somebody was on, the way sign-in does', () => {
    expect(registerHref('/tickets/abc')).toBe('/register?next=%2Ftickets%2Fabc')
  })

  it('keeps the query, encoded', () => {
    expect(registerHref('/events?city=Toronto')).toBe('/register?next=%2Fevents%3Fcity%3DToronto')
  })

  it('adds nothing for the home page or an unusable path', () => {
    expect(registerHref('/')).toBe('/register')
    expect(registerHref(null)).toBe('/register')
    expect(registerHref(undefined)).toBe('/register')
    expect(registerHref('//evil.example')).toBe('/register')
    expect(registerHref('/\\evil.example')).toBe('/register')
    expect(registerHref('https://evil.example/')).toBe('/register')
  })

  it('from sign-in or account creation, carries the destination that page already has', () => {
    // The same `next` the sign-in page's own "Create an account" link carries.
    expect(registerHref('/sign-in?next=%2Fevents%2Fqawwali%2Fcheckout')).toBe(
      '/register?next=%2Fevents%2Fqawwali%2Fcheckout',
    )
    expect(registerHref('/register?next=%2Ftickets')).toBe('/register?next=%2Ftickets')
    expect(registerHref('/sign-in')).toBe('/register')
    expect(registerHref('/register/')).toBe('/register')
  })

  it('never nests an auth page, or an off-site one, inside next', () => {
    expect(registerHref('/sign-in?next=%2F%2Fevil.example')).toBe('/register')
    expect(registerHref('/register?next=%2Fsign-in')).toBe('/register')
    expect(registerHref('/sign-in?next=%2Fregister%3Fnext%3D%252Ftickets')).toBe('/register')
  })

  it.each(DOT_SEGMENT_ESCAPES)(
    'carries nothing for %s, which resolves to another host',
    (value) => {
      expect(registerHref(value)).toBe('/register')
      expect(registerHref(`/sign-in?next=${encodeURIComponent(value)}`)).toBe('/register')
    },
  )
})
