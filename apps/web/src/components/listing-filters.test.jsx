import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}))

const { EventFilters } = await import('./listing-filters.jsx')

const categories = [
  { value: 'GARBA_DANDIYA', label: 'Garba & Dandiya' },
  { value: 'COMEDY', label: 'Comedy' },
]

const cities = ['Ahmedabad', 'London']

/**
 * Render the filter bar with sensible defaults.
 *
 * @param {object} [filters] The filter state the server would have passed in.
 * @param {boolean} [anyActive] Whether the clear control should be offered.
 * @returns {object} A `userEvent` session bound to the rendered document.
 */
function renderFilters(filters = { category: '', city: '', q: '' }, anyActive = false) {
  render(
    <EventFilters
      categories={categories}
      cities={cities}
      filters={filters}
      anyActive={anyActive}
    />,
  )

  return userEvent.setup()
}

describe('EventFilters', () => {
  it('works without JavaScript: it is a GET form pointed at the listing', () => {
    renderFilters()
    const form = screen.getByRole('form', { name: 'Filter events' })

    expect(form).toHaveAttribute('action', '/events')
    expect(form).toHaveAttribute('method', 'get')
  })

  it('labels every control', () => {
    renderFilters()

    expect(screen.getByLabelText('Category')).toBeInTheDocument()
    expect(screen.getByLabelText('City')).toBeInTheDocument()
    expect(screen.getByLabelText('Search')).toBeInTheDocument()
  })

  it('shows the filters the server resolved from the URL', () => {
    renderFilters({ category: 'COMEDY', city: 'London', q: 'stand-up' })

    expect(screen.getByLabelText('Category')).toHaveValue('COMEDY')
    expect(screen.getByLabelText('City')).toHaveValue('London')
    expect(screen.getByLabelText('Search')).toHaveValue('stand-up')
  })

  it('offers every category and city, plus an "all" option for each', () => {
    renderFilters()

    expect(screen.getByRole('option', { name: 'All categories' })).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Every city' })).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Garba & Dandiya' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ahmedabad' })).toBeInTheDocument()
  })

  it('navigates as soon as a category is chosen, without waiting for a submit', async () => {
    const user = renderFilters()
    push.mockClear()

    await user.selectOptions(screen.getByLabelText('Category'), 'COMEDY')

    expect(push).toHaveBeenCalledWith('/events?category=COMEDY')
  })

  it('combines the category already chosen with a newly chosen city', async () => {
    const user = renderFilters({ category: 'COMEDY', city: '', q: '' })
    push.mockClear()

    await user.selectOptions(screen.getByLabelText('City'), 'London')

    expect(push).toHaveBeenCalledWith('/events?category=COMEDY&city=London')
  })

  it('applies a typed search on submit', async () => {
    const user = renderFilters()
    push.mockClear()

    await user.type(screen.getByLabelText('Search'), 'garba toronto')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(push).toHaveBeenCalledWith('/events?q=garba+toronto')
  })

  it('trims a search of stray whitespace rather than searching for it', async () => {
    const user = renderFilters()
    push.mockClear()

    await user.type(screen.getByLabelText('Search'), '  qawwali  ')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(push).toHaveBeenCalledWith('/events?q=qawwali')
  })

  it('returns to the canonical listing URL when everything is cleared', async () => {
    const user = renderFilters({ category: 'COMEDY', city: '', q: '' })
    push.mockClear()

    await user.selectOptions(screen.getByLabelText('Category'), '')

    expect(push).toHaveBeenCalledWith('/events')
  })

  it('only offers the clear control when something is actually filtered', () => {
    renderFilters()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  it('clears every filter at once', async () => {
    const user = renderFilters({ category: 'COMEDY', city: 'London', q: 'x' }, true)
    push.mockClear()

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(push).toHaveBeenCalledWith('/events')
  })
})
