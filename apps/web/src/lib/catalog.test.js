import { describe, expect, it } from 'vitest'

import {
  EVENT_CATEGORIES,
  categoriesWithEvents,
  categoryDescriptor,
  categoryLabel,
  citiesWithEvents,
  filterEvents,
  sortByStartDate,
} from './catalog.js'

/**
 * Build a minimal event summary for a filtering test.
 *
 * @param {object} overrides Fields to override on the base summary.
 * @returns {object} An event summary.
 */
function summary(overrides = {}) {
  return {
    id: 'evtbasesample01',
    title: 'Navratri Raas Garba',
    summary: 'Nine nights of raas on the GMDC ground.',
    slug: 'navratri-raas-garba',
    category: 'GARBA_DANDIYA',
    city: 'Ahmedabad',
    venueName: 'GMDC Ground',
    organizationName: 'Navrang Utsav Samiti',
    startsAt: '2026-10-11T13:30:00.000Z',
    ...overrides,
  }
}

describe('categoryDescriptor', () => {
  it('returns the descriptor for a known category', () => {
    expect(categoryDescriptor('GARBA_DANDIYA').label).toBe('Garba & Dandiya')
  })

  it('falls back to a neutral descriptor rather than throwing on an unknown category', () => {
    const descriptor = categoryDescriptor('QAWWALI_BATTLE_ROYALE')

    expect(descriptor.label).toBe('Event')
    expect(descriptor.glyph).toBeTruthy()
  })

  it('covers every category the API enum defines', () => {
    const values = EVENT_CATEGORIES.map((category) => category.value)

    expect(values).toEqual(
      expect.arrayContaining([
        'MUSIC_CONCERT',
        'GARBA_DANDIYA',
        'BOLLYWOOD_NIGHT',
        'CLASSICAL_DANCE',
        'COMEDY',
        'FILM_SCREENING',
        'CULTURAL_FESTIVAL',
        'FOOD_FESTIVAL',
        'WEDDING_EXPO',
        'RELIGIOUS',
        'THEATRE',
        'WORKSHOP',
        'NETWORKING',
        'SPORTS',
      ]),
    )
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('categoryLabel', () => {
  it('reads a human label rather than the enum member', () => {
    expect(categoryLabel('BOLLYWOOD_NIGHT')).toBe('Bollywood Nights')
  })
})

describe('filterEvents', () => {
  const events = [
    summary(),
    summary({ id: 'evtcomedylondon1', category: 'COMEDY', city: 'London', title: 'Desi Comedy Uncensored' }),
    summary({ id: 'evtbollytoronto1', category: 'BOLLYWOOD_NIGHT', city: 'Toronto', title: 'Retro Rewind' }),
  ]

  it('returns everything when no filter is set', () => {
    expect(filterEvents(events)).toHaveLength(3)
  })

  it('narrows by category', () => {
    expect(filterEvents(events, { category: 'COMEDY' }).map((event) => event.city)).toEqual(['London'])
  })

  it('narrows by exact city', () => {
    expect(filterEvents(events, { city: 'Toronto' })).toHaveLength(1)
    expect(filterEvents(events, { city: 'toronto' })).toHaveLength(0)
  })

  it('requires every search term to match, across any searchable field', () => {
    expect(filterEvents(events, { q: 'garba ahmedabad' })).toHaveLength(1)
    expect(filterEvents(events, { q: 'garba london' })).toHaveLength(0)
  })

  it('matches the category label as well as the stored fields', () => {
    expect(filterEvents(events, { q: 'bollywood' })).toHaveLength(1)
  })

  it('ignores surrounding whitespace and case in the query', () => {
    expect(filterEvents(events, { q: '  COMEDY  ' })).toHaveLength(1)
  })

  it('combines filters with AND', () => {
    expect(filterEvents(events, { category: 'COMEDY', city: 'Toronto' })).toHaveLength(0)
  })

  it('treats a missing list as empty', () => {
    expect(filterEvents(undefined, { city: 'London' })).toEqual([])
  })
})

describe('categoriesWithEvents', () => {
  it('only offers categories that have events, and counts them', () => {
    const result = categoriesWithEvents([
      summary(),
      summary({ id: 'evtgarbatwo0001' }),
      summary({ id: 'evtcomedyone001', category: 'COMEDY' }),
    ])

    expect(result.map((category) => [category.value, category.count])).toEqual([
      ['GARBA_DANDIYA', 2],
      ['COMEDY', 1],
    ])
  })

  it('preserves the editorial browsing order rather than event order', () => {
    const result = categoriesWithEvents([
      summary({ category: 'COMEDY' }),
      summary({ id: 'evtgarbaorder01', category: 'GARBA_DANDIYA' }),
    ])

    expect(result.map((category) => category.value)).toEqual(['GARBA_DANDIYA', 'COMEDY'])
  })
})

describe('citiesWithEvents', () => {
  it('lists unique cities alphabetically and drops blanks', () => {
    const cities = citiesWithEvents([
      summary({ city: 'Toronto' }),
      summary({ city: 'Ahmedabad' }),
      summary({ city: 'Toronto' }),
      summary({ city: null }),
    ])

    expect(cities).toEqual(['Ahmedabad', 'Toronto'])
  })
})

describe('sortByStartDate', () => {
  it('orders soonest first without mutating the input', () => {
    const events = [
      summary({ id: 'evtlatersample1', startsAt: '2026-12-01T00:00:00.000Z' }),
      summary({ id: 'evtsoonersample', startsAt: '2026-10-01T00:00:00.000Z' }),
    ]
    const sorted = sortByStartDate(events)

    expect(sorted.map((event) => event.id)).toEqual(['evtsoonersample', 'evtlatersample1'])
    expect(events[0].id).toBe('evtlatersample1')
  })
})
