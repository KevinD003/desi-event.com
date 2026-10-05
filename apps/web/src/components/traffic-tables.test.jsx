/**
 * The visit tables: real captions and headers, a share of the whole per
 * source, the per-day table inside its disclosure with the same summary every
 * time, deleted events marked as such, and each event linking to its own
 * figures with the period kept.
 *
 * @module components/traffic-tables.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TABLE_SUMMARY } from '../lib/traffic-chart.js'
import { ORDERS_PAID_ON_DAYS_LABEL } from '../lib/traffic.js'
import {
  CardPlacements,
  EventsTraffic,
  TrafficByDay,
  TrafficSources,
  ticketAndSeatClicks,
} from './traffic-tables.jsx'

afterEach(cleanup)

const ORG = 'corg000000000000000001'

/**
 * An event row as the API sends it in `byEvent`.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The row.
 */
function eventRow(overrides = {}) {
  return {
    eventId: 'cevent00000000000000001',
    title: 'Navratri on the Lawn',
    slug: 'navratri-on-the-lawn',
    status: 'ON_SALE',
    deleted: false,
    startsAt: '2026-10-20T00:00:00.000Z',
    views: 1204,
    visitors: 800,
    cardClicks: 90,
    ticketClicks: 40,
    seatClicks: 2,
    websiteRedirects: 7,
    websiteLinkOn: true,
    ordersPaid: 31,
    ...overrides,
  }
}

describe('TrafficSources', () => {
  it('lists every source by name with its page views and its share of the whole', () => {
    render(
      <TrafficSources
        total={200}
        sources={[
          { source: 'DIRECT', views: 50 },
          { source: 'INTERNAL', views: 100 },
          { source: 'SEARCH', views: 30 },
          { source: 'SOCIAL', views: 20 },
          { source: 'OTHER', views: 0 },
        ]}
      />,
    )

    const table = screen.getByRole('table', { name: 'Where page views came from' })
    const internal = within(table).getByRole('row', { name: /Desi-Event pages/u })

    expect(within(internal).getByText('100')).toBeTruthy()
    expect(within(internal).getByText('50.0%')).toBeTruthy()
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Source', 'Page views', 'Share'])
  })

  it('shows a dash for every share when nothing was viewed, rather than dividing by zero', () => {
    render(<TrafficSources total={0} sources={[{ source: 'DIRECT', views: 0 }]} />)

    expect(screen.getByText('—')).toBeTruthy()
  })
})

describe('CardPlacements', () => {
  it('names each place a card is clicked', () => {
    render(
      <CardPlacements
        placements={[
          { placement: 'HOME', clicks: 4 },
          { placement: 'LISTING', clicks: 1 },
          { placement: 'SEARCH', clicks: 0 },
        ]}
      />,
    )

    const table = screen.getByRole('table', { name: 'Where the event card was clicked' })

    expect(within(table).getByRole('row', { name: 'Home page 4' })).toBeTruthy()
    expect(within(table).getByRole('row', { name: 'Events list 1' })).toBeTruthy()
    expect(within(table).getByRole('row', { name: 'Search results 0' })).toBeTruthy()
  })
})

describe('TrafficByDay', () => {
  const days = [
    {
      day: '2026-10-01',
      views: 12,
      visitors: 9,
      cardClicks: 3,
      ticketClicks: 2,
      seatClicks: 1,
      websiteRedirects: 1,
      ordersPaid: 2,
    },
  ]

  it('is a disclosure whose summary always reads the same, holding the per-day table', () => {
    const { container } = render(<TrafficByDay days={days} open />)

    const details = container.querySelector('details')

    expect(details.open).toBe(true)
    expect(details.querySelector('summary').textContent).toBe(TABLE_SUMMARY)
    expect(TABLE_SUMMARY).toBe('Visits per day, as a table')

    const table = within(details).getByRole('table', { name: 'Visits per day (UTC)' })

    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Day',
      'Page views',
      'Visitors',
      'Event card clicks',
      'Ticket and seat clicks',
      'Website visits',
      ORDERS_PAID_ON_DAYS_LABEL,
    ])
    expect(within(table).getByRole('row', { name: 'Oct 1 12 9 3 3 1 2' })).toBeTruthy()
  })

  it('starts closed for a long period', () => {
    const { container } = render(<TrafficByDay days={days} open={false} />)

    expect(container.querySelector('details').open).toBe(false)
    expect(container.querySelector('summary').textContent).toBe(TABLE_SUMMARY)
  })
})

describe('EventsTraffic', () => {
  it('links each event to its own figures, keeping the period', () => {
    render(<EventsTraffic rows={[eventRow()]} organizationId={ORG} keep={{ range: '7' }} />)

    const link = screen.getByRole('link', { name: 'Navratri on the Lawn' })
    const href = new URL(link.getAttribute('href'), 'https://desi-event.test')

    expect(href.pathname).toBe('/analytics')
    expect(href.searchParams.get('organizationId')).toBe(ORG)
    expect(href.searchParams.get('eventId')).toBe('cevent00000000000000001')
    expect(href.searchParams.get('range')).toBe('7')
  })

  it('reads the status and the website link as words, and adds ticket and seat clicks', () => {
    render(<EventsTraffic rows={[eventRow()]} organizationId={ORG} />)

    const row = screen.getByRole('row', { name: /Navratri on the Lawn/u })

    expect(within(row).getByText('On sale')).toBeTruthy()
    expect(within(row).getByText('On')).toBeTruthy()
    expect(within(row).getByText('42')).toBeTruthy()
    expect(within(row).getByText('1,204')).toBeTruthy()
  })

  it('marks a deleted event as deleted, because it was seen and sold before it went', () => {
    render(
      <EventsTraffic
        rows={[eventRow({ deleted: true, status: 'DELETED', websiteLinkOn: false })]}
        organizationId={ORG}
      />,
    )

    const row = screen.getByRole('row', { name: /Navratri on the Lawn/u })

    expect(within(row).getByText('Deleted')).toBeTruthy()
    expect(within(row).getByText('Off')).toBeTruthy()
  })

  it('says so when the organisation has no events', () => {
    render(<EventsTraffic rows={[]} organizationId={ORG} />)

    expect(screen.getByText('This organisation has no events.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('carries no money column', () => {
    render(<EventsTraffic rows={[eventRow()]} organizationId={ORG} />)

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)

    expect(headers.join(' ')).not.toMatch(/\$|revenue|amount|value|owed/iu)
  })
})

describe('ticketAndSeatClicks', () => {
  it('adds the two counts the API keeps apart', () => {
    expect(ticketAndSeatClicks({ ticketClicks: 3, seatClicks: 4 })).toBe(7)
    expect(ticketAndSeatClicks({})).toBe(0)
  })
})
