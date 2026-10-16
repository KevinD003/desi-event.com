import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_API_URL,
  getApiBaseUrl,
  getApiClient,
  loadCatalogueFacets,
  loadCatalogueOverview,
  loadEventBySlug,
  loadEventList,
  loadSeatMap,
  resetApiClient,
  withTicketTypeAvailability,
} from './api.js'
import { sampleEventSummaries } from './sample-data.js'

/**
 * Build a client stub whose event reads behave in a chosen way.
 *
 * @param {object} handlers Implementations for the route methods under test.
 * @returns {object} A stand-in for the contract client.
 */
function stubClient(handlers = {}) {
  return {
    events: {
      list: handlers.list ?? vi.fn(),
      get: handlers.get ?? vi.fn(),
      facets: handlers.facets ?? vi.fn(),
    },
  }
}

/** A well-formed live listing payload. */
const liveListing = {
  data: [
    {
      id: 'evtlivefromapi01',
      slug: 'live-from-the-api',
      title: 'Live From The API',
      summary: 'Served by a running server.',
      category: 'MUSIC_CONCERT',
      status: 'PUBLISHED',
      startsAt: '2026-11-01T18:00:00.000Z',
      endsAt: '2026-11-01T21:00:00.000Z',
      timezone: 'Asia/Kolkata',
      city: 'Mumbai',
      minPriceCents: 50_000,
      currency: 'INR',
    },
  ],
  pagination: {
    page: 1,
    perPage: 12,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
}

beforeEach(() => {
  resetApiClient()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  resetApiClient()
})

describe('getApiBaseUrl', () => {
  const original = process.env.NEXT_PUBLIC_API_URL

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_API_URL
    else process.env.NEXT_PUBLIC_API_URL = original
  })

  it('falls back to the local API when nothing is configured', () => {
    delete process.env.NEXT_PUBLIC_API_URL
    expect(getApiBaseUrl()).toBe(DEFAULT_API_URL)
  })

  it('ignores an empty or whitespace-only value', () => {
    process.env.NEXT_PUBLIC_API_URL = '   '
    expect(getApiBaseUrl()).toBe(DEFAULT_API_URL)
  })

  it('uses the configured origin, trimmed', () => {
    process.env.NEXT_PUBLIC_API_URL = ' https://api.desi-event.test '
    expect(getApiBaseUrl()).toBe('https://api.desi-event.test')
  })
})

describe('getApiClient', () => {
  it('memoises the client for a given base URL', () => {
    expect(getApiClient()).toBe(getApiClient())
  })

  it('exposes a method for every contract route it needs', () => {
    const client = getApiClient()

    expect(typeof client.events.list).toBe('function')
    expect(typeof client.events.get).toBe('function')
    expect(typeof client.holds.create).toBe('function')
  })
})

