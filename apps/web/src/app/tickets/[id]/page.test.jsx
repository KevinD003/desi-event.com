/**
 * One ticket's page: the night it is for, and the online event's joining link
 * for its holder while it admits — and for nobody else.
 *
 * What these pin:
 *
 *   - **The night is labelled truthfully.** The organiser's label beside the
 *     night's own date in its own zone, or no row at all for a ticket good for
 *     every night.
 *   - **The joining link is the holder's.** It is drawn only when the API gave
 *     it and the reader is the holder, it leaks no referrer, and an organiser
 *     reading the same ticket never sees it.
 *
 * @module app/tickets/id/page.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../lib/organizer-api.js', () => ({ getTicket: vi.fn() }))
vi.mock('../../../lib/session.js', async () => {
  const actual = await vi.importActual('../../../lib/session.js')

  return { ...actual, readSession: vi.fn() }
})

const { getTicket } = await import('../../../lib/organizer-api.js')
const { readSession } = await import('../../../lib/session.js')
const { default: TicketDetailPage, metadata } = await import('./page.jsx')

const JOIN = 'https://stream.example.com/room/9f2c'

/**
 * `GET /v1/tickets/:id` as its holder reads it.
 *
 * @param {object} [overrides] Fields of `data` to change.
 * @returns {object} The payload's `data`.
 */
function detail(overrides = {}) {
  return {
    ticket: {
      id: 'tkt00000000000000000001',
      orderItemId: 'itm00000000000000000001',
      code: 'DE-SWP-7Q2K',
      attendeeName: 'Asha Patel',
      status: 'VALID',
      checkedInAt: null,
    },
    event: {
      id: 'evt00000000000000000001',
      slug: 'nine-nights-online',
      title: 'Nine Nights, Online',
      category: 'GARBA_DANDIYA',
      startsAt: '2026-10-03T23:30:00.000Z',
      timezone: 'America/New_York',
      status: 'ON_SALE',
      coverImage: null,
    },
    organizationId: 'org00000000000000000001',
    holder: true,
    transfers: [],
    session: {
      id: 'ses00000000000000000002',
      label: 'Night 2',
      startsAt: '2026-10-04T23:30:00.000Z',
      endsAt: '2026-10-05T04:30:00.000Z',
      doorsOpenAt: null,
      timezone: 'America/New_York',
    },
    onlineJoinUrl: JOIN,
    ...overrides,
  }
}

/**
 * Render the page for one ticket.
 *
 * @returns {Promise<object>} The render result.
 */
async function renderPage() {
  return render(
    await TicketDetailPage({ params: Promise.resolve({ id: 'tkt00000000000000000001' }) }),
  )
}

beforeEach(() => {
  getTicket.mockReset()
  readSession.mockReset()
  readSession.mockResolvedValue({ user: { displayName: 'Asha Patel' }, memberships: [] })
})

afterEach(() => cleanup())

describe('the night a ticket is for', () => {
  it('is its label beside its own date, in the night’s zone', async () => {
    getTicket.mockResolvedValue(detail())

    await renderPage()

    const night = screen.getByText('Night', { selector: 'dt' })
    expect(night.nextElementSibling).toHaveTextContent('Night 2 · Sun, Oct 4 · 7:30 PM')
  })

  it('is the date alone for a night with no label', async () => {
    getTicket.mockResolvedValue(detail({ session: { ...detail().session, label: null } }))

    await renderPage()

    expect(screen.getByText('Night', { selector: 'dt' }).nextElementSibling).toHaveTextContent(
      /^Sun, Oct 4 · 7:30 PM$/u,
    )
  })

  it('is not given for a ticket good for every night', async () => {
    getTicket.mockResolvedValue(detail({ session: null }))

    await renderPage()

    expect(screen.queryByText('Night', { selector: 'dt' })).toBeNull()
  })
})

