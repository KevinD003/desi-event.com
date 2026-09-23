/**
 * The organiser directory is derived from the public event listing and says
 * exactly how much of it the page was built from.
 *
 * The properties worth pinning:
 *
 *   - **One entry per organiser**, linking to their page, with how many
 *     upcoming listed events they have, in name order.
 *   - **Upcoming, in every public status.** The listing is asked from now on
 *     with no status, so an organiser whose events are on sale is listed.
 *   - **A bounded walk says it is bounded.** When the listing is longer than
 *     the pages read, or a later page could not be read, the page says how
 *     many events it was built from.
 *   - **No verified badge.** The event listing does not carry verification, so
 *     the directory claims none, whatever else a summary carries.
 *   - **The sample notice appears exactly when the events came from the
 *     fallback**, and nothing on the page ranks or hypes.
 *
 * @module app/organizers/page.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('../../lib/api.js', () => ({
  loadEventList: vi.fn(),
  loadCatalogueFacets: vi.fn(),
  getApiClient: vi.fn(),
}))

const { getApiClient, loadEventList } = await import('../../lib/api.js')
const { default: OrganizersPage, metadata } = await import('./page.jsx')

/** The sample-data notice's title. */
const SAMPLE_NOTICE = 'Showing our sample programme'

/** The live listing read the page makes, replaced per test. */
const list = vi.fn()

/**
 * An event summary as the listing returns it.
 *
 * @param {string} slug The event slug.
 * @param {string} organizationSlug The organiser slug.
 * @param {string} organizationName The organiser name.
 * @param {object} [overrides] Fields to change.
 * @returns {object} The summary.
 */
function event(slug, organizationSlug, organizationName, overrides = {}) {
  return { slug, status: 'PUBLISHED', organizationSlug, organizationName, ...overrides }
}

/**
 * One page of a listing, as the contract client or `loadEventList` answers.
 *
 * @param {Array<{events: object[], hasNextPage: boolean, total?: number}>} pages The pages.
 * @param {number} page The page asked for.
 * @returns {{events: object[], pagination: object}} The page.
 */
function pageOf(pages, page) {
  const served = pages[page - 1] ?? { events: [], hasNextPage: false }

  return {
    events: served.events,
    pagination: { page, total: served.total, hasNextPage: served.hasNextPage },
  }
}

/**
 * Serve the live listing from fixed pages.
 *
 * @param {Array<{events: object[], hasNextPage: boolean, total?: number}>} pages The pages.
 * @returns {void}
 */
function serve(pages) {
  list.mockImplementation(async ({ page }) => {
    const { events, pagination } = pageOf(pages, page)

    return { data: events, pagination }
  })
}

/**
 * Make the live listing unreachable, so `loadEventList`'s fallback answers
 * from these sample pages.
 *
 * @param {Array<{events: object[], hasNextPage: boolean, total?: number}>} pages The sample pages.
 * @returns {void}
 */
function serveSample(pages) {
  list.mockRejectedValue(Object.assign(new Error('unreachable'), { status: 0 }))
  loadEventList.mockImplementation(async ({ page }) => ({
    ...pageOf(pages, page),
    usedFallback: true,
  }))
}

/**
 * Render the page.
 *
 * @returns {Promise<HTMLElement>} The container.
 */
async function draw() {
  const { container } = render(await OrganizersPage())

  return container
}

beforeEach(() => {
  list.mockReset()
  loadEventList.mockReset()
  getApiClient.mockReturnValue({ events: { list } })
})

