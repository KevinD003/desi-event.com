/**
 * The list of bookings waiting to be paid at the door, shared by the
 * organiser's "Payments at the venue" page and the Desi-Event team's page
 * (SPEC3-XI §12.9, §12.13).
 *
 * Pinned: a button per booking only when the reader may cancel, each named
 * after its booking with its visible words first; the Desi-Event team's list
 * names nobody; the dialog opens on its booking and gives focus back to the
 * button when closed; and a cancellation closes it, is said once in the
 * section's polite region, takes focus to the heading and reads the page
 * again.
 *
 * @module components/unpaid-venue-bookings.test
 */

import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  usePathname: () => '/organizer/events/eventaaaaaaaaaaaaaaaaaaaa/venue-payments',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { UnpaidVenueBookings, cancelButtonName } = await import('./unpaid-venue-bookings.jsx')

const EVENT_ID = 'eventaaaaaaaaaaaaaaaaaaaa'

const ROWS = [
  { orderReference: 'DE-7Q2K9P', buyerName: 'Asha Rao', unpaidTickets: 2, unpaidCents: 9000 },
  { orderReference: 'DE-4M8T2W', buyerName: 'Ravi Shah', unpaidTickets: 1, unpaidCents: 4000 },
]

/**
 * A Response-shaped stub.
 *
 * @param {number} status The status.
 * @param {object} body The body.
 * @returns {object} The stub.
 */
function answer(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/** The dialog's read of the first booking. */
const BOOKING_READ = {
  data: {
    eventId: EVENT_ID,
    eventTitle: 'Navratri Garba Night',
    currency: 'USD',
    bookings: [
      {
        orderReference: 'DE-7Q2K9P',
        placedAt: '2026-10-10T10:00:00.000Z',
        buyerName: 'Asha Rao',
        feesCents: 729,
        unpaidTickets: 2,
        unpaidCents: 9000,
        tickets: ['ticketaaaaaaaaaaaaaaaaaaa', 'ticketbbbbbbbbbbbbbbbbbbb'].map((ticketId, i) => ({
          ticketId,
          label: `Ticket ${i + 1} of 2`,
          attendeeName: null,
          nightLabel: null,
          everyNight: true,
          dueCents: 4500,
          heldBy: 'BUYER',
          offerPending: false,
          cancellable: true,
          notCancellable: null,
        })),
      },
    ],
    pagination: { page: 1, perPage: 20, total: 1 },
  },
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('the organiser’s table', () => {
  it('offers a button per booking, named after its booking with its visible words first', () => {
    render(<UnpaidVenueBookings eventId={EVENT_ID} currency="USD" bookings={ROWS} canCancel />)

    const table = screen.getByRole('table', { name: 'Bookings with unpaid tickets' })
    const rows = within(table).getAllByRole('row')

    expect(rows).toHaveLength(3)
    expect(within(rows[1]).getByText('Asha Rao')).toBeInTheDocument()
    expect(within(rows[1]).getByText('$90.00')).toBeInTheDocument()

    const buttons = screen.getAllByRole('button')

    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Cancel unpaid tickets in booking DE-7Q2K9P',
      'Cancel unpaid tickets in booking DE-4M8T2W',
    ])
    expect(buttons.every((button) => button.textContent === 'Cancel unpaid tickets…')).toBe(true)
    expect(cancelButtonName('DE-7Q2K9P')).toBe('Cancel unpaid tickets in booking DE-7Q2K9P')
  })

  it('offers no button to a reader who may not cancel', () => {
    render(
      <UnpaidVenueBookings eventId={EVENT_ID} currency="USD" bookings={ROWS} canCancel={false} />,
    )

    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('says when no booking is waiting', () => {
    render(<UnpaidVenueBookings eventId={EVENT_ID} currency="USD" bookings={[]} canCancel />)

    expect(screen.getByText('No bookings are waiting to be paid at the door.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows the note under the list when it is given', () => {
    render(
      <UnpaidVenueBookings
        eventId={EVENT_ID}
        currency="USD"
        bookings={ROWS}
        canCancel
        note="You can cancel tickets that have not been paid for until their night ends."
      />,
    )

    expect(
      screen.getByText(
        'You can cancel tickets that have not been paid for until their night ends.',
      ),
    ).toBeInTheDocument()
  })
})

describe('the Desi-Event team’s list', () => {
  it('names no buyer, and says when each booking was placed and what it owes', () => {
    render(
      <UnpaidVenueBookings
        eventId={EVENT_ID}
        currency="USD"
        layout="list"
        canCancel
        bookings={[
          {
            orderReference: 'DE-7Q2K9P',
            placedAt: '2026-10-10T10:00:00.000Z',
            buyerName: null,
            unpaidTickets: 2,
            unpaidCents: 9000,
          },
        ]}
      />,
    )

    expect(
      screen.getByText('Booking DE-7Q2K9P · placed Oct 10, 2026 · 2 unpaid ($90.00)'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Cancel unpaid tickets in booking DE-7Q2K9P' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('cancelling from the list', () => {
  it('opens the dialog on its booking, and gives focus back to the button when it is closed', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, BOOKING_READ))
    render(<UnpaidVenueBookings eventId={EVENT_ID} currency="USD" bookings={ROWS} canCancel />)

    const opener = screen.getByRole('button', {
      name: 'Cancel unpaid tickets in booking DE-7Q2K9P',
    })

    await user.click(opener)

    expect(await screen.findByRole('dialog', { name: 'Cancel unpaid tickets' })).toBeInTheDocument()
    expect(apiFetch.mock.calls[0][1]).toEqual({ query: { order: 'DE-7Q2K9P' } })

    await screen.findByRole('group', { name: 'Tickets to cancel' })
    await user.click(screen.getByRole('button', { name: 'Keep them' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })

  it('closes on success, says what happened once, takes focus to the heading and reads the page again', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, BOOKING_READ))
    render(<UnpaidVenueBookings eventId={EVENT_ID} currency="USD" bookings={ROWS} canCancel />)

    await user.click(
      screen.getByRole('button', { name: 'Cancel unpaid tickets in booking DE-7Q2K9P' }),
    )
    await screen.findByRole('group', { name: 'Tickets to cancel' })
    await user.type(screen.getByLabelText(/^Reason/u), 'Not paid before the doors opened')

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: {
          cancellationId: 'cancelaaaaaaaaaaaaaaaaaa',
          orderReference: 'DE-7Q2K9P',
          ticketCount: 2,
          basisCents: 9000,
          feeKeptCents: 486,
          currency: 'USD',
          cancelledAt: '2026-10-12T21:05:00.000Z',
          by: 'ORGANISER',
          byName: 'Meera Owner',
          reason: 'Not paid before the doors opened',
          seatsReturned: 0,
          placesReturned: { tieraaaaaaaaaaaaaaaaaaaaa: 2 },
          placesOnSale: 'NONE',
          eventSalesStopped: true,
          replayed: false,
        },
      }),
    )
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Cancel 2 unpaid tickets' }))
    })

    const sentence =
      '2 tickets cancelled. Their places are free again but not on sale now: sales for them are closed or paused. Open sales on the event page to sell them.'

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const said = screen.getAllByText(sentence)

    // Said once, in the section's polite region.
    expect(said).toHaveLength(1)
    expect(said[0]).toHaveAttribute('role', 'status')
    expect(said[0]).toHaveAttribute('aria-live', 'polite')
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Bookings with unpaid tickets' }),
      ),
    )
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
