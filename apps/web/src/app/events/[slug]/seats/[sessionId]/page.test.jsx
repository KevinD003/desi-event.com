/**
 * The seat page for one night: it never draws a map the API did not give for
 * this event, sends a signed-out visitor to sign in and back here, and stays
 * out of the index.
 *
 * @module app/events/slug/seats/sessionId/page.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('../../../../../lib/api.js', () => ({
  loadEventBySlug: vi.fn(),
  loadSeatMap: vi.fn(),
}))
vi.mock('../../../../../lib/session.js', () => ({ readSession: vi.fn() }))
// The team's read is made as the viewer; here it is the only part replaced.
vi.mock('../../../../../lib/team-booking.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadTeamSeatMap: vi.fn(),
}))

const { loadEventBySlug, loadSeatMap } = await import('../../../../../lib/api.js')
const { readSession } = await import('../../../../../lib/session.js')
const { loadTeamSeatMap } = await import('../../../../../lib/team-booking.js')
const { default: SeatPage, generateMetadata } = await import('./page.jsx')

const EVENT = {
  id: 'evseatednight',
  slug: 'seated-night',
  title: 'A Seated Night',
  timezone: 'America/New_York',
  startsAt: '2026-10-03T23:30:00.000Z',
  endsAt: '2026-10-04T04:30:00.000Z',
  venue: { name: 'Hall', city: 'Edison', region: 'NJ', country: 'US' },
  ticketTypes: [],
  sessions: [],
}

/**
 * A night's map, as `GET /v1/sessions/:id/seats` answers it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The map's `data`.
 */
function seatMap(overrides = {}) {
  return {
    sessionId: 'snnightonexxx',
    eventId: EVENT.id,
    label: 'Night 1',
    startsAt: '2026-10-03T23:30:00.000Z',
    endsAt: '2026-10-04T04:30:00.000Z',
    doorsOpenAt: '2026-10-03T23:00:00.000Z',
    timezone: 'America/New_York',
    status: 'ON_SALE',
    salesStartAt: null,
    salesEndAt: null,
    maxSeatsPerOrder: 10,
    zones: [{ id: 'pzfrontxxxxxx', name: 'Front', sortOrder: 0 }],
    tiers: [
      {
        id: 'ttfrontxxxxxx',
        name: 'Front stalls',
        priceCents: 4_500,
        currency: 'USD',
        priceZoneId: 'pzfrontxxxxxx',
        minPerOrder: 1,
        maxPerOrder: 10,
        onSale: true,
      },
    ],
    counts: { total: 1, available: 1, held: 0, sold: 0, unavailable: 0 },
    sections: [
      {
        id: 'scstallsxxxxx',
        name: 'Stalls',
        kind: 'SEATED',
        sortOrder: 0,
        rows: [
          {
            id: 'rwaxxxxxxxxxx',
            label: 'A',
            sortOrder: 0,
            seats: [
              {
                id: 'esa1xxxxxxxxx',
                seatId: 'sta1xxxxxxxxx',
                label: 'A1',
                sectionId: 'scstallsxxxxx',
                priceZoneId: 'pzfrontxxxxxx',
                sortOrder: 0,
                available: true,
                accessible: false,
                companionOfSeatId: null,
                obstructedView: false,
                restricted: false,
                restrictionNote: null,
                priceCents: null,
                ticketTypeId: 'ttfrontxxxxxx',
              },
            ],
          },
        ],
        seats: [],
      },
    ],
    ...overrides,
  }
}

const params = { params: Promise.resolve({ slug: EVENT.slug, sessionId: 'snnightonexxx' }) }

beforeEach(() => {
  loadEventBySlug.mockReset()
  loadSeatMap.mockReset()
  readSession.mockReset()
  loadTeamSeatMap.mockReset()
  loadEventBySlug.mockResolvedValue({ event: EVENT, usedFallback: false })
  loadSeatMap.mockResolvedValue(seatMap())
  readSession.mockResolvedValue(null)
})

