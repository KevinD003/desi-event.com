/**
 * The venue directory lists only venues it can link to, says only what each
 * one asserts, and never passes a failure off as an empty directory.
 *
 * The properties worth pinning:
 *
 *   - **No dead links.** A venue with no slug, or one merged into another, is
 *     not linked.
 *   - **Accessibility is the venue's own claim**, in the words its page uses,
 *     and an absent claim is never drawn as a "no"; a venue that wrote only a
 *     note is not called silent.
 *   - **A failed read is a failure.** The page draws the refusal, not "no
 *     venues", repeats nothing from the error's message, and does not tell
 *     the visitor to check a connection that was never the problem.
 *   - **The filter is the API's.** A GET form whose checkboxes carry the API's
 *     vocabulary, whose state survives into the pagination links, and which is
 *     honest about the filter being applied a page at a time.
 *   - **No sample data, and no hype.**
 *
 * @module app/venues/page.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/venues',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/request-path.js', () => ({ requestPath: async () => '/venues' }))
vi.mock('../../lib/api.js', () => ({
  getApiClient: vi.fn(),
  loadEventList: vi.fn(),
  loadCatalogueFacets: vi.fn(),
}))

const { getApiClient } = await import('../../lib/api.js')
const { default: VenuesPage, metadata } = await import('./page.jsx')

/** The venue read the page makes, replaced per test. */
const list = vi.fn()

/**
 * A venue summary as `GET /v1/venues` returns it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The summary.
 */
function venue(overrides = {}) {
  return {
    id: 'vnu00000000000000000001',
    slug: 'jio-world-garden',
    name: 'Jio World Garden',
    addressLine1: 'Bandra Kurla Complex',
    addressLine2: null,
    city: 'Mumbai',
    region: 'Maharashtra',
    postalCode: '400051',
    country: 'IN',
    latitude: null,
    longitude: null,
    capacity: 6000,
    timezone: 'Asia/Kolkata',
    shared: true,
    mergedIntoVenueId: null,
    accessibility: { features: ['STEP_FREE_ENTRANCE', 'HEARING_LOOP'], note: null },
    ...overrides,
  }
}

/**
 * Render the page for a query string.
 *
 * @param {Record<string, string|string[]>} [query] The search parameters.
 * @returns {Promise<HTMLElement>} The container.
 */
async function draw(query = {}) {
  const { container } = render(await VenuesPage({ searchParams: Promise.resolve(query) }))

  return container
}

/**
 * A listing response.
 *
 * @param {object[]} data The venues.
 * @param {object} [pagination] Pagination overrides.
 * @returns {object} The response body.
 */
function listing(data, pagination = {}) {
  return {
    data,
    pagination: { page: 1, perPage: 48, total: data.length, hasNextPage: false, ...pagination },
  }
}