describe('the organiser directory', () => {
  it('lists each organiser once, by name, linking to their page with their count', async () => {
    serve([
      {
        total: 3,
        hasNextPage: false,
        events: [
          event('garba-1', 'navrang-utsav-samiti', 'Navrang Utsav Samiti'),
          event('comedy-1', 'masala-arts-london', 'Masala Arts London'),
          event('garba-2', 'navrang-utsav-samiti', 'Navrang Utsav Samiti'),
        ],
      },
    ])

    await draw()

    const directory = screen.getByRole('list', { name: 'Organisers' })
    const names = within(directory)
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)

    expect(names).toEqual(['Masala Arts London', 'Navrang Utsav Samiti'])

    const navrang = screen.getByRole('link', { name: 'Navrang Utsav Samiti' })

    expect(navrang.getAttribute('href')).toBe('/organizers/navrang-utsav-samiti')
    expect(within(navrang.closest('li')).getByText('2 upcoming events listed')).toBeInTheDocument()
    expect(
      within(screen.getByRole('link', { name: 'Masala Arts London' }).closest('li')).getByText(
        '1 upcoming event listed',
      ),
    ).toBeInTheDocument()
  })

  it('asks for upcoming events in every public status, so organisers who are selling are listed', async () => {
    serve([
      {
        hasNextPage: false,
        events: [
          event('on-sale', 'selling-org', 'Selling Organiser', { status: 'ON_SALE' }),
          event('sold-out', 'full-org', 'Full House Organiser', { status: 'SOLD_OUT' }),
        ],
      },
    ])

    await draw()

    const [query] = list.mock.calls[0]

    expect(query).not.toHaveProperty('status')
    expect(Date.parse(query.startsAfter)).not.toBeNaN()
    expect(loadEventList).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Selling Organiser' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Full House Organiser' })).toBeInTheDocument()
  })

  it('frames the list as organisers with upcoming events listed', async () => {
    serve([{ hasNextPage: false, events: [event('a', 'org-a', 'Organiser A')] }])

    const container = await draw()

    expect(
      screen.getByText(/These are the organisers with upcoming events listed on Desi-Event/),
    ).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/as soon as one of their events is published/)
  })

  it('says how many events it was built from when it stopped before the end', async () => {
    serve(
      Array.from({ length: 7 }, (_, index) => ({
        total: 700,
        hasNextPage: true,
        events: [event(`event-${index}`, `org-${index}`, `Organiser ${index}`)],
      })),
    )

    await draw()

    expect(list).toHaveBeenCalledTimes(5)
    expect(screen.getByTestId('organizer-coverage').textContent).toBe(
      'Showing organisers from the first 5 of 700 upcoming events.',
    )
  })

  it('says the rest could not be read when a later page fails, and mixes in no samples', async () => {
    list.mockImplementation(async ({ page }) => {
      if (page === 1) {
        return {
          data: [event('live-1', 'live-org', 'Live Organiser')],
          pagination: { page, total: 250, hasNextPage: true },
        }
      }

      throw Object.assign(new Error('timed out'), { status: 0 })
    })
    loadEventList.mockResolvedValue({
      events: [event('sample-1', 'rangmanch-collective', 'Rangmanch Collective')],
      pagination: { page: 1, total: 1, hasNextPage: false },
      usedFallback: true,
    })

    await draw()

    expect(screen.getByTestId('organizer-coverage').textContent).toBe(
      'Showing organisers from the first 1 of 250 upcoming events: the rest of the listing could not be read just now.',
    )
    expect(screen.getByRole('link', { name: 'Live Organiser' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Rangmanch Collective' })).toBeNull()
    expect(screen.queryByText(SAMPLE_NOTICE)).toBeNull()
  })

  it('says nothing about coverage when it read the whole listing', async () => {
    serve([{ total: 1, hasNextPage: false, events: [event('a', 'org-a', 'Organiser A')] }])

    await draw()

    expect(screen.queryByTestId('organizer-coverage')).toBeNull()
  })

  it('draws no verified badge, even from a summary carrying something that looks like one', async () => {
    serve([
      {
        hasNextPage: false,
        events: [
          event('a', 'org-a', 'Organiser A', {
            organizationVerified: true,
            verified: true,
            organization: { slug: 'org-a', verificationStatus: 'VERIFIED', verified: true },
          }),
        ],
      },
    ])

    const container = await draw()

    // The summary schema carries no verification: anything that looks like it
    // is not the API's badge, which only the organiser's own page shows.
    expect(screen.getByRole('link', { name: 'Organiser A' })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/verified/i)
    expect(container.querySelector('[aria-label*="erified" i], [title*="erified" i]')).toBeNull()
  })

  it('shows the sample notice when the events came from the fallback, and still links', async () => {
    serveSample([
      {
        hasNextPage: false,
        events: [event('sample-1', 'rangmanch-collective', 'Rangmanch Collective')],
      },
    ])

    await draw()

    expect(screen.getByText(SAMPLE_NOTICE)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Rangmanch Collective' }).getAttribute('href')).toBe(
      '/organizers/rangmanch-collective',
    )
  })

  it('shows no sample notice when the API answered', async () => {
    serve([{ hasNextPage: false, events: [event('a', 'org-a', 'Organiser A')] }])

    await draw()

    expect(screen.queryByText(SAMPLE_NOTICE)).toBeNull()
  })

  it('says so plainly when nobody has anything listed', async () => {
    serve([{ total: 0, hasNextPage: false, events: [] }])

    await draw()

    expect(screen.getByText('No organisers have upcoming events listed')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Organisers' })).toBeNull()
  })

  it('has one h1 and makes no claim of popularity', async () => {
    serve([
      {
        hasNextPage: false,
        events: [
          event('a', 'org-a', 'Organiser A'),
          event('b', 'org-a', 'Organiser A'),
          event('c', 'org-b', 'Organiser B'),
        ],
      },
    ])

    const container = await draw()

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(container.textContent).not.toMatch(/popular|trending|selling fast/i)
  })

  it('is a public, indexable page', () => {
    expect(metadata.title).toBe('Organisers')
    expect(metadata.robots).toBeUndefined()
  })
})
