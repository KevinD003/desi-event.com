/**
 * The directory helpers answer only from what the API holds.
 *
 * The properties worth pinning:
 *
 *   - **Category counts are the facet's.** Every category is listed, an absent
 *     one reads as nothing listed rather than disappearing, and a payload with
 *     no category list reads as "unknown", never as fourteen empty categories.
 *   - **Venue filters are ones the API accepts.** Unknown claims are dropped,
 *     a seventh is left out and named, and the venue read fails closed —
 *     with no message that names an endpoint, and in words meant for a read
 *     the server made — instead of passing for an empty directory.
 *   - **The organiser derivation is exact about what it read.** Upcoming
 *     listed events in every public status, deduped by slug, counted per
 *     distinct event, sorted by name, bounded to the page limit the API
 *     accepts, and never splices sample organisers into a live directory.
 *
 * @module lib/directory.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_PER_PAGE } from '@desi-event/schemas'

const {
  MAX_ACCESSIBILITY_FILTERS,
  ORGANIZER_SCAN,
  VENUES_PER_PAGE,
  buildVenuesHref,
  categoryCountLabel,
  deriveOrganizers,
  describeCategoryDirectory,
  listableVenues,
  loadVenueDirectory,
  organizerCountLabel,
  parseVenueFilters,
  upcomingEventReader,
  venueAccessibilityLabels,
  venueHasAccessibilityNote,
  venuePlace,
} = await import('./directory.js')

describe('describeCategoryDirectory', () => {
  it('lists every category with the facet count, and zero for one the facet omits', () => {
    const { categories, countsKnown } = describeCategoryDirectory({
      categories: [
        { value: 'COMEDY', count: 12 },
        { value: 'GARBA_DANDIYA', count: 1 },
      ],
    })

    expect(countsKnown).toBe(true)
    expect(categories).toHaveLength(14)

    const byValue = Object.fromEntries(categories.map((entry) => [entry.value, entry]))

    expect(byValue.COMEDY.count).toBe(12)
    expect(byValue.GARBA_DANDIYA.count).toBe(1)
    expect(byValue.THEATRE.count).toBe(0)
    expect(byValue.COMEDY.href).toBe('/events?category=COMEDY')
    expect(byValue.THEATRE.href).toBe('/events?category=THEATRE')
  })

  it('keeps editorial order rather than ranking by count', () => {
    const { categories } = describeCategoryDirectory({
      categories: [
        { value: 'SPORTS', count: 900 },
        { value: 'GARBA_DANDIYA', count: 1 },
      ],
    })

    expect(categories[0].value).toBe('GARBA_DANDIYA')
    expect(categories.at(-1).value).toBe('SPORTS')
  })

  it('reports unknown counts, not zero counts, when the facet has no category list', () => {
    const { categories, countsKnown } = describeCategoryDirectory({ cities: [] })

    expect(countsKnown).toBe(false)
    expect(categories.every((entry) => entry.count === null)).toBe(true)
  })

  it('leaves out a facet value the listing could not filter by', () => {
    const { categories } = describeCategoryDirectory({
      categories: [{ value: 'NOT_A_CATEGORY', count: 4 }],
    })

    expect(categories.map((entry) => entry.value)).not.toContain('NOT_A_CATEGORY')
  })
})

describe('categoryCountLabel', () => {
  it('words a count, a single event, nothing, and an unknown', () => {
    expect(categoryCountLabel(12)).toBe('12 events')
    expect(categoryCountLabel(1)).toBe('1 event')
    expect(categoryCountLabel(0)).toBe('Nothing listed right now')
    expect(categoryCountLabel(null)).toBeNull()
  })
})

describe('parseVenueFilters', () => {
  it('keeps only claims the API accepts, in vocabulary order', () => {
    const filters = parseVenueFilters({
      city: '  Mumbai ',
      accessibility: ['HEARING_LOOP', 'NOT_A_CLAIM', 'STEP_FREE_ENTRANCE'],
    })

    expect(filters.city).toBe('Mumbai')
    expect(filters.accessibility).toEqual(['STEP_FREE_ENTRANCE', 'HEARING_LOOP'])
    expect(filters.leftOut).toEqual([])
    expect(filters.page).toBe(1)
  })

  it('accepts a single claim sent as a scalar', () => {
    expect(parseVenueFilters({ accessibility: 'LIFT_ACCESS' }).accessibility).toEqual([
      'LIFT_ACCESS',
    ])
  })

  it('applies at most six claims and names the rest instead of sending a request the API refuses', () => {
    const filters = parseVenueFilters({
      accessibility: [
        'STEP_FREE_ENTRANCE',
        'STEP_FREE_TO_SEATING',
        'ACCESSIBLE_TOILET',
        'ACCESSIBLE_PARKING',
        'WHEELCHAIR_SPACES',
        'COMPANION_SEATING',
        'HEARING_LOOP',
        'CAPTIONING',
      ],
    })

    expect(filters.accessibility).toHaveLength(MAX_ACCESSIBILITY_FILTERS)
    expect(filters.leftOut).toEqual(['HEARING_LOOP', 'CAPTIONING'])
  })

  it('cuts a city to the length the API accepts and ignores a nonsense page', () => {
    const filters = parseVenueFilters({ city: 'x'.repeat(300), page: '-4' })

    expect(filters.city).toHaveLength(120)
    expect(filters.page).toBe(1)
  })
})

describe('buildVenuesHref', () => {
  it('round-trips filters through the URL', () => {
    const href = buildVenuesHref({
      city: 'Navi Mumbai',
      accessibility: ['STEP_FREE_ENTRANCE', 'HEARING_LOOP'],
      page: 3,
    })

    expect(href).toBe(
      '/venues?city=Navi+Mumbai&accessibility=STEP_FREE_ENTRANCE&accessibility=HEARING_LOOP&page=3',
    )

    const parsed = parseVenueFilters(
      Object.fromEntries(
        [...new URL(href, 'https://example.test').searchParams.keys()].map((key) => [
          key,
          new URL(href, 'https://example.test').searchParams.getAll(key),
        ]),
      ),
    )

    expect(parsed).toMatchObject({
      city: 'Navi Mumbai',
      accessibility: ['STEP_FREE_ENTRANCE', 'HEARING_LOOP'],
      page: 3,
    })
  })

  it('is the bare path when nothing is set', () => {
    expect(buildVenuesHref({ city: '', accessibility: [], page: 1 })).toBe('/venues')
  })
})

describe('listableVenues', () => {
  it('drops a venue with no slug and one merged into another', () => {
    const venues = listableVenues([
      { slug: 'tagore-hall', name: 'Tagore Hall', mergedIntoVenueId: null },
      { slug: null, name: 'No Page Hall', mergedIntoVenueId: null },
      { slug: 'old-hall', name: 'Old Hall', mergedIntoVenueId: 'vnu00000000000000000002' },
    ])

    expect(venues.map((venue) => venue.slug)).toEqual(['tagore-hall'])
  })
})

describe('venuePlace and venueAccessibilityLabels', () => {
  it('names the country and does not repeat a region that is the city', () => {
    expect(venuePlace({ city: 'Mumbai', region: 'Maharashtra', country: 'IN' })).toBe(
      'Mumbai, Maharashtra, India',
    )
    expect(venuePlace({ city: 'Singapore', region: 'Singapore', country: 'SG' })).toBe('Singapore')
  })

  it('uses the venue page wording for exactly the claims asserted', () => {
    expect(
      venueAccessibilityLabels({
        accessibility: { features: ['HEARING_LOOP', 'STEP_FREE_ENTRANCE', 'HEARING_LOOP'] },
      }),
    ).toEqual(['Hearing loop', 'Step-free entrance'])
    expect(venueAccessibilityLabels({ accessibility: null })).toEqual([])
  })

  it('notices a note written without any claim, and ignores a blank one', () => {
    const noteOnly = {
      accessibility: { features: [], note: 'Accessible entrance at Gate 3; ring the bell.' },
    }

    expect(venueAccessibilityLabels(noteOnly)).toEqual([])
    expect(venueHasAccessibilityNote(noteOnly)).toBe(true)
    expect(venueHasAccessibilityNote({ accessibility: { features: [], note: '   ' } })).toBe(false)
    expect(venueHasAccessibilityNote({ accessibility: null })).toBe(false)
  })
})

describe('loadVenueDirectory', () => {
  let warn

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('asks for the filters the page parsed, and returns only listable venues', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [
        { slug: 'troxy', name: 'Troxy', mergedIntoVenueId: null },
        { slug: null, name: 'Unlisted', mergedIntoVenueId: null },
      ],
      pagination: { page: 2, perPage: 48, total: 60, hasNextPage: false },
    })

    const result = await loadVenueDirectory(
      { city: 'London', accessibility: ['HEARING_LOOP'], page: 2 },
      { client: { venues: { list } } },
    )

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'London', accessibility: ['HEARING_LOOP'], page: 2 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.ok).toBe(true)
    expect(result.venues.map((venue) => venue.slug)).toEqual(['troxy'])
    expect(result.pagination).toEqual({ page: 2, hasNextPage: false })
  })

  it('fails closed, carrying no message that names the endpoint', async () => {
    const list = vi.fn().mockRejectedValue(
      Object.assign(new Error('Request to GET http://127.0.0.1:4000/v1/venues failed'), {
        status: 0,
        code: 'NETWORK_ERROR',
      }),
    )

    const result = await loadVenueDirectory(
      { city: '', accessibility: [], page: 1 },
      { client: { venues: { list } } },
    )

    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('/v1/')
    expect(warn.mock.calls.flat().join(' ')).not.toContain('/v1/')
    // The log keeps what actually happened.
    expect(warn.mock.calls.flat().join(' ')).toContain('status 0, NETWORK_ERROR')
  })

  it('words an unanswered server-side read as our failure, not the visitor’s connection', async () => {
    const list = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('timed out'), { status: 0, code: 'NETWORK_ERROR' }),
      )

    const result = await loadVenueDirectory(
      { city: '', accessibility: [], page: 1 },
      { client: { venues: { list } } },
    )

    // Status 0 is what `describeApiRefusal` reads as "Check your connection".
    expect(result.error).toEqual({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      retryAfterSeconds: null,
    })
  })

  it('passes a rate limit and a server error through, and draws any other refusal as ours', async () => {
    /**
     * The refusal the page is handed for one thrown error.
     *
     * @param {object} thrown What the client throws.
     * @returns {Promise<object>} The refusal.
     */
    async function refusalFor(thrown) {
      const list = vi.fn().mockRejectedValue(Object.assign(new Error('refused'), thrown))
      const result = await loadVenueDirectory(
        { city: '', accessibility: [], page: 1 },
        { client: { venues: { list } } },
      )

      return result.error
    }

    expect(await refusalFor({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 30 })).toEqual({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 30,
    })
    expect(await refusalFor({ status: 500, code: 'INTERNAL' })).toEqual({
      status: 500,
      code: 'INTERNAL',
      retryAfterSeconds: null,
    })

    // An anonymous public read: a sign-in prompt, "not for this account" or
    // "check what you entered" would each be advice for the wrong person.
    for (const status of [400, 401, 403, 404]) {
      expect((await refusalFor({ status, code: 'X' })).status).toBe(503)
    }
  })

  it('treats a response with no listing as a failure, not an empty directory', async () => {
    const list = vi.fn().mockResolvedValue({ data: null })

    const result = await loadVenueDirectory(
      { city: '', accessibility: [], page: 1 },
      { client: { venues: { list } } },
    )

    expect(result.ok).toBe(false)
    expect(result.error.status).toBe(502)
  })
})

