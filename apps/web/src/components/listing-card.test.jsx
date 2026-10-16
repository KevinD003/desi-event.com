import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { AvailabilityChip, EventCard, EventGrid } from './listing-card.jsx'

/** A listing summary as the API sends one: an Edison garba night, priced in dollars. */
const garba = {
  id: 'evtnavratrinightone',
  slug: 'navratri-night-one-edison',
  title: 'Navratri Night One: Garba Under the Lights',
  summary: 'Nine nights open with aarti at the lit garbo and a live dhol.',
  category: 'GARBA_DANDIYA',
  startsAt: '2026-10-11T23:30:00.000Z',
  endsAt: '2026-10-12T04:30:00.000Z',
  timezone: 'America/New_York',
  city: 'Edison',
  venueName: 'Lamplight Expo Hall',
  minPriceCents: 3500,
  currency: 'USD',
  soldOut: false,
}

describe('EventCard', () => {
  it('links to the event exactly once, so the card is one entry in the links list', () => {
    render(<EventCard event={garba} />)
    const links = screen.getAllByRole('link')

    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/events/navratri-night-one-edison')
    expect(links[0]).toHaveAccessibleName('Navratri Night One: Garba Under the Lights')
  })

  it('describes the poster rather than leaving an unlabelled graphic', () => {
    render(<EventCard event={garba} />)

    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Illustration of garba dancers circling a lit lamp under festival lights for Navratri Night One: Garba Under the Lights',
    )
  })

  it('shows the approved cover in the organiser’s words, and keeps the link named by the title', () => {
    const { container } = render(
      <EventCard
        event={{
          ...garba,
          coverImage: {
            id: 'cmedia0000000000000000001',
            url: '/v1/media/cmedia0000000000000000001',
            altText: 'Dancers circling a lit garbo',
            width: 1200,
            height: 800,
            contentType: 'image/jpeg',
          },
        }}
      />,
    )

    const cover = screen.getByRole('img', { name: 'Dancers circling a lit garbo' })

    expect(cover.getAttribute('src')).toContain(
      'url=%2Fapi%2Fv1%2Fmedia%2Fcmedia0000000000000000001',
    )
    expect(container.querySelector('svg[data-slot="poster"]')).toBeNull()
    expect(screen.getByRole('link')).toHaveAccessibleName(
      'Navratri Night One: Garba Under the Lights',
    )
  })

  it('shows the human category label, not the enum member, and says what it is', () => {
    render(<EventCard event={garba} />)

    const label = screen.getByText('Garba & Dandiya')

    expect(label.textContent).toBe('Category: Garba & Dandiya')
    expect(screen.queryByText('GARBA_DANDIYA')).not.toBeInTheDocument()
  })

  it('states the start in the event’s own zone, with the zone’s letters', () => {
    render(<EventCard event={garba} />)

    // 23:30 UTC on 11 October is 7:30 PM in New York, on daylight time. The
    // year is shown only when it is not the current one, so it is not pinned.
    expect(screen.getByText(/^Sun, Oct 11(, 2026)? · 7:30 PM EDT$/)).toBeInTheDocument()
  })

  it('keeps the event’s zone rather than the reader’s, wherever the event is', () => {
    render(
      <EventCard
        event={{
          ...garba,
          startsAt: '2026-10-12T02:30:00.000Z',
          timezone: 'America/Los_Angeles',
          city: 'Santa Clara',
        }}
      />,
    )

    // The same instant is Sunday night in Santa Clara and Monday in New York.
    expect(screen.getByText(/^Sun, Oct 11(, 2026)? · 7:30 PM PDT$/)).toBeInTheDocument()
  })

  it('gives the date a machine-readable value', () => {
    const { container } = render(<EventCard event={garba} />)

    expect(container.querySelector('time')).toHaveAttribute('dateTime', '2026-10-11T23:30:00.000Z')
  })

  it('says where: the venue and the city, or that it is online', () => {
    const { rerender } = render(<EventCard event={garba} />)

    expect(screen.getByText('Lamplight Expo Hall · Edison')).toBeInTheDocument()

    rerender(<EventCard event={{ ...garba, isOnline: true }} />)
    // Once on the poster, once as the place.
    expect(screen.getAllByText('Online')).toHaveLength(2)
    expect(screen.queryByText(/Lamplight Expo Hall/)).not.toBeInTheDocument()
  })

  it('puts the state or province after the city when the summary carries it', () => {
    const { rerender } = render(<EventCard event={{ ...garba, region: 'NJ', country: 'US' }} />)

    expect(screen.getByText('Lamplight Expo Hall · Edison, NJ')).toBeInTheDocument()

    rerender(
      <EventCard
        event={{ ...garba, venueName: null, city: 'Toronto', region: 'ON', country: 'CA' }}
      />,
    )
    expect(screen.getByText('Toronto, ON')).toBeInTheDocument()
  })

  it('prices in US dollars', () => {
    render(<EventCard event={garba} />)

    expect(screen.getByText('$35.00')).toBeInTheDocument()
  })

  it('still prices an event in its own currency when that is not dollars', () => {
    render(<EventCard event={{ ...garba, minPriceCents: 149_900, currency: 'INR' }} />)

    expect(screen.getByText('₹1,499.00')).toBeInTheDocument()
  })

  it('says so when tickets have gone, with the meaning spelled out for a screen reader', () => {
    render(<EventCard event={{ ...garba, soldOut: true }} />)

    expect(screen.getByText('Sold out')).toBeInTheDocument()
    expect(screen.getByText(/^Availability:/)).toBeInTheDocument()
  })

  it('says it is on sale only when the API says a ticket can be bought now', () => {
    const { rerender } = render(<EventCard event={{ ...garba, salesOpen: true }} />)

    expect(screen.getByText('On sale')).toBeInTheDocument()

    rerender(<EventCard event={{ ...garba, salesOpen: false }} />)
    expect(screen.queryByText('On sale')).not.toBeInTheDocument()
    expect(screen.getByText('Not on sale now')).toBeInTheDocument()

    rerender(<EventCard event={{ ...garba, status: 'SALES_PAUSED', salesOpen: false }} />)
    expect(screen.getByText('Sales paused')).toBeInTheDocument()
  })

  it('invents no urgency: no count, no "selling fast", no "few left"', () => {
    const { container } = render(<EventCard event={{ ...garba, salesOpen: true }} />)

    expect(container.textContent).not.toMatch(
      /selling fast|few left|only \d+|hurry|popular|trending/i,
    )
  })

  it('names the organiser', () => {
    render(<EventCard event={{ ...garba, organizationName: 'Mirrorwork Events' }} />)

    expect(screen.getByText('Mirrorwork Events')).toBeInTheDocument()
  })

  it('claims no verification it was not told about', () => {
    // A listing summary carries no verification state, so a card that drew a
    // badge would be inferring an endorsement nobody made.
    const { container } = render(
      <EventCard event={{ ...garba, organizationName: 'Mirrorwork Events' }} />,
    )

    expect(container.textContent).not.toMatch(/verified/i)
  })

  it('shows the all-in price when the API sends it, and says what it includes', () => {
    render(<EventCard event={{ ...garba, minPriceCents: 3500, minTotalCents: 3806 }} />)

    expect(screen.getByText('$38.06')).toBeInTheDocument()
    expect(screen.getByText('including any fees and tax')).toBeInTheDocument()
    // The face value is not presented as the price.
    expect(screen.queryByText('$35.00')).not.toBeInTheDocument()
  })

  it('says a face value is before fees when that is all it has', () => {
    render(<EventCard event={garba} />)

    expect(screen.getByText('$35.00')).toBeInTheDocument()
    expect(screen.getByText('before fees and tax')).toBeInTheDocument()
  })

  it('reads a free event as free, not as "from free"', () => {
    const { container } = render(
      <EventCard event={{ ...garba, minPriceCents: 0, minTotalCents: 0, salesOpen: true }} />,
    )

    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/from free/i)
  })

  it('does not invent a price for an event with no tiers yet', () => {
    render(<EventCard event={{ ...garba, minPriceCents: null, currency: null }} />)

    expect(screen.getByText('Price to be announced')).toBeInTheDocument()
  })

  it('uses the heading level the surrounding page asks for', () => {
    render(<EventCard event={garba} headingLevel="h2" />)

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Navratri Night One: Garba Under the Lights',
    )
  })
})

