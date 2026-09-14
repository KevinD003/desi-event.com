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

  it('says the same thing however the resource went missing', () => {
    // The component takes no props at all: there is no argument that could make
    // it distinguish "never published" from "withdrawn" from "deleted", so the
    // page cannot be used to probe which of those a URL is.
    expect(NotFoundView).toHaveLength(0)
  })
})