describe('loadEventList', () => {
  it('returns the API payload untouched when the service answers', async () => {
    const list = vi.fn().mockResolvedValue(liveListing)

    const result = await loadEventList({ page: 1, perPage: 12 }, { client: stubClient({ list }) })

    expect(result.usedFallback).toBe(false)
    expect(result.events).toEqual(liveListing.data)
    expect(result.pagination).toEqual(liveListing.pagination)
  })

  it('sends only the filters that are set, and leaves the public statuses to the API', async () => {
    const list = vi.fn().mockResolvedValue(liveListing)

    await loadEventList(
      { category: 'COMEDY', page: 2, perPage: 6 },
      { client: stubClient({ list }) },
    )

    const [query] = list.mock.calls[0]

    expect(query).toMatchObject({ category: 'COMEDY', page: 2, perPage: 6 })
    // No status filter: an event on sale, paused or sold out is still listed,
    // with the words to say which. Asking for PUBLISHED hid every one of them.
    expect(query).not.toHaveProperty('status')
    expect(query).not.toHaveProperty('city')
    expect(query).not.toHaveProperty('q')
  })

  it('sends the state as country and region, the format as isOnline, and When as the API reads it', async () => {
    const list = vi.fn().mockResolvedValue(liveListing)

    await loadEventList(
      {
        region: 'CA-ON',
        city: 'Toronto',
        language: 'Hindi',
        when: 'weekend',
        from: '2026-10-17',
        format: 'in_person',
        free: true,
        onSale: true,
      },
      { client: stubClient({ list }) },
    )

    const [query] = list.mock.calls[0]

    expect(query).toMatchObject({
      country: 'CA',
      region: 'ON',
      city: 'Toronto',
      language: 'Hindi',
      when: 'weekend',
      isOnline: false,
      free: true,
      onSale: true,
    })
    // A named span wins over days left beside it.
    expect(query).not.toHaveProperty('fromDate')
    expect(query).not.toHaveProperty('sort', 'price:asc')
  })

  it('sends chosen days as fromDate and toDate, and nothing for switches left off', async () => {
    const list = vi.fn().mockResolvedValue(liveListing)

    await loadEventList(
      { when: 'dates', from: '2026-10-17', to: '2026-10-18', format: 'online', free: false },
      { client: stubClient({ list }) },
    )

    const [query] = list.mock.calls[0]

    expect(query).toMatchObject({ fromDate: '2026-10-17', toDate: '2026-10-18', isOnline: true })
    expect(query).not.toHaveProperty('when')
    expect(query).not.toHaveProperty('free')
    expect(query).not.toHaveProperty('onSale')
    expect(query).not.toHaveProperty('country')
  })

  it('narrows the fallback catalogue by state as it asks the API to', async () => {
    const list = vi.fn().mockRejectedValue(new Error('down'))

    const result = await loadEventList(
      { region: 'US-NJ', perPage: 48 },
      { client: stubClient({ list }) },
    )

    expect(result.events.length).toBeGreaterThan(0)
    expect(result.events.every((event) => event.region === 'NJ' && event.country === 'US')).toBe(
      true,
    )
  })

  it('falls back to the curated catalogue when the API is unreachable', async () => {
    const list = vi.fn().mockRejectedValue(new Error('fetch failed'))

    const result = await loadEventList({}, { client: stubClient({ list }) })

    expect(result.usedFallback).toBe(true)
    expect(result.events.length).toBeGreaterThan(0)
    // What the API would list: a postponed, cancelled or finished sample event
    // has its own page but is not in "what is on".
    expect(result.pagination.total).toBe(sampleEventSummaries().length)
    expect(result.events.every((event) => event.status !== 'CANCELLED')).toBe(true)
  })

  it('falls back when the API answers with something malformed', async () => {
    const list = vi.fn().mockResolvedValue({ data: 'not an array' })

    const result = await loadEventList({}, { client: stubClient({ list }) })

    expect(result.usedFallback).toBe(true)
  })

  it('falls back when the API answers with nothing at all', async () => {
    const list = vi.fn().mockResolvedValue(null)

    expect((await loadEventList({}, { client: stubClient({ list }) })).usedFallback).toBe(true)
  })

  it('applies the same filters to the fallback catalogue as it asks the API for', async () => {
    const list = vi.fn().mockRejectedValue(new Error('connection refused'))

    const result = await loadEventList({ city: 'Edison' }, { client: stubClient({ list }) })

    expect(result.events.length).toBeGreaterThan(0)
    expect(result.events.every((event) => event.city === 'Edison')).toBe(true)
  })

  it('paginates the fallback catalogue rather than returning all of it', async () => {
    const list = vi.fn().mockRejectedValue(new Error('down'))

    const result = await loadEventList({ page: 2, perPage: 4 }, { client: stubClient({ list }) })

    expect(result.events).toHaveLength(4)
    expect(result.pagination).toMatchObject({ page: 2, perPage: 4, hasPreviousPage: true })
  })

  it('never lets an API failure escape to the caller', async () => {
    const list = vi.fn().mockRejectedValue(new Error('boom'))

    await expect(loadEventList({}, { client: stubClient({ list }) })).resolves.toBeDefined()
  })

  it('logs one warning per failing read, not one per card', async () => {
    const list = vi.fn().mockRejectedValue(new Error('down'))
    const client = stubClient({ list })

    await loadEventList({}, { client })
    await loadEventList({ city: 'Edison' }, { client })

    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(console.warn.mock.calls[0][0]).toContain('events.list')
  })
})

