/**
 * One order must say what was bought and what it cost without inventing
 * anything, and must not hand out what it should not.
 *
 * The properties worth pinning:
 *
 *   - **No codes.** The payload carries each ticket's `code`; the page never
 *     renders one, anywhere in its markup.
 *   - **One row per ticket.** A superseded row is not listed, and a ticket
 *     handed on for good is accounted for in words rather than silently
 *     dropped from the count.
 *   - **One answer for "not yours" and "no such order".** A 404, a 403, a
 *     malformed reference and an order read as an organiser all produce the
 *     same page, word for word.
 *   - **Honest money.** Zero discount and tax lines are left out, the total is
 *     there, and a paid order says its payment was simulated.
 *   - **Other refusals are not "not found".** A lapsed step-up is offered the
 *     step-up; a dead API is a failure.
 *   - **Links only where they open.** A ticket is linked only when the
 *     signed-in account is the one the order's tickets were issued to, and the
 *     page promises a pass or a hand-over only for a ticket that has one.
 *
 * @module app/account/orders/reference/page.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/account-api.js', () => ({ getMyOrder: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/account/orders/DE-8F3K2Q',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../../lib/session.js', () => ({ readSession: vi.fn() }))

const { getMyOrder } = await import('../../../../lib/account-api.js')
const { readSession } = await import('../../../../lib/session.js')
const {
  default: OrderPage,
  venueCancellationSentences,
  venueEndedSentences,
  venueEndingSentences,
} = await import('./page.jsx')

/** The signed-in account, which placed the default order. */
const VIEWER = 'usr00000000000000000001'

/** An event that has not happened yet, whenever these tests run. */
const LATER = {
  title: 'Diwali Mela',
  slug: 'diwali-mela',
  startsAt: '2030-10-10T13:30:00.000Z',
  endsAt: '2030-10-10T18:00:00.000Z',
  timezone: 'Asia/Kolkata',
  venueName: 'Jio World Garden',
  city: 'Mumbai',
  isOnline: false,
}

/** A ticket code that must never reach the page. */
const SECRET_CODE = 'DET-SECRET7Q2'

/**
 * A ticket row as the order payload carries it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The ticket.
 */
function ticket(overrides = {}) {
  return {
    id: 'tkt00000000000000000001',
    orderItemId: 'itm00000000000000000001',
    code: SECRET_CODE,
    attendeeName: null,
    status: 'VALID',
    checkedInAt: null,
    purchaserHolding: 'HELD',
    supersededByLaterTicket: false,
    ...overrides,
  }
}

/**
 * An order as `GET /v1/orders/:reference` returns it to its buyer.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The order.
 */
function order(overrides = {}) {
  return {
    id: 'ord00000000000000000001',
    reference: 'DE-8F3K2Q',
    eventId: 'evt00000000000000000001',
    userId: 'usr00000000000000000001',
    status: 'PAID',
    currency: 'INR',
    subtotalCents: 100000,
    discountCents: 0,
    feesCents: 5000,
    taxCents: 0,
    totalCents: 105000,
    createdAt: '2026-09-01T10:00:00.000Z',
    paidAt: '2026-09-01T10:01:00.000Z',
    cancelledAt: null,
    buyerName: 'Asha',
    buyerEmail: 'asha@example.com',
    items: [
      {
        id: 'itm00000000000000000001',
        orderId: 'ord00000000000000000001',
        ticketTypeId: 'tt000000000000000000001',
        quantity: 2,
        unitPriceCents: 50000,
        subtotalCents: 100000,
      },
    ],
    tickets: [
      ticket({ id: 'tkt00000000000000000001' }),
      ticket({ id: 'tkt00000000000000000002', code: 'DET-SECRET8R3' }),
    ],
    event: {
      title: 'Diwali Mela',
      slug: 'diwali-mela',
      startsAt: '2026-10-10T13:30:00.000Z',
      endsAt: '2026-10-10T18:00:00.000Z',
      timezone: 'Asia/Kolkata',
      venueName: 'Jio World Garden',
      city: 'Mumbai',
      isOnline: false,
    },
    ...overrides,
  }
}

/**
 * A refusal as `callApi` throws it.
 *
 * @param {object} fields Status, code, message.
 * @returns {Error} The error.
 */
function refused(fields) {
  return Object.assign(new Error(fields.message ?? 'The API answered.'), fields)
}

/**
 * Render the page for a reference.
 *
 * @param {string} [reference] The reference in the URL.
 * @returns {Promise<object>} The render result.
 */
async function renderPage(reference = 'DE-8F3K2Q') {
  return render(await OrderPage({ params: Promise.resolve({ reference }) }))
}

beforeEach(() => {
  getMyOrder.mockReset()
  readSession.mockReset()
  readSession.mockResolvedValue({ user: { id: VIEWER } })
})

afterEach(cleanup)

describe('the order', () => {
  it('reads the order named in the URL', async () => {
    getMyOrder.mockResolvedValue(order())

    await renderPage('DE-8F3K2Q')

    expect(getMyOrder).toHaveBeenCalledWith('DE-8F3K2Q')
  })

  it('is headed by its event, under a trail back to the orders', async () => {
    getMyOrder.mockResolvedValue(order())

    await renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Diwali Mela' })).toBeInTheDocument()

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })

    expect(trail.textContent).toContain('DE-8F3K2Q')
    expect(screen.getByRole('link', { name: 'Your orders' }).getAttribute('href')).toBe(
      '/account/orders',
    )
  })

  it('is headed by its reference when the event is gone', async () => {
    getMyOrder.mockResolvedValue(order({ event: null }))

    await renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Order DE-8F3K2Q' })).toBeInTheDocument()
  })

  it('gives its status in words and its times in the event’s timezone', async () => {
    getMyOrder.mockResolvedValue(order())

    const { container } = await renderPage()

    expect(screen.getAllByText('Paid — simulated').length).toBeGreaterThan(0)
    // 10:00 UTC is 3:30 PM in Mumbai.
    expect(container.textContent).toMatch(/Sep 1, 2026, 3:30\sPM (IST|GMT\+5:30)/)
  })
})