describe('the seat page, when there is nothing true to draw', () => {
  it('renders the not-found view for an event nobody has', async () => {
    loadEventBySlug.mockResolvedValue({ event: null, usedFallback: false })

    render(await SeatPage(params))

    expect(screen.getByTestId('not-found-view')).toBeInTheDocument()
    expect(loadSeatMap).not.toHaveBeenCalled()
  })

  it('invents no map when only the fallback catalogue answered', async () => {
    loadEventBySlug.mockResolvedValue({ event: EVENT, usedFallback: true })

    render(await SeatPage(params))

    expect(screen.getByTestId('not-found-view')).toBeInTheDocument()
    expect(loadSeatMap).not.toHaveBeenCalled()
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('renders the not-found view when the API gives no map for the night', async () => {
    loadSeatMap.mockResolvedValue(null)

    render(await SeatPage(params))

    expect(screen.getByTestId('not-found-view')).toBeInTheDocument()
  })

  it('will not draw another event’s night under this event’s name', async () => {
    loadSeatMap.mockResolvedValue(seatMap({ eventId: 'evsomeoneelse' }))

    render(await SeatPage(params))

    expect(screen.getByTestId('not-found-view')).toBeInTheDocument()
    expect(screen.queryByRole('grid')).toBeNull()
    expect(readSession).not.toHaveBeenCalled()
  })
})

describe('the seat page for a night of this event', () => {
  it('names the event and the night, in the venue’s zone', async () => {
    render(await SeatPage(params))

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Choose seats for A Seated Night',
    )
    expect(screen.getByText(/Night 1 · Sat, Oct 3 · 7:30 PM/u)).toBeInTheDocument()
    expect(
      screen.getByText('All times are the local time at the venue (America/New_York).'),
    ).toBeInTheDocument()
    expect(loadSeatMap).toHaveBeenCalledWith('snnightonexxx')
  })

  it('sends a signed-out visitor to sign in and back to this map', async () => {
    render(await SeatPage(params))

    expect(screen.getByRole('link', { name: 'Sign in to reserve' })).toHaveAttribute(
      'href',
      `/sign-in?next=${encodeURIComponent('/events/seated-night/seats/snnightonexxx')}`,
    )
    expect(screen.queryByRole('button', { name: /^Reserve/u })).toBeNull()
  })

  it('lets a signed-in buyer reserve, as themselves', async () => {
    readSession.mockResolvedValue({
      user: { displayName: 'Asha Patel', email: 'asha@example.test' },
    })

    render(await SeatPage(params))

    expect(screen.queryByRole('link', { name: 'Sign in to reserve' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Choose seats to continue' })).toBeDisabled()
  })

  it('stays out of the index, and names the event in its title', async () => {
    const metadata = await generateMetadata(params)

    expect(metadata).toEqual({
      title: 'Choose seats for A Seated Night',
      robots: { index: false, follow: false },
    })

    loadEventBySlug.mockResolvedValue({ event: null, usedFallback: false })

    expect((await generateMetadata(params)).robots).toEqual({ index: false, follow: false })
  })
})

describe('the seat page for the organiser’s own team', () => {
  const teamEvent = { ...EVENT, organizationId: 'orgnavratrixx' }
  const publicMap = seatMap()
  const row = publicMap.sections[0].rows[0]
  // The team's map has one more seat on it: a guest-list seat, sold under a
  // hidden tier a stranger's map leaves out.
  const guestSeats = seatMap({
    tiers: [
      ...publicMap.tiers,
      {
        id: 'ttguestxxxxxx',
        name: 'Guest seats',
        priceCents: 0,
        currency: 'USD',
        priceZoneId: 'pzfrontxxxxxx',
        minPerOrder: 1,
        maxPerOrder: 10,
        onSale: true,
      },
    ],
    sections: [
      {
        ...publicMap.sections[0],
        rows: [
          {
            ...row,
            seats: [
              ...row.seats,
              {
                ...row.seats[0],
                id: 'esa9xxxxxxxxx',
                seatId: 'sta9xxxxxxxxx',
                label: 'A9',
                sortOrder: 9,
                ticketTypeId: 'ttguestxxxxxx',
              },
            ],
          },
        ],
      },
    ],
  })

  /**
   * A signed-in member with these capabilities in the event's organisation.
   *
   * @param {string[]} capabilities What the membership holds.
   * @returns {object} The session payload.
   */
  const member = (capabilities) => ({
    user: { displayName: 'Meera Shah', email: 'meera@example.test' },
    capabilities: [],
    memberships: [{ organizationId: teamEvent.organizationId, capabilities }],
  })

  beforeEach(() => {
    loadEventBySlug.mockResolvedValue({ event: teamEvent, usedFallback: false })
    loadTeamSeatMap.mockResolvedValue(guestSeats)
  })

  it('draws the map as the team reads it for a member who may book hidden tiers', async () => {
    readSession.mockResolvedValue(member(['ticketType:manage']))

    render(await SeatPage(params))

    expect(loadTeamSeatMap).toHaveBeenCalledWith('snnightonexxx')
    expect(document.body).toHaveTextContent('A9')
  })

  it('draws the public map for anybody else, and when the team’s read fails', async () => {
    readSession.mockResolvedValue(member(['event:view_draft']))

    const { unmount } = render(await SeatPage(params))

    expect(loadTeamSeatMap).not.toHaveBeenCalled()
    expect(document.body).not.toHaveTextContent('A9')
    unmount()

    readSession.mockResolvedValue(member(['ticketType:manage']))
    loadTeamSeatMap.mockResolvedValue(null)

    render(await SeatPage(params))

    expect(loadTeamSeatMap).toHaveBeenCalledWith('snnightonexxx')
    expect(document.body).not.toHaveTextContent('A9')
    expect(document.body).toHaveTextContent('A1')
  })
})
