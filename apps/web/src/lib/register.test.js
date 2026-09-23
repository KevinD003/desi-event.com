import { describe, expect, it } from 'vitest'

import { COURTYARD_AREAS, registerFor } from './register.js'

describe('registerFor', () => {
  it.each(COURTYARD_AREAS)('draws %s and everything under it in the courtyard register', (area) => {
    expect(registerFor(area)).toBe('courtyard')
    expect(registerFor(`${area}/something/deeper`)).toBe('courtyard')
  })

  it.each([
    '/',
    '/events',
    '/events/garba-night',
    '/events/garba-night/checkout',
    '/sign-in',
    '/venues/rangoli-hall',
  ])('keeps the public page %s editorial', (pathname) => {
    expect(registerFor(pathname)).toBe('editorial')
  })

  it('keeps the public organiser profile editorial, though it shares a prefix with the workspace', () => {
    expect(registerFor('/organizer/events')).toBe('courtyard')
    expect(registerFor('/organizers/rangoli-collective')).toBe('editorial')
  })

  it('does not treat a lookalike path as a signed-in area', () => {
    expect(registerFor('/tickets-and-passes')).toBe('editorial')
    expect(registerFor('/privacy-policy')).toBe('editorial')
  })

  it('falls back to editorial when the path is unknown', () => {
    expect(registerFor(null)).toBe('editorial')
    expect(registerFor(undefined)).toBe('editorial')
  })
})
