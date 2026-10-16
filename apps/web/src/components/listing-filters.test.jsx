import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { cleanup, render, screen } from '@testing-library/react'
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

/** States and provinces as the facets give them, out of order on purpose. */
const regions = [
  { country: 'CA', region: 'ON', name: 'Ontario', count: 4, cities: [] },
  { country: 'US', region: 'TX', name: 'Texas', count: 45, cities: [] },
  { country: 'US', region: 'NJ', name: 'New Jersey', count: 7, cities: [] },
  { country: 'CA', region: 'BC', name: 'British Columbia', count: 2, cities: [] },
]

const languages = ['Hindi', 'Gujarati']

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
      regions={regions}
      cities={cities}
      languages={languages}
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
    expect(screen.getByLabelText('State or province')).toBeInTheDocument()
    expect(screen.getByLabelText('City')).toBeInTheDocument()
    expect(screen.getByLabelText('Search')).toBeInTheDocument()
    expect(screen.getByLabelText('When')).toBeInTheDocument()
    expect(screen.getByLabelText('From')).toHaveAttribute('type', 'date')
    expect(screen.getByLabelText('To')).toHaveAttribute('type', 'date')
    expect(screen.getByLabelText('Language')).toBeInTheDocument()
    expect(screen.getByLabelText('Format')).toBeInTheDocument()
    expect(screen.getByLabelText('Free only')).toHaveAttribute('type', 'checkbox')
    expect(screen.getByLabelText('Tickets on sale now')).toHaveAttribute('type', 'checkbox')
    expect(screen.getByRole('group', { name: 'Price and tickets' })).toBeInTheDocument()
  })

  it('groups the states under their country, the United States first, with their counts', () => {
    renderFilters()
    const select = screen.getByLabelText('State or province')
    const groups = [...select.querySelectorAll('optgroup')]

    expect(groups.map((group) => group.label)).toEqual(['United States', 'Canada'])
    expect([...groups[0].querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'New Jersey (7)',
      'Texas (45)',
    ])
    expect([...groups[1].querySelectorAll('option')].map((option) => option.value)).toEqual([
      'CA-BC',
      'CA-ON',
    ])
    expect(screen.getByRole('option', { name: 'Every state and province' })).toHaveValue('')
  })

  it('says the City select follows the state', () => {
    renderFilters()
    expect(screen.getByLabelText('City')).toHaveAccessibleDescription(
      'Choose a state or province to list only its cities.',
    )

    cleanup()
    renderFilters({ category: '', region: 'US-TX', city: '', q: '' })
    expect(screen.getByLabelText('City')).toHaveAccessibleDescription(
      'Cities in the state or province you chose.',
    )
    expect(screen.getByRole('option', { name: 'Every city in this state' })).toHaveValue('')
  })

  it('clears the city when the state changes, and asks for the new state at once', async () => {
    const user = renderFilters({ category: 'COMEDY', region: 'US-TX', city: 'London', q: '' })
    push.mockClear()

    await user.selectOptions(screen.getByLabelText('State or province'), 'CA-ON')

    expect(screen.getByLabelText('City')).toHaveValue('')
    expect(push).toHaveBeenCalledWith('/events?category=COMEDY&region=CA-ON')
  })

  it('applies a language, a format and each switch the moment it is chosen', async () => {
    const user = renderFilters()

    push.mockClear()
    await user.selectOptions(screen.getByLabelText('Language'), 'Hindi')
    expect(push).toHaveBeenLastCalledWith('/events?language=Hindi')

    await user.selectOptions(screen.getByLabelText('Format'), 'online')
    expect(push).toHaveBeenLastCalledWith('/events?language=Hindi&format=online')

    await user.click(screen.getByLabelText('Free only'))
    expect(push).toHaveBeenLastCalledWith('/events?language=Hindi&format=online&free=true')

    await user.click(screen.getByLabelText('Tickets on sale now'))
    expect(push).toHaveBeenLastCalledWith(
      '/events?language=Hindi&format=online&free=true&onSale=true',
    )
  })

  it('applies a named span at once, and waits for Apply with chosen dates', async () => {
    const user = renderFilters()

    push.mockClear()
    await user.selectOptions(screen.getByLabelText('When'), 'weekend')
    expect(push).toHaveBeenLastCalledWith('/events?when=weekend')

    // Typing a day says "Choose dates" in When, and asks for nothing until Apply.
    push.mockClear()
    await user.type(screen.getByLabelText('From'), '2026-10-17')
    expect(screen.getByLabelText('When')).toHaveValue('dates')
    expect(push).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(push).toHaveBeenLastCalledWith('/events?when=dates&from=2026-10-17')

    // Back to a named span: the days go, so the two never disagree.
    await user.selectOptions(screen.getByLabelText('When'), 'today')
    expect(screen.getByLabelText('From')).toHaveValue('')
    expect(push).toHaveBeenLastCalledWith('/events?when=today')
  })

  it('does not ask for anything when Choose dates is picked with no day chosen', async () => {
    const user = renderFilters()
    push.mockClear()

    await user.selectOptions(screen.getByLabelText('When'), 'dates')

    expect(push).not.toHaveBeenCalled()
  })

  it('keeps More filters closed until one of them is chosen, and says how many are', () => {
    const { container } = render(
      <EventFilters
        categories={categories}
        regions={regions}
        cities={cities}
        languages={languages}
        filters={{ category: 'COMEDY', city: '', q: '' }}
      />,
    )
    const details = container.querySelector('details')

    expect(details).not.toHaveAttribute('open')
    expect(details.querySelector('summary')).toHaveTextContent(/^More filters$/)

    cleanup()
    const again = render(
      <EventFilters
        categories={categories}
        regions={regions}
        cities={cities}
        languages={languages}
        filters={{ category: '', city: '', q: '', language: 'Hindi', free: true }}
      />,
    )
    const open = again.container.querySelector('details')

    expect(open).toHaveAttribute('open')
    expect(open.querySelector('summary')).toHaveTextContent('More filters· 2 chosen')
  })

  it('shows every filter the server resolved from the URL', () => {
    renderFilters({
      category: 'COMEDY',
      region: 'US-TX',
      city: 'London',
      q: 'stand-up',
      language: 'Gujarati',
      when: 'dates',
      from: '2026-10-17',
      to: '2026-10-18',
      format: 'in_person',
      free: true,
      onSale: true,
    })

    expect(screen.getByLabelText('State or province')).toHaveValue('US-TX')
    expect(screen.getByLabelText('Language')).toHaveValue('Gujarati')
    expect(screen.getByLabelText('When')).toHaveValue('dates')
    expect(screen.getByLabelText('From')).toHaveValue('2026-10-17')
    expect(screen.getByLabelText('To')).toHaveValue('2026-10-18')
    expect(screen.getByLabelText('Format')).toHaveValue('in_person')
    expect(screen.getByLabelText('Free only')).toBeChecked()
    expect(screen.getByLabelText('Tickets on sale now')).toBeChecked()
  })

  it('describes the search as what the API searches, and promises nothing more', () => {
    // `GET /v1/events` needs every word to match an event's own text, its
    // venue, the venue's city or its organiser. Nothing else is searched, so
    // the field names exactly those.
    renderFilters()
    const search = screen.getByLabelText('Search')

    expect(search).toHaveAccessibleDescription(
      /^Searches events, venues, cities and organisers\. Every word has to match/,
    )
    expect(search).toHaveAttribute('placeholder', 'Event, venue or organiser')
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
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('clears every filter at once, in the URL and in every field', async () => {
    const user = renderFilters(
      {
        category: 'COMEDY',
        region: 'US-TX',
        city: 'London',
        q: 'x',
        language: 'Hindi',
        when: 'dates',
        from: '2026-10-17',
        to: '2026-10-18',
        format: 'online',
        free: true,
        onSale: true,
      },
      true,
    )
    push.mockClear()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(push).toHaveBeenCalledWith('/events')
    for (const label of [
      'Category',
      'State or province',
      'City',
      'Search',
      'When',
      'From',
      'To',
      'Language',
      'Format',
    ]) {
      expect(screen.getByLabelText(label)).toHaveValue('')
    }
    expect(screen.getByLabelText('Free only')).not.toBeChecked()
    expect(screen.getByLabelText('Tickets on sale now')).not.toBeChecked()
  })

  describe('a choice made before hydration', () => {
    /**
     * Put the server's HTML in the document, let `interact` change it the way
     * a visitor can before any script has run, then hydrate.
     *
     * @param {Function} interact What the visitor does first, given the form.
     * @param {object} [filters] The filter state the server rendered.
     * @returns {Promise<{unmount: Function}>} The hydrated root.
     */
    async function hydrateAfter(interact, filters = { category: '', city: '', q: '' }) {
      const tree = (
        <EventFilters
          categories={categories}
          regions={regions}
          cities={cities}
          languages={languages}
          filters={filters}
        />
      )
      const container = document.createElement('div')
      container.innerHTML = renderToString(tree)
      document.body.append(container)

      const form = container.querySelector('form')
      expect(form).not.toHaveAttribute('data-enhanced')

      interact(form)
      push.mockClear()

      let root
      await act(async () => {
        root = hydrateRoot(container, tree)
      })

      expect(form).toHaveAttribute('data-enhanced', 'true')

      return {
        unmount() {
          act(() => root.unmount())
          container.remove()
        },
      }
    }

    it('is applied once the page hydrates, instead of leaving the box and the listing apart', async () => {
      const { unmount } = await hydrateAfter((form) => {
        form.elements.namedItem('city').value = 'London'
      })

      expect(push).toHaveBeenCalledTimes(1)
      expect(push).toHaveBeenCalledWith('/events?city=London')
      unmount()
    })

    it('keeps the filters already in the address when applying it', async () => {
      const { unmount } = await hydrateAfter(
        (form) => {
          form.elements.namedItem('city').value = 'London'
        },
        { category: 'COMEDY', city: '', q: '' },
      )

      expect(push).toHaveBeenCalledWith('/events?category=COMEDY&city=London')
      unmount()
    })

    it('does nothing when the form still matches the address', async () => {
      const { unmount } = await hydrateAfter(() => {}, { category: 'COMEDY', city: '', q: '' })

      expect(push).not.toHaveBeenCalled()
      unmount()
    })

    it('replays a state chosen before hydration, without the last state’s city', async () => {
      const { unmount } = await hydrateAfter(
        (form) => {
          form.elements.namedItem('region').value = 'CA-ON'
        },
        { category: '', region: 'US-TX', city: 'London', q: '' },
      )

      expect(push).toHaveBeenCalledTimes(1)
      expect(push).toHaveBeenCalledWith('/events?region=CA-ON')
      unmount()
    })

    it('replays a switch or a named span chosen before hydration', async () => {
      const first = await hydrateAfter((form) => {
        form.elements.namedItem('free').checked = true
      })
      expect(push).toHaveBeenCalledWith('/events?free=true')
      first.unmount()

      const second = await hydrateAfter(
        (form) => {
          form.elements.namedItem('when').value = 'month'
        },
        { category: '', city: '', q: '', when: 'dates', from: '2026-10-17', to: '' },
      )
      expect(push).toHaveBeenCalledWith('/events?when=month')
      second.unmount()
    })

    it('leaves days typed before hydration for the visitor to apply', async () => {
      const { unmount } = await hydrateAfter((form) => {
        form.elements.namedItem('when').value = 'dates'
        form.elements.namedItem('from').value = '2026-10-17'
      })

      expect(push).not.toHaveBeenCalled()
      unmount()
    })

    it('leaves a half-typed search for the visitor to submit', async () => {
      const { unmount } = await hydrateAfter((form) => {
        form.elements.namedItem('q').value = 'dand'
      })

      expect(push).not.toHaveBeenCalled()
      unmount()
    })
  })
})
