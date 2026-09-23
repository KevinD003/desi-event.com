/**
 * The home page says only what the catalogue says.
 *
 * Each section is read from the listing and the facets the page loaded: the
 * featured cards, the cities and their counts, the categories, the next event
 * behind the hero's poster. These tests feed it the sample catalogue — the
 * same data the page falls back to — and a few hand-made edges, and hold it
 * to the rules the rest of the public site keeps: one `h1`, a search that
 * works without JavaScript, honest copy about payments and fees, and no
 * figure it cannot back.
 *
 * @module app/page.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('../lib/api.js', () => ({
  loadCatalogueOverview: vi.fn(),
  loadCatalogueFacets: vi.fn(),
}))

const { loadCatalogueFacets, loadCatalogueOverview } = await import('../lib/api.js')
const { sampleEventSummaries } = await import('../lib/sample-data.js')
const { default: HomePage } = await import('./page.jsx')

/**
 * Facet counts for a set of summaries, as the API computes them.
 *
 * @param {object[]} events Summaries.
 * @returns {object} The facets.
 */
function facetsOf(events) {
  const count = (values) => {
    const tally = new Map()
    for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1)

    return [...tally].map(([value, n]) => ({ value, count: n }))
  }

  return {
    scope: { status: 'LISTED', total: events.length },
    categories: count(events.map((event) => event.category)),
    cities: count(events.map((event) => event.city).filter(Boolean)),
    languages: [],
    formats: [],
  }
}

/**
 * Render the page with a listing and facets.
 *
 * @param {object} [options] What the loaders answer.
 * @param {object[]} [options.events] The listing.
 * @param {object} [options.facets] The facets.
 * @param {boolean} [options.usedFallback] Whether the sample catalogue answered.
 * @returns {Promise<HTMLElement>} The render container.
 */
async function draw({ events = sampleEventSummaries(), facets, usedFallback = false } = {}) {
  loadCatalogueOverview.mockResolvedValue({
    events,
    pagination: { page: 1, total: events.length },
    usedFallback,
  })
  loadCatalogueFacets.mockResolvedValue({ facets: facets ?? facetsOf(events), usedFallback })

  const { container } = render(await HomePage())

  return container
}

beforeEach(() => {
  loadCatalogueOverview.mockReset()
  loadCatalogueFacets.mockReset()
})

afterEach(cleanup)

