import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PER_PAGE,
  buildEventsHref,
  hasActiveFilters,
  paginate,
  parseEventFilters,
} from './search-params.js'

describe('parseEventFilters', () => {
  it('defaults to an unfiltered first page', () => {
    expect(parseEventFilters()).toEqual({
      category: '',
      city: '',
      q: '',
      page: 1,
      perPage: DEFAULT_PER_PAGE,
    })
  })

  it('reads and upper-cases a known category', () => {
    expect(parseEventFilters({ category: 'comedy' }).category).toBe('COMEDY')
  })

  it('drops a category the front end has no option for', () => {
    expect(parseEventFilters({ category: 'INTERPRETIVE_BHANGRA' }).category).toBe('')
  })

  it('takes the first value when a parameter is repeated', () => {
    expect(parseEventFilters({ city: ['Mumbai', 'London'] }).city).toBe('Mumbai')
  })

  it('trims the free-text query', () => {
    expect(parseEventFilters({ q: '  garba toronto  ' }).q).toBe('garba toronto')
  })

  it('caps an over-long query at the length the API accepts', () => {
    expect(parseEventFilters({ q: 'x'.repeat(500) }).q).toHaveLength(120)
  })

  it('ignores a page that is not a positive integer', () => {
    expect(parseEventFilters({ page: '0' }).page).toBe(1)
    expect(parseEventFilters({ page: '-3' }).page).toBe(1)
    expect(parseEventFilters({ page: 'three' }).page).toBe(1)
  })

  it('clamps an absurd page size instead of asking the API for it', () => {
    expect(parseEventFilters({ perPage: '5000' }).perPage).toBe(48)
  })

  it('ignores non-string values that a query string cannot actually produce', () => {
    expect(parseEventFilters({ city: 42 }).city).toBe('')
  })
})

describe('buildEventsHref', () => {
  it('keeps the canonical listing URL clean when nothing is filtered', () => {
    expect(buildEventsHref()).toBe('/events')
    expect(buildEventsHref({ category: '', city: '', q: '', page: 1 })).toBe('/events')
  })

  it('encodes the active filters', () => {
    expect(buildEventsHref({ category: 'COMEDY', city: 'London' })).toBe(
      '/events?category=COMEDY&city=London',
    )
  })

  it('percent-encodes a query with spaces', () => {
    expect(buildEventsHref({ q: 'garba toronto' })).toBe('/events?q=garba+toronto')
  })

  it('omits page 1 and the default page size', () => {
    expect(buildEventsHref({ page: 1, perPage: DEFAULT_PER_PAGE })).toBe('/events')
    expect(buildEventsHref({ page: 3 })).toBe('/events?page=3')
  })

  it('round-trips through parseEventFilters', () => {
    const filters = { category: 'GARBA_DANDIYA', city: 'Ahmedabad', q: 'raas', page: 2 }
    const href = buildEventsHref(filters)
    const search = Object.fromEntries(new URL(href, 'https://example.test').searchParams)

    expect(parseEventFilters(search)).toMatchObject(filters)
  })
})

describe('hasActiveFilters', () => {
  it('ignores paging, which is not a filter', () => {
    expect(hasActiveFilters({ page: 4 })).toBe(false)
    expect(hasActiveFilters({ q: 'garba' })).toBe(true)
    expect(hasActiveFilters()).toBe(false)
  })
})

describe('paginate', () => {
  const events = Array.from({ length: 25 }, (_unused, index) => ({ id: `event-${index}` }))

  it('slices the requested page and reports the counters', () => {
    const { items, pagination } = paginate(events, { page: 2, perPage: 10 })

    expect(items.map((event) => event.id)).toEqual(
      Array.from({ length: 10 }, (_unused, index) => `event-${index + 10}`),
    )
    expect(pagination).toEqual({
      page: 2,
      perPage: 10,
      total: 25,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    })
  })

  it('returns a short final page', () => {
    expect(paginate(events, { page: 3, perPage: 10 }).items).toHaveLength(5)
  })

  it('clamps a page past the end back onto the last page rather than showing nothing', () => {
    const { items, pagination } = paginate(events, { page: 99, perPage: 10 })

    expect(items).toHaveLength(5)
    expect(pagination.page).toBe(3)
    expect(pagination.hasNextPage).toBe(false)
  })

  it('handles an empty catalogue without claiming a page zero', () => {
    const { items, pagination } = paginate([], { page: 1, perPage: 10 })

    expect(items).toEqual([])
    expect(pagination).toMatchObject({ page: 1, total: 0, totalPages: 0, hasPreviousPage: false })
  })
})
