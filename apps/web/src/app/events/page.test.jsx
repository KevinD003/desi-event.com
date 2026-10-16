/**
 * The listing: a night band with the page's heading, the filter bar over its
 * edge, a sentence that says what matched, the cards, and the pages.
 *
 * @module app/events/page.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('../../lib/api.js', () => ({
  loadEventList: vi.fn(),
  loadCatalogueFacets: vi.fn(),
}))
// The visit counting reads the session, which only a request has; it is
// tested on its own (`components/traffic-scope.test.jsx`). Here it is a marker.
vi.mock('../../components/traffic-scope.jsx', () => ({
  TrafficScope: ({ view = null }) => (
    <span data-testid="traffic-scope" data-view={JSON.stringify(view)} />
  ),
}))

const { loadCatalogueFacets, loadEventList } = await import('../../lib/api.js')
const { sampleEventSummaries } = await import('../../lib/sample-data.js')
const { default: EventsPage, metadata } = await import('./page.jsx')

/**
 * Render the listing for a query and a page of results.
 *
 * @param {object} [options] What the loaders answer.
 * @param {Record<string, string>} [options.query] The URL's query.
 * @param {object[]} [options.events] The page of results.
 * @param {object} [options.pagination] Its counters.
 * @param {boolean} [options.usedFallback] Whether the sample catalogue answered.
 * @param {object} [options.facets] Facet lists to add to (or replace) the default ones.
 * @returns {Promise<HTMLElement>} The render container.
 */