describe('loadCatalogueFacets', () => {
  it('passes the API’s facets through, regions and all', async () => {
    const data = {
      scope: { status: 'LISTED', total: 1 },
      categories: [],
      cities: [{ value: 'Frisco', count: 1 }],
      regions: [
        {
          country: 'US',
          region: 'TX',
          name: 'Texas',
          count: 1,
          cities: [{ value: 'Frisco', count: 1 }],
        },
      ],
      languages: [],
      formats: [],
    }
    const facets = vi.fn().mockResolvedValue({ data })

    expect(await loadCatalogueFacets({ client: stubClient({ facets }) })).toEqual({
      facets: data,
      usedFallback: false,
    })
  })

  it('derives states with their cities, languages and formats from the sample catalogue', async () => {
    const facets = vi.fn().mockRejectedValue(new Error('down'))

    const result = await loadCatalogueFacets({ client: stubClient({ facets }) })
    const summaries = sampleEventSummaries()

    expect(result.usedFallback).toBe(true)

    const jersey = result.facets.regions.find((entry) => entry.region === 'NJ')
    expect(jersey).toMatchObject({ country: 'US', name: 'New Jersey' })
    expect(jersey.cities.map((city) => city.value).sort()).toEqual(
      [
        ...new Set(summaries.filter((event) => event.region === 'NJ').map((event) => event.city)),
      ].sort(),
    )
    expect(result.facets.regions.reduce((sum, entry) => sum + entry.count, 0)).toBe(
      summaries.filter((event) => event.city).length,
    )
    expect(result.facets.languages.length).toBeGreaterThan(0)
    expect(result.facets.formats.reduce((sum, entry) => sum + entry.count, 0)).toBe(
      summaries.length,
    )
  })
})

describe('loadEventBySlug', () => {
  it('returns the live event when the API answers', async () => {
    const get = vi.fn().mockResolvedValue({
      data: { slug: 'live-from-the-api', title: 'Live', ticketTypes: [] },
    })

    const result = await loadEventBySlug('live-from-the-api', { client: stubClient({ get }) })

    expect(result.usedFallback).toBe(false)
    expect(result.event.title).toBe('Live')
  })

  it('falls back to the curated event of the same slug', async () => {
    const get = vi.fn().mockRejectedValue(new Error('fetch failed'))

    const result = await loadEventBySlug('navratri-night-one-edison', {
      client: stubClient({ get }),
    })

    expect(result.usedFallback).toBe(true)
    expect(result.event.title).toBe('Navratri Night One: Garba Under the Lights')
    expect(result.event.ticketTypes.length).toBeGreaterThan(0)
  })

  it('reports a genuinely unknown slug as absent, so the route can answer 404', async () => {
    const get = vi.fn().mockRejectedValue(new Error('404'))

    const result = await loadEventBySlug('not-a-real-event', { client: stubClient({ get }) })

    expect(result.event).toBeNull()
  })

  it('treats a response with no event in it as a failure', async () => {
    const get = vi.fn().mockResolvedValue({ data: {} })

    expect((await loadEventBySlug('anything', { client: stubClient({ get }) })).event).toBeNull()
  })
})

describe('loadCatalogueOverview', () => {
  it('asks for a page big enough to build the filter options from', async () => {
    const list = vi.fn().mockResolvedValue(liveListing)

    await loadCatalogueOverview({ client: stubClient({ list }) })

    expect(list.mock.calls[0][0]).toMatchObject({ page: 1, perPage: 48 })
  })
})