/**
 * An event summary as the listing returns it.
 *
 * @param {string} slug The event slug.
 * @param {string|null} organizationSlug The organiser slug.
 * @param {string|null} organizationName The organiser name.
 * @param {object} [overrides] Fields to change.
 * @returns {object} The summary.
 */
function event(slug, organizationSlug, organizationName, overrides = {}) {
  return { slug, status: 'PUBLISHED', organizationSlug, organizationName, ...overrides }
}

/**
 * A fake `loadEventList` serving fixed pages.
 *
 * @param {Array<{events: object[], hasNextPage: boolean, usedFallback?: boolean, total?: number}>} pages The pages, first first.
 * @returns {Function} The loader, a `vi.fn`.
 */
function fakeLoader(pages) {
  return vi.fn(async ({ page }) => {
    const served = pages[page - 1] ?? { events: [], hasNextPage: false }

    return {
      events: served.events,
      pagination: { page, total: served.total, hasNextPage: served.hasNextPage },
      usedFallback: served.usedFallback ?? false,
    }
  })
}

describe('deriveOrganizers', () => {
  it('dedupes by slug, counts distinct events, and sorts by name', async () => {
    const load = fakeLoader([
      {
        total: 5,
        hasNextPage: true,
        events: [
          event('garba-1', 'navrang', 'Navrang Utsav Samiti'),
          event('comedy-1', 'masala', 'Masala Arts London'),
          event('garba-2', 'navrang', 'Navrang Utsav Samiti'),
        ],
      },
      {
        hasNextPage: false,
        events: [
          // The same event again, as a listing that shifted between reads can serve it.
          event('garba-2', 'navrang', 'Navrang Utsav Samiti'),
          event('film-1', 'apu', 'apu Film Society'),
        ],
      },
    ])

    const directory = await deriveOrganizers({ load })

    expect(directory.organizers).toEqual([
      { slug: 'apu', name: 'apu Film Society', eventCount: 1 },
      { slug: 'masala', name: 'Masala Arts London', eventCount: 1 },
      { slug: 'navrang', name: 'Navrang Utsav Samiti', eventCount: 2 },
    ])
    expect(directory.eventsRead).toBe(4)
    expect(directory.truncated).toBe(false)
    expect(directory.usedFallback).toBe(false)
  })

  it('never asks for a bigger page than the API accepts', async () => {
    const load = fakeLoader([{ hasNextPage: false, events: [] }])

    await deriveOrganizers({ load })

    // Asking for more than MAX_PER_PAGE is a 400, and a refused read falls back
    // to the sample catalogue: the directory would silently turn into samples.
    expect(load).toHaveBeenCalledWith({ page: 1, perPage: ORGANIZER_SCAN.perPage })
    expect(ORGANIZER_SCAN.perPage).toBeLessThanOrEqual(MAX_PER_PAGE)
    expect(ORGANIZER_SCAN.maxPages * ORGANIZER_SCAN.perPage).toBeLessThanOrEqual(500)
    expect(VENUES_PER_PAGE).toBeLessThanOrEqual(MAX_PER_PAGE)
  })

  it('stops at the page bound and reports that it did', async () => {
    const pages = Array.from({ length: 8 }, (_, index) => ({
      total: 800,
      hasNextPage: true,
      events: [event(`event-${index}`, `org-${index}`, `Organiser ${index}`)],
    }))
    const load = fakeLoader(pages)

    const directory = await deriveOrganizers({ load, maxPages: 5 })

    expect(load).toHaveBeenCalledTimes(5)
    expect(directory.truncated).toBe(true)
    expect(directory.interrupted).toBe(false)
    expect(directory.eventsRead).toBe(5)
    expect(directory.totalListed).toBe(800)
  })

  it('never splices sample organisers into a live directory', async () => {
    const load = fakeLoader([
      { hasNextPage: true, events: [event('live-1', 'live-org', 'Live Organiser')] },
      {
        hasNextPage: false,
        usedFallback: true,
        events: [event('sample-1', 'rangmanch-collective', 'Rangmanch Collective')],
      },
    ])

    const directory = await deriveOrganizers({ load })

    expect(directory.organizers.map((organizer) => organizer.slug)).toEqual(['live-org'])
    expect(directory.usedFallback).toBe(false)
    expect(directory.truncated).toBe(true)
    expect(directory.interrupted).toBe(true)
  })

  it('reports a directory built from the sample catalogue as such', async () => {
    const load = fakeLoader([
      {
        hasNextPage: false,
        usedFallback: true,
        events: [event('sample-1', 'rangmanch-collective', 'Rangmanch Collective')],
      },
    ])

    const directory = await deriveOrganizers({ load })

    expect(directory.usedFallback).toBe(true)
    expect(directory.organizers).toHaveLength(1)
  })

  it('skips events with no organiser slug and events in a status the public listing must not serve', async () => {
    const load = fakeLoader([
      {
        hasNextPage: false,
        events: [
          event('orphan', null, null),
          event('draft', 'secret-org', 'Secret Organiser', { status: 'DRAFT' }),
          event('ok', 'visible-org', 'Visible Organiser', { status: 'ON_SALE' }),
        ],
      },
    ])

    const directory = await deriveOrganizers({ load })

    expect(directory.organizers.map((organizer) => organizer.slug)).toEqual(['visible-org'])
  })
})

