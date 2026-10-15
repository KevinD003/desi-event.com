/**
 * The promo codes screen: offered only where the session holds `promo:manage`,
 * every status a word beside a shape, windows in a stated zone, and an event
 * filter that carries ids and never a code.
 *
 * @module app/organizer/promo-codes/page.test
 */

import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/organizer/promo-codes',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const readSession = vi.fn()

vi.mock('../../../lib/session.js', async () => {
  const actual = await vi.importActual('../../../lib/session.js')

  return { ...actual, readSession: (...args) => readSession(...args) }
})
vi.mock('../../../lib/organizer-api.js', async () => {
  const actual = await vi.importActual('../../../lib/organizer-api.js')

  return { ...actual, listPromoCodes: vi.fn() }
})
vi.mock('../../../lib/workspace-api.js', async () => {
  const actual = await vi.importActual('../../../lib/workspace-api.js')

  return { ...actual, listOrganizationEvents: vi.fn() }
})

const { listPromoCodes } = await import('../../../lib/organizer-api.js')
const { listOrganizationEvents } = await import('../../../lib/workspace-api.js')
const { default: PromoCodesPage, metadata } = await import('./page.jsx')

const ORG = 'orgmirrorwork1'
const OTHER = 'orglakeshore01'

/**
 * A session with the given memberships.
 *
 * @param {object[]} memberships The memberships.
 * @returns {object} The session.
 */
function session(memberships) {
  return { user: { displayName: 'Manager' }, capabilities: [], memberships }
}

/**
 * A membership.
 *
 * @param {string} organizationId The organisation.
 * @param {string[]} capabilities What it holds.
 * @param {string} [name] The organisation's name.
 * @returns {object} The membership.
 */
function membership(organizationId, capabilities, name = 'Mirrorwork Events') {
  return { organizationId, organizationName: name, role: 'EVENT_MANAGER', capabilities }
}

/**
 * A code as the list returns it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The code.
 */
function code(overrides = {}) {
  return {
    id: 'prsave10xxxxx',
    organizationId: ORG,
    eventId: null,
    code: 'SAVE10',
    type: 'PERCENTAGE',
    value: 1000,
    currency: null,
    maxRedemptions: 50,
    redemptionCount: 3,
    startsAt: null,
    endsAt: null,
    active: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    status: 'ACTIVE',
    event: null,
    ordersCount: 3,
    ...overrides,
  }
}

const EVENTS = [
  {
    id: 'evninenightsx',
    title: 'Nine Nights',
    timezone: 'America/Chicago',
    currency: 'USD',
    startsAt: '2026-10-10T00:30:00.000Z',
  },
]

/**
 * Render the page.
 *
 * @param {Record<string, string>} [query] The query string.
 * @returns {Promise<object>} The render result.
 */
async function renderPage(query = {}) {
  return render(await PromoCodesPage({ searchParams: Promise.resolve(query) }))
}

beforeEach(() => {
  readSession.mockReset()
  listPromoCodes.mockReset()
  listOrganizationEvents.mockReset()
  listOrganizationEvents.mockResolvedValue({ events: EVENTS, pagination: null })
})

