import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ImportedEventPanel, RESERVE_NOTE } from './imported-event-panel.jsx'

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

const event = (extra = {}) => ({
  title: 'Raga Night',
  slug: 'raga-night',
  // 7:30 PM in Houston on Friday 6 November: the day the message names is the venue's.
  startsAt: '2026-11-07T01:30:00.000Z',
  timezone: 'America/Chicago',
  venue: { name: 'Stafford Centre', city: 'Houston' },
  ...extra,
})

/** The exact address the owner's live site uses for this event. */
const RAGA_NIGHT_WHATSAPP =
  "https://wa.me/19726949043?text=Hi!%20I'd%20like%20to%20reserve%20tickets%20for%20%22Raga%20Night%22%20on%20Friday%2C%20November%206%20at%20Stafford%20Centre%2C%20Houston."

describe('ImportedEventPanel', () => {
  it('says the prices are as the organiser listed them, and offers Reserve on WhatsApp', () => {
    render(<ImportedEventPanel event={event()} importedFrom={importedFrom()} />)

    expect(
      screen.getByText('Prices are as the organiser listed them on 30 September 2026.'),
    ).toBeInTheDocument()

    const link = screen.getByRole('link', {
      name: 'Reserve on WhatsApp, opens WhatsApp in a new tab',
    })

    expect(link).toHaveTextContent('Reserve on WhatsApp')
    expect(link).toHaveAttribute('href', RAGA_NIGHT_WHATSAPP)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAccessibleDescription(RESERVE_NOTE)
  })

  it('no longer says the tickets are sold on another site, and offers no "Buy tickets" link', () => {
    render(
      <ImportedEventPanel
        event={event()}
        importedFrom={importedFrom({ prices: [], priceListed: false, ticketsOnSource: false })}
      />,
    )

    expect(screen.queryByText(/another site|not on the desi events/iu)).toBeNull()
    expect(screen.queryByRole('link', { name: /buy tickets/iu })).toBeNull()
    // Its one link is the company's own WhatsApp chat: nothing goes anywhere else.
    expect(screen.getAllByRole('link').map((link) => new URL(link.href).host)).toEqual(['wa.me'])
    expect(screen.queryByText(/not on sale/iu)).toBeNull()
  })

  it('keeps the prices note but offers no chat when the event can no longer be reserved', () => {
    render(<ImportedEventPanel event={event()} importedFrom={importedFrom()} reservable={false} />)

    expect(
      screen.getByText('Prices are as the organiser listed them on 30 September 2026.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(RESERVE_NOTE)).toBeNull()
  })

  it('leaves out a part of the message the event does not have, rather than guessing it', () => {
    render(
      <ImportedEventPanel
        event={event({ venue: { name: null, city: 'Toronto' } })}
        importedFrom={importedFrom()}
      />,
    )

    expect(screen.getByRole('link', { name: /reserve on whatsapp/iu })).toHaveAttribute(
      'href',
      "https://wa.me/19726949043?text=Hi!%20I'd%20like%20to%20reserve%20tickets%20for%20%22Raga%20Night%22%20on%20Friday%2C%20November%206%20at%20Toronto.",
    )
  })

  it('names no source site and no host of it, in text or in any attribute', () => {
    const { container } = render(
      <ImportedEventPanel event={event()} importedFrom={importedFrom()} />,
    )
    const shown = [
      container.textContent,
      ...[...container.querySelectorAll('*')].flatMap((element) =>
        [...element.attributes].map((attribute) => attribute.value),
      ),
    ].join('\n')

    expect(shown).not.toMatch(/sulekha/iu)
  })
})
