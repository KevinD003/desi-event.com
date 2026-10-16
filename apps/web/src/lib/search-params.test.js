import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PER_PAGE,
  buildEventsHref,
  citiesFor,
  countMoreFilters,
  hasActiveFilters,
  paginate,
  parseEventFilters,
  reconcileFilters,
} from './search-params.js'

/** Facets as `GET /v1/events/facets` answers them, with Springfield in two states. */
const facets = {
  cities: [
    { value: 'Springfield', count: 5 },
    { value: 'Frisco', count: 3 },
    { value: 'Houston', count: 2 },
    { value: 'Toronto', count: 1 },
  ],
  regions: [
    {
      country: 'US',
      region: 'TX',
      name: 'Texas',
      count: 5,
      cities: [
        { value: 'Frisco', count: 3 },
        { value: 'Houston', count: 2 },
      ],
    },
    {
      country: 'US',
      region: 'IL',
      name: 'Illinois',
      count: 3,
      cities: [{ value: 'Springfield', count: 3 }],
    },
    {
      country: 'US',
      region: 'MO',
      name: 'Missouri',
      count: 2,
      cities: [{ value: 'Springfield', count: 2 }],
    },
    {
      country: 'CA',
      region: 'ON',
      name: 'Ontario',
      count: 1,
      cities: [{ value: 'Toronto', count: 1 }],
    },
  ],
  languages: [
    { value: 'Hindi', count: 6 },
    { value: 'Gujarati', count: 4 },
  ],
}

