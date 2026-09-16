import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { EventCard, EventGrid } from './listing-card.jsx'

const garba = {
  id: 'evtnavratrirasgarba',
  slug: 'navratri-raas-garba-nine-nights',
  title: 'Navratri Raas Garba',
  summary: 'Nine nights of traditional raas on the GMDC ground.',
  category: 'GARBA_DANDIYA',
  startsAt: '2026-10-11T13:30:00.000Z',
  endsAt: '2026-10-11T20:30:00.000Z',
  timezone: 'Asia/Kolkata',
  city: 'Ahmedabad',
  venueName: 'GMDC Ground',
  minPriceCents: 149_900,
  currency: 'INR',
  soldOut: false,
}

describe('EventCard', () => {
  it('links to the event exactly once, so the card is one entry in the links list', () => {
    render(<EventCard event={garba} />)
    const links = screen.getAllByRole('link')

    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/events/navratri-raas-garba-nine-nights')
    expect(links[0]).toHaveAccessibleName('Navratri Raas Garba')
  })

  it('describes the poster rather than leaving an unlabelled graphic', () => {
    render(<EventCard event={garba} />)

    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Garba & Dandiya poster for Navratri Raas Garba',
    )
  })

  it('shows the human category label, not the enum member', () => {
    render(<EventCard event={garba} />)

    expect(screen.getByText('Garba & Dandiya')).toBeInTheDocument()
    expect(screen.queryByText('GARBA_DANDIYA')).not.toBeInTheDocument()
  })

  it('renders the date and time in the event’s own timezone', () => {
    render(<EventCard event={garba} />)

    expect(screen.getByText(/Sun, 11 Oct, 2026/)).toBeInTheDocument()
    expect(screen.getByText('7:00 pm')).toBeInTheDocument()
  })

  it('gives the date a machine-readable value', () => {
    const { container } = render(<EventCard event={garba} />)

    expect(container.querySelector('time')).toHaveAttribute('dateTime', '2026-10-11T13:30:00.000Z')
  })

  it('prices in the event’s own currency', () => {
    render(<EventCard event={garba} />)

    expect(screen.getByText('₹1,499.00')).toBeInTheDocument()
  })

  it('prices a Toronto event in Canadian dollars', () => {
    render(
      <EventCard event={{ ...garba, minPriceCents: 5500, currency: 'CAD', city: 'Toronto' }} />,
    )

    expect(screen.getByText('$55.00')).toBeInTheDocument()
  })

  it('says so when tickets have gone, with the meaning spelled out for a screen reader', () => {
    render(<EventCard event={{ ...garba, soldOut: true }} />)

    expect(screen.getByText('Sold out')).toBeInTheDocument()
    expect(screen.getByText(/^Availability:$/)).toBeInTheDocument()
  })

  it('does not invent a price for an event with no tiers yet', () => {
    render(<EventCard event={{ ...garba, minPriceCents: null, currency: null }} />)

    expect(screen.getByText('Price to be announced')).toBeInTheDocument()
  })

  it('uses the heading level the surrounding page asks for', () => {
    render(<EventCard event={garba} headingLevel="h2" />)

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Navratri Raas Garba')
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
})