describe('the home page', () => {
  it('has one h1, and it reads as one sentence', async () => {
    await draw()

    const [heading] = screen.getAllByRole('heading', { level: 1 })

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(heading.textContent.replace(/\s+/g, ' ').trim()).toBe(
      'Nine nights. One circle. Find your garba.',
    )
  })

  it('searches with a plain GET to the listing, offering every listed city', async () => {
    const events = sampleEventSummaries()

    await draw({ events })

    const search = screen.getByRole('search', { name: 'Find events' })
    const city = within(search).getByLabelText('City')
    const cities = new Set(events.map((event) => event.city))

    expect(search).toHaveAttribute('action', '/events')
    expect(search).toHaveAttribute('method', 'get')
    expect(city).toHaveAttribute('name', 'city')
    expect(within(search).getByLabelText('What')).toHaveAttribute('name', 'q')
    expect(within(city).getByRole('option', { name: 'All cities' })).toHaveValue('')
    expect(within(city).getAllByRole('option')).toHaveLength(cities.size + 1)
    expect(within(search).getByRole('button', { name: 'Find events' })).toHaveAttribute(
      'type',
      'submit',
    )
  })

  it('offers search for what the API searches: events, venues and organisers', async () => {
    // `GET /v1/events` matches every word against an event's own text, its
    // venue, the venue's city and its organiser (apps/api tests/events.test.js
    // and event-search-integration.test.js), so the page may invite all three.
    const container = await draw()
    const search = screen.getByRole('search', { name: 'Find events' })

    expect(within(search).getByLabelText('What')).toHaveAttribute(
      'placeholder',
      'Event, venue or organiser',
    )
    expect(container).toHaveTextContent(/search for an event, a venue or an organiser/i)
  })

  it('features the four soonest events that have not finished, earliest first', async () => {
    const events = sampleEventSummaries()

    await draw({ events })

    const list = screen.getByRole('list', { name: 'Events happening soon' })
    const titles = within(list)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)

    expect(titles).toEqual(events.slice(0, 4).map((event) => event.title))
  })

  it('leaves out a night that has already ended, whatever its status', async () => {
    const [first, ...rest] = sampleEventSummaries()
    const ended = {
      ...first,
      title: 'A Night That Has Ended',
      startsAt: '2020-10-10T23:00:00.000Z',
      endsAt: '2020-10-11T03:00:00.000Z',
    }

    const container = await draw({ events: [ended, ...rest] })

    expect(container.textContent).not.toContain('A Night That Has Ended')
  })

  it('puts the next garba night’s own poster behind the hero, with a link to it', async () => {
    const events = sampleEventSummaries()
    const garba = events.find((event) => event.category === 'GARBA_DANDIYA')

    await draw({ events })

    const hero = screen.getByRole('region', { name: /Nine nights/ })
    const next = within(hero).getByRole('link', { name: /^Next garba night:/ })

    expect(next).toHaveAttribute('href', `/events/${garba.slug}`)
    expect(next).toHaveAccessibleName(new RegExp(garba.title.replace(/[:.]/g, '.')))
    expect(within(hero).getByRole('img')).toHaveAccessibleName(new RegExp(`for ${garba.title}$`))
  })

  it('falls back to the next night of any kind when no garba night is listed', async () => {
    const events = sampleEventSummaries().filter((event) => event.category === 'WORKSHOP')

    await draw({ events })

    const hero = screen.getByRole('region', { name: /Nine nights/ })

    expect(within(hero).getByRole('link', { name: /^Next up:/ })).toHaveAttribute(
      'href',
      `/events/${events[0].slug}`,
    )
  })

  it('groups the cities by time zone, with the facets’ counts said in words', async () => {
    await draw()

    const eastern = screen.getByRole('list', { name: 'Cities in Eastern Time' })
    const edison = within(eastern).getByRole('link', { name: /^Edison/ })

    expect(edison).toHaveAttribute('href', '/events?city=Edison')
    expect(edison).toHaveAccessibleName(/^Edison \d+ events? listed$/)
    expect(screen.getByRole('list', { name: 'Cities in Pacific Time' })).toBeInTheDocument()
  })

  it('offers the categories that have something listed, and only those', async () => {
    await draw()

    const categories = screen.getByRole('list', { name: 'Browse by category' })
    const names = within(categories)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)

    expect(names).toContain('Garba & Dandiya')
    expect(names).toContain('Workshops')
    expect(names).not.toContain('Comedy')
  })

  it('says in its own words that payments are simulated and tax is not calculated', async () => {
    const container = await draw()

    expect(container.textContent).toMatch(
      /Payments on this site are simulated — no card, no money moves\./,
    )
    expect(container.textContent).toMatch(/US sales tax is not calculated in this demo/)
  })

  it('points organisers at the workspace, and says there is no sign-up', async () => {
    const container = await draw()

    expect(screen.getByRole('link', { name: /Open the organiser workspace/ })).toHaveAttribute(
      'href',
      '/organizer',
    )
    expect(screen.getByRole('link', { name: 'What this site does not do' })).toHaveAttribute(
      'href',
      '/limitations',
    )
    expect(container.textContent).toMatch(/there is no sign-up for an organisation/)
  })

  it('invents no urgency and no popularity', async () => {
    const container = await draw()

    expect(container.textContent).not.toMatch(
      /selling fast|few left|hurry|popular|trending|coming soon|\bsoon\b/i,
    )
  })

  it('shows the sample notice when, and only when, the catalogue fell back', async () => {
    await draw({ usedFallback: true })
    expect(screen.getByText('Showing our sample programme')).toBeInTheDocument()

    cleanup()
    await draw({ usedFallback: false })
    expect(screen.queryByText('Showing our sample programme')).toBeNull()
  })

  it('leaves figures out, rather than showing zeros, when the facets could not be read', async () => {
    const container = await draw({
      facets: { scope: { status: 'LISTED', total: 0 }, categories: [], cities: [] },
    })

    expect(screen.queryByRole('list', { name: /^Cities in/ })).toBeNull()
    expect(screen.queryByRole('list', { name: 'Browse by category' })).toBeNull()
    expect(container.textContent).not.toMatch(/\b0 (cities|events)\b/)
  })

  it('says so plainly when nothing is listed', async () => {
    await draw({ events: [] })

    expect(screen.getByText(/Nothing is listed right now/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Events happening soon' })).toBeNull()
  })
})
