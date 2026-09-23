/**
 * The transfers page must show who an offer went to only as the API masked
 * it, and must not invent a way to do what the API refuses.
 *
 * The properties worth pinning:
 *
 *   - **The recipient is the masked string, and only that.** No address beyond
 *     `toEmailMasked` reaches the markup, even when the payload carries more.
 *   - **Withdrawing happens on the ticket.** Each offer links there.
 *   - **The wallet's sections, not a second opinion.** "Given to you" and
 *     "Handed on" hold what the wallet puts in them, and a used ticket is in
 *     neither. A ticket on offer is one card, under the offers, and "Handed
 *     on" does not call a ticket that was given to you one you bought.
 *   - **Nothing is claimed about how a code travels** that the API does not do:
 *     the sender never has the code.
 *   - **One clock per card.** The event's time and the offer's deadline name
 *     the zone the same way.
 *   - **Reserved seats are stated as they are.** Without "yet", without
 *     "coming soon".
 *   - **Nothing is not the same as a failure.** An empty account gets the
 *     empty state; a dead API gets the failure and no empty state; a first
 *     page with more behind it says nothing about the tickets it did not read.
 *
 * @module app/account/transfers/page.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/organizer-api.js', () => ({ getMyTickets: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/account/transfers',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { getMyTickets } = await import('../../../lib/organizer-api.js')
const { default: TransfersPage } = await import('./page.jsx')

/** The recipient as the API masks it. */
const MASKED = '••••@example.com'

/**
 * A wallet row as `GET /v1/tickets` returns it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The row.
 */
function walletTicket(overrides = {}) {
  return {
    id: 'tkt00000000000000000001',
    orderItemId: 'itm00000000000000000001',
    code: 'DET-SECRET7Q2',
    attendeeName: null,
    status: 'VALID',
    checkedInAt: null,
    holderRelationship: 'PURCHASED',
    admits: true,
    admissionRefusal: null,
    orderReference: 'DE-8F3K2Q',
    event: {
      id: 'evt00000000000000000001',
      slug: 'diwali-mela',
      title: 'Diwali Mela',
      startsAt: '2030-10-10T13:30:00.000Z',
      endsAt: '2030-10-10T18:00:00.000Z',
      timezone: 'Asia/Kolkata',
      status: 'PUBLISHED',
      cancelledAt: null,
    },
    venue: { name: 'Jio World Garden', city: 'Mumbai', region: 'MH', country: 'IN' },
    isOnline: false,
    tier: { id: 'tt000000000000000000001', name: 'Gold' },
    seat: null,
    pendingTransfer: null,
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  }
}

/** A ticket this person has offered to somebody, still open. */
const OFFERED = walletTicket({
  id: 'tktOFFERED00000000000001',
  status: 'TRANSFER_PENDING',
  pendingTransfer: {
    id: 'trf00000000000000000001',
    toEmailMasked: MASKED,
    expiresAt: '2030-10-01T00:00:00.000Z',
  },
})

/** A ticket somebody handed to this person. */
const GIVEN = walletTicket({
  id: 'tktGIVEN0000000000000001',
  holderRelationship: 'RECEIVED',
  orderReference: null,
  event: { ...walletTicket().event, title: 'Holi Festival' },
})

/** A ticket this person handed on. */
const HANDED_ON = walletTicket({
  id: 'tktHANDEDON0000000000001',
  status: 'TRANSFERRED',
  admits: false,
  event: { ...walletTicket().event, title: 'Garba Night' },
})

/** A ticket that was used, and so belongs to none of this page's sections. */
const USED = walletTicket({
  id: 'tktUSED00000000000000001',
  status: 'CHECKED_IN',
  admits: false,
  event: { ...walletTicket().event, title: 'Eid Bazaar' },
})

/**
 * Render the page with what the wallet read returns.
 *
 * @param {object[]} tickets The rows.
 * @param {object|null} [pagination] The counters.
 * @returns {Promise<object>} The render result.
 */
