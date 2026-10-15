/**
 * The category directory says what the facets say, and nothing more.
 *
 * The properties worth pinning:
 *
 *   - **Counts come from the facet data** and each category links to its
 *     filtered listing.
 *   - **An empty category is still listed**, in honest words, and still links.
 *   - **Unknown is not zero.** A facet payload with no category list shows no
 *     counts at all rather than fourteen "nothing listed".
 *   - **The sample notice appears exactly when the facets came from the
 *     fallback**, and nothing on the page ranks or hypes.
 *
 * @module app/categories/page.test
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('../../lib/api.js', () => ({
  loadCatalogueFacets: vi.fn(),
  loadEventList: vi.fn(),
  getApiClient: vi.fn(),
}))

const { loadCatalogueFacets } = await import('../../lib/api.js')
const { default: CategoriesPage, metadata } = await import('./page.jsx')

/** The sample-data notice's title. */
const SAMPLE_NOTICE = 'Showing our sample programme'

/**
 * Render the page for a facet result.
 *
 * @param {object} facets The facets.
 * @param {boolean} [usedFallback] Whether they came from the sample catalogue.
 * @returns {Promise<HTMLElement>} The container.
 */
async function draw(facets, usedFallback = false) {
  loadCatalogueFacets.mockResolvedValue({ facets, usedFallback })

  const { container } = render(await CategoriesPage())

  return container
}

/**
 * The card for one category, found by its heading.
 *
 * @param {string} label The category label.
 * @returns {HTMLElement} The card's link.
 */
function card(label) {
  return screen.getByRole('heading', { level: 2, name: label }).closest('a')
}

describe('the category directory', () => {
  it('shows each category with its facet count, linking to the filtered listing', async () => {
    await draw({
      categories: [
        { value: 'COMEDY', count: 12 },
        { value: 'GARBA_DANDIYA', count: 1 },
      ],
    })

    const comedy = card('Comedy')
    const garba = card('Garba & Dandiya')

    expect(comedy.getAttribute('href')).toBe('/events?category=COMEDY')
    expect(within(comedy).getByText('12 events')).toBeInTheDocument()
    expect(garba.getAttribute('href')).toBe('/events?category=GARBA_DANDIYA')
    expect(within(garba).getByText('1 event')).toBeInTheDocument()
  })

  it('still lists and links a category with nothing in it, and says so', async () => {
    await draw({ categories: [{ value: 'COMEDY', count: 3 }] })

    const theatre = card('Theatre')

    expect(theatre.getAttribute('href')).toBe('/events?category=THEATRE')
    expect(within(theatre).getByText('Nothing listed right now')).toBeInTheDocument()
    expect(within(theatre).queryByText(/0 events/)).toBeNull()
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(14)
  })

  it('shows no counts, rather than zeros, when the facets carry no category list', async () => {
    const container = await draw({ cities: [] })

    expect(screen.queryAllByTestId('category-count')).toHaveLength(0)
    expect(container.textContent).not.toContain('Nothing listed right now')
    expect(
      screen.getByText(/could not be read just now, so no counts are shown/),
    ).toBeInTheDocument()
    expect(card('Comedy').getAttribute('href')).toBe('/events?category=COMEDY')
  })

  it('shows the sample notice when, and only when, the facets came from the fallback', async () => {
    await draw({ categories: [{ value: 'COMEDY', count: 2 }] }, true)
    expect(screen.getByText(SAMPLE_NOTICE)).toBeInTheDocument()
  })

  it('shows no sample notice when the API answered', async () => {
    await draw({ categories: [{ value: 'COMEDY', count: 2 }] }, false)
    expect(screen.queryByText(SAMPLE_NOTICE)).toBeNull()
  })

  it('has one h1 and makes no claim of popularity', async () => {
    const container = await draw({
      categories: [
        { value: 'COMEDY', count: 900 },
        { value: 'SPORTS', count: 1 },
      ],
    })

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(container.textContent).not.toMatch(/popular|trending|selling fast/i)
  })

  it('is a public, indexable page', () => {
    expect(metadata.title).toBe('Categories')
    expect(metadata.description).toEqual(expect.any(String))
    expect(metadata.robots).toBeUndefined()
  })
})