describe('what it cost', () => {
  it('labels lines without inventing a tier name', async () => {
    getMyOrder.mockResolvedValue(order())

    const { container } = await renderPage()

    expect(container.textContent).toContain('Tickets, 2 × ₹500.00')
    expect(container.textContent).toContain('₹1,000.00')
  })

  it('leaves out a zero discount and a zero tax, and keeps the booking fee and total', async () => {
    getMyOrder.mockResolvedValue(order())

    await renderPage()

    expect(screen.queryByText('Discount')).toBeNull()
    expect(screen.queryByText('Tax')).toBeNull()
    expect(screen.getByText('Booking fee')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('₹1,050.00')).toBeInTheDocument()
  })

  it('shows a discount and a tax that were applied', async () => {
    getMyOrder.mockResolvedValue(order({ discountCents: 10000, taxCents: 1800 }))

    await renderPage()

    expect(screen.getByText('Discount')).toBeInTheDocument()
    expect(screen.getByText('−₹100.00')).toBeInTheDocument()
    expect(screen.getByText('Tax')).toBeInTheDocument()
    expect(screen.getByText('₹18.00')).toBeInTheDocument()
  })

  it('names the tax as the event’s place does, once the order says where the event is', async () => {
    getMyOrder.mockResolvedValue(
      order({
        taxCents: 1800,
        event: { ...order().event, country: 'IN', region: 'Maharashtra' },
      }),
    )

    await renderPage()

    expect(screen.getByText('GST')).toBeInTheDocument()
    expect(screen.queryByText('Tax')).toBeNull()
    expect(screen.getByText('₹18.00')).toBeInTheDocument()
  })

  it('says a paid order’s payment was simulated, and says nothing about refunds', async () => {
    getMyOrder.mockResolvedValue(order())

    const { container } = await renderPage()

    expect(
      screen.getByText('Simulated payment — no card was charged and no money moved.'),
    ).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/refund/i)
  })

  it('says a refunded order was refunded', async () => {
    getMyOrder.mockResolvedValue(
      order({ status: 'REFUNDED', tickets: [ticket({ status: 'REFUNDED' })] }),
    )

    await renderPage()

    expect(screen.getByText(/This order was refunded in full\./)).toBeInTheDocument()
  })

  it('says a pending order is not paid and has no tickets yet', async () => {
    getMyOrder.mockResolvedValue(order({ status: 'PENDING', paidAt: null, tickets: [] }))

    await renderPage()

    expect(screen.getByText('Not paid.')).toBeInTheDocument()
    expect(screen.getByText(/None have been issued for this order\./)).toBeInTheDocument()
  })
})