async function renderPage(tickets, pagination = null) {
  getMyTickets.mockResolvedValue({ tickets, pagination })

  return render(await TransfersPage())
}

beforeEach(() => {
  getMyTickets.mockReset()
})

afterEach(cleanup)

describe('offers you have made', () => {
  it('shows the recipient exactly as the API masked it', async () => {
    await renderPage([OFFERED])

    const section = screen.getByRole('region', { name: 'Offers you have made' })

    expect(within(section).getByText(MASKED)).toBeInTheDocument()
  })

  it('prints no address beyond the masked one, even when the payload carries more', async () => {
    const leaky = {
      ...OFFERED,
      pendingTransfer: { ...OFFERED.pendingTransfer, toEmail: 'priya.sharma@example.com' },
    }

    const { container } = await renderPage([leaky])

    const addresses = container.innerHTML.match(/[^\s<>"]*@[^\s<>"]*/g) ?? []

    expect(addresses).toEqual([MASKED])
    expect(container.innerHTML).not.toContain('priya')
  })

  it('shows "Hidden email" when that is what the API sent', async () => {
    await renderPage([
      {
        ...OFFERED,
        pendingTransfer: { ...OFFERED.pendingTransfer, toEmailMasked: 'Hidden email' },
      },
    ])

    expect(screen.getByText('Hidden email')).toBeInTheDocument()
  })

  it('links to the ticket, where the offer is withdrawn', async () => {
    await renderPage([OFFERED])

    expect(
      screen.getByRole('link', { name: 'Withdraw or view this offer' }).getAttribute('href'),
    ).toBe('/tickets/tktOFFERED00000000000001')
    // Withdrawing is not re-implemented here.
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says a lapsed offer can no longer be accepted', async () => {
    await renderPage([
      {
        ...OFFERED,
        pendingTransfer: { ...OFFERED.pendingTransfer, expiresAt: '2020-01-01T00:00:00.000Z' },
      },
    ])

    expect(screen.getByText(/can no longer be accepted/)).toBeInTheDocument()
    expect(screen.getByText('Lapsed')).toBeInTheDocument()
  })

  it('writes the event’s time and the deadline on one clock, naming the zone alike', async () => {
    await renderPage([OFFERED])

    const card = screen.getByRole('region', { name: 'Offers you have made' })
    const when = within(card).getByText('When').nextElementSibling.textContent
    const until = within(card).getByText('Open until').nextElementSibling.textContent
    const zone = /(IST|GMT\+5:30)$/

    // 13:30 UTC is 7:00 PM in Mumbai; 00:00 UTC is 5:30 AM.
    expect(when).toMatch(/7:00\sPM/)
    expect(until).toMatch(/5:30\sAM/)
    expect(when.match(zone)?.[1]).toBeDefined()
    expect(until.match(zone)?.[1]).toBe(when.match(zone)[1])
  })

  it('never renders a ticket’s code', async () => {
    const { container } = await renderPage([OFFERED, GIVEN, HANDED_ON])

    expect(container.innerHTML).not.toContain('DET-SECRET7Q2')
  })
})