async function draw({ query = {}, events, pagination, usedFallback = false, facets = {} } = {}) {
  const page = events ?? sampleEventSummaries().slice(0, 12)

  loadEventList.mockResolvedValue({
    events: page,
    pagination: pagination ?? {
      page: 1,
      perPage: 12,
      total: page.length,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    usedFallback,
  })
  loadCatalogueFacets.mockResolvedValue({
    facets: {
      categories: [
        { value: 'GARBA_DANDIYA', count: 12 },
        { value: 'WORKSHOP', count: 2 },
      ],
      cities: [
        { value: 'Edison', count: 4 },
        { value: 'Houston', count: 3 },
      ],
      ...facets,
    },
    usedFallback,
  })

  const { container } = render(await EventsPage({ searchParams: Promise.resolve(query) }))

  return container
}

beforeEach(() => {
  loadEventList.mockReset()
  loadCatalogueFacets.mockReset()
})

afterEach(cleanup)

describe('the listing', () => {
  it('has one h1, on a band named by it, with a trail home', async () => {
    await draw()

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'What’s on' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', {
        name: 'Home',
      }),
    ).toHaveAttribute('href', '/')
  })

  it('offers the filters with every category and city the facets list', async () => {
    await draw()

    const form = screen.getByRole('form', { name: 'Filter events' })

    expect(within(form).getByRole('option', { name: 'Garba & Dandiya' })).toBeInTheDocument()
    expect(within(form).getByRole('option', { name: 'Houston' })).toBeInTheDocument()
  })

  it('says what matched, in a sentence, and lists the cards under their own headings', async () => {
    await draw({ query: { city: 'Edison' }, events: sampleEventSummaries().slice(0, 2) })

    expect(screen.getByTestId('result-count')).toHaveTextContent('2 events in Edison')

    const list = screen.getByRole('list', { name: 'Matching events' })

    expect(within(list).getAllByRole('heading', { level: 2 })).toHaveLength(2)
  })

  it('says a card’s price shows whether the fee is in it, and that payment is simulated', async () => {
    const container = await draw()

    expect(container.textContent).toMatch(/A card’s price says whether the booking fee is in it/)
    expect(container.textContent).toMatch(/Payments on this site are simulated\./)
  })

  it('offers a way back to everything when nothing matches', async () => {
    await draw({
      query: { q: 'nothing like this' },
      events: [],
      pagination: {
        page: 1,
        perPage: 12,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })

    expect(screen.getByRole('heading', { name: 'Nothing matches that' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clear all filters' })).toHaveAttribute(
      'href',
      '/events',
    )
  })

  it('pages through a long listing, keeping the filters in the links', async () => {
    await draw({
      query: { category: 'GARBA_DANDIYA', page: '2' },
      pagination: {
        page: 2,
        perPage: 12,
        total: 30,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      },
    })

    const pages = screen.getByRole('navigation', { name: 'Listing pages' })

    expect(within(pages).getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/events?category=GARBA_DANDIYA',
    )
    expect(within(pages).getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/events?category=GARBA_DANDIYA&page=3',
    )
    expect(pages).toHaveTextContent('Page 2 of 3')
  })

  it('shows the sample notice only when the catalogue fell back', async () => {
    // One card a draw: the notice is about where the page came from, not what
    // is on it, and twelve cards of poster art (some 5,200 nodes a draw, drawn
    // twice) made this a five-second case under load.
    const events = sampleEventSummaries().slice(0, 1)

    await draw({ events, usedFallback: true })
    expect(screen.getByText('Showing our sample programme')).toBeInTheDocument()

    cleanup()
    await draw({ events })
    expect(screen.queryByText('Showing our sample programme')).toBeNull()
  })

  it('keeps its posters fan out of the reading order: the cards carry the names', async () => {
    const container = await draw({ events: sampleEventSummaries().slice(0, 3) })

    const images = screen.getAllByRole('img')

    // One named poster per card, and the three in the fan are hidden.
    expect(images).toHaveLength(3)
    expect(container.querySelectorAll('[data-slot="poster"]')).toHaveLength(6)
  })

  it('describes the catalogue as it is now', () => {
    expect(metadata.title).toBe('All events')
    expect(metadata.description).toMatch(/garba/i)
  })
})

/** States with their cities, Springfield in two of them. */
const PLACES = Object.freeze({
  cities: [
    { value: 'Springfield', count: 5 },
    { value: 'Frisco', count: 3 },
    { value: 'Toronto', count: 1 },
  ],
  regions: [
    {
      country: 'US',
      region: 'TX',
      name: 'Texas',
      count: 3,
      cities: [{ value: 'Frisco', count: 3 }],
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
  languages: [{ value: 'Hindi', count: 4 }],
})

describe('state, then city', () => {
  it('offers every state under its country, with how many events each has', async () => {
    await draw({ facets: PLACES })

    const select = screen.getByLabelText('State or province')

    expect(within(select).getByRole('group', { name: 'United States' })).toBeInTheDocument()
    expect(within(select).getByRole('group', { name: 'Canada' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Texas (3)' })).toHaveValue('US-TX')
    expect(within(select).getByRole('option', { name: 'Ontario (1)' })).toHaveValue('CA-ON')
  })

  it('lists only the chosen state’s cities, and asks for the city in that state', async () => {
    await draw({ facets: PLACES, query: { region: 'us-il', city: 'springfield' } })

    const city = screen.getByLabelText('City')

    expect(
      within(city)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Every city in this state', 'Springfield'])
    expect(city).toHaveValue('Springfield')
    expect(screen.getByLabelText('State or province')).toHaveValue('US-IL')
    expect(loadEventList).toHaveBeenLastCalledWith(
      expect.objectContaining({ region: 'US-IL', city: 'Springfield' }),
    )
  })

  it('drops a city that is not in the chosen state, and lists the state', async () => {
    await draw({
      facets: PLACES,
      query: { region: 'CA-ON', city: 'Frisco' },
      events: sampleEventSummaries().slice(0, 1),
    })

    expect(screen.getByLabelText('City')).toHaveValue('')
    expect(loadEventList).toHaveBeenLastCalledWith(
      expect.objectContaining({ region: 'CA-ON', city: '' }),
    )
    expect(screen.getByTestId('result-count')).toHaveTextContent(/^1 event in Ontario$/)
  })

  it('drops a state the catalogue does not list', async () => {
    await draw({ facets: PLACES, query: { region: 'US-AK' } })

    expect(screen.getByLabelText('State or province')).toHaveValue('')
    expect(loadEventList).toHaveBeenLastCalledWith(expect.objectContaining({ region: '' }))
  })

  it('lists every city when no state is chosen', async () => {
    await draw({ facets: PLACES })

    expect(
      within(screen.getByLabelText('City'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Every city', 'Frisco', 'Springfield', 'Toronto'])
  })
})

describe('what the sentence says', () => {
  it('names the city with its state, and the other filters chosen', async () => {
    await draw({
      facets: PLACES,
      query: { region: 'US-TX', city: 'Frisco', when: 'weekend', free: 'true', onSale: 'true' },
      events: sampleEventSummaries().slice(0, 2),
    })

    expect(screen.getByTestId('result-count')).toHaveTextContent(
      /^2 free events in Frisco, TX this weekend on sale now$/,
    )
  })

  it('says the chosen days and the language', async () => {
    await draw({
      facets: PLACES,
      query: { from: '2026-10-17', to: '2026-10-18', language: 'hindi', format: 'online' },
      events: sampleEventSummaries().slice(0, 2),
    })

    expect(screen.getByTestId('result-count')).toHaveTextContent(
      /^2 online events from Oct 17, 2026 to Oct 18, 2026 in Hindi$/,
    )
  })

  it('opens More filters when one of them is chosen, and offers to clear them', async () => {
    const container = await draw({ facets: PLACES, query: { onSale: 'true' } })

    expect(container.querySelector('details')).toHaveAttribute('open')
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tickets on sale now')).toBeChecked()
  })
})

describe('counting clicks on the listing', () => {
  /**
   * Summaries with database-shaped ids, as the API sends them.
   *
   * @returns {object[]} The summaries.
   */
  const counted = () =>
    sampleEventSummaries()
      .slice(0, 3)
      .map((event, index) => ({
        ...event,
        id: `clistevent${String(index).padStart(14, '0')}`,
        organizationId: 'corgalpha00000000000001',
      }))

  it('counts a card click as from the events list, scoped once for the page', async () => {
    await draw({ events: counted() })

    const links = within(screen.getByRole('list', { name: 'Matching events' })).getAllByRole('link')

    expect(links.map((link) => link.dataset.trafficPlacement)).toEqual([
      'LISTING',
      'LISTING',
      'LISTING',
    ])
    expect(screen.getAllByTestId('traffic-scope')).toHaveLength(1)
  })

  it('counts a card click as from search results when the visitor searched', async () => {
    await draw({ events: counted(), query: { q: 'garba' } })

    const links = within(screen.getByRole('list', { name: 'Matching events' })).getAllByRole('link')

    expect(links.every((link) => link.dataset.trafficPlacement === 'SEARCH')).toBe(true)
  })

  it('counts nothing on sample data', async () => {
    await draw({ events: counted(), usedFallback: true })

    expect(document.querySelectorAll('[data-traffic-kind]')).toHaveLength(0)
  })
})
