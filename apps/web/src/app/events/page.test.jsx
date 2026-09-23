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
 * @returns {Promise<HTMLElement>} The render container.
 */
async function draw({ query = {}, events, pagination, usedFallback = false } = {}) {
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
    await draw({ usedFallback: true })
    expect(screen.getByText('Showing our sample programme')).toBeInTheDocument()

    cleanup()
    await draw()
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
