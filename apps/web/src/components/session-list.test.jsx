import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { SessionList } from './session-list.jsx'

const NOW = new Date('2026-10-01T12:00:00.000Z')

/**
 * A public night.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The night.
 */
function night(overrides = {}) {
  return {
    id: 'snnightonexxx',
    label: 'Night 1',
    startsAt: '2026-10-03T23:30:00.000Z',
    endsAt: '2026-10-04T04:30:00.000Z',
    doorsOpenAt: '2026-10-03T23:00:00.000Z',
    timezone: 'America/New_York',
    status: 'SCHEDULED',
    salesStartAt: null,
    salesEndAt: null,
    hasSeatMap: false,
    seatsAvailable: null,
    ...overrides,
  }
}

const SEATED = night({
  id: 'snnighttwoxxx',
  label: 'Night 2',
  startsAt: '2026-10-04T23:30:00.000Z',
  endsAt: '2026-10-05T04:30:00.000Z',
  doorsOpenAt: null,
  hasSeatMap: true,
  seatsAvailable: 12,
})

describe('the list of nights', () => {
  it('lists each night in order with its label, date and times in the venue’s zone', () => {
    render(<SessionList sessions={[night(), SEATED]} eventSlug="nine-nights" now={NOW} />)

    const list = screen.getByRole('list', { name: 'Nights' })
    const items = within(list).getAllByRole('listitem')

    expect(items).toHaveLength(2)
    expect(
      within(items[0]).getByRole('heading', { name: 'Night 1 · Sat, Oct 3 · 7:30 PM' }),
    ).toBeInTheDocument()
    expect(within(items[0]).getByText('Doors')).toBeInTheDocument()
    expect(within(items[0]).getByText('Sat, Oct 3 · 7:00 PM')).toHaveAttribute(
      'dateTime',
      '2026-10-03T23:00:00.000Z',
    )
    // No doors time is invented for a night that has none.
    expect(within(items[1]).queryByText('Doors')).toBeNull()
    expect(
      screen.getByText(/the local time at the venue \(America\/New_York\), not your own/u),
    ).toBeInTheDocument()
  })

  it('marks each night with its own zone when the nights are not all in one', () => {
    const chicago = night({
      id: 'snchicagoxxxx',
      label: 'Chicago night',
      startsAt: '2026-10-04T23:30:00.000Z',
      endsAt: '2026-10-05T03:30:00.000Z',
      doorsOpenAt: null,
      timezone: 'America/Chicago',
    })

    render(<SessionList sessions={[night(), chicago]} eventSlug="two-cities" now={NOW} />)

    const items = within(screen.getByRole('list', { name: 'Nights' })).getAllByRole('listitem')

    // One zone stated for every night would be wrong for one of them.
    expect(screen.queryByText(/^All times are/u)).toBeNull()
    expect(
      screen.getByText(
        'These nights are in different time zones. Each time is the local time at that night’s venue, marked with its zone, not your own.',
      ),
    ).toBeInTheDocument()
    expect(
      within(items[0]).getByRole('heading', { name: 'Night 1 · Sat, Oct 3 · 7:30 PM EDT' }),
    ).toBeInTheDocument()
    expect(within(items[0]).getByText('Sat, Oct 3 · 7:30 PM EDT')).toHaveAttribute(
      'dateTime',
      '2026-10-03T23:30:00.000Z',
    )
    expect(
      within(items[1]).getByRole('heading', { name: 'Chicago night · Sun, Oct 4 · 6:30 PM CDT' }),
    ).toBeInTheDocument()
    expect(within(items[1]).getByText('Sun, Oct 4 · 6:30 PM CDT')).toHaveAttribute(
      'dateTime',
      '2026-10-04T23:30:00.000Z',
    )
    expect(within(items[1]).getByText('Sun, Oct 4 · 10:30 PM CDT')).toBeInTheDocument()
  })

  it('says each night’s state in words', () => {
    render(
      <SessionList
        sessions={[night({ status: 'CANCELLED' }), { ...SEATED, seatsAvailable: 0 }]}
        eventSlug="nine-nights"
        ticketTypes={[
          {
            id: 'ttstalls',
            reserved: true,
            eventSessionId: SEATED.id,
            status: 'ON_SALE',
            availableQuantity: 0,
            isSoldOut: true,
          },
        ]}
        now={NOW}
      />,
    )

    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    expect(screen.getByText('Sold out')).toBeInTheDocument()
  })

  it('does not call a seated night sold out when its tiers are only not on sale now', () => {
    render(
      <SessionList
        sessions={[{ ...SEATED, seatsAvailable: 0 }]}
        eventSlug="nine-nights"
        ticketTypes={[
          {
            id: 'ttstalls',
            reserved: true,
            eventSessionId: SEATED.id,
            status: 'PAUSED',
            availableQuantity: 0,
            isSoldOut: true,
          },
        ]}
        now={NOW}
      />,
    )

    expect(screen.queryByText('Sold out')).toBeNull()
    expect(screen.getByText('Not on sale now')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('links a seated night that is selling to its seats, and no other night', () => {
    render(<SessionList sessions={[night(), SEATED]} eventSlug="nine-nights" now={NOW} />)

    const links = screen.getAllByRole('link')

    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName('Choose seats for Night 2 · Sun, Oct 4 · 7:30 PM')
    expect(links[0]).toHaveAttribute('href', '/events/nine-nights/seats/snnighttwoxxx')
  })

  it('marks a night’s seat link so a click on it is counted, only when the page asks', () => {
    const { unmount } = render(
      <SessionList
        sessions={[night(), SEATED]}
        eventSlug="nine-nights"
        now={NOW}
        traffic={{ eventId: 'cevtnights0000000000001', organizationId: 'corgalpha00000000000001' }}
      />,
    )

    const [link] = screen.getAllByRole('link')

    expect(link).toHaveAttribute('data-traffic-kind', 'SEATS_CLICK')
    expect(link).toHaveAttribute('data-traffic-placement', 'EVENT_PAGE')
    expect(link).toHaveAttribute('data-traffic-event', 'cevtnights0000000000001')
    unmount()

    render(<SessionList sessions={[night(), SEATED]} eventSlug="nine-nights" now={NOW} />)

    expect(screen.getAllByRole('link')[0].hasAttribute('data-traffic-kind')).toBe(false)
  })

  it('offers no seats when the event itself is not selling', () => {
    render(<SessionList sessions={[SEATED]} eventSlug="nine-nights" buyable={false} now={NOW} />)

    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('the nights of an event imported from an organiser’s listing', () => {
  it('shows only the start of a night whose end the listing did not give', () => {
    render(
      <SessionList
        sessions={[night({ doorsOpenAt: null, endTimeListed: false })]}
        eventSlug="raga-night"
        buyable
        now={NOW}
      />,
    )

    const nights = screen.getByRole('list', { name: 'Nights' })

    expect(within(nights).getByText('Starts')).toBeInTheDocument()
    expect(within(nights).queryByText('Ends')).not.toBeInTheDocument()
  })

  it('reads like any other night: “On sale” here, never “Tickets on another site”, and still says a night is cancelled', () => {
    render(
      <SessionList
        sessions={[night(), night({ id: 'snnightthree', label: 'Night 3', status: 'CANCELLED' })]}
        eventSlug="raga-night"
        buyable
        now={NOW}
        soldElsewhere
      />,
    )

    expect(screen.getByText('On sale')).toBeInTheDocument()
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    expect(screen.queryByText(/another site/iu)).not.toBeInTheDocument()
  })
})