describe('the tickets on it', () => {
  it('never renders a ticket’s code, even though the payload carries it', async () => {
    getMyOrder.mockResolvedValue(order())

    const { container } = await renderPage()

    expect(container.innerHTML).not.toContain(SECRET_CODE)
    expect(container.innerHTML).not.toContain('DET-SECRET8R3')
  })

  it('links each ticket to its own page by position, with its status in words', async () => {
    getMyOrder.mockResolvedValue(order())

    await renderPage()

    expect(screen.getByRole('link', { name: 'Ticket 1 of 2' }).getAttribute('href')).toBe(
      '/tickets/tkt00000000000000000001',
    )
    expect(screen.getByRole('link', { name: 'Ticket 2 of 2' }).getAttribute('href')).toBe(
      '/tickets/tkt00000000000000000002',
    )
    expect(screen.getAllByText('Ready to use')).toHaveLength(2)
  })

  it('does not list a superseded row', async () => {
    // Handed out and handed back: the buyer's original, superseded, and the
    // replacement they hold now. One purchase, one ticket.
    getMyOrder.mockResolvedValue(
      order({
        items: [{ ...order().items[0], quantity: 1, subtotalCents: 50000 }],
        tickets: [
          ticket({
            id: 'tktORIGINAL0000000000001',
            status: 'TRANSFERRED',
            purchaserHolding: 'TRANSFERRED_AWAY',
            supersededByLaterTicket: true,
          }),
          ticket({ id: 'tktREPLACEMENT00000000001' }),
        ],
      }),
    )

    const { container } = await renderPage()

    expect(screen.getByRole('link', { name: 'Ticket 1 of 1' }).getAttribute('href')).toBe(
      '/tickets/tktREPLACEMENT00000000001',
    )
    expect(container.innerHTML).not.toContain('tktORIGINAL0000000000001')
  })

  it('accounts for a ticket handed on for good instead of dropping it silently', async () => {
    getMyOrder.mockResolvedValue(
      order({
        tickets: [
          ticket({ id: 'tktKEPT00000000000000001' }),
          ticket({
            id: 'tktGIVEN0000000000000001',
            status: 'TRANSFERRED',
            purchaserHolding: 'TRANSFERRED_AWAY',
            supersededByLaterTicket: true,
          }),
        ],
      }),
    )

    await renderPage()

    expect(screen.getByRole('link', { name: 'Ticket 1 of 1' })).toBeInTheDocument()
    expect(
      screen.getByText(/The other ticket on this order was handed on to somebody else/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Transfers' }).getAttribute('href')).toBe(
      '/account/transfers',
    )
  })

  it('does not link the tickets of an order another account placed with this address', async () => {
    // The API returns an order to whoever signs in with its buyer's address;
    // the tickets were issued to the account that placed it.
    getMyOrder.mockResolvedValue(order({ userId: 'usr00000000000000000002' }))

    await renderPage()

    expect(screen.queryByRole('link', { name: /Ticket \d of \d/ })).toBeNull()
    expect(screen.getByText('Ticket 1 of 2')).toBeInTheDocument()
    expect(
      screen.getByText(/placed from another account with your email address/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/show its pass/)).toBeNull()
  })

  it('does not guess whose the tickets are when the session could not be read', async () => {
    readSession.mockResolvedValue(null)
    getMyOrder.mockResolvedValue(order())

    await renderPage()

    expect(screen.queryByRole('link', { name: /Ticket \d of \d/ })).toBeNull()
    expect(screen.getByText(/could not be checked just now/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My tickets' }).getAttribute('href')).toBe('/tickets')
  })

  it('does not link the tickets of an order placed without signing in', async () => {
    // Their owner is no account, and a ticket's page opens only for its holder.
    getMyOrder.mockResolvedValue(order({ userId: null }))

    await renderPage()

    expect(screen.queryByRole('link', { name: /Ticket \d of \d/ })).toBeNull()
    expect(screen.getByText('Ticket 1 of 2')).toBeInTheDocument()
    expect(screen.getByText(/placed without signing in/)).toBeInTheDocument()
  })
})

describe('what opening a ticket is for', () => {
  it('offers the pass and handing on for a ticket that is ready to use', async () => {
    getMyOrder.mockResolvedValue(order({ event: LATER }))

    await renderPage()

    expect(screen.getByText(/Open a ticket to show its pass at the door/)).toBeInTheDocument()
    expect(screen.getByText(/to hand it on\./)).toBeInTheDocument()
  })

  it('promises no pass and no hand-over on a refunded order', async () => {
    getMyOrder.mockResolvedValue(
      order({
        status: 'REFUNDED',
        event: LATER,
        tickets: [
          ticket({ id: 'tkt00000000000000000001', status: 'REFUNDED' }),
          ticket({ id: 'tkt00000000000000000002', status: 'REFUNDED' }),
        ],
      }),
    )

    const { container } = await renderPage()

    expect(screen.getByRole('link', { name: 'Ticket 1 of 2' })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/pass at the door|hand it on/)
    expect(screen.getByText('Open a ticket to see where it stands.')).toBeInTheDocument()
  })

  it.each([['CHECKED_IN'], ['REVOKED']])(
    'promises no pass and no hand-over when every ticket is %s',
    async (status) => {
      getMyOrder.mockResolvedValue(
        order({
          event: LATER,
          tickets: [
            ticket({ id: 'tkt00000000000000000001', status }),
            ticket({ id: 'tkt00000000000000000002', status }),
          ],
        }),
      )

      const { container } = await renderPage()

      expect(container.textContent).not.toMatch(/pass at the door|hand it on/)
    },
  )

  it('promises nothing at the door once the event is over', async () => {
    getMyOrder.mockResolvedValue(
      order({
        event: {
          ...LATER,
          startsAt: '2020-10-10T13:30:00.000Z',
          endsAt: '2020-10-10T18:00:00.000Z',
        },
      }),
    )

    const { container } = await renderPage()

    expect(container.textContent).not.toMatch(/pass at the door/)
  })
})

describe('tickets missing from the list, with no hand-over to explain them', () => {
  it('says a one-ticket order has none listed, in the singular', async () => {
    getMyOrder.mockResolvedValue(
      order({ items: [{ ...order().items[0], quantity: 1, subtotalCents: 50000 }], tickets: [] }),
    )

    await renderPage()

    expect(
      screen.getByText('This order is for 1 ticket, and none is listed on it.'),
    ).toBeInTheDocument()
  })

  it('says how many of several are listed', async () => {
    getMyOrder.mockResolvedValue(
      order({
        items: [{ ...order().items[0], quantity: 3, subtotalCents: 150000 }],
        tickets: [ticket()],
      }),
    )

    const { container } = await renderPage()

    expect(
      screen.getByText('This order is for 3 tickets, and only one is listed on it.'),
    ).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/handed on to somebody else/)
  })
})

describe('an order that is not on this account', () => {
  /** The sentence every such case must say. */
  const ANSWER = 'There is no order with that reference on this account.'

  it('reads the same for "not yours" (403) and "does not exist" (404)', async () => {
    getMyOrder.mockRejectedValueOnce(refused({ status: 404, code: 'NOT_FOUND' }))

    const missing = (await renderPage()).container.innerHTML

    cleanup()
    getMyOrder.mockRejectedValueOnce(refused({ status: 403, code: 'FORBIDDEN' }))

    const refusedPage = (await renderPage()).container.innerHTML

    expect(missing).toBe(refusedPage)
    expect(screen.getByText(ANSWER)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your orders' }).getAttribute('href')).toBe(
      '/account/orders',
    )
  })

  it('reads the same for a reference the API will not even parse', async () => {
    getMyOrder.mockRejectedValueOnce(refused({ status: 404, code: 'NOT_FOUND' }))

    const missing = (await renderPage()).container.innerHTML

    cleanup()
    getMyOrder.mockRejectedValueOnce(
      refused({ status: 400, code: 'VALIDATION_ERROR', message: 'Expected an alphanumeric…' }),
    )

    expect((await renderPage('not a reference!')).container.innerHTML).toBe(missing)
  })

  it('reads the same for an order the API returned to an organiser rather than its buyer', async () => {
    getMyOrder.mockRejectedValueOnce(refused({ status: 404, code: 'NOT_FOUND' }))

    const missing = (await renderPage()).container.innerHTML

    cleanup()

    const { buyerEmail: _withheld, ...asOrganiserSeesIt } = order()

    getMyOrder.mockResolvedValueOnce(asOrganiserSeesIt)

    const { container } = await renderPage()

    expect(container.innerHTML).toBe(missing)
    expect(container.innerHTML).not.toContain('Diwali Mela')
  })
})

describe('other refusals', () => {
  it('offers the step-up for a lapsed confirmation rather than "not found"', async () => {
    getMyOrder.mockRejectedValue(refused({ status: 403, code: 'STEP_UP_REQUIRED' }))

    const { container } = await renderPage()

    expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeInTheDocument()
    expect(container.textContent).not.toContain('There is no order with that reference')
  })

  it('draws a dead API as a failure, with nothing of the order', async () => {
    getMyOrder.mockRejectedValue(new TypeError('fetch failed'))

    const { container } = await renderPage()

    expect(container.textContent).toMatch(/This order could not be loaded\./)
    expect(container.textContent).not.toContain('There is no order with that reference')
  })
})

describe('the group pass', () => {
  /** The summary the API gives the buyer of an order with two admitting tickets. */
  const AVAILABLE = { admits: 2, available: true, unavailableReason: null }

  it('is offered to the buyer holding the tickets, under its own heading, and fetches nothing', async () => {
    const { apiFetch } = await import('../../../../lib/api-fetch.js')

    apiFetch.mockReset()
    getMyOrder.mockResolvedValue(order({ event: LATER, groupPass: AVAILABLE }))

    const { container } = await renderPage()
    const section = screen.getByRole('region', { name: 'Group pass (admits 2)' })

    expect(section.id).toBe('group-pass')
    expect(section.textContent).toContain(
      'One QR that lets in every ticket on this order that you still hold. Each ticket keeps its own pass as well.',
    )
    expect(screen.getByRole('button', { name: 'Show group pass' })).toBeInTheDocument()
    // Nothing is asked for, and nothing secret is drawn, until the buyer asks.
    expect(apiFetch).not.toHaveBeenCalled()
    expect(container.textContent).not.toMatch(/DEG-|G1\./)
    expect(section.textContent).not.toMatch(/offered to somebody/)
  })

  it('says a ticket on offer is let in until the offer is accepted', async () => {
    getMyOrder.mockResolvedValue(
      order({
        event: LATER,
        groupPass: AVAILABLE,
        tickets: [
          ticket({ id: 'tkt00000000000000000001' }),
          ticket({ id: 'tkt00000000000000000002', status: 'TRANSFER_PENDING' }),
        ],
      }),
    )

    await renderPage()

    expect(screen.getByRole('region', { name: 'Group pass (admits 2)' }).textContent).toMatch(
      /let in by the group pass until they accept\. If it is let in first, the offer can no longer be accepted\./,
    )
  })

  it.each([
    ['another account', { userId: 'usr00000000000000000009' }],
    ['a guest checkout', { userId: null }],
  ])('is not offered for an order placed from %s', async (_label, overrides) => {
    getMyOrder.mockResolvedValue(order({ event: LATER, groupPass: AVAILABLE, ...overrides }))

    await renderPage()

    expect(screen.queryByRole('region', { name: /Group pass/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show group pass' })).toBeNull()
  })

  it('is not offered when the account reading could not be checked', async () => {
    readSession.mockRejectedValue(new Error('down'))
    getMyOrder.mockResolvedValue(order({ event: LATER, groupPass: AVAILABLE }))

    await renderPage()

    expect(screen.queryByRole('button', { name: 'Show group pass' })).toBeNull()
  })

  it.each([
    ['one ticket', 'TOO_FEW_TICKETS'],
    ['an unpaid order', 'ORDER_NOT_PAID'],
    ['a cancelled event', 'EVENT_CANCELLED'],
  ])('says nothing about a group pass for %s', async (_label, reason) => {
    getMyOrder.mockResolvedValue(
      order({
        event: LATER,
        groupPass: { admits: 1, available: false, unavailableReason: reason },
      }),
    )

    await renderPage()

    expect(screen.queryByRole('region', { name: /Group pass/ })).toBeNull()
  })

  it('says to use each ticket’s own pass when there are more than fifty, without a pass', async () => {
    getMyOrder.mockResolvedValue(
      order({
        event: LATER,
        groupPass: { admits: 51, available: false, unavailableReason: 'TOO_MANY_TICKETS' },
      }),
    )

    await renderPage()

    const section = screen.getByRole('region', { name: 'Group pass' })

    expect(section.textContent).toMatch(/more than 50 tickets that admit/)
    expect(section.textContent).toMatch(/Use each ticket’s own pass at the door\./)
    expect(screen.queryByRole('button', { name: 'Show group pass' })).toBeNull()
  })

  it('is absent from an order the API gave no summary for', async () => {
    getMyOrder.mockResolvedValue(order({ event: LATER }))

    await renderPage()

    expect(screen.queryByRole('region', { name: /Group pass/ })).toBeNull()
  })
})

describe('what a line bought, a discount, and an online event’s link', () => {
  it('names each line’s ticket type and the night it is for', async () => {
    getMyOrder.mockResolvedValue(
      order({
        items: [
          {
            id: 'itm00000000000000000001',
            orderId: 'ord00000000000000000001',
            ticketTypeId: 'tt000000000000000000001',
            ticketTypeName: 'Garden Seating',
            session: {
              id: 'snnighttwoxxx',
              label: 'Night 2',
              startsAt: '2030-10-11T13:30:00.000Z',
              endsAt: '2030-10-11T18:00:00.000Z',
              doorsOpenAt: null,
              timezone: 'Asia/Kolkata',
            },
            quantity: 2,
            unitPriceCents: 50000,
            subtotalCents: 100000,
          },
        ],
      }),
    )

    await renderPage()

    expect(screen.getByText('Garden Seating')).toBeInTheDocument()
    expect(screen.getByText('Night 2 · Fri, Oct 11 · 7:00 PM')).toBeInTheDocument()
  })

  it('shows the discount the order was given, and none when it was given none', async () => {
    getMyOrder.mockResolvedValue(order({ discountCents: 10000, totalCents: 95000 }))

    await renderPage()

    expect(screen.getByText('Discount')).toBeInTheDocument()
    expect(screen.getByText('−₹100.00')).toBeInTheDocument()

    cleanup()
    getMyOrder.mockResolvedValue(order())

    await renderPage()

    expect(screen.queryByText('Discount')).toBeNull()
  })

  it('offers the joining link the server gave, named by its host, with no referrer', async () => {
    getMyOrder.mockResolvedValue(
      order({
        event: { ...LATER, isOnline: true, venueName: null, city: null },
        onlineJoinUrl: 'https://stream.example.com/r/9',
      }),
    )

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Join online' })).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Join online at stream.example.com' })

    expect(link).toHaveAttribute('href', 'https://stream.example.com/r/9')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('referrerPolicy', 'no-referrer')
  })

  it('offers no joining link when the server gave none', async () => {
    getMyOrder.mockResolvedValue(
      order({ event: { ...LATER, isOnline: true }, onlineJoinUrl: null }),
    )

    await renderPage()

    expect(screen.queryByRole('heading', { name: 'Join online' })).toBeNull()
  })
})

describe('what changed since the order was placed', () => {
  it('lists each change, who made it and why, in the event’s zone', async () => {
    getMyOrder.mockResolvedValue(
      order({
        eventChanges: [
          {
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
        ],
      }),
    )
    await renderPage()

    const changes = screen.getByRole('region', { name: 'Changes since you bought' })

    expect(within(changes).getByText('The event changed')).toBeInTheDocument()
    expect(changes).toHaveTextContent(/The start time: .*Oct 10, 2026.* → .*Oct 17, 2026/)
    expect(changes).toHaveTextContent('Reason given: The garden was booked twice.')
    expect(changes).toHaveTextContent('Changed by the Desi-Event team.')
    expect(changes).toHaveTextContent('These notices are not emailed.')
  })

  it('names a cancelled night from the order’s own lines, as `orders.get` really answers (no event nights)', async () => {
    const night2 = {
      id: 'csession000000000000000002',
      label: 'Night 2',
      startsAt: '2030-10-11T13:30:00.000Z',
      endsAt: '2030-10-11T18:00:00.000Z',
      doorsOpenAt: null,
      timezone: 'Asia/Kolkata',
    }

    getMyOrder.mockResolvedValue(
      order({
        items: [
          {
            id: 'itm00000000000000000001',
            orderId: 'ord00000000000000000001',
            ticketTypeId: 'tt000000000000000000001',
            ticketTypeName: 'Night 1 entry',
            session: { ...night2, id: 'csession000000000000000001', label: 'Night 1' },
            quantity: 1,
            unitPriceCents: 50000,
            subtotalCents: 50000,
          },
          {
            id: 'itm00000000000000000002',
            orderId: 'ord00000000000000000001',
            ticketTypeId: 'tt000000000000000000002',
            ticketTypeName: 'Night 2 entry',
            session: night2,
            quantity: 1,
            unitPriceCents: 50000,
            subtotalCents: 50000,
          },
        ],
        eventChanges: [
          {
            id: 'cnotice000000000000000002',
            kind: 'SESSION_CANCELLED',
            at: '2026-10-05T10:00:00.000Z',
            changed: ['a night'],
            before: { startsAt: night2.startsAt },
            after: null,
            reason: 'The singer is unwell.',
            sessionId: night2.id,
            by: 'ORGANIZER',
          },
        ],
      }),
    )
    await renderPage()

    const changes = screen.getByRole('region', { name: 'Changes since you bought' })

    expect(changes).toHaveTextContent('A night was cancelled')
    expect(changes).toHaveTextContent('The night of Night 2 · Fri, Oct 11 · 7:00 PM.')
  })

  it('names a cancelled night no line is for (a ticket good for every night) by when it was to start', async () => {
    getMyOrder.mockResolvedValue(
      order({
        eventChanges: [
          {
            id: 'cnotice000000000000000002',
            kind: 'SESSION_CANCELLED',
            at: '2026-10-05T10:00:00.000Z',
            changed: ['a night'],
            before: { startsAt: '2030-10-11T13:30:00.000Z' },
            after: null,
            reason: 'The singer is unwell.',
            sessionId: 'csession000000000000000002',
            by: 'ORGANIZER',
          },
        ],
      }),
    )
    await renderPage()

    expect(screen.getByRole('region', { name: 'Changes since you bought' })).toHaveTextContent(
      'The night of Fri, Oct 11, 2030, 7:00 PM.',
    )
  })

  it('says who took a deleted event’s page down, and lists nothing when nothing changed', async () => {
    getMyOrder.mockResolvedValue(
      order({
        event: { ...order().event, status: 'DELETED' },
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
            by: 'ORGANIZER',
          },
        ],
      }),
    )
    const { unmount } = await renderPage()

    expect(
      screen.getByText(/^The organiser removed this event’s page\. It is no longer on the site\./),
    ).toBeInTheDocument()
    unmount()

    getMyOrder.mockResolvedValue(order())
    await renderPage()

    expect(
      screen.queryByRole('region', { name: 'Changes since you bought' }),
    ).not.toBeInTheDocument()
  })
})

describe('a booking paid at the venue (SPEC3 §12.7, SPEC3-XI §12.7)', () => {
  /**
   * A pay-at-the-venue order of two $40.00 tickets with a $3.31 fee each.
   *
   * @param {object} [venue] Fields of `venuePayment` to change.
   * @param {object} [overrides] Fields of the order to change.
   * @returns {object} The order.
   */
  function atVenue(venue = {}, overrides = {}) {
    return order({
      currency: 'USD',
      paymentMethod: 'AT_VENUE',
      subtotalCents: 8_000,
      feesCents: 662,
      feeGrossCents: 662,
      feeWaivedCents: 0,
      referralApplied: false,
      taxCents: 0,
      totalCents: 662,
      fee: { percentageBps: 450, flatCentsPerTicket: 151 },
      items: [
        {
          id: 'itm00000000000000000001',
          orderId: 'ord00000000000000000001',
          ticketTypeId: 'tt000000000000000000001',
          quantity: 2,
          unitPriceCents: 4_000,
          subtotalCents: 8_000,
        },
      ],
      tickets: [
        ticket({
          id: 'tkt00000000000000000001',
          venuePayment: {
            dueCents: 4_000,
            paid: false,
            currency: 'USD',
            cancelled: null,
            paidAtDoorByYou: false,
          },
        }),
        ticket({
          id: 'tkt00000000000000000002',
          code: 'DET-SECRET8R3',
          venuePayment: {
            dueCents: 4_000,
            paid: false,
            currency: 'USD',
            cancelled: null,
            paidAtDoorByYou: false,
          },
        }),
      ],
      venuePayment: {
        dueCents: 8_000,
        paidCents: 0,
        unpaidTickets: 2,
        unpaidCents: 8_000,
        paidTickets: 0,
        paidByOthersTickets: 0,
        paidByOthersCents: 0,
        passedOnUnpaidTickets: 0,
        passedOnUnpaidCents: 0,
        cancelledTickets: 0,
        cancelledCents: 0,
        feeKeptCents: 0,
        state: 'TO_PAY',
        ...venue,
      },
      venueCancellations: [],
      ...overrides,
    })
  }

  it('reads as booked with what is owed at the door, never as paid', async () => {
    getMyOrder.mockResolvedValue(atVenue())

    const { container } = await renderPage()

    expect(screen.getByText('Booked — pay $80.00 at the door')).toBeInTheDocument()
    expect(screen.getByText('Booking fee paid')).toBeInTheDocument()
    expect(screen.getByText('Paid online (simulated)')).toBeInTheDocument()
    expect(screen.getByText('To pay at the door')).toBeInTheDocument()
    expect(screen.queryByText('Total')).toBeNull()
    expect(screen.getByText('No tax is added to tickets paid at the venue.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Until a ticket is paid for at the door, the organiser or Desi-Event can cancel it; the booking fee is not refunded if they do.',
      ),
    ).toBeInTheDocument()
    expect(container.textContent).not.toContain('Paid — simulated')
  })

  it('names the place’s tax on a booking paid at the venue, and says none is added to its tickets', async () => {
    getMyOrder.mockResolvedValue(
      atVenue(
        {},
        {
          event: {
            ...order().event,
            timezone: 'America/Chicago',
            city: 'Houston',
            country: 'US',
            region: 'TX',
          },
        },
      ),
    )

    await renderPage()

    expect(screen.getByText('Sales tax')).toBeInTheDocument()
    expect(screen.queryByText('Tax')).toBeNull()
    expect(
      screen.getByText('No sales tax is added to tickets paid at the venue.'),
    ).toBeInTheDocument()
  })

  it('shows the waiver and says nothing was paid online when a referral code removed the fee', async () => {
    getMyOrder.mockResolvedValue(
      atVenue({}, { feesCents: 0, feeWaivedCents: 662, referralApplied: true, totalCents: 0 }),
    )

    await renderPage()

    expect(screen.getByText('Booking fee waived (referral code)')).toBeInTheDocument()
    expect(screen.getByText('−$6.62')).toBeInTheDocument()
    expect(screen.getByText('Booking fee waived with a referral code.')).toBeInTheDocument()
    expect(screen.getByText('Nothing was paid online for this order.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Until a ticket is paid for at the door, the organiser or Desi-Event can cancel it.',
      ),
    ).toBeInTheDocument()
  })

  it('counts what the buyer paid at the door apart from what people they passed tickets to paid', async () => {
    getMyOrder.mockResolvedValue(
      atVenue({
        state: 'PAID',
        unpaidTickets: 0,
        unpaidCents: 0,
        paidTickets: 1,
        paidCents: 4_000,
        paidByOthersTickets: 1,
        paidByOthersCents: 4_000,
      }),
    )

    await renderPage()

    // The status chip and the sum's term both read it.
    expect(screen.getAllByText('Paid at the door')).toHaveLength(2)
    expect(screen.getByText('$40.00 of $80.00')).toBeInTheDocument()
    expect(screen.getByText('Paid at the door by people you passed tickets to')).toBeInTheDocument()
  })

  it('lists a ticket passed on that still owes, as its new holder’s to pay', async () => {
    const base = atVenue({
      state: 'PASSED_ON',
      unpaidTickets: 1,
      unpaidCents: 4_000,
      passedOnUnpaidTickets: 1,
      passedOnUnpaidCents: 4_000,
    })

    getMyOrder.mockResolvedValue({
      ...base,
      tickets: [
        base.tickets[0],
        {
          ...base.tickets[1],
          supersededByLaterTicket: true,
          purchaserHolding: 'TRANSFERRED_AWAY',
          // Where the ticket stands with its new holder: the API's to say.
          passedOn: { state: 'OWES', dueCents: 4_000 },
        },
      ],
    })

    await renderPage()

    expect(
      screen.getByText('Passed on — its new holder pays $40.00 at the door'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Passed on to other people: 1 ticket, \$40\.00 to be paid at the door by whoever holds it\./u,
      ),
    ).toBeInTheDocument()
  })

  it('stops saying the new holder pays once they paid at the door', async () => {
    // The buyer's own row for the ticket keeps reading unpaid: the payment
    // lands on the new holder's ticket. The order counts it as paid by others.
    const base = atVenue({
      state: 'PAID',
      unpaidTickets: 1,
      unpaidCents: 4_000,
      paidByOthersTickets: 1,
      paidByOthersCents: 4_000,
      passedOnUnpaidTickets: 0,
      passedOnUnpaidCents: 0,
    })

    getMyOrder.mockResolvedValue({
      ...base,
      tickets: [
        base.tickets[0],
        {
          ...base.tickets[1],
          supersededByLaterTicket: true,
          purchaserHolding: 'TRANSFERRED_AWAY',
          passedOn: { state: 'PAID', dueCents: 0 },
        },
      ],
    })

    await renderPage()

    expect(screen.getByText('Paid at the door by people you passed tickets to')).toBeInTheDocument()
    expect(screen.queryByText(/its new holder pays/u)).toBeNull()
    expect(
      screen.getByText(/The other ticket on this order was handed on to somebody else/u),
    ).toBeInTheDocument()
  })

  it('stops saying the new holder pays once the ticket passed on was cancelled unpaid', async () => {
    const base = atVenue(
      {
        state: 'TO_PAY',
        unpaidTickets: 1,
        unpaidCents: 4_000,
        cancelledTickets: 1,
        cancelledCents: 4_000,
        feeKeptCents: 331,
        passedOnUnpaidTickets: 0,
        passedOnUnpaidCents: 0,
      },
      {
        venueCancellations: [
          {
            at: '2026-10-08T15:00:00.000Z',
            by: 'ORGANISER',
            ticketCount: 1,
            basisCents: 4_000,
            feeKeptCents: 331,
            reason: 'Not paid before the doors opened.',
          },
        ],
      },
    )

    getMyOrder.mockResolvedValue({
      ...base,
      tickets: [
        base.tickets[0],
        {
          ...base.tickets[1],
          supersededByLaterTicket: true,
          purchaserHolding: 'TRANSFERRED_AWAY',
          passedOn: { state: 'CANCELLED', dueCents: 0 },
        },
      ],
    })

    await renderPage()

    expect(screen.getByText(/You no longer owe \$40\.00 for it\./u)).toBeInTheDocument()
    expect(screen.queryByText(/its new holder pays/u)).toBeNull()
  })

  it('names the exact amount still owed on each ticket passed on, when another passed on was paid since', async () => {
    // Two tickets of different prices passed on; the dearer one was since paid
    // at the door. The row still owing says its own amount, not a guess.
    const base = atVenue(
      {
        state: 'PASSED_ON',
        unpaidTickets: 0,
        unpaidCents: 0,
        paidByOthersTickets: 1,
        paidByOthersCents: 4_000,
        passedOnUnpaidTickets: 1,
        passedOnUnpaidCents: 2_500,
      },
      { subtotalCents: 6_500 },
    )

    getMyOrder.mockResolvedValue({
      ...base,
      tickets: [
        {
          ...base.tickets[0],
          supersededByLaterTicket: true,
          purchaserHolding: 'TRANSFERRED_AWAY',
          passedOn: { state: 'PAID', dueCents: 0 },
        },
        {
          ...base.tickets[1],
          venuePayment: { ...base.tickets[1].venuePayment, dueCents: 2_500 },
          supersededByLaterTicket: true,
          purchaserHolding: 'TRANSFERRED_AWAY',
          passedOn: { state: 'OWES', dueCents: 2_500 },
        },
      ],
    })

    await renderPage()

    expect(
      screen.getByText('Passed on — its new holder pays $25.00 at the door'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/its new holder pays \$40\.00/u)).toBeNull()
    // One row still owes; the one paid at the door is not listed as owing.
    expect(screen.getAllByText(/^Passed on — its new holder pays/u)).toHaveLength(1)
  })

  it('draws a block for each cancellation of unpaid tickets, with or without a kept fee', async () => {
    getMyOrder.mockResolvedValue(
      atVenue(
        { state: 'CANCELLED', cancelledTickets: 2, cancelledCents: 8_000, feeKeptCents: 662 },
        {
          venueCancellations: [
            {
              at: '2026-10-08T15:00:00.000Z',
              by: 'ORGANISER',
              ticketCount: 2,
              basisCents: 8_000,
              feeKeptCents: 662,
              reason: 'Not paid by the deadline we set.',
            },
          ],
        },
      ),
    )

    await renderPage()

    const block = screen.getByRole('heading', { name: 'Unpaid tickets cancelled' }).parentElement

    expect(block).toHaveTextContent(
      'The organiser cancelled 2 tickets on Thu, Oct 8, 2026 because they were not paid for. You no longer owe $80.00 for them.',
    )
    expect(block).toHaveTextContent(
      'The booking fee paid for them online, $6.62, is kept by Desi-Event and is not refunded.',
    )
    expect(block).toHaveTextContent('Reason given: “Not paid by the deadline we set.”')
    expect(screen.getByText('Cancelled — not paid at the door')).toBeInTheDocument()
  })

  it('reads what the order paid online, so a fee refunded earlier is never called nothing paid', async () => {
    getMyOrder.mockResolvedValue(
      atVenue(
        { state: 'CANCELLED', cancelledTickets: 2, cancelledCents: 8_000, feeKeptCents: 0 },
        {
          venueCancellations: [
            {
              at: '2026-10-08T15:00:00.000Z',
              by: 'ORGANISER',
              ticketCount: 2,
              basisCents: 8_000,
              passedOnTickets: 0,
              passedOnBasisCents: 0,
              feeKeptCents: 0,
              reason: 'Not paid by the deadline we set.',
            },
          ],
        },
      ),
    )

    await renderPage()

    const block = screen.getByRole('heading', { name: 'Unpaid tickets cancelled' }).parentElement

    expect(block).toHaveTextContent('None of the booking fee you paid online is kept for them.')
    expect(block).not.toHaveTextContent(/Nothing was paid online/u)
  })

  it('writes a cancellation by the Desi-Event team of one ticket with nothing paid online', () => {
    expect(
      venueCancellationSentences(
        {
          at: '2026-10-08T15:00:00.000Z',
          by: 'DESI_EVENT',
          ticketCount: 1,
          basisCents: 4_000,
          feeKeptCents: 0,
          reason: 'Duplicate booking.',
        },
        'USD',
        'UTC',
      ),
    ).toEqual([
      'The Desi-Event team cancelled 1 ticket on Thu, Oct 8, 2026 because it was not paid for. You no longer owe $40.00 for it.',
      'Nothing was paid online for it.',
      'Reason given: “Duplicate booking.”',
    ])
  })

  it('never says nothing was paid online for a booking that paid its fee online and kept none of it', () => {
    const sentences = venueCancellationSentences(
      {
        at: '2026-10-08T15:00:00.000Z',
        by: 'ORGANISER',
        ticketCount: 2,
        basisCents: 8_000,
        passedOnTickets: 0,
        passedOnBasisCents: 0,
        feeKeptCents: 0,
        reason: 'Not paid by the deadline we set.',
      },
      'USD',
      'UTC',
      { paidOnlineCents: 670 },
    )

    expect(sentences).toContain('None of the booking fee you paid online is kept for them.')
    expect(sentences.join(' ')).not.toContain('Nothing was paid online')
  })

  it('tells the buyer only what they no longer owe, apart from the tickets they passed on', () => {
    expect(
      venueCancellationSentences(
        {
          at: '2026-10-08T15:00:00.000Z',
          by: 'ORGANISER',
          ticketCount: 2,
          basisCents: 8_000,
          passedOnTickets: 1,
          passedOnBasisCents: 4_000,
          feeKeptCents: 662,
          reason: 'Not paid by the deadline we set.',
        },
        'USD',
        'UTC',
        { paidOnlineCents: 662 },
      ),
    ).toEqual([
      'The organiser cancelled 1 ticket on Thu, Oct 8, 2026 because it was not paid for. You no longer owe $40.00 for it.',
      '1 ticket you passed on to someone else was cancelled too.',
      'The booking fee paid for them online, $6.62, is kept by Desi-Event and is not refunded.',
      'Reason given: “Not paid by the deadline we set.”',
    ])
  })

  it('names tickets passed on, and nothing owed by the buyer, when only those were cancelled', () => {
    const sentences = venueCancellationSentences(
      {
        at: '2026-10-08T15:00:00.000Z',
        by: 'DESI_EVENT',
        ticketCount: 2,
        basisCents: 8_000,
        passedOnTickets: 2,
        passedOnBasisCents: 8_000,
        feeKeptCents: 0,
        reason: 'Duplicate booking.',
      },
      'USD',
      'UTC',
      { paidOnlineCents: 0 },
    )

    expect(sentences[0]).toBe(
      'The Desi-Event team cancelled 2 tickets you passed on to other people on Thu, Oct 8, 2026 because they were not paid for.',
    )
    expect(sentences.join(' ')).not.toContain('You no longer owe')
    expect(sentences).toContain('Nothing was paid online for them.')
  })

  it('says how a refunded booking ended, and where door money went', async () => {
    expect(
      venueEndingSentences({
        status: 'REFUNDED',
        currency: 'USD',
        totalCents: 662,
        venuePayment: { feeKeptCents: 331, paidCents: 4_000, paidByOthersCents: 4_000 },
      }),
    ).toEqual([
      'The rest of the booking fee you paid online was refunded (simulated); $3.31 of it was kept when unpaid tickets were cancelled.',
      'The $40.00 you paid at the door is with the organiser, not with Desi-Event. Ask the organiser to return it.',
      '$40.00 was paid at the door by people you passed tickets to; it is with the organiser.',
    ])
    expect(
      venueEndingSentences({
        status: 'REFUNDED',
        currency: 'USD',
        totalCents: 662,
        venuePayment: { feeKeptCents: 0, paidCents: 0, paidByOthersCents: 0 },
      }),
    ).toEqual(['The booking fee you paid online was refunded (simulated).'])

    getMyOrder.mockResolvedValue(atVenue({ state: 'NONE' }, { status: 'REFUNDED' }))
    await renderPage()

    expect(screen.getByText('Booking fee refunded — simulated')).toBeInTheDocument()
    expect(screen.queryByText(/This order was refunded in full/u)).toBeNull()
  })

  it('reads a booking whose event was cancelled as ended with nothing to pay, never as owing', async () => {
    getMyOrder.mockResolvedValue(
      atVenue(
        { state: 'ENDED', unpaidTickets: 0, unpaidCents: 0 },
        { totalCents: 0, feesCents: 0, event: { ...LATER, status: 'CANCELLED' } },
      ),
    )

    await renderPage()

    expect(screen.getByText('Cancelled — nothing to pay')).toBeInTheDocument()
    expect(
      screen.getByText(
        'This event was cancelled, so nothing is owed at the door for these tickets.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('To pay at the door')).toBeNull()
    expect(screen.queryByText(/Booked — pay/u)).toBeNull()
    expect(screen.queryByText('Paid — simulated')).toBeNull()
  })

  it('says where door money went on a booking that ended', () => {
    expect(
      venueEndedSentences({
        status: 'PAID',
        currency: 'USD',
        event: { status: 'ON_SALE' },
        venuePayment: { state: 'ENDED', paidCents: 4_000, paidByOthersCents: 0 },
      }),
    ).toEqual([
      'None of these tickets can be used any more, so nothing is owed at the door for them.',
      'The $40.00 you paid at the door is with the organiser, not with Desi-Event. Ask the organiser to return it.',
    ])
  })

  it('says a legacy order’s fee terms were not recorded', async () => {
    getMyOrder.mockResolvedValue(order({ fee: null }))

    await renderPage()

    expect(
      screen.getByText(
        'Booking fee terms were not recorded for orders placed before 9 October 2026.',
      ),
    ).toBeInTheDocument()
  })
})
