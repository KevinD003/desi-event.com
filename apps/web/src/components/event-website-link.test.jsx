import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { EventWebsiteLink } from './event-website-link.jsx'

describe('Visit the organiser’s website', () => {
  it('renders nothing without a link', () => {
    const { container } = render(<EventWebsiteLink slug="garba-night" link={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('links to The Desi Events’ own redirect, never the address, and names the host', () => {
    render(<EventWebsiteLink slug="garba-night" link={{ host: 'rangoli.example' }} />)

    const link = screen.getByRole('link', { name: 'Visit the organiser’s website' })

    expect(link).toHaveAttribute('href', '/events/garba-night/website')
    expect(link).toHaveAttribute('rel', 'nofollow')
    expect(link).not.toHaveAttribute('target')
    expect(screen.getByText('(rangoli.example)')).toBeInTheDocument()
    expect(link).toHaveAccessibleDescription(
      'Opens rangoli.example, which The Desi Events does not run. The Desi Events counts the visit without recording your address, browser or account.',
    )
  })

  it('marks a reader whose visits are not counted, and says so', () => {
    render(<EventWebsiteLink slug="garba-night" link={{ host: 'rangoli.example' }} uncounted />)

    const link = screen.getByRole('link', { name: 'Visit the organiser’s website' })

    expect(link).toHaveAttribute('href', '/events/garba-night/website?count=no')
    expect(link).toHaveAccessibleDescription(
      'Opens rangoli.example, which The Desi Events does not run. Visits by the event’s own team and staff at The Desi Events are not counted.',
    )
  })

  it('is only ever “Visit the organiser’s website”: it can no longer be relabelled “Buy tickets” as a main action', () => {
    // An imported event's tickets are sold here (ADR 0015, addendum
    // 2026-10-15 (2)), so the "Buy tickets" variant that sent buyers away is
    // gone: whatever is passed, the link says what it is and names its host.
    render(
      <EventWebsiteLink
        slug="garba-night"
        link={{ host: 'tickets.example.org' }}
        label="Buy tickets"
        button
      />,
    )

    const link = screen.getByRole('link', { name: 'Visit the organiser’s website' })

    expect(link).toHaveAttribute('href', '/events/garba-night/website')
    expect(link).toHaveAttribute('rel', 'nofollow')
    expect(link).toHaveAccessibleDescription(
      'Opens tickets.example.org, which The Desi Events does not run. The Desi Events counts the visit without recording your address, browser or account.',
    )
    expect(screen.queryByRole('link', { name: 'Buy tickets' })).toBeNull()
  })

  it('no longer takes a note in place of its host: where it goes is always printed', () => {
    render(
      <EventWebsiteLink
        slug="garba-night"
        link={{ host: 'tickets.example.org' }}
        note="Opens the organiser’s ticket page on another site."
      />,
    )

    expect(screen.getByText('(tickets.example.org)')).toBeInTheDocument()
    expect(screen.queryByText(/ticket page on another site/u)).toBeNull()
  })
})
