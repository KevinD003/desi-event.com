/**
 * The purchase history must say what each order is, in words, and must never
 * pass a failure off as an empty history.
 *
 * The properties worth pinning:
 *
 *   - **Status is a word.** Each of the five order states reads as a sentence
 *     a person can repeat, and a paid one says it was simulated. The colour
 *     and the glyph beside it repeat the word; they are pinned too, so a
 *     wrong colour or a missing glyph goes red.
 *   - **Simulated is said up front.** Once, in a sentence, before the list.
 *   - **Paging is honest.** Previous and Next are real links carrying `page=`
 *     and appear only when there is somewhere to go; the page asked for is the
 *     page requested of the API.
 *   - **A failure is a failure.** A refused or unreachable read draws the
 *     refusal and no list — not "You have no orders yet".
 *
 * @module app/account/orders/page.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/account-api.js', () => ({ getMyOrders: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/account/orders',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { getMyOrders } = await import('../../../lib/account-api.js')
const { default: OrdersPage } = await import('./page.jsx')

/**
 * An order as `GET /v1/orders` returns it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The order.
 */
function order(overrides = {}) {
  return {
    id: 'ord00000000000000000001',
    reference: 'DE-8F3K2Q',
    status: 'PAID',
    currency: 'INR',
    subtotalCents: 100000,
    discountCents: 0,
    feesCents: 5000,
    taxCents: 0,
    totalCents: 105000,
    createdAt: '2026-09-01T10:00:00.000Z',
    paidAt: '2026-09-01T10:01:00.000Z',
    buyerName: 'Asha',
    buyerEmail: 'asha@example.com',
    items: [
      {
        id: 'itm00000000000000000001',
        ticketTypeId: 'tt000000000000000000001',
        quantity: 2,
        unitPriceCents: 50000,
        subtotalCents: 100000,
      },
    ],
    tickets: [],
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
 * Page counters.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The counters.
 */
function counters(overrides = {}) {
  return {
    page: 1,
    perPage: 20,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
    ...overrides,
  }
}

/**
 * Render the page for a query.
 *
 * @param {object} [query] The URL's query.
 * @returns {Promise<object>} The render result.
 */
async function renderPage(query = {}) {
  return render(await OrdersPage({ searchParams: Promise.resolve(query) }))
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

beforeEach(() => {
  getMyOrders.mockReset()
})

afterEach(cleanup)

describe('each order', () => {
  it.each([
    ['PAID', 'Paid — simulated', 'success'],
    ['PENDING', 'Waiting for payment', 'pending'],
    ['CANCELLED', 'Cancelled', 'neutral'],
    ['REFUNDED', 'Refunded — simulated', 'info'],
    ['EXPIRED', 'Expired', 'neutral'],
  ])('reads %s as “%s”, in words, a %s colour and its glyph', async (status, words, tone) => {
    getMyOrders.mockResolvedValue({ orders: [order({ status })], pagination: counters() })

    await renderPage()

    const card = screen.getByRole('listitem')
    const chip = within(card).getByText(words)

    expect(chip.getAttribute('data-tone')).toBe(tone)
    expect(chip.className).toContain(`text-status-${tone}`)

    // The glyph repeats the colour for somebody who cannot tell colours
    // apart, and is hidden from a screen reader, which hears the word.
    const glyph = chip.querySelector('svg[data-slot="status-icon"]')

    expect(glyph).not.toBeNull()
    expect(glyph.getAttribute('data-tone')).toBe(tone)
    expect(glyph.getAttribute('aria-hidden')).toBe('true')
  })

  it('shows an unknown status by its own name', async () => {
    getMyOrders.mockResolvedValue({
      orders: [order({ status: 'ON_HOLD' })],
      pagination: counters(),
    })

    await renderPage()

    expect(screen.getByText('ON_HOLD')).toBeInTheDocument()
  })

  it('links the event title to the order, and shows the reference, count and total', async () => {
    getMyOrders.mockResolvedValue({ orders: [order()], pagination: counters() })

    await renderPage()

    expect(screen.getByRole('link', { name: 'Diwali Mela' }).getAttribute('href')).toBe(
      '/account/orders/DE-8F3K2Q',
    )

    const card = screen.getByRole('listitem')

    expect(within(card).getByText('DE-8F3K2Q')).toBeInTheDocument()
    expect(within(card).getByText('2')).toBeInTheDocument()
    expect(within(card).getByText('₹1,050.00')).toBeInTheDocument()
  })

  it('gives the event’s time in the event’s own timezone, named', async () => {
    getMyOrders.mockResolvedValue({ orders: [order()], pagination: counters() })

    await renderPage()

    // 13:30 UTC is 7:00 PM in Mumbai, written the site's US way in Mumbai's zone.
    expect(
      screen.getByText(/Oct 10, 2026 · 7:00\sPM – 11:30\sPM (IST|GMT\+5:30)/),
    ).toBeInTheDocument()
  })

  it('titles an order whose event is gone by its reference', async () => {
    getMyOrders.mockResolvedValue({ orders: [order({ event: null })], pagination: counters() })

    await renderPage()

    expect(screen.getByRole('link', { name: 'Order DE-8F3K2Q' })).toBeInTheDocument()
  })
})

describe('the simulated-payment notice', () => {
  it('says once, near the top, that payments are simulated and no money moved', async () => {
    getMyOrders.mockResolvedValue({ orders: [order()], pagination: counters() })

    const { container } = await renderPage()

    expect(screen.getByText('Payments on this site are simulated.')).toBeInTheDocument()
    expect(container.textContent).toMatch(/no money moved/)
    expect(container.textContent.match(/Payments on this site are simulated/g)).toHaveLength(1)
  })

  it('never calls a payment successful', async () => {
    getMyOrders.mockResolvedValue({ orders: [order()], pagination: counters() })

    const { container } = await renderPage()

    expect(container.textContent).not.toMatch(/payment successful|successfully paid/i)
  })
})

describe('paging', () => {
  it('asks the API for the page in the URL', async () => {
    getMyOrders.mockResolvedValue({
      orders: [order()],
      pagination: counters({ page: 3, total: 41, totalPages: 3, hasPreviousPage: true }),
    })

    await renderPage({ page: '3' })

    expect(getMyOrders).toHaveBeenCalledWith({ page: 3, perPage: 20 })
  })

  it('offers no page links when everything fits on one page', async () => {
    getMyOrders.mockResolvedValue({ orders: [order()], pagination: counters() })

    await renderPage()

    expect(screen.queryByRole('link', { name: 'Next' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Previous' })).toBeNull()
  })

  it('offers Next as a real link when there are more pages', async () => {
    getMyOrders.mockResolvedValue({
      orders: [order()],
      pagination: counters({ total: 25, totalPages: 2, hasNextPage: true }),
    })

    await renderPage()

    expect(screen.getByRole('link', { name: 'Next' }).getAttribute('href')).toBe(
      '/account/orders?page=2',
    )
    expect(screen.queryByRole('link', { name: 'Previous' })).toBeNull()
  })

  it('offers Previous from a later page', async () => {
    getMyOrders.mockResolvedValue({
      orders: [order()],
      pagination: counters({ page: 2, total: 25, totalPages: 2, hasPreviousPage: true }),
    })

    await renderPage({ page: '2' })

    expect(screen.getByRole('link', { name: 'Previous' }).getAttribute('href')).toBe(
      '/account/orders',
    )
    expect(screen.queryByRole('link', { name: 'Next' })).toBeNull()
    expect(screen.getByText('Orders 21 to 21 of 25, newest first.')).toBeInTheDocument()
  })

  it('does not call a page past the end an empty history', async () => {
    getMyOrders.mockResolvedValue({
      orders: [],
      pagination: counters({ page: 9, total: 3, hasPreviousPage: true }),
    })

    await renderPage({ page: '9' })

    expect(screen.queryByText('You have no orders yet')).toBeNull()
    expect(screen.getByText('There are no orders on page 9')).toBeInTheDocument()
  })
})

describe('an empty history', () => {
  it('says there are no orders and points to the events', async () => {
    getMyOrders.mockResolvedValue({ orders: [], pagination: counters({ total: 0, totalPages: 0 }) })

    await renderPage()

    expect(screen.getByText('You have no orders yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Find an event' }).getAttribute('href')).toBe('/events')
  })
})

describe('a failed read', () => {
  it('draws the failure and no list when the API is unreachable', async () => {
    getMyOrders.mockRejectedValue(new TypeError('fetch failed'))

    const { container } = await renderPage()

    expect(container.textContent).toMatch(/Your orders could not be loaded\./)
    expect(screen.queryByText('You have no orders yet')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('does not repeat the API’s own message', async () => {
    getMyOrders.mockRejectedValue(
      refused({ status: 500, message: 'relation "orders_internal" does not exist' }),
    )

    const { container } = await renderPage()

    expect(container.textContent).not.toContain('orders_internal')
  })

  it('sends a lost session to sign in, and back here', async () => {
    getMyOrders.mockRejectedValue(refused({ status: 401, code: 'UNAUTHORIZED' }))

    await renderPage()

    expect(screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')).toBe(
      '/sign-in?next=%2Faccount%2Forders',
    )
    expect(screen.queryByText('You have no orders yet')).toBeNull()
  })

  it('sends an account without a second factor to set one up', async () => {
    getMyOrders.mockRejectedValue(refused({ status: 403, code: 'MFA_ENROLMENT_REQUIRED' }))

    await renderPage()

    expect(screen.getByRole('link', { name: 'Set up two-step sign-in' })).toBeInTheDocument()
  })
})