describe('joining the online event', () => {
  it('is offered to the holder, naming the host, and sends no referrer', async () => {
    getTicket.mockResolvedValue(detail())

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Join the online event' })).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Join online at stream.example.com' })
    expect(link).toHaveAttribute('href', JOIN)
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('is not offered when the API gave no link — a ticket that no longer admits', async () => {
    getTicket.mockResolvedValue(
      detail({ ticket: { ...detail().ticket, status: 'REFUNDED' }, onlineJoinUrl: null }),
    )

    await renderPage()

    expect(screen.queryByRole('heading', { name: 'Join the online event' })).toBeNull()
    expect(document.body.innerHTML).not.toContain('stream.example.com')
  })

  it('is never shown to the organiser reading the same ticket', async () => {
    // Even were a link to arrive, the page draws it for the holder only.
    getTicket.mockResolvedValue(detail({ holder: false }))

    await renderPage()

    expect(screen.queryByRole('heading', { name: 'Join the online event' })).toBeNull()
    expect(document.body.innerHTML).not.toContain('stream.example.com')
  })

  it('draws nothing for a link that is not a web address', async () => {
    getTicket.mockResolvedValue(detail({ onlineJoinUrl: 'javascript:alert(1)' }))

    await renderPage()

    expect(screen.queryByRole('heading', { name: 'Join the online event' })).toBeNull()
    expect(screen.queryByRole('link', { name: /Join online/u })).toBeNull()
  })
})

