/**
 * The refund list makes every refund's page reachable, in every status, and
 * says what produced the figures before any of them.
 *
 * The properties worth pinning:
 *
 *   - **Every status is in the filter**, the retained spellings included, so a
 *     settled, declined or cancelled refund can be found — the point of the page.
 *   - **Each row links to its detail page.**
 *   - **A lapsed step-up is a step-up**, not a failure.
 *   - **The mode is the server's**, and when it cannot be read the page claims
 *     only what is true of every mode.
 *   - **Provider identifiers are not drawn**, though the payload carries them.
 *   - **Scoped to an organisation this session belongs to**, and a platform
 *     account with none is told plainly rather than shown an empty table.
 *   - **No false claims about the list**: nothing says which refunds come
 *     first (the API's order is the enum's, not urgency's), and a page past
 *     the end is not drawn as "no refunds".
 *
 * @module app/finance/refunds/page.test
 */

import { render, screen, within } from '@testing-library/react'
import { REFUND_STATUSES } from '@desi-event/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/finance/refunds',
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

  return { ...actual, getFinanceSummary: vi.fn() }
})
vi.mock('../../../lib/workspace-api.js', async () => {
  const actual = await vi.importActual('../../../lib/workspace-api.js')

  return { ...actual, listRefunds: vi.fn() }
})

const { getFinanceSummary } = await import('../../../lib/organizer-api.js')
const { listRefunds } = await import('../../../lib/workspace-api.js')
const { default: RefundListPage } = await import('./page.jsx')

/** The organisation. */
const ORG = 'org00000000000000000001'

/** A second organisation. */
const OTHER = 'org00000000000000000002'

/**
 * A finance member of one or two organisations.
 *
 * @param {string[]} [ids] Which organisations.
 * @returns {object} The session.
 */
function finance(ids = [ORG]) {
  return {
    user: {},
    capabilities: [],
    memberships: ids.map((organizationId, index) => ({
      organizationId,
      organizationName: `Organisation ${index + 1}`,
      role: 'FINANCE',
      capabilities: ['finance:view'],
    })),
  }
}

/**
 * One refund, as the API returns it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The refund.
 */
function refund(overrides = {}) {
  return {
    id: 'ref00000000000000000001',
    orderId: 'ord00000000000000000001',
    orderReference: 'DE-8F3K2Q',
    organizationId: ORG,
    paymentId: 'pay00000000000000000001',
    provider: 'in-memory-payments',
    providerRefundId: 're_secret_provider_id',
    amountCents: 150000,
    currency: 'INR',
    reason: 'EVENT_CANCELLED',
    reasonNote: null,
    status: 'SUCCEEDED',
    allocation: null,
    items: [],
    requestedById: null,
    approvedById: null,
    ticketsRevoked: true,
    inventoryReturned: true,
    failureCode: null,
    attempts: 1,
    submittedAt: '2026-09-20T10:00:00.000Z',
    settledAt: '2026-09-20T10:01:00.000Z',
    createdAt: '2026-09-19T10:00:00.000Z',
    updatedAt: '2026-09-20T10:01:00.000Z',
    ...overrides,
  }
}

/**
 * Render the page.
 *
 * @param {object} [options] What the session and the API answer.
 * @param {object} [options.as] The session.
 * @param {object|Error} [options.answer] The list, or an error to throw.
 * @param {object|Error} [options.mode] The finance summary, or an error to throw.
 * @param {object} [options.query] The query string.
 * @returns {Promise<object>} The render result.
 */
async function renderPage({ as = finance(), answer, mode, query = {} } = {}) {
  readSession.mockResolvedValue(as)

  if (answer instanceof Error) listRefunds.mockRejectedValue(answer)
  else listRefunds.mockResolvedValue(answer ?? { refunds: [refund()], pagination: null })

  if (mode instanceof Error) getFinanceSummary.mockRejectedValue(mode)
  else
    getFinanceSummary.mockResolvedValue(
      mode ?? {
        mode: 'MOCK',
        modeNotice:
          'DEMO — no money moved. These figures describe a demonstration and are not an accounting record.',
        totals: { grossCents: 999999 },
      },
    )

  return render(await RefundListPage({ searchParams: Promise.resolve(query) }))
}

beforeEach(() => {
  listRefunds.mockReset()
  getFinanceSummary.mockReset()
})

describe('the filter', () => {
  it('offers every refund status, settled, declined and cancelled included', async () => {
    await renderPage()

    const offered = within(screen.getByRole('combobox', { name: 'Status' }))
      .getAllByRole('option')
      .map((option) => option.value)
      .filter(Boolean)

    expect(offered).toEqual([...REFUND_STATUSES])
    expect(offered).toEqual(expect.arrayContaining(['SUCCEEDED', 'DECLINED', 'CANCELLED']))
  })

  it('asks for the chosen organisation, status and order, and nothing it cannot scope', async () => {
    await renderPage({
      as: finance([ORG, OTHER]),
      query: { organizationId: OTHER, status: 'DECLINED', orderReference: ' de-8f3k2q ' },
    })

    expect(listRefunds).toHaveBeenCalledWith({
      organizationId: OTHER,
      status: 'DECLINED',
      orderReference: 'DE-8F3K2Q',
      page: 1,
      perPage: 50,
    })
    expect(getFinanceSummary).toHaveBeenCalledWith({ organizationId: OTHER, currency: 'INR' })
  })

  it('never asks about an organisation this session does not belong to', async () => {
    await renderPage({ query: { organizationId: 'org-not-mine' } })

    expect(listRefunds.mock.calls[0][0].organizationId).toBe(ORG)
  })

  it('does not send an order reference the API would refuse, and says why', async () => {
    await renderPage({ query: { orderReference: 'x;drop' } })

    expect(listRefunds.mock.calls[0][0].orderReference).toBe('')
    expect(screen.getByText(/not in the form references take/u)).toBeInTheDocument()
  })
})