describe('the wallet’s own sections', () => {
  it('lists given and handed-on tickets as links, with their status in words', async () => {
    await renderPage([GIVEN, HANDED_ON, USED])

    const given = screen.getByRole('region', { name: 'Given to you' })
    const handedOn = screen.getByRole('region', { name: 'Handed on' })

    expect(within(given).getByRole('link', { name: 'Holi Festival' }).getAttribute('href')).toBe(
      '/tickets/tktGIVEN0000000000000001',
    )
    expect(within(given).getByText('Ready to use')).toBeInTheDocument()
    expect(within(handedOn).getByRole('link', { name: 'Garba Night' }).getAttribute('href')).toBe(
      '/tickets/tktHANDEDON0000000000001',
    )
    expect(within(handedOn).getByText('Handed on', { selector: 'span' })).toBeInTheDocument()
  })

  it('shows a ticket that was given to you and is now on offer once, as an offer', async () => {
    const passedOn = {
      ...GIVEN,
      status: 'TRANSFER_PENDING',
      pendingTransfer: OFFERED.pendingTransfer,
    }

    await renderPage([passedOn])

    expect(screen.getAllByText('Holi Festival')).toHaveLength(1)
    expect(
      within(screen.getByRole('region', { name: 'Offers you have made' })).getByText(
        'Holi Festival',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Given to you' })).toBeNull()
  })

  it('does not say a ticket you were given and passed on was one you bought', async () => {
    await renderPage([{ ...HANDED_ON, holderRelationship: 'RECEIVED', orderReference: null }])

    const handedOn = screen.getByRole('region', { name: 'Handed on' })

    expect(within(handedOn).getByRole('link', { name: 'Garba Night' })).toBeInTheDocument()
    expect(handedOn.textContent).not.toMatch(/bought/i)
    expect(handedOn.textContent).toMatch(/Tickets you handed to somebody else/)
  })

  it('leaves out a ticket that was simply used', async () => {
    await renderPage([GIVEN, USED])

    expect(screen.queryByText('Eid Bazaar')).toBeNull()
  })
})

describe('what is always said', () => {
  it('points to where an offered ticket is accepted', async () => {
    await renderPage([GIVEN])

    expect(
      screen
        .getByRole('link', { name: 'enter the code to accept the ticket' })
        .getAttribute('href'),
    ).toBe('/tickets/accept')
  })

  it('does not say the sender sent the code, which the API never gives them', async () => {
    await renderPage([GIVEN])

    const accept = screen.getByRole('region', { name: 'Accept a ticket' })

    expect(accept.textContent).not.toMatch(/sent you|they sent/i)
    expect(accept.textContent).toMatch(/never sees that code/)
    expect(accept.textContent).toMatch(/delivers no email/)
  })

  it('says reserved-seat tickets cannot be handed on, and promises nothing', async () => {
    const { container } = await renderPage([GIVEN])
    const seats = screen.getByRole('region', { name: 'Reserved seats' })

    expect(seats.textContent).toMatch(/Tickets for reserved seats cannot be handed on\./)
    expect(seats.textContent).not.toMatch(/\byet\b/i)
    expect(container.textContent).not.toMatch(/coming soon/i)
  })

  it('says when it is reading only the newest of the tickets on the account', async () => {
    await renderPage([GIVEN], {
      page: 1,
      perPage: 1,
      total: 30,
      totalPages: 30,
      hasNextPage: true,
      hasPreviousPage: false,
    })

    expect(
      screen.getByText(/reads the 1 most recently issued of the 30 tickets/),
    ).toBeInTheDocument()
  })
})

describe('nothing, and failure', () => {
  it('draws the empty state when no section has anything in it', async () => {
    await renderPage([USED])

    expect(screen.getByText('Nothing handed on or received')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Offers you have made' })).toBeNull()
  })

  it('does not say nothing was handed on when it read only the newest tickets', async () => {
    await renderPage([USED], {
      page: 1,
      perPage: 1,
      total: 30,
      totalPages: 30,
      hasNextPage: true,
      hasPreviousPage: false,
    })

    expect(screen.queryByText('Nothing handed on or received')).toBeNull()
    expect(
      screen.getByText(/None of the 1 most recently issued tickets on this account/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Older tickets were not read\./)).toBeInTheDocument()
  })

  it('draws a dead API as a failure, not as nothing', async () => {
    getMyTickets.mockRejectedValue(new TypeError('fetch failed'))

    const { container } = render(await TransfersPage())

    expect(container.textContent).toMatch(/Your transfers could not be loaded\./)
    expect(screen.queryByText('Nothing handed on or received')).toBeNull()
  })
})
