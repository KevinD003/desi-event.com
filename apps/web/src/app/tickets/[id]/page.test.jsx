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

import { cleanup, render, screen } from '@testing-library/react'
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
