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

import { cleanup, render, screen } from '@testing-library/react'
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
const { default: OrderPage } = await import('./page.jsx')

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
