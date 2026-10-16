import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { NotFoundView } from './not-found-view.jsx'

describe('NotFoundView', () => {
  it('leads with a heading that says the page is not there', () => {
    render(<NotFoundView />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/not on the bill/i)
  })

  it('explains what happened in a sentence a visitor can act on', () => {
    render(<NotFoundView />)

    expect(document.body).toHaveTextContent(/finished its run or never existed/i)
  })

  it('offers discovery, search and home', () => {
    render(<NotFoundView />)

    expect(screen.getByRole('link', { name: 'Browse every event' })).toHaveAttribute(
      'href',
      '/events',
    )
    expect(screen.getByRole('link', { name: 'Search events' })).toHaveAttribute(
      'href',
      '/events#filter-q',
    )
    expect(screen.getByRole('link', { name: 'Back to the home page' })).toHaveAttribute('href', '/')
  })

  it('animates nothing, so reduced motion has nothing to suppress', () => {
    const { container } = render(<NotFoundView />)

    expect(container.querySelectorAll('[data-motion]')).toHaveLength(0)
  })

  it('keeps its poster plate away from assistive technology, and draws no festival ornament', () => {
    const { container } = render(<NotFoundView />)
    const plate = container.querySelector('[data-plate]')

    expect(plate.getAttribute('aria-hidden')).toBe('true')
    expect(plate.querySelectorAll('a, button')).toHaveLength(0)
    // The plate's joke repeats the heading; the page's words are the heading.
    expect(plate.textContent).toMatch(/Admit\s*none/u)
    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(container.querySelector('.mirror-band, [data-ornament]')).toBeNull()
  })

  it('says the same thing however the resource went missing', () => {
    // The component takes no props at all: there is no argument that could make
    // it distinguish "never published" from "withdrawn" from "deleted", so the
    // page cannot be used to probe which of those a URL is.
    expect(NotFoundView).toHaveLength(0)
  })
})