describe('withTicketTypeAvailability', () => {
  it('derives availability from the stored columns when the API did not fold it in', () => {
    const event = withTicketTypeAvailability({
      ticketTypes: [{ id: 'tta', quantityTotal: 100, quantitySold: 40, status: 'ON_SALE' }],
    })

    expect(event.ticketTypes[0]).toMatchObject({ availableQuantity: 60, isSoldOut: false })
  })

  it('prefers the availability the API folded in, which already subtracts active holds', () => {
    const event = withTicketTypeAvailability({
      ticketTypes: [
        {
          id: 'tta',
          quantityTotal: 100,
          quantitySold: 40,
          status: 'ON_SALE',
          availableQuantity: 12,
        },
      ],
    })

    expect(event.ticketTypes[0].availableQuantity).toBe(12)
  })

  it('treats a tier that is not on sale as sold out with nothing available', () => {
    const event = withTicketTypeAvailability({
      ticketTypes: [{ id: 'ttb', quantityTotal: 100, quantitySold: 0, status: 'PAUSED' }],
    })

    expect(event.ticketTypes[0]).toMatchObject({ availableQuantity: 0, isSoldOut: true })
  })

  it('never reports a negative count when a tier has oversold', () => {
    const event = withTicketTypeAvailability({
      ticketTypes: [{ id: 'ttc', quantityTotal: 10, quantitySold: 14, status: 'ON_SALE' }],
    })

    expect(event.ticketTypes[0].availableQuantity).toBe(0)
  })

  it('copes with an event that has no ticket types at all', () => {
    expect(withTicketTypeAvailability({ title: 'Bare' }).ticketTypes).toEqual([])
  })
})

describe('loadSeatMap', () => {
  it('reads a night’s seat map, and never invents one', async () => {
    const seats = vi.fn().mockResolvedValue({ data: { sessionId: 'snnightonexxx', sections: [] } })

    expect(await loadSeatMap('snnightonexxx', { client: { sessions: { seats } } })).toEqual({
      sessionId: 'snnightonexxx',
      sections: [],
    })
    expect(seats.mock.calls[0][0]).toEqual({ id: 'snnightonexxx' })
  })

  it('answers null when the API refuses or is down: no fallback map exists', async () => {
    const refused = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }))
    const empty = vi.fn().mockResolvedValue({ data: null })

    expect(
      await loadSeatMap('snnightonexxx', { client: { sessions: { seats: refused } } }),
    ).toBeNull()
    expect(
      await loadSeatMap('snnightonexxx', { client: { sessions: { seats: empty } } }),
    ).toBeNull()
  })
})

describe('withTicketTypeAvailability for a seated tier', () => {
  const night = { id: 'snnightonexxx', hasSeatMap: true, seatsAvailable: 7 }
  const seated = {
    id: 'ttseatedxxxxx',
    reserved: true,
    eventSessionId: 'snnightonexxx',
    status: 'ON_SALE',
    quantityTotal: 0,
    quantitySold: 0,
  }

  it('counts its own free seats, as the API sent them, not its quantity columns', () => {
    const [tier] = withTicketTypeAvailability({
      sessions: [night],
      ticketTypes: [{ ...seated, availableQuantity: 4, isSoldOut: false }],
    }).ticketTypes

    expect(tier).toMatchObject({ availableQuantity: 4, isSoldOut: false })
  })

  it('never reads the night’s count as its own', () => {
    // The night has 7 free seats, all in another zone; this tier has none.
    const [tier] = withTicketTypeAvailability({
      sessions: [night],
      ticketTypes: [{ ...seated, availableQuantity: 0, isSoldOut: true }],
    }).ticketTypes

    expect(tier).toMatchObject({ availableQuantity: 0, isSoldOut: true })

    // And a tier the API did not count gets no number at all, not the night's.
    const [uncounted] = withTicketTypeAvailability({
      sessions: [night],
      ticketTypes: [seated],
    }).ticketTypes

    expect(uncounted.availableQuantity).toBeNull()
    expect(uncounted.isSoldOut).toBe(false)
  })

  it('is sold out when it has no seat left, or it is not on sale', () => {
    const full = withTicketTypeAvailability({
      sessions: [night],
      ticketTypes: [{ ...seated, availableQuantity: 0 }],
    }).ticketTypes[0]
    const paused = withTicketTypeAvailability({
      sessions: [night],
      ticketTypes: [{ ...seated, status: 'PAUSED', availableQuantity: 5 }],
    }).ticketTypes[0]

    expect(full).toMatchObject({ availableQuantity: 0, isSoldOut: true })
    expect(paused).toMatchObject({ availableQuantity: 0, isSoldOut: true })
  })

  it('falls back to its own columns when its night has no seat map', () => {
    const [tier] = withTicketTypeAvailability({
      sessions: [{ ...night, hasSeatMap: false, seatsAvailable: null }],
      ticketTypes: [seated],
    }).ticketTypes

    expect(tier).toMatchObject({ availableQuantity: 0, isSoldOut: true })
  })
})
