/**
 * The organiser's "Payments at the venue" page (SPEC3 §12.9, SPEC3-XI §12.9).
 *
 * Pinned: the figures in the report's words, including the cancelled unpaid
 * tickets and the booking fees kept for them; the three tables and their
 * empty sentences; a "Cancel unpaid tickets…" button per unpaid booking only
 * when the report says this reader may cancel, each named after its booking;
 * a finance member sees everything else and no button; a lapsed second factor
 * is offered in place; and a reader without finance is refused.
 *
 * @file app/organizer/events/id/venue-payments/page.test.jsx
 */

import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/organizer/events/eventaaaaaaaaaaaaaaaaaaaa/venue-payments',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../../../lib/organizer-api.js', () => ({
  callApi: vi.fn(),
  getOrganizerEvent: vi.fn(),
  getVenuePayments: vi.fn(),
}))
vi.mock('../../../../../lib/session.js', () => ({ readSession: vi.fn() }))

const api = await import('../../../../../lib/organizer-api.js')
const { readSession } = await import('../../../../../lib/session.js')
const { default: VenuePaymentsPage, cancelledByWords } = await import('./page.jsx')

const EVENT = {
  id: 'eventaaaaaaaaaaaaaaaaaaaa',
  organizationId: 'orgaaaaaaaaaaaaaaaaaaaaaa',
  title: 'Navratri Garba Night',
}

const OWNER = {
  user: { id: 'u1' },
  capabilities: [],
  memberships: [{ organizationId: EVENT.organizationId, capabilities: ['finance:view'] }],
}

/**
 * A report.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The report.
 */
function report(overrides = {}) {
  return {
    currency: 'USD',
    summary: {
      unpaidTickets: 3,
      unpaidCents: 13500,
      paidAtDoorTickets: 2,
      paidAtDoorCents: 8000,
      payments: 1,
      eventEnded: false,
      notPaidByEndTickets: 0,
      notPaidByEndCents: 0,
      paidOnRefundedCents: 0,
      cancelledUnpaidTickets: 1,
      cancelledUnpaidCents: 4500,
      feeKeptCents: 364,
    },
    payments: [
      {
        id: 'paymentaaaaaaaaaaaaaaaaaa',
        recordedAt: '2026-10-11T19:00:00.000Z',
        nightLabel: 'Saturday',
        recordedByName: 'Door Steward',
        orderReference: 'DE-1A2B3C',
        ticketCount: 2,
        amountCents: 8000,
        via: 'DOOR_GROUP',
        tickets: [
          { ticketId: 'ticketaaaaaaaaaaaaaaaaaaa', attendeeName: 'Asha Rao', amountCents: 4000 },
          { ticketId: 'ticketbbbbbbbbbbbbbbbbbbb', attendeeName: null, amountCents: 4000 },
        ],
      },
    ],
    unpaidOrders: [
      { orderReference: 'DE-7Q2K9P', buyerName: 'Ravi Shah', unpaidTickets: 2, unpaidCents: 9000 },
      { orderReference: 'DE-4M8T2W', buyerName: 'Mina Patel', unpaidTickets: 1, unpaidCents: 4500 },
    ],
    cancellations: [
      {
        id: 'cancelaaaaaaaaaaaaaaaaaa',
        at: '2026-10-12T21:05:00.000Z',
        by: 'DESI_EVENT',
        byName: 'Priya Admin',
        orderReference: 'DE-9Z8Y7X',
        ticketCount: 1,
        basisCents: 4500,
        reason: 'Not paid before the doors opened',
      },
    ],
    cancellationsHasMore: false,
    canCancelUnpaid: true,
    pagination: { page: 1, perPage: 20, total: 3, hasNextPage: false, hasPreviousPage: false },
    ...overrides,
  }
}