describe('upcomingEventReader', () => {
  let warn

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('asks for upcoming events in every public status, from one instant for the whole walk', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [event('garba-1', 'navrang', 'Navrang Utsav Samiti', { status: 'ON_SALE' })],
      pagination: { page: 1, total: 1, hasNextPage: false },
    })
    const now = new Date('2026-09-23T10:00:00.000Z')
    const read = upcomingEventReader({ client: { events: { list } }, now })

    const first = await read({ page: 1, perPage: 100 })
    await read({ page: 2, perPage: 100 })

    const [query, callOptions] = list.mock.calls[0]

    expect(query).toEqual({
      page: 1,
      perPage: 100,
      sort: 'startsAt:asc',
      startsAfter: '2026-09-23T10:00:00.000Z',
    })
    // No status: the API's public set (published, on sale, paused, sold out)
    // applies. Asking for PUBLISHED would drop every event whose sales opened.
    expect(query).not.toHaveProperty('status')
    expect(callOptions.signal).toBeInstanceOf(AbortSignal)
    expect(list.mock.calls[1][0].startsAfter).toBe('2026-09-23T10:00:00.000Z')
    expect(first).toMatchObject({ usedFallback: false })
    expect(first.events.map((summary) => summary.slug)).toEqual(['garba-1'])
  })

  it('answers a failed read from the sample catalogue without asking the API a second time', async () => {
    const list = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED'), { status: 0, code: 'NETWORK_ERROR' }),
      )
    const read = upcomingEventReader({ client: { events: { list } } })

    const result = await read({ page: 1, perPage: 100 })

    expect(list).toHaveBeenCalledTimes(1)
    expect(result.usedFallback).toBe(true)
    expect(result.events.length).toBeGreaterThan(0)
    expect(result.events.every((summary) => typeof summary.organizationSlug === 'string')).toBe(
      true,
    )
  })

  it('treats a response with no data array as a failure', async () => {
    const list = vi.fn().mockResolvedValue({ data: null })
    const read = upcomingEventReader({ client: { events: { list } } })

    expect((await read({ page: 1, perPage: 100 })).usedFallback).toBe(true)
  })
})

describe('organizerCountLabel', () => {
  it('words one and many, as upcoming, which is what was counted', () => {
    expect(organizerCountLabel(1)).toBe('1 upcoming event listed')
    expect(organizerCountLabel(3)).toBe('3 upcoming events listed')
  })
})
