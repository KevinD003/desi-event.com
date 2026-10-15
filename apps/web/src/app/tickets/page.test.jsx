/**
 * The wallet, as cards.
 *
 * What these pin is what the redesign added and must not get wrong:
 *
 *   - **The poster is scenery.** Every card draws its event's poster, and none
 *     of them is announced: the card's heading already names the event.
 *   - **The way to the pass is offered only where the server said the ticket
 *     admits**, and it goes to the ticket's own page — the pass itself is
 *     never on this list.
 *   - **The status is a word.** The chip says what the state means, from the
 *     one table the ticket and order pages share.
 *   - **Every group is a region named by its heading**, and each ticket's
 *     heading link is the event's title.
 *   - **A group pass is a link, never a pass.** An order with two to fifty
 *     tickets this account bought and that still admit gets a card linking to
 *     the order's group pass; the count is not given from a cut-short list.
 *
 * @module app/tickets/page.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/organizer-api.js', () => ({ getMyTickets: vi.fn() }))

const { getMyTickets } = await import('../../lib/organizer-api.js')
const { describePoster } = await import('../../lib/poster-art.js')
const { default: MyTicketsPage } = await import('./page.jsx')

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
    code: 'DE-SWP-7Q2K',
    attendeeName: null,
    status: 'VALID',
    checkedInAt: null,
    holderRelationship: 'PURCHASED',
    admits: true,
    admissionRefusal: null,
    orderReference: 'DE-8F3K2Q',
    event: {
      id: 'evt00000000000000000001',
      slug: 'navratri-night-one-edison',
      title: 'Navratri Night One: Garba Under the Lights',
      category: 'GARBA_DANDIYA',
      startsAt: '2030-10-10T23:30:00.000Z',
      endsAt: '2030-10-11T04:00:00.000Z',
      timezone: 'America/New_York',
      status: 'ON_SALE',
      cancelledAt: null,
    },
    venue: { name: 'Lamplight Expo Hall', city: 'Edison', region: 'NJ', country: 'US' },
    isOnline: false,
    tier: { id: 'tt000000000000000000001', name: 'General Admission' },
    seat: null,
    pendingTransfer: null,
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  }
}

/**
 * Render the page over the given rows.
 *
 * @param {object[]} tickets The rows.
 * @returns {Promise<object>} The render result.
 */
async function renderWallet(tickets) {
  getMyTickets.mockResolvedValue({ tickets, pagination: null })

  return render(await MyTicketsPage())
}

beforeEach(() => {
  getMyTickets.mockReset()
})

afterEach(cleanup)

describe('MyTicketsPage', () => {
  it('draws each ticket’s poster without announcing it', async () => {
    const { container } = await renderWallet([walletTicket()])

    expect(container.querySelectorAll('[data-slot="poster-thumb"] svg')).toHaveLength(1)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('draws the same scene as the event’s own page, from the category the API sends', async () => {
    const workshop = walletTicket()
    workshop.event = { ...workshop.event, category: 'WORKSHOP' }

    const { container } = await renderWallet([walletTicket(), workshop])
    const scenes = [...container.querySelectorAll('[data-slot="poster-thumb"] svg')].map((svg) =>
      svg.getAttribute('aria-label'),
    )

    expect(describePoster('WORKSHOP')).not.toBe(describePoster('GARBA_DANDIYA'))
    expect(scenes).toEqual([
      `${describePoster('GARBA_DANDIYA')} for Navratri Night One: Garba Under the Lights`,
      `${describePoster('WORKSHOP')} for Navratri Night One: Garba Under the Lights`,
    ])
  })

  it('offers the entry pass only for a ticket the server says admits, on its own page', async () => {
    await renderWallet([
      walletTicket(),
      walletTicket({
        id: 'tkt00000000000000000002',
        status: 'CHECKED_IN',
        admits: false,
        admissionRefusal: 'This ticket has already been used.',
        event: {
          ...walletTicket().event,
          id: 'evt00000000000000000002',
          slug: 'garba-warm-up-night-atlanta',
          title: 'Garba Warm-Up Night',
        },
      }),
    ])

    const passes = screen.getAllByRole('link', { name: /^show my entry pass/iu })

    expect(passes).toHaveLength(1)
    // Named for its event, so a list of them is not a list of the same words.
    expect(passes[0].textContent).toBe(
      'Show my entry pass for Navratri Night One: Garba Under the Lights',
    )
    expect(passes[0].getAttribute('href')).toBe('/tickets/tkt00000000000000000001#entry-pass')
  })

  it('names each ticket by its event and says its state in words', async () => {
    await renderWallet([walletTicket()])

    const region = screen.getByRole('region', { name: 'Coming up' })
    const item = within(region).getByRole('listitem')

    expect(
      within(item).getByRole('heading', { level: 3 }).querySelector('a').getAttribute('href'),
    ).toBe('/tickets/tkt00000000000000000001')
    expect(within(item).getByRole('heading', { level: 3 }).textContent).toBe(
      'Navratri Night One: Garba Under the Lights',
    )
    expect(within(item).getByText('Ready to use')).toBeTruthy()
    expect(within(item).getByText('Lamplight Expo Hall, Edison')).toBeTruthy()
  })

  it('says a ticket withdrawn because its night or event was called off no longer works, never the raw CANCELLED', async () => {
    await renderWallet([
      walletTicket({
        status: 'CANCELLED',
        admits: false,
        admissionRefusal: null,
        revokedAt: '2026-10-08T15:00:00.000Z',
      }),
    ])

    expect(
      screen.getByText('Withdrawn — this ticket no longer works at the door'),
    ).toBeInTheDocument()
    expect(screen.queryByText('CANCELLED')).toBeNull()
  })

  it('keeps the count of what still admits', async () => {
    await renderWallet([walletTicket()])

    expect(screen.getByText('One ticket still gets you in.')).toBeTruthy()
  })

  it('has one level-one heading, the page’s', async () => {
    await renderWallet([walletTicket()])

    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'My tickets',
    ])
  })
})