describe('EventCard for an event imported from an organiser’s listing', () => {
  // Sold here like any other (ADR 0015, addendum 2026-10-15 (2)): the API sends
  // its ticket types' `minPriceCents`, `currency` and `salesOpen` as for every
  // event, and still sends `importedFrom` (with a source name the card ignores).
  const imported = (summary = {}, extra = {}) => ({
    ...garba,
    minPriceCents: 2500,
    currency: 'USD',
    salesOpen: true,
    status: 'ON_SALE',
    organizationName: 'The Desi Events',
    importedFrom: {
      sourceName: 'Sulekha',
      presentedBy: 'Raga Nights Houston',
      listedOn: '2026-09-30',
      prices: [
        { name: 'Child', priceCents: 0, currency: 'USD' },
        { name: 'Adult', priceCents: 2500, currency: 'USD' },
      ],
      priceListed: true,
      ticketsOnSource: false,
      ...extra,
    },
    ...summary,
  })

  it('gives “From” its cheapest ticket type, as any card does, without naming the site', () => {
    const { container } = render(<EventCard event={imported()} />)

    expect(container.textContent).toContain('From $25.00')
    expect(screen.getByText('before fees and tax')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/sulekha/iu)
    expect(screen.queryByText('No price listed')).not.toBeInTheDocument()
  })

  it('reads its price from its ticket types, not from the listing’s prices', () => {
    const { container, rerender } = render(<EventCard event={imported({ minPriceCents: 0 })} />)

    expect(screen.getByText('Free')).toBeInTheDocument()

    // A listing that gave no price, so no ticket type: what any such card says.
    rerender(
      <EventCard event={imported({ minPriceCents: null, currency: null, salesOpen: false })} />,
    )
    expect(screen.getByText('Price to be announced')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\$25\.00/u)
  })

  it('names the organiser who presents it, and says it is on sale when its sales are open', () => {
    render(<EventCard event={imported()} />)

    expect(screen.getByText('Raga Nights Houston')).toBeInTheDocument()
    expect(screen.getByText('On sale')).toBeInTheDocument()
  })

  it('says “Not on sale now” when its sales are closed, like any card', () => {
    render(<EventCard event={imported({ salesOpen: false, status: 'PUBLISHED' })} />)

    expect(screen.getByText('Not on sale now')).toBeInTheDocument()
  })

  it('still says when the event itself is cancelled', () => {
    render(<EventCard event={imported({ status: 'CANCELLED' })} />)

    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })

  it('writes a Canadian event’s price in CA$, in its own zone and city', () => {
    const { container } = render(
      <EventCard
        event={imported(
          {
            minPriceCents: 3000,
            currency: 'CAD',
            city: 'Toronto',
            venueName: 'Harbourfront Hall',
            timezone: 'America/Toronto',
            startsAt: '2026-11-08T00:30:00.000Z',
          },
          { presentedBy: 'Toronto Garba Collective' },
        )}
      />,
    )

    expect(container.textContent).toContain('From CA$30.00')
    expect(container.textContent).toContain('Harbourfront Hall · Toronto')
    expect(container.textContent).toMatch(/7:30\sPM EST/u)
    expect(container.textContent).not.toMatch(/(?<!CA)\$30\.00/u)
  })
})

