import { describe, expect, it } from 'vitest'

import { currentHref } from './active-path.js'

const DISCOVER = [
  { href: '/events' },
  { href: '/events?category=GARBA_DANDIYA' },
  { href: '/events?category=MUSIC_CONCERT' },
  { href: '/events?category=COMEDY' },
]

describe('currentHref', () => {
  it('marks only the category the page is filtered to, not every link to /events', () => {
    expect(currentHref(DISCOVER, '/events', new URLSearchParams('category=COMEDY'))).toBe(
      '/events?category=COMEDY',
    )
  })

  it('marks the unfiltered entry when no category is chosen', () => {
    expect(currentHref(DISCOVER, '/events', new URLSearchParams(''))).toBe('/events')
  })

  it('ignores parameters an entry does not ask about', () => {
    expect(
      currentHref(DISCOVER, '/events', new URLSearchParams('category=COMEDY&city=Toronto')),
    ).toBe('/events?category=COMEDY')
  })

  it('marks the plain entry on a page beneath it', () => {
    expect(currentHref(DISCOVER, '/events/garba-night', null)).toBe('/events')
  })

  it('prefers the longer path when two entries both contain the page', () => {
    const items = [{ href: '/finance' }, { href: '/finance/connect' }]

    expect(currentHref(items, '/finance/connect', null)).toBe('/finance/connect')
    expect(currentHref(items, '/finance', null)).toBe('/finance')
  })

  it('marks nothing on a page no entry contains', () => {
    expect(currentHref(DISCOVER, '/tickets', null)).toBeNull()
    expect(currentHref(DISCOVER, null, null)).toBeNull()
  })

  it('never marks more than one entry', () => {
    const search = new URLSearchParams('category=GARBA_DANDIYA')
    const current = DISCOVER.filter(
      (item) => currentHref(DISCOVER, '/events', search) === item.href,
    )

    expect(current).toHaveLength(1)
  })
})