describe('who is offered the page', () => {
  it('is kept out of the index', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it('refuses a member without promo:manage anywhere, and asks for nothing', async () => {
    readSession.mockResolvedValue(session([membership(ORG, ['event:view', 'report:view'])]))

    await renderPage()

    expect(listPromoCodes).not.toHaveBeenCalled()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to the workspace' })).toBeInTheDocument()
  })

  it('reads the codes of an organisation where the session holds promo:manage, never another', async () => {
    readSession.mockResolvedValue(
      session([
        membership(OTHER, ['event:view'], 'Lakeshore Raas'),
        membership(ORG, ['promo:manage']),
      ]),
    )
    listPromoCodes.mockResolvedValue({ codes: [], pagination: null })

    await renderPage({ organizationId: OTHER })

    expect(listPromoCodes).toHaveBeenCalledWith(ORG, { eventId: null, page: 1 })
    expect(screen.queryByRole('navigation', { name: 'Choose an organisation' })).toBeNull()
  })
})

describe('the table of codes', () => {
  beforeEach(() => {
    readSession.mockResolvedValue(session([membership(ORG, ['promo:manage'])]))
    // The rows are read at a fixed moment, inside FIVE's window. Whether a
    // code is offered Resume reads the clock (`promoHasEnded`), and with the
    // real one this table stopped offering it on 10 October 2026 at 04:59 UTC,
    // the end of the window the fixture states. Only `Date` is replaced, so
    // rendering and its timers run as they do in the browser.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T12:00:00.000Z') })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('says what each code takes off, where, when, how often, and its status in words', async () => {
    listPromoCodes.mockResolvedValue({
      codes: [
        code(),
        code({
          id: 'prfivexxxxxxx',
          code: 'FIVE',
          type: 'FIXED_AMOUNT',
          value: 500,
          currency: 'USD',
          maxRedemptions: null,
          redemptionCount: 0,
          ordersCount: 0,
          eventId: 'evninenightsx',
          event: { id: 'evninenightsx', slug: 'nine-nights', title: 'Nine Nights' },
          startsAt: '2026-10-01T14:00:00.000Z',
          endsAt: '2026-10-10T04:59:00.000Z',
          active: false,
          status: 'PAUSED',
        }),
      ],
      pagination: null,
    })

    await renderPage()

    const table = screen.getByRole('table')
    const [, first, second] = within(table).getAllByRole('row')

    expect(within(first).getByRole('rowheader')).toHaveTextContent('SAVE10')
    expect(first).toHaveTextContent('10% off')
    expect(first).toHaveTextContent('All events')
    expect(first).toHaveTextContent('No window: live until paused or used up')
    expect(first).toHaveTextContent('3 of 50')
    expect(first).toHaveTextContent('Active')
    expect(first.querySelector('[data-slot="status-icon"]')).toHaveAttribute('data-tone', 'success')

    expect(second).toHaveTextContent('$5.00 off')
    expect(second).toHaveTextContent('Nine Nights')
    // The event's own zone, stated.
    expect(second).toHaveTextContent('Thu, Oct 1 · 9:00 AM to Fri, Oct 9 · 11:59 PM (CDT)')
    expect(second).toHaveTextContent('0, no limit')
    expect(second).toHaveTextContent('Paused')
    expect(within(second).getByRole('button', { name: 'Resume FIVE' })).toBeInTheDocument()
    expect(within(second).getByRole('button', { name: 'Delete FIVE' })).toBeInTheDocument()
    // A used code can be paused and not deleted.
    expect(within(first).queryByRole('button', { name: 'Delete SAVE10' })).toBeNull()
    expect(first).toHaveTextContent('Used 3 times, so it can be paused but not deleted.')
  })

  it('says plainly when there are none, without promising any', async () => {
    listPromoCodes.mockResolvedValue({ codes: [], pagination: null })

    await renderPage()

    expect(screen.getByText('No promo codes')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\b(yet|soon|coming)\b/iu)
  })

  it('narrows to one event by its id, and offers the way back to every code', async () => {
    listPromoCodes.mockResolvedValue({ codes: [], pagination: null })

    await renderPage({ organizationId: ORG, eventId: 'evninenightsx' })

    expect(listPromoCodes).toHaveBeenCalledWith(ORG, { eventId: 'evninenightsx', page: 1 })
    expect(
      screen.getByText(/Showing the codes for Nine Nights and the codes for every event\./u),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Show every code' })).toHaveAttribute(
      'href',
      `/organizer/promo-codes?organizationId=${ORG}`,
    )
    // The form starts scoped to that event.
    expect(screen.getByLabelText('Applies to')).toHaveValue('evninenightsx')
  })

  it('ignores an event filter that is not an id, rather than sending it anywhere', async () => {
    listPromoCodes.mockResolvedValue({ codes: [], pagination: null })

    await renderPage({ eventId: 'SAVE10 OR 1=1' })

    expect(listPromoCodes).toHaveBeenCalledWith(ORG, { eventId: null, page: 1 })
  })

  it('counts every code in the heading and pages through them, keeping the filter', async () => {
    listPromoCodes.mockResolvedValue({
      codes: [code({ id: 'prpagetwoxxxx', code: 'PAGETWO' })],
      pagination: {
        page: 2,
        perPage: 50,
        total: 101,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      },
    })

    await renderPage({ organizationId: ORG, eventId: 'evninenightsx', page: '2' })

    expect(listPromoCodes).toHaveBeenCalledWith(ORG, { eventId: 'evninenightsx', page: 2 })
    // The organisation's total, not the length of one page.
    expect(screen.getByRole('heading', { name: 'Codes (101)' })).toBeInTheDocument()
    expect(screen.getByText('Codes 51 to 51 of 101, newest first.')).toBeInTheDocument()

    const pages = screen.getByRole('navigation', { name: 'Promo code pages' })
    expect(within(pages).getByText('Page 2 of 3')).toBeInTheDocument()
    expect(within(pages).getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      `/organizer/promo-codes?organizationId=${ORG}&eventId=evninenightsx`,
    )
    expect(within(pages).getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      `/organizer/promo-codes?organizationId=${ORG}&eventId=evninenightsx&page=3`,
    )
  })

  it('reads only digits as a page, and says so when a page is past the last', async () => {
    listPromoCodes.mockResolvedValue({ codes: [], pagination: null })

    await renderPage({ page: '2; drop' })

    expect(listPromoCodes).toHaveBeenCalledWith(ORG, { eventId: null, page: 1 })

    listPromoCodes.mockResolvedValue({
      codes: [],
      pagination: {
        page: 9,
        perPage: 50,
        total: 60,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    })

    await renderPage({ page: '9' })

    expect(screen.getByText('There are no codes on page 9')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      `/organizer/promo-codes?organizationId=${ORG}&page=2`,
    )
  })

  it('says what could not be read, and still offers the form', async () => {
    listPromoCodes.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }))

    await renderPage()

    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Make a promo code' })).toBeInTheDocument()
  })

  it('offers the form for every event when the events could not be read', async () => {
    listPromoCodes.mockResolvedValue({ codes: [], pagination: null })
    listOrganizationEvents.mockRejectedValue(new Error('down'))

    await renderPage()

    expect(screen.getByText(/a new code can only be for every event just now/u)).toBeInTheDocument()
    expect(within(screen.getByLabelText('Applies to')).getAllByRole('option')).toHaveLength(1)
  })
})