describe('AvailabilityChip', () => {
  it('carries its meaning in words, with the dot only as decoration', () => {
    const { container } = render(
      <AvailabilityChip availability={{ tone: 'open', label: 'On sale' }} />,
    )

    expect(container.textContent).toBe('Availability: On sale')
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
  })
})

describe('EventGrid', () => {
  it('is a labelled list, so the count is announced before the cards', () => {
    render(
      <EventGrid
        label="Matching events"
        events={[garba, { ...garba, id: 'evtsecondsample', slug: 'second', title: 'Second Event' }]}
      />,
    )

    const list = screen.getByRole('list', { name: 'Matching events' })

    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })

  it('renders nothing but an empty list when there are no events', () => {
    render(<EventGrid label="Matching events" events={[]} />)

    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('as a rail, scrolls inside itself on a phone rather than widening the page', () => {
    render(<EventGrid label="Upcoming events" events={[garba]} layout="rail" />)

    const list = screen.getByRole('list', { name: 'Upcoming events' })

    // Asserted on the classes because jsdom applies no stylesheet: the list is
    // the scroll container, and each card snaps and keeps a fixed share.
    expect(list.className).toContain('overflow-x-auto')
    expect(list.className).toContain('snap-x')
    expect(within(list).getByRole('listitem').className).toContain('snap-start')
  })
})

describe('counting a click on a card', () => {
  const counted = {
    ...garba,
    id: 'cevtnavratri000000000001',
    organizationId: 'corgalpha00000000000001',
  }

  it('marks the title link with the event, its organisation and the place, when asked', () => {
    render(<EventCard event={counted} trafficPlacement="HOME" />)

    const link = screen.getByRole('link')

    expect(link).toHaveAttribute('data-traffic-kind', 'CARD_CLICK')
    expect(link).toHaveAttribute('data-traffic-event', 'cevtnavratri000000000001')
    expect(link).toHaveAttribute('data-traffic-organization', 'corgalpha00000000000001')
    expect(link).toHaveAttribute('data-traffic-placement', 'HOME')
  })

  it('marks nothing when the page does not ask, or for an event that cannot be counted', () => {
    const { unmount } = render(<EventCard event={counted} />)

    expect(
      Object.keys(screen.getByRole('link').dataset).filter((key) => key.startsWith('traffic')),
    ).toEqual([])
    unmount()

    // Sample data's ids are not the database's, so a card built from them
    // carries no attributes even when the page asks.
    render(<EventCard event={{ ...garba, id: 'Sample Event 1' }} trafficPlacement="LISTING" />)

    expect(
      Object.keys(screen.getByRole('link').dataset).filter((key) => key.startsWith('traffic')),
    ).toEqual([])
  })

  it('passes the place to every card in a grid', () => {
    render(
      <EventGrid
        events={[counted, { ...counted, id: 'cevtnavratri000000000002', slug: 'night-two' }]}
        label="Matching events"
        trafficPlacement="SEARCH"
      />,
    )

    expect(
      screen.getAllByRole('link').map((link) => link.getAttribute('data-traffic-placement')),
    ).toEqual(['SEARCH', 'SEARCH'])
  })
})