describe('group passes', () => {
  /** A second ticket on the same order as {@link walletTicket}'s default. */
  const PARTNER = { id: 'tkt00000000000000000002', code: 'DE-SWP-8R3L' }

  it('lists an order with two admitting tickets above the tickets, linking to its group pass', async () => {
    const { container } = await renderWallet([walletTicket(), walletTicket(PARTNER)])

    const region = screen.getByRole('region', { name: 'Group passes' })
    const card = within(region).getByRole('listitem')

    expect(within(card).getByRole('heading', { level: 3 }).textContent).toBe(
      'Navratri Night One: Garba Under the Lights',
    )
    expect(within(card).getByText('Group pass (admits 2)')).toBeTruthy()

    const link = within(card).getByRole('link', { name: /^show group pass/iu })

    expect(link.textContent).toBe('Show group pass for Navratri Night One: Garba Under the Lights')
    expect(link.getAttribute('href')).toBe('/account/orders/DE-8F3K2Q#group-pass')
    // Above the ticket sections, and nothing of a pass on the page.
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)

    expect(headings.indexOf('Group passes')).toBeLessThan(headings.indexOf('Coming up'))
    expect(container.textContent).not.toMatch(/DEG-|G1\./)
  })

  it('has none when each order has one ticket', async () => {
    await renderWallet([walletTicket(), walletTicket({ ...PARTNER, orderReference: 'DE-9G4L3R' })])

    expect(screen.queryByRole('region', { name: 'Group passes' })).toBeNull()
    expect(screen.queryByRole('link', { name: /show group pass/iu })).toBeNull()
  })

  it('counts only tickets this account bought and that still admit', async () => {
    await renderWallet([
      walletTicket(),
      walletTicket({ ...PARTNER, holderRelationship: 'RECEIVED' }),
      walletTicket({
        id: 'tkt00000000000000000003',
        status: 'CHECKED_IN',
        admits: false,
        admissionRefusal: 'This ticket has already been used.',
      }),
    ])

    expect(screen.queryByRole('region', { name: 'Group passes' })).toBeNull()
  })

  it('does not count from a cut-short list, and sends the reader to the order for it', async () => {
    getMyTickets.mockResolvedValue({
      tickets: [walletTicket(), walletTicket(PARTNER)],
      pagination: { hasNextPage: true, total: 140 },
    })

    render(await MyTicketsPage())

    const card = within(screen.getByRole('region', { name: 'Group passes' })).getByRole('listitem')

    expect(within(card).queryByText(/admits \d/)).toBeNull()
    expect(within(card).getByText('Group pass')).toBeTruthy()
    expect(within(card).getByText(/how many it admits is on the order’s page/)).toBeTruthy()
  })
})

