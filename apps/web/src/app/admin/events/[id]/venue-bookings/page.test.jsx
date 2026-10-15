/**
 * The Desi Events team's "Bookings waiting to be paid at the door" (SPEC3-XI
 * §12.13).
 *
 * Pinned: only a session holding `venue_booking:cancel` reaches it; a lapsed
 * second factor is offered in place; the rows name no buyer or attendee; each
 * booking's button is named after it; the empty list has its own sentence;
 * and the way back is to the event.
 *
 * @file app/admin/events/id/venue-bookings/page.test.jsx
 */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/events/eventaaaaaaaaaaaaaaaaaaaa/venue-bookings',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../../../lib/organizer-api.js', () => ({
  callApi: vi.fn(),
  getVenueBookings: vi.fn(),
}))
vi.mock('../../../../../lib/session.js', () => ({ readSession: vi.fn() }))

const api = await import('../../../../../lib/organizer-api.js')
const { readSession } = await import('../../../../../lib/session.js')
const { default: AdminVenueBookingsPage, INTRO } = await import('./page.jsx')

const EVENT_ID = 'eventaaaaaaaaaaaaaaaaaaaa'

const ADMIN = { user: { id: 'a1' }, capabilities: ['venue_booking:cancel'], memberships: [] }

/**
 * The list the API answers a platform reader with: no names.
 *
 * @param {object[]} [bookings] The bookings.
 * @returns {object} The list.
 */
function list(bookings) {
  const rows = bookings ?? [
    {
      orderReference: 'DE-7Q2K9P',
      placedAt: '2026-10-10T10:00:00.000Z',
      buyerName: null,
      feesCents: 0,
      unpaidTickets: 1,
      unpaidCents: 4000,
      tickets: [
        {
          ticketId: 'ticketaaaaaaaaaaaaaaaaaaa',
          label: 'Ticket 1 of 1',
          attendeeName: null,
          nightLabel: null,
          everyNight: false,
          dueCents: 4000,
          heldBy: 'BUYER',
          offerPending: false,
          cancellable: true,
          notCancellable: null,
        },
      ],
    },
  ]

  return {
    eventId: EVENT_ID,
    eventTitle: 'Navratri Garba Night',
    currency: 'USD',
    bookings: rows,
    pagination: {
      page: 1,
      perPage: 20,
      total: rows.length,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  }
}

/**
 * Render the page.
 *
 * @param {object} [session] The session.
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderPage(session = ADMIN) {
  readSession.mockResolvedValue(session)
  render(
    await AdminVenueBookingsPage({
      params: Promise.resolve({ id: EVENT_ID }),
      searchParams: Promise.resolve({}),
    }),
  )
}

beforeEach(() => {
  api.getVenueBookings.mockReset()
})

describe('the list', () => {
  it('heads the page with the event, names nobody, and names each button after its booking', async () => {
    api.getVenueBookings.mockResolvedValue(list())

    await renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Bookings waiting to be paid at the door' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Navratri Garba Night', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText(INTRO)).toBeInTheDocument()
    expect(INTRO).toBe(
      'Tickets booked to pay at the door and not paid for yet. Cancelling them frees their places; The Desi Events keeps any booking fee paid online for them.',
    )
    expect(
      screen.getByText('Booking DE-7Q2K9P · placed Oct 10, 2026 · 1 unpaid ($40.00)'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Cancel unpaid tickets in booking DE-7Q2K9P' }),
    ).toHaveTextContent('Cancel unpaid tickets…')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to the event' })).toHaveAttribute(
      'href',
      `/admin/events/${EVENT_ID}`,
    )
  })

  it('says when no booking is waiting', async () => {
    api.getVenueBookings.mockResolvedValue(list([]))

    await renderPage()

    expect(screen.getByText('No bookings are waiting to be paid at the door.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cancel unpaid tickets/u })).toBeNull()
  })

  it('pages the list as the other administrators’ lists do', async () => {
    api.getVenueBookings.mockResolvedValue({
      ...list(),
      pagination: { page: 1, perPage: 20, total: 40, hasNextPage: true, hasPreviousPage: false },
    })

    await renderPage()

    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      `/admin/events/${EVENT_ID}/venue-bookings?page=2`,
    )
  })
})

describe('the dates, as the event keeps time', () => {
  it('says the day each booking was placed in the event’s zone, which the list names', async () => {
    const [row] = list().bookings

    api.getVenueBookings.mockResolvedValue({
      ...list([{ ...row, placedAt: '2026-10-10T03:00:00.000Z' }]),
      timezone: 'America/Chicago',
    })

    await renderPage()

    // 03:00 UTC on 10 October is the evening of 9 October in Chicago.
    expect(
      screen.getByText('Booking DE-7Q2K9P · placed Oct 9, 2026 · 1 unpaid ($40.00)'),
    ).toBeInTheDocument()
  })
})

describe('who may read it', () => {
  it('offers the second factor in place when the read asks for one', async () => {
    api.getVenueBookings.mockRejectedValue(
      Object.assign(new Error('Step up.'), { status: 403, code: 'STEP_UP_REQUIRED' }),
    )

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()
    expect(screen.getByText(/see the bookings waiting to be paid at the door/u)).toBeInTheDocument()
  })

  it('gives the administration area’s refusal to anybody without the capability, and reads nothing', async () => {
    await renderPage({ user: { id: 'f1' }, capabilities: ['finance:view'], memberships: [] })

    expect(api.getVenueBookings).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeInTheDocument()
  })
})
