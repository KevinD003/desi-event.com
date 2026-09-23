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