describe('a ticket for one night, and an online event’s link', () => {
  it('names the night a ticket is for, label and date together', async () => {
    await renderWallet([
      walletTicket({
        session: {
          id: 'snnighttwoxxx',
          label: 'Night 2',
          startsAt: '2030-10-11T23:30:00.000Z',
          endsAt: '2030-10-12T04:00:00.000Z',
          doorsOpenAt: null,
          timezone: 'America/New_York',
        },
      }),
    ])

    expect(screen.getByText('Night')).toBeInTheDocument()
    expect(screen.getByText('Night 2 · Fri, Oct 11 · 7:30 PM')).toBeInTheDocument()
  })

  it('says nothing about a night for a ticket good for every night', async () => {
    await renderWallet([walletTicket({ session: null })])

    expect(screen.queryByText('Night')).toBeNull()
  })

  it('offers the joining link only when the server gave one, named by its host, with no referrer', async () => {
    await renderWallet([
      walletTicket({
        isOnline: true,
        venue: null,
        onlineJoinUrl: 'https://stream.example.com/r/1',
      }),
    ])

    const link = screen.getByRole('link', { name: /^Join online at stream\.example\.com/u })

    expect(link.textContent).toBe(
      'Join online at stream.example.com for Navratri Night One: Garba Under the Lights',
    )
    expect(link).toHaveAttribute('href', 'https://stream.example.com/r/1')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('referrerPolicy', 'no-referrer')
  })

  it('offers no joining link for a ticket that does not admit, whose link the server withheld', async () => {
    await renderWallet([
      walletTicket({
        isOnline: true,
        venue: null,
        admits: false,
        status: 'REVOKED',
        admissionRefusal: 'This ticket has been revoked.',
        onlineJoinUrl: null,
      }),
    ])

    expect(screen.queryByRole('link', { name: /^Join online/u })).toBeNull()
  })

  it('does not draw a link that is not a web address', async () => {
    await renderWallet([walletTicket({ isOnline: true, onlineJoinUrl: 'javascript:alert(1)' })])

    expect(screen.queryByRole('link', { name: /^Join online/u })).toBeNull()
  })
})

describe('tickets booked to pay at the venue (SPEC3 §12.7, SPEC3-XI §12.7)', () => {
  /** What a ticket owing $40.00 at the door carries. */
  const OWING = {
    dueCents: 4_000,
    paid: false,
    currency: 'USD',
    cancelled: null,
    paidAtDoorByYou: false,
  }

  it('reads "Pay at the door" on the card instead of "Ready to use", and says how', async () => {
    await renderWallet([walletTicket({ venuePayment: OWING })])

    expect(screen.getByText('Pay at the door: $40.00')).toBeInTheDocument()
    expect(screen.queryByText('Ready to use')).toBeNull()
    expect(
      screen.getByText('Pay this at the door. The steward records it before letting you in.'),
    ).toBeInTheDocument()
  })

  it('says on the card why a ticket was cancelled unpaid, once', async () => {
    const reason = 'Not paid for at the door by the end of the night.'

    await renderWallet([
      walletTicket({
        status: 'REVOKED',
        admits: false,
        holderRelationship: 'RECEIVED',
        orderReference: null,
        revokedAt: '2030-10-11T05:00:00.000Z',
        // The API sends no marker as a reason (`holderRevokedReason`): the
        // reason given is the cancellation's own.
        revokedReason: null,
        venuePayment: {
          ...OWING,
          cancelled: { at: '2030-10-11T05:00:00.000Z', by: 'ORGANISER', reason },
        },
      }),
    ])

    expect(screen.getByText('Cancelled — not paid')).toBeInTheDocument()
    expect(screen.getAllByText(`Reason given: “${reason}”`)).toHaveLength(1)
  })

  it('says on the group pass what the buyer’s own tickets still owe at the door', async () => {
    await renderWallet([
      walletTicket({ venuePayment: OWING }),
      walletTicket({
        id: 'tkt00000000000000000002',
        code: 'DE-SWP-8R3L',
        venuePayment: OWING,
      }),
    ])

    const region = screen.getByRole('region', { name: 'Group passes' })

    expect(
      within(region).getByText('Pay $80.00 at the door for the tickets still unpaid.'),
    ).toBeInTheDocument()
  })
})