beforeEach(() => {
  list.mockReset()
  getApiClient.mockReturnValue({ venues: { list } })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('the venue directory', () => {
  it('links each listable venue to its page, with where it is and how many it holds', async () => {
    list.mockResolvedValue(listing([venue()]))

    await draw()

    const link = screen.getByRole('link', { name: 'Jio World Garden' })

    expect(link.getAttribute('href')).toBe('/venues/jio-world-garden')

    const item = link.closest('li')

    expect(within(item).getByText('Mumbai, Maharashtra, India')).toBeInTheDocument()
    expect(within(item).getByText('Capacity 6,000')).toBeInTheDocument()
  })

  it('does not link a venue with no slug, or one merged into another', async () => {
    list.mockResolvedValue(
      listing([
        venue(),
        venue({ id: 'vnu00000000000000000002', slug: null, name: 'Hall With No Page' }),
        venue({
          id: 'vnu00000000000000000003',
          slug: 'old-duplicate',
          name: 'Old Duplicate Hall',
          mergedIntoVenueId: 'vnu00000000000000000001',
        }),
      ]),
    )

    const container = await draw()

    expect(screen.queryByRole('link', { name: 'Hall With No Page' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Old Duplicate Hall' })).toBeNull()
    expect(container.querySelector('a[href="/venues/old-duplicate"]')).toBeNull()
    expect(screen.getByTestId('venue-summary').textContent).toBe('1 venue on this page')
  })

  it('shows exactly the accessibility the venue asserts, in the venue page’s words', async () => {
    list.mockResolvedValue(
      listing([
        venue(),
        venue({
          id: 'vnu00000000000000000004',
          slug: 'tagore-hall',
          name: 'Tagore Hall',
          accessibility: null,
        }),
      ]),
    )

    await draw()

    const garden = screen.getByRole('list', { name: 'Accessibility at Jio World Garden' })

    expect(
      within(garden)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Step-free entrance', 'Hearing loop'])
    expect(within(garden).queryByText('Accessible toilet')).toBeNull()

    const tagore = screen.getByRole('link', { name: 'Tagore Hall' }).closest('li')

    expect(
      within(tagore).getByText('This venue has not published its accessibility details.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Accessibility at Tagore Hall' })).toBeNull()
  })

  it('does not call a venue silent when it wrote a note but ticked no claim', async () => {
    list.mockResolvedValue(
      listing([
        venue({
          accessibility: { features: [], note: 'Accessible entrance at Gate 3; ring the bell.' },
        }),
        venue({
          id: 'vnu00000000000000000005',
          slug: 'troxy',
          name: 'Troxy',
          accessibility: { features: ['HEARING_LOOP'], note: 'Loop covers the stalls only.' },
        }),
      ]),
    )

    await draw()

    const garden = screen.getByRole('link', { name: 'Jio World Garden' }).closest('li')

    expect(within(garden).queryByText(/has not published/)).toBeNull()
    expect(
      within(garden).getByText('The venue describes its accessibility in a note on its page.'),
    ).toBeInTheDocument()

    const troxy = screen.getByRole('link', { name: 'Troxy' }).closest('li')

    expect(within(troxy).getByText('Hearing loop')).toBeInTheDocument()
    expect(
      within(troxy).getByText('The venue adds an accessibility note on its page.'),
    ).toBeInTheDocument()
  })

  it('draws an unanswered read as a failure at our end, not as an empty directory or the visitor’s connection', async () => {
    list.mockRejectedValue(
      Object.assign(new Error('Request to GET http://127.0.0.1:4000/v1/venues failed'), {
        status: 0,
        code: 'NETWORK_ERROR',
      }),
    )

    const container = await draw()

    expect(screen.getByText(/The venue directory could not be loaded/)).toBeInTheDocument()
    expect(screen.getByText(/The service could not finish this/)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Check your connection|Nothing reached Desi-Event/)
    expect(container.textContent).not.toMatch(/No venues are listed|venues? on this page/)
    expect(screen.queryByRole('list', { name: 'Venues' })).toBeNull()
    expect(container.textContent).not.toContain('/v1/')
    expect(container.textContent).not.toContain('127.0.0.1')
  })

  it('draws a server error, and a response with no listing, as the same failure', async () => {
    list.mockRejectedValueOnce(
      Object.assign(new Error('Request to GET /v1/venues failed with 500'), {
        status: 500,
        code: 'INTERNAL_ERROR',
      }),
    )

    const first = await draw()

    expect(screen.getByText(/The venue directory could not be loaded/)).toBeInTheDocument()
    expect(first.textContent).not.toMatch(/No venues are listed|Check your connection/)
    first.remove()

    list.mockResolvedValueOnce({ data: null })

    const second = await draw()

    expect(second.textContent).toMatch(/The venue directory could not be loaded/)
    expect(second.textContent).not.toMatch(/No venues are listed|Check your connection/)
    expect(second.textContent).not.toContain('MALFORMED_RESPONSE')
  })

  it('says to wait when rate limited, and offers no sign-in on this public page when refused', async () => {
    list.mockRejectedValueOnce(
      Object.assign(new Error('Too many requests'), { status: 429, code: 'RATE_LIMITED' }),
    )

    const limited = await draw()

    expect(limited.textContent).toMatch(/Too many attempts/)
    expect(limited.textContent).not.toMatch(/No venues are listed/)
    limited.remove()

    list.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorised'), { status: 401, code: 'UNAUTHENTICATED' }),
    )

    const refused = await draw()

    expect(refused.textContent).toMatch(/The venue directory could not be loaded/)
    expect(refused.textContent).not.toMatch(/Sign in|Not for this account/)
  })

  it('says the directory is empty only when the API answered with nothing', async () => {
    list.mockResolvedValue(listing([]))

    const container = await draw()

    expect(screen.getByText('No venues are listed')).toBeInTheDocument()
    expect(screen.queryByText(/could not be loaded/)).toBeNull()
    // Nothing implies something is on the way.
    expect(container.textContent).not.toMatch(/\byet\b|coming soon/i)
  })

  it('offers the API’s accessibility vocabulary in a GET form and asks the API for what was ticked', async () => {
    list.mockResolvedValue(listing([venue()]))

    await draw({ city: 'Mumbai', accessibility: ['HEARING_LOOP', 'NOT_A_CLAIM'] })

    const form = screen.getByRole('form', { name: 'Filter venues' })

    expect(form.getAttribute('method')).toBe('get')
    expect(form.getAttribute('action')).toBe('/venues')
    expect(within(form).getAllByRole('checkbox')).toHaveLength(15)
    expect(within(form).getByRole('checkbox', { name: 'Hearing loop' })).toBeChecked()
    expect(within(form).getByRole('checkbox', { name: 'Step-free entrance' })).not.toBeChecked()
    expect(within(form).getByRole('textbox', { name: 'City' })).toHaveValue('Mumbai')

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'Mumbai', accessibility: ['HEARING_LOOP'], page: 1 }),
      expect.anything(),
    )
  })

  it('names the needs it could not apply rather than sending more than the API accepts', async () => {
    list.mockResolvedValue(listing([venue()]))

    await draw({
      accessibility: [
        'STEP_FREE_ENTRANCE',
        'STEP_FREE_TO_SEATING',
        'ACCESSIBLE_TOILET',
        'ACCESSIBLE_PARKING',
        'WHEELCHAIR_SPACES',
        'COMPANION_SEATING',
        'CAPTIONING',
      ],
    })

    expect(list.mock.calls[0][0].accessibility).toHaveLength(6)
    expect(screen.getByText(/so these were left out: Captioning\./)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Captioning' })).not.toBeChecked()
  })

  it('keeps the filters in the pagination links and is honest that the filter works a page at a time', async () => {
    list.mockResolvedValue(listing([], { page: 2, hasNextPage: true }))

    await draw({ city: 'London', accessibility: 'HEARING_LOOP', page: '2' })

    const pages = screen.getByRole('navigation', { name: 'Directory pages' })

    expect(within(pages).getByRole('link', { name: /Next/ }).getAttribute('href')).toBe(
      '/venues?city=London&accessibility=HEARING_LOOP&page=3',
    )
    expect(
      within(pages)
        .getByRole('link', { name: /Previous/ })
        .getAttribute('href'),
    ).toBe('/venues?city=London&accessibility=HEARING_LOOP')
    expect(screen.getByText('None of the venues on this page can be shown')).toBeInTheDocument()
    expect(screen.queryByText('No venues match those filters')).toBeNull()
    expect(screen.getAllByText(/applied a page at a time/).length).toBeGreaterThan(0)
  })

  it('does not call a filtered last page the end of the directory', async () => {
    list.mockResolvedValue(listing([], { page: 2, hasNextPage: false }))

    await draw({ accessibility: 'HEARING_LOOP', page: '2' })

    expect(screen.getByText('None of the venues on this page match')).toBeInTheDocument()
    expect(screen.queryByText('There is nothing on this page')).toBeNull()
    expect(screen.queryByText('No venues are listed')).toBeNull()
  })

  it('never shows the sample notice, has one h1, and makes no claim of popularity', async () => {
    list.mockResolvedValue(listing([venue()]))

    const container = await draw()

    expect(screen.queryByText('Showing our sample programme')).toBeNull()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(container.textContent).not.toMatch(/popular|trending|selling fast/i)
  })

  it('is a public, indexable page', () => {
    expect(metadata.title).toBe('Venues')
    expect(metadata.robots).toBeUndefined()
  })
})