describe('the page itself', () => {
  it('stays out of the index', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})

describe('what changed since the ticket was bought', () => {
  it('lists a cancelled night in its own box, naming the night', async () => {
    getTicket.mockResolvedValue(
      detail({
        eventChanges: [
          {
            id: 'cnotice000000000000000002',
            kind: 'SESSION_CANCELLED',
            at: '2026-10-01T10:00:00.000Z',
            changed: [],
            before: null,
            after: null,
            reason: 'The singer cancelled.',
            sessionId: 'ses00000000000000000002',
            by: 'ORGANIZER',
          },
        ],
      }),
    )
    await renderPage()

    const changes = screen.getByRole('region', { name: 'Changes since you bought' })

    expect(within(changes).getByText('A night was cancelled')).toBeInTheDocument()
    expect(changes).toHaveTextContent('The night of Night 2')
    expect(changes).toHaveTextContent('Reason given: The singer cancelled.')
  })

  it('names a cancelled night by when it was to start on a ticket good for every night', async () => {
    // An every-night pass has no night of its own (`session` is null), and the
    // holder is the one a cancelled night matters to.
    getTicket.mockResolvedValue(
      detail({
        session: null,
        eventChanges: [
          {
            id: 'cnotice000000000000000002',
            kind: 'SESSION_CANCELLED',
            at: '2026-10-01T10:00:00.000Z',
            changed: ['a night'],
            before: { startsAt: '2030-10-11T13:30:00.000Z' },
            after: null,
            reason: 'The singer cancelled.',
            sessionId: 'ses00000000000000000003',
            by: 'ORGANIZER',
          },
        ],
      }),
    )
    await renderPage()

    expect(screen.getByRole('region', { name: 'Changes since you bought' })).toHaveTextContent(
      /The night of Fri, Oct 11, 2030, \d{1,2}:\d{2}\s?[AP]M\./,
    )
  })

  it('says a deleted event’s ticket no longer works at the door, and who took the page down', async () => {
    getTicket.mockResolvedValue(
      detail({
        event: { ...detail().event, status: 'DELETED' },
        eventChanges: [
          {
            ...{
              id: 'cnotice000000000000000001',
              kind: 'MATERIAL_CHANGE',
              at: '2026-10-01T10:00:00.000Z',
              changed: ['startsAt'],
              before: { startsAt: '2026-10-10T13:30:00.000Z' },
              after: { startsAt: '2026-10-17T13:30:00.000Z' },
              reason: 'The garden was booked twice.',
              sessionId: null,
              by: 'DESI_EVENT',
            },
            kind: 'DELETED',
            changed: [],
            by: 'DESI_EVENT',
          },
        ],
      }),
    )
    await renderPage()

    expect(
      screen.getByText(
        'The Desi-Event team removed this event’s page. It is no longer on the site, and this ticket no longer works at the door.',
      ),
    ).toBeInTheDocument()
  })
})

describe('a withdrawn ticket', () => {
  it('says under "Where it stands" that it no longer works at the door, in the wallet’s words', async () => {
    getTicket.mockResolvedValue(
      detail({ ticket: { ...detail().ticket, status: 'CANCELLED' }, onlineJoinUrl: null }),
    )

    await renderPage()

    const section = screen.getByRole('region', { name: 'Where it stands' })

    expect(section).toHaveTextContent(
      'Does not admit. Withdrawn — this ticket no longer works at the door.',
    )
    expect(section).not.toHaveTextContent('Cancelled. It admits nobody.')
  })
})

describe('a ticket booked to pay at the door (SPEC3-XI §12.7)', () => {
  /**
   * What a ticket owing $40.00 at the door carries, with fields changed.
   *
   * @param {object} [overrides] Fields of `venuePayment` to change.
   * @returns {object} The ticket's `venuePayment`.
   */
  function venue(overrides = {}) {
    return {
      dueCents: 4_000,
      paid: false,
      currency: 'USD',
      cancelled: null,
      paidAtDoorByYou: false,
      ...overrides,
    }
  }

  /**
   * The "Where it stands" section.
   *
   * @returns {HTMLElement} The section.
   */
  function whereItStands() {
    return screen.getByRole('region', { name: 'Where it stands' })
  }

  it('tells its holder what it owes, once, under "Where it stands"', async () => {
    getTicket.mockResolvedValue(
      detail({ ticket: { ...detail().ticket, venuePayment: venue() }, onlineJoinUrl: null }),
    )

    await renderPage()

    expect(within(whereItStands()).getByText('Pay at the door: $40.00')).toBeInTheDocument()
    expect(
      within(whereItStands()).getByText(
        'Pay this at the door. The steward records it before letting you in.',
      ),
    ).toBeInTheDocument()
    // Not again under "What you can do": one note, where the state is.
    expect(screen.getAllByText('Pay at the door: $40.00')).toHaveLength(1)
  })

  it('dates a cancellation for not being paid in the event’s own zone, not UTC', async () => {
    // 02:30 UTC on 9 October is 10:30 PM on 8 October in New York, where the
    // event is: the holder reads the day the organiser acted, at the venue.
    getTicket.mockResolvedValue(
      detail({
        ticket: {
          ...detail().ticket,
          status: 'REVOKED',
          venuePayment: venue({
            cancelled: {
              at: '2026-10-09T02:30:00.000Z',
              by: 'ORGANISER',
              reason: 'Not paid for at the door by the end of the night.',
            },
          }),
        },
        onlineJoinUrl: null,
      }),
    )

    await renderPage()

    expect(within(whereItStands()).getByText('Cancelled — not paid')).toBeInTheDocument()
    expect(
      within(whereItStands()).getByText(
        'The organiser cancelled this ticket on Thu, Oct 8, 2026 because it had not been paid for. You no longer owe $40.00 for it.',
      ),
    ).toBeInTheDocument()
    // Why, too: a holder the ticket was passed to has no order page to read
    // it on (SPEC3-XI XU10).
    expect(
      within(whereItStands()).getByText(
        'Reason given: “Not paid for at the door by the end of the night.”',
      ),
    ).toBeInTheDocument()
  })

  it('tells a holder who paid at the door for a refunded ticket that the organiser has the money', async () => {
    getTicket.mockResolvedValue(
      detail({
        ticket: {
          ...detail().ticket,
          status: 'REFUNDED',
          venuePayment: venue({ paid: true, paidAtDoorByYou: true }),
        },
        onlineJoinUrl: null,
      }),
    )

    await renderPage()

    expect(
      within(whereItStands()).getByText(
        'The $40.00 you paid at the door for this ticket is with the organiser, not with Desi-Event. Ask the organiser to return it.',
      ),
    ).toBeInTheDocument()
  })

  it('addresses none of it to the organiser reading the same ticket', async () => {
    getTicket.mockResolvedValue(
      detail({
        holder: false,
        ticket: { ...detail().ticket, venuePayment: venue() },
        onlineJoinUrl: null,
      }),
    )

    await renderPage()

    expect(screen.queryByText('Pay at the door: $40.00')).toBeNull()
    expect(screen.queryByText(/Pay this at the door/u)).toBeNull()
  })

  it('draws no note for a ticket that owes nothing at the door', async () => {
    getTicket.mockResolvedValue(
      detail({ ticket: { ...detail().ticket, venuePayment: null }, onlineJoinUrl: null }),
    )

    await renderPage()

    expect(screen.queryByText(/at the door/u)).toBeNull()
  })
})
