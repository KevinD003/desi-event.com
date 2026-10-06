import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { EventWebsiteLink } from './event-website-link.jsx'

describe('Visit the organiser’s website', () => {
  it('renders nothing without a link', () => {
    const { container } = render(<EventWebsiteLink slug="garba-night" link={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('links to Desi-Event’s own redirect, never the address, and names the host', () => {
    render(<EventWebsiteLink slug="garba-night" link={{ host: 'rangoli.example' }} />)

    const link = screen.getByRole('link', { name: 'Visit the organiser’s website' })

    expect(link).toHaveAttribute('href', '/events/garba-night/website')
    expect(link).toHaveAttribute('rel', 'nofollow')
    expect(link).not.toHaveAttribute('target')
    expect(screen.getByText('(rangoli.example)')).toBeInTheDocument()
    expect(link).toHaveAccessibleDescription(
      'Opens rangoli.example, which Desi-Event does not run. Desi-Event counts the visit without recording your address, browser or account.',
    )
  })

  it('marks a reader whose visits are not counted, and says so', () => {
    render(<EventWebsiteLink slug="garba-night" link={{ host: 'rangoli.example' }} uncounted />)

    const link = screen.getByRole('link', { name: 'Visit the organiser’s website' })

    expect(link).toHaveAttribute('href', '/events/garba-night/website?count=no')
    expect(link).toHaveAccessibleDescription(
      'Opens rangoli.example, which Desi-Event does not run. Visits by the event’s own team and Desi-Event staff are not counted.',
    )
  })

  it('can say where tickets are bought, as the page’s main action, with the same note', () => {
    render(
      <EventWebsiteLink
        slug="garba-night"
        link={{ host: 'events.sulekha.com' }}
        label="Buy tickets on Sulekha"
        button
      />,
    )

    const link = screen.getByRole('link', { name: 'Buy tickets on Sulekha' })

    expect(link).toHaveAttribute('href', '/events/garba-night/website')
    expect(link).toHaveAttribute('rel', 'nofollow')
    expect(link).toHaveAccessibleDescription(
      'Opens events.sulekha.com, which Desi-Event does not run. Desi-Event counts the visit without recording your address, browser or account.',
    )
    expect(screen.queryByRole('link', { name: 'Visit the organiser’s website' })).toBeNull()
  })
})
