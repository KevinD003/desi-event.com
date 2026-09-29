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

  it('offers no seats when the event itself is not selling', () => {
    render(<SessionList sessions={[SEATED]} eventSlug="nine-nights" buyable={false} now={NOW} />)

    expect(screen.queryByRole('link')).toBeNull()
  })
})