describe('parseEventFilters', () => {
  it('defaults to an unfiltered first page', () => {
    expect(parseEventFilters()).toEqual({
      category: '',
      region: '',
      city: '',
      q: '',
      language: '',
      when: '',
      from: '',
      to: '',
      format: '',
      free: false,
      onSale: false,
      page: 1,
      perPage: DEFAULT_PER_PAGE,
    })
  })

  it('reads a state or province as its whole ISO 3166-2 code, in capitals', () => {
    expect(parseEventFilters({ region: 'us-tx' }).region).toBe('US-TX')
    expect(parseEventFilters({ region: 'CA-ON' }).region).toBe('CA-ON')
    for (const region of ['TX', 'Texas', 'US_TX', 'US-', '-TX', 'USA-TX']) {
      expect(parseEventFilters({ region }).region).toBe('')
    }
  })

  it('reads the format, the switches and a language, and drops what the form cannot send', () => {
    expect(parseEventFilters({ format: 'ONLINE' }).format).toBe('online')
    expect(parseEventFilters({ format: 'in_person' }).format).toBe('in_person')
    expect(parseEventFilters({ format: 'hybrid' }).format).toBe('')
    expect(parseEventFilters({ free: 'true', onSale: 'TRUE' })).toMatchObject({
      free: true,
      onSale: true,
    })
    expect(parseEventFilters({ free: 'yes', onSale: '1' })).toMatchObject({
      free: false,
      onSale: false,
    })
    expect(parseEventFilters({ language: ' Hindi ' }).language).toBe('Hindi')
    expect(parseEventFilters({ language: 'x'.repeat(61) }).language).toBe('')
    expect(parseEventFilters({ language: 'Hin\u0000di' }).language).toBe('')
  })

  it('reads a named span and drops any days beside it', () => {
    for (const when of ['today', 'weekend', 'week', 'month']) {
      expect(parseEventFilters({ when, from: '2026-10-17', to: '2026-10-18' })).toMatchObject({
        when,
        from: '',
        to: '',
      })
    }
    expect(parseEventFilters({ when: 'tonight' }).when).toBe('')
  })

  it('reads days typed in with When left alone as "Choose dates"', () => {
    expect(parseEventFilters({ from: '2026-10-17' })).toMatchObject({
      when: 'dates',
      from: '2026-10-17',
      to: '',
    })
    expect(parseEventFilters({ when: 'dates', to: '2026-10-18' })).toMatchObject({
      when: 'dates',
      from: '',
      to: '2026-10-18',
    })
    // "Choose dates" with no day chosen is still the choice the form shows.
    expect(parseEventFilters({ when: 'dates' })).toMatchObject({ when: 'dates', from: '', to: '' })
  })

  it('drops a day that does not exist and turns a backwards range round', () => {
    expect(parseEventFilters({ from: '2026-02-30', to: '2026-03-02' })).toMatchObject({
      when: 'dates',
      from: '',
      to: '2026-03-02',
    })
    expect(parseEventFilters({ from: '17/10/2026' })).toMatchObject({ when: '', from: '' })
    expect(parseEventFilters({ from: '2026-10-20', to: '2026-10-17' })).toMatchObject({
      from: '2026-10-17',
      to: '2026-10-20',
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

describe('buildEventsHref with every filter', () => {
  it('writes them in one fixed order, so one set of filters is one URL', () => {
    expect(
      buildEventsHref({
        q: 'raas',
        onSale: true,
        free: true,
        format: 'in_person',
        to: '2026-10-18',
        from: '2026-10-17',
        when: 'dates',
        language: 'Hindi',
        city: 'Frisco',
        region: 'US-TX',
        category: 'GARBA_DANDIYA',
      }),
    ).toBe(
      '/events?category=GARBA_DANDIYA&region=US-TX&city=Frisco&language=Hindi&when=dates&from=2026-10-17&to=2026-10-18&format=in_person&free=true&onSale=true&q=raas',
    )
  })

  it('leaves the days out beside a named span, and the switches out when off', () => {
    expect(buildEventsHref({ when: 'weekend', from: '2026-10-17', free: false })).toBe(
      '/events?when=weekend',
    )
  })

  it('round-trips every filter through parseEventFilters', () => {
    const filters = {
      category: 'COMEDY',
      region: 'CA-ON',
      city: 'Toronto',
      q: 'stand-up',
      language: 'Hindi',
      when: 'dates',
      from: '2026-10-17',
      to: '2026-10-18',
      format: 'online',
      free: true,
      onSale: true,
      page: 2,
      perPage: DEFAULT_PER_PAGE,
    }
    const href = buildEventsHref(filters)
    const search = Object.fromEntries(new URL(href, 'https://example.test').searchParams)

    expect(parseEventFilters(search)).toEqual(filters)
  })
})

describe('reconcileFilters', () => {
  const base = parseEventFilters()

  it('keeps a state the catalogue lists, and a city within it', () => {
    expect(
      reconcileFilters({ ...base, region: 'US-IL', city: 'Springfield' }, facets),
    ).toMatchObject({ region: 'US-IL', city: 'Springfield' })
  })

  it('drops a city that is not in the chosen state', () => {
    // What a visitor without JavaScript sends after changing the state.
    expect(reconcileFilters({ ...base, region: 'CA-ON', city: 'Frisco' }, facets)).toMatchObject({
      region: 'CA-ON',
      city: '',
    })
  })

  it('drops a state the catalogue does not list, and keeps a city it does', () => {
    expect(reconcileFilters({ ...base, region: 'US-AK', city: 'Houston' }, facets)).toMatchObject({
      region: '',
      city: 'Houston',
    })
    expect(reconcileFilters({ ...base, city: 'Atlantis' }, facets).city).toBe('')
  })

  it('takes the catalogue’s spelling of a city or a language typed in another case', () => {
    expect(
      reconcileFilters({ ...base, region: 'US-TX', city: 'frisco', language: 'HINDI' }, facets),
    ).toMatchObject({ city: 'Frisco', language: 'Hindi' })
    expect(reconcileFilters({ ...base, language: 'Klingon' }, facets).language).toBe('')
  })

  it('leaves every other filter as it was', () => {
    const filters = { ...base, category: 'COMEDY', when: 'today', free: true, q: 'garba' }

    expect(reconcileFilters(filters, facets)).toEqual(filters)
  })

  it('drops the place filters when there are no facets at all', () => {
    expect(reconcileFilters({ ...base, region: 'US-TX', city: 'Frisco' }, {})).toMatchObject({
      region: '',
      city: '',
    })
  })
})

describe('citiesFor', () => {
  it('lists the chosen state’s cities, A to Z', () => {
    expect(citiesFor(facets, 'US-TX')).toEqual(['Frisco', 'Houston'])
    expect(citiesFor(facets, 'US-MO')).toEqual(['Springfield'])
  })

  it('lists every city once when no state is chosen', () => {
    expect(citiesFor(facets, '')).toEqual(['Frisco', 'Houston', 'Springfield', 'Toronto'])
    expect(citiesFor({}, '')).toEqual([])
  })
})

describe('hasActiveFilters', () => {
  it('ignores paging, which is not a filter', () => {
    expect(hasActiveFilters({ page: 4 })).toBe(false)
    expect(hasActiveFilters({ q: 'garba' })).toBe(true)
    expect(hasActiveFilters()).toBe(false)
  })

  it('counts every filter, a state and the ones behind More filters too', () => {
    for (const filters of [
      { region: 'US-TX' },
      { language: 'Hindi' },
      { when: 'today' },
      { when: 'dates', from: '2026-10-17' },
      { format: 'online' },
      { free: true },
      { onSale: true },
    ]) {
      expect(hasActiveFilters(filters)).toBe(true)
    }
    // "Choose dates" with no day chosen narrows nothing.
    expect(hasActiveFilters({ when: 'dates' })).toBe(false)
  })
})

describe('countMoreFilters', () => {
  it('counts the filters behind the disclosure, and only those', () => {
    expect(countMoreFilters({ category: 'COMEDY', region: 'US-TX', q: 'x' })).toBe(0)
    expect(
      countMoreFilters({
        when: 'week',
        language: 'Hindi',
        format: 'online',
        free: true,
        onSale: true,
      }),
    ).toBe(5)
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