/**
 * Render the page.
 *
 * @param {object} [session] The session.
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderPage(session = OWNER) {
  readSession.mockResolvedValue(session)
  render(
    await VenuePaymentsPage({
      params: Promise.resolve({ id: EVENT.id }),
      searchParams: Promise.resolve({}),
    }),
  )
}

beforeEach(() => {
  api.getOrganizerEvent.mockReset()
  api.getVenuePayments.mockReset()
  api.getOrganizerEvent.mockResolvedValue(EVENT)
})

describe('the figures', () => {
  it('says what is owed, taken, cancelled and kept, in the event’s currency', async () => {
    api.getVenuePayments.mockResolvedValue(report())

    await renderPage()

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Payments at the venue — Navratri Garba Night',
      }),
    ).toBeInTheDocument()

    const figures = screen.getByRole('region', { name: 'Figures' })
    const value = (label) => within(figures).getByText(label).nextElementSibling.textContent

    expect(value('Tickets booked to pay at the door, not paid')).toBe('3 ($135.00)')
    expect(value('Payments taken at the door')).toBe('$80.00 (2 tickets)')
    expect(value('Unpaid tickets cancelled')).toBe('1 ($45.00 no longer owed)')
    expect(value('Booking fees on them, kept by Desi-Event')).toBe('$3.64')
    expect(within(figures).queryByText('Not paid by the end of the event')).toBeNull()
    expect(figures).toHaveTextContent(
      'Money taken at the door is yours. Desi-Event records the amounts to help you count them; they are not in your payouts or in the figures from the ledger. The site adds no sales tax to tickets paid at the venue; you may still owe sales tax on those sales.',
    )
  })

  it('counts what was not paid by the end once the event is over, and what was taken on bookings later refunded', async () => {
    api.getVenuePayments.mockResolvedValue(
      report({
        summary: {
          ...report().summary,
          eventEnded: true,
          notPaidByEndTickets: 2,
          notPaidByEndCents: 9000,
          paidOnRefundedCents: 4000,
        },
      }),
    )

    await renderPage()

    const figures = screen.getByRole('region', { name: 'Figures' })

    expect(
      within(figures).getByText('Not paid by the end of the event').nextElementSibling,
    ).toHaveTextContent('2 ($90.00)')
    expect(figures).toHaveTextContent(
      'Payments taken at the door on bookings later refunded or cancelled: $40.00. If you return them, return them yourself; Desi-Event does not hold this money.',
    )
  })
})

describe('the tables', () => {
  it('lists the payments taken, with the tickets’ names and how each was taken', async () => {
    api.getVenuePayments.mockResolvedValue(report())

    await renderPage()

    const table = screen.getByRole('table', { name: 'Payments taken at the door' })
    const [, row] = within(table).getAllByRole('row')

    expect(row).toHaveTextContent('Saturday')
    expect(row).toHaveTextContent('Door Steward')
    expect(row).toHaveTextContent('DE-1A2B3C')
    expect(row).toHaveTextContent('2 tickets: Asha Rao, No name on the ticket')
    expect(row).toHaveTextContent('$80.00')
    expect(row).toHaveTextContent('Group pass')
  })

  it('offers "Cancel unpaid tickets…" per unpaid booking, each named after it, with the note under the table', async () => {
    api.getVenuePayments.mockResolvedValue(report())

    await renderPage()

    expect(
      screen
        .getAllByRole('button', { name: /^Cancel unpaid tickets in booking/u })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Cancel unpaid tickets in booking DE-7Q2K9P',
      'Cancel unpaid tickets in booking DE-4M8T2W',
    ])
    expect(
      screen.getByText(
        'You can cancel tickets that have not been paid for until their night ends. Their places are freed and sell again while their sales are open; Desi-Event keeps any booking fee paid online for them.',
      ),
    ).toBeInTheDocument()
  })

  it('lists the cancelled unpaid tickets, naming a Desi-Event administrator as such', async () => {
    api.getVenuePayments.mockResolvedValue(report())

    await renderPage()

    const table = screen.getByRole('table', { name: 'Cancelled unpaid tickets' })
    const [header, row] = within(table).getAllByRole('row')

    expect(
      within(header)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['When', 'By', 'Booking', 'Tickets', 'No longer owed', 'Reason'])
    expect(row).toHaveTextContent('Priya Admin (Desi-Event)')
    expect(row).toHaveTextContent('DE-9Z8Y7X')
    expect(row).toHaveTextContent('$45.00')
    expect(row).toHaveTextContent('Not paid before the doors opened')
  })

  it('says each table is empty in its own words', async () => {
    api.getVenuePayments.mockResolvedValue(
      report({ payments: [], unpaidOrders: [], cancellations: [] }),
    )

    await renderPage()

    expect(
      screen.getByText('No payment has been taken at the door for this event.'),
    ).toBeInTheDocument()
    expect(screen.getByText('No bookings are waiting to be paid at the door.')).toBeInTheDocument()
    expect(screen.getByText('No unpaid tickets have been cancelled.')).toBeInTheDocument()
  })

  it('shows a finance member everything but the button', async () => {
    api.getVenuePayments.mockResolvedValue(report({ canCancelUnpaid: false }))

    await renderPage()

    expect(screen.getByRole('table', { name: 'Bookings with unpaid tickets' })).toHaveTextContent(
      'Ravi Shah',
    )
    expect(screen.queryByRole('button', { name: /Cancel unpaid tickets/u })).toBeNull()
    expect(screen.queryByText(/You can cancel tickets/u)).toBeNull()
    expect(screen.getByRole('table', { name: 'Cancelled unpaid tickets' })).toBeInTheDocument()
  })

  it('names who cancelled as the organisation reads it', () => {
    expect(cancelledByWords({ by: 'ORGANISER', byName: 'Meera Owner' })).toBe('Meera Owner')
    expect(cancelledByWords({ by: 'DESI_EVENT', byName: 'Priya Admin' })).toBe(
      'Priya Admin (Desi-Event)',
    )
    expect(cancelledByWords({ by: 'DESI_EVENT', byName: null })).toBe('The Desi-Event team')
  })
})

describe('who may read it', () => {
  it('offers the second factor in place when it has lapsed', async () => {
    api.getVenuePayments.mockRejectedValue(
      Object.assign(new Error('Step up.'), { status: 403, code: 'STEP_UP_REQUIRED' }),
    )

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()
    expect(screen.getByText(/see the payments taken at the door/u)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Figures' })).toBeNull()
  })

  it('refuses a reader without finance in the organisation, and reads no report', async () => {
    await renderPage({
      user: { id: 'u2' },
      capabilities: [],
      memberships: [{ organizationId: EVENT.organizationId, capabilities: ['event:view_draft'] }],
    })

    expect(api.getVenuePayments).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Figures' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to the event' })).toHaveAttribute(
      'href',
      `/organizer/events/${EVENT.id}`,
    )
  })

  it('says the event could not be opened when its read is refused', async () => {
    api.getOrganizerEvent.mockRejectedValue(
      Object.assign(new Error('No such event.'), { status: 404, code: 'NOT_FOUND' }),
    )

    await renderPage()

    expect(api.getVenuePayments).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Back to your events' })).toBeInTheDocument()
  })
})
