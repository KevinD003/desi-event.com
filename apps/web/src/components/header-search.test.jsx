/**
 * The header's search trigger: a button that opens a GET form to the
 * listing's own search, and adds nothing to the page until it is asked for.
 *
 * @module components/header-search.test
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(''),
}))

const { HeaderSearch } = await import('./header-search.jsx')

afterEach(cleanup)

describe('HeaderSearch', () => {
  it('is a button drawn from 1024px, and no search box until it is pressed', () => {
    render(<HeaderSearch />)

    const trigger = screen.getByRole('button', { name: 'Search' })

    expect(trigger.className).toContain('hidden')
    expect(trigger.className).toContain('lg:inline-flex')
    expect(trigger.className).toContain('min-h-11')
    expect(screen.queryByRole('search')).toBeNull()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('opens a search of the listing, by the parameter the listing reads', async () => {
    render(<HeaderSearch />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    })

    const form = await screen.findByRole('search', { name: 'Search events' })
    const box = within(form).getByLabelText('Search events, venues, cities and organisers')

    expect(form.getAttribute('action')).toBe('/events')
    expect(box).toHaveAttribute('name', 'q')
    expect(box).toHaveAttribute('maxlength', '100')
    expect(within(form).getByRole('button', { name: 'Search' })).toHaveAttribute('type', 'submit')
  })
})