describe('the rows', () => {
  it('links every refund, whatever its status, to its detail page', async () => {
    await renderPage({
      answer: {
        refunds: [
          refund({ id: 'r-settled', status: 'SUCCEEDED', orderReference: 'DE-AAAA' }),
          refund({ id: 'r-declined', status: 'DECLINED', orderReference: 'DE-BBBB' }),
          refund({ id: 'r-cancelled', status: 'CANCELLED', orderReference: 'DE-CCCC' }),
        ],
        pagination: null,
      },
    })

    expect(screen.getByRole('link', { name: 'Refund on DE-AAAA' })).toHaveAttribute(
      'href',
      '/finance/refunds/r-settled',
    )
    expect(screen.getByRole('link', { name: 'Refund on DE-BBBB' })).toHaveAttribute(
      'href',
      '/finance/refunds/r-declined',
    )
    expect(screen.getByRole('link', { name: 'Refund on DE-CCCC' })).toHaveAttribute(
      'href',
      '/finance/refunds/r-cancelled',
    )
  })

  it('draws the status as a word and the amount in its currency', async () => {
    await renderPage()

    const row = screen.getByRole('link', { name: 'Refund on DE-8F3K2Q' }).closest('tr')

    expect(within(row).getByText('Succeeded (settled)')).toBeInTheDocument()
    expect(within(row).getByText(/1,500/u)).toBeInTheDocument()
  })

  it('does not draw the provider’s refund reference or the payment id', async () => {
    const { container } = await renderPage()

    expect(container.textContent).not.toContain('re_secret_provider_id')
    expect(container.textContent).not.toContain('pay00000000000000000001')
  })
})

describe('what the page claims about the list', () => {
  it('says what the API puts first, which is what it now does', async () => {
    const { container } = await renderPage()

    expect(container.textContent).toMatch(/the ones still in flight first/u)
  })

  it('says a page past the end is past the end, with the real count and a way back', async () => {
    await renderPage({
      query: { status: 'DECLINED', page: '2' },
      answer: {
        refunds: [],
        pagination: {
          page: 2,
          perPage: 50,
          total: 3,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: true,
        },
      },
    })

    expect(screen.getByText('Page 2 is past the end of this list')).toBeInTheDocument()
    expect(
      screen.getByText('There are 3 refunds matching these filters, on 1 page.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the first page' })).toHaveAttribute(
      'href',
      `/finance/refunds?organizationId=${ORG}&status=DECLINED`,
    )
    expect(screen.queryByText('No refunds')).not.toBeInTheDocument()
    expect(screen.queryByText('No refund matches these filters')).not.toBeInTheDocument()
  })

  it('says there are no refunds only when the list has none', async () => {
    await renderPage({
      answer: {
        refunds: [],
        pagination: {
          page: 1,
          perPage: 50,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      },
    })

    expect(screen.getByText('No refunds')).toBeInTheDocument()
    expect(screen.queryByText(/past the end/u)).not.toBeInTheDocument()
  })
})

describe('the mode', () => {
  it('says what produced the figures, in the server’s words, before the table', async () => {
    await renderPage()

    const banner = screen.getByText('Demonstration data').closest('p')

    expect(banner).toHaveTextContent(/DEMO — no money moved/u)
    expect(
      banner.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('claims only what is true of every mode when the mode cannot be read', async () => {
    await renderPage({ mode: Object.assign(new Error('x'), { status: 503 }) })

    expect(screen.getByText(/neither payment mode this build can run in/u)).toBeInTheDocument()
    expect(screen.queryByText('Demonstration data')).not.toBeInTheDocument()
    expect(screen.queryByText('Sandbox data')).not.toBeInTheDocument()
  })
})

describe('refusals', () => {
  it('offers the step-up when the FINANCE_VIEW window has lapsed', async () => {
    const lapsed = Object.assign(new Error('Authenticate at /v1/auth/step-up'), {
      status: 403,
      code: 'STEP_UP_REQUIRED',
    })

    const { container } = await renderPage({ answer: lapsed, mode: lapsed })

    expect(screen.getByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\/v1\//u)
  })

  it('draws any other failure as absent, not as an empty list', async () => {
    await renderPage({ answer: Object.assign(new Error('boom'), { status: 500 }) })

    expect(screen.getByText(/The refund list could not be loaded/u)).toBeInTheDocument()
    expect(screen.queryByText('No refunds')).not.toBeInTheDocument()
  })

  it('tells a platform account with no organisation that there is no list, and asks nothing', async () => {
    await renderPage({
      as: { user: {}, capabilities: ['finance:view', 'reconciliation:manage'], memberships: [] },
    })

    expect(screen.getByText(/listed one organisation at a time/u)).toBeInTheDocument()
    expect(listRefunds).not.toHaveBeenCalled()
  })
})
