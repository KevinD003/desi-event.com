import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ImportedEventPanel } from './imported-event-panel.jsx'

const importedFrom = (extra = {}) => ({
  sourceName: 'Sulekha',
  presentedBy: 'Raga Nights Houston',
  listedOn: '2026-09-30',
  prices: [
    { name: 'Adult', priceCents: 2500, currency: 'USD' },
    { name: 'Child', priceCents: 0, currency: 'USD' },
  ],
  priceListed: true,
  ticketsOnSource: true,
  ...extra,
})

describe('ImportedEventPanel', () => {
  it('says where tickets are sold, the prices as listed, and links to the listing', () => {
    render(
      <ImportedEventPanel
        importedFrom={importedFrom()}
        slug="raga-night"
        websiteLink={{ host: 'events.sulekha.com' }}
      />,
    )

    expect(
      screen.getByText('Tickets for this event are sold on Sulekha, not on The Desi Events.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('As listed on Sulekha on 30 September 2026: Adult $25.00, Child Free.'),
    ).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Buy tickets on Sulekha' })

    expect(link).toHaveAttribute('href', '/events/raga-night/website')
    expect(link).toHaveAccessibleDescription(
      'Opens events.sulekha.com, which The Desi Events does not run. The Desi Events counts the visit without recording your address, browser or account.',
    )
  })

  it('says the listing gives no price, and offers no link while it is off', () => {
    render(
      <ImportedEventPanel
        importedFrom={importedFrom({ prices: [], priceListed: false, ticketsOnSource: false })}
        slug="raga-night"
        websiteLink={null}
      />,
    )

    expect(screen.getByText('Sulekha does not list a price for this event.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(/not on sale/iu)).toBeNull()
  })

  it('marks an uncounted reader’s link', () => {
    render(
      <ImportedEventPanel
        importedFrom={importedFrom()}
        slug="raga-night"
        websiteLink={{ host: 'events.sulekha.com' }}
        uncounted
      />,
    )

    expect(screen.getByRole('link', { name: 'Buy tickets on Sulekha' })).toHaveAttribute(
      'href',
      '/events/raga-night/website?count=no',
    )
  })
})
