/**
 * The reconciliation list makes every item's page reachable, in every state,
 * scoped the way the API scopes it, and draws no provider identifier.
 *
 * The properties worth pinning:
 *
 *   - **Every state is filterable** — resolved included — and every kind.
 *   - **Each row links to its detail page.**
 *   - **A lapsed step-up is a step-up**, not a failure.
 *   - **The platform view is offered only to the platform.** An organisation's
 *     finance member is always scoped to one of their own organisations.
 *   - **No provider reference, internal id or evidence is drawn**, though the
 *     list payload carries all of them.
 *   - **No false claims about the list**: nothing says which items come first
 *     (the API's order puts escalated after resolved), a page past the end is
 *     not "nothing to reconcile", and the empty state speaks only for the
 *     scope shown.
 *
 * @module app/operations/reconciliation/page.test
 */

import { render, screen, within } from '@testing-library/react'
import { RECONCILIATION_KINDS, RECONCILIATION_STATES } from '@desi-event/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/operations/reconciliation',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const readSession = vi.fn()

vi.mock('../../../lib/session.js', async () => {
  const actual = await vi.importActual('../../../lib/session.js')

  return { ...actual, readSession: (...args) => readSession(...args) }
})
vi.mock('../../../lib/workspace-api.js', async () => {
  const actual = await vi.importActual('../../../lib/workspace-api.js')

  return { ...actual, listReconciliationTasks: vi.fn() }
})

const { listReconciliationTasks } = await import('../../../lib/workspace-api.js')
const { default: ReconciliationListPage } = await import('./page.jsx')

/** The organisation. */
const ORG = 'org00000000000000000001'

/**
 * A platform finance administrator.
 *
 * @returns {object} The session.
 */
function platform() {
  return { user: {}, capabilities: ['finance:view', 'reconciliation:manage'], memberships: [] }
}

/**
 * An organisation's finance member, with no platform capability.
 *
 * @returns {object} The session.
 */
function orgFinance() {
  return {
    user: {},
    capabilities: [],
    memberships: [
      {
        organizationId: ORG,
        organizationName: 'Rangoli',
        role: 'FINANCE',
        capabilities: ['finance:view'],
      },
    ],
  }
}

/**
 * One item, as the list returns it: the whole detail shape.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The item.
 */
function task(overrides = {}) {
  return {
    id: 'rec00000000000000000001',
    kind: 'PAYMENT_TIMEOUT',
    state: 'RESOLVED',
    paymentId: 'pay_internal_0001',
    orderId: 'ord_internal_0001',
    orderReference: 'DE-8F3K2Q',
    refundId: null,
    organizationId: ORG,
    providerRef: 'pi_3PzSecretProviderRef',
    localState: { status: 'requires_capture', amountCents: 150000 },
    providerState: { status: 'succeeded_provider_side' },
    attempts: 2,
    lastError: null,
    assignedToId: null,
    resolution: 'SETTLED_FROM_PROVIDER',
    resolutionNote: 'Confirmed.',
    resolvedAt: '2026-09-20T10:00:00.000Z',
    resolvedById: null,
    escalatedAt: null,
    escalationReason: null,
    notes: [],
    aging: 'OVERDUE',
    ageHours: 80,
    createdAt: '2026-09-17T10:00:00.000Z',
    ...overrides,
  }
}

/**
 * Render the page.
 *
 * @param {object} [options] What the session and the API answer.
 * @param {object} [options.as] The session.
 * @param {object|Error} [options.answer] The list, or an error to throw.
 * @param {object} [options.query] The query string.
 * @returns {Promise<object>} The render result.
 */
async function renderPage({ as = platform(), answer, query = {} } = {}) {
  readSession.mockResolvedValue(as)

  if (answer instanceof Error) listReconciliationTasks.mockRejectedValue(answer)
  else listReconciliationTasks.mockResolvedValue(answer ?? { tasks: [task()], pagination: null })

  return render(await ReconciliationListPage({ searchParams: Promise.resolve(query) }))
}

beforeEach(() => {
  listReconciliationTasks.mockReset()
})

describe('filters', () => {
  it('offers every state, resolved included, and every kind', async () => {
    await renderPage()

    const values = (name) =>
      within(screen.getByRole('combobox', { name }))
        .getAllByRole('option')
        .map((option) => option.value)
        .filter(Boolean)

    expect(values('State')).toEqual([...RECONCILIATION_STATES])
    expect(values('State')).toContain('RESOLVED')
    expect(values('Kind')).toEqual([...RECONCILIATION_KINDS])
  })

  it('sends the chosen filters and drops ones the API does not know', async () => {
    await renderPage({
      query: { state: 'ESCALATED', kind: 'NOT_A_KIND', aging: 'OVERDUE', reference: 'pi_123' },
    })

    expect(listReconciliationTasks).toHaveBeenCalledWith({
      organizationId: '',
      state: 'ESCALATED',
      kind: '',
      aging: 'OVERDUE',
      page: 1,
      perPage: 50,
    })
  })
})

describe('scope', () => {
  it('gives the platform the every-organisation view', async () => {
    await renderPage()

    expect(listReconciliationTasks.mock.calls[0][0].organizationId).toBe('')
    expect(screen.getByText(/for every organisation: open/u)).toBeInTheDocument()
  })

  it('always scopes an organisation’s finance member to their own organisation', async () => {
    await renderPage({ as: orgFinance(), query: { organizationId: '' } })

    expect(listReconciliationTasks.mock.calls[0][0].organizationId).toBe(ORG)
    expect(screen.queryByRole('option', { name: 'Every organisation' })).not.toBeInTheDocument()
  })

  it('refuses a session with neither, before asking the API', async () => {
    await renderPage({ as: { user: {}, capabilities: [], memberships: [] } })

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeInTheDocument()
    expect(listReconciliationTasks).not.toHaveBeenCalled()
  })
})

describe('the rows', () => {
  it('links every item, whatever its state, to its detail page', async () => {
    await renderPage({
      answer: {
        tasks: [
          task({ id: 'r-open', state: 'OPEN', kind: 'REFUND_UNKNOWN' }),
          task({ id: 'r-done', state: 'RESOLVED', kind: 'TRANSFER_STUCK' }),
        ],
        pagination: null,
      },
    })

    expect(screen.getByRole('link', { name: 'Refund unknown' })).toHaveAttribute(
      'href',
      '/operations/reconciliation/r-open',
    )
    expect(screen.getByRole('link', { name: 'Transfer stuck' })).toHaveAttribute(
      'href',
      '/operations/reconciliation/r-done',
    )
  })

  it('draws the state in words and the age as a band', async () => {
    await renderPage()

    const row = screen.getByRole('link', { name: 'Payment timeout' }).closest('tr')

    expect(within(row).getByText('Resolved')).toBeInTheDocument()
    expect(within(row).getByText('Overdue')).toBeInTheDocument()
    expect(within(row).getByText('DE-8F3K2Q')).toBeInTheDocument()
  })

  it('never draws the provider reference, internal ids or the evidence', async () => {
    const { container } = await renderPage()

    for (const secret of [
      'pi_3PzSecretProviderRef',
      'pay_internal_0001',
      'ord_internal_0001',
      'requires_capture',
      'succeeded_provider_side',
    ]) {
      expect(container.innerHTML).not.toContain(secret)
    }
  })
})

describe('what the page claims about the list', () => {
  it('says what the API puts first, which is what it now does', async () => {
    const { container } = await renderPage()

    expect(container.textContent).toMatch(
      /the unresolved ones first and the oldest of those first/u,
    )
  })

  it('says a page past the end is past the end, with the real count and a way back', async () => {
    await renderPage({
      as: orgFinance(),
      query: { page: '2' },
      answer: {
        tasks: [],
        pagination: {
          page: 2,
          perPage: 50,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: true,
        },
      },
    })

    expect(screen.getByText('Page 2 is past the end of this list')).toBeInTheDocument()
    expect(screen.getByText('There is 1 item in all, on 1 page.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the first page' })).toHaveAttribute(
      'href',
      `/operations/reconciliation?organizationId=${ORG}`,
    )
    expect(screen.queryByText('Nothing to reconcile')).not.toBeInTheDocument()
  })

  it('speaks only for the organisation shown when its list is empty', async () => {
    const { container } = await renderPage({
      as: orgFinance(),
      answer: {
        tasks: [],
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

    expect(screen.getByText('Nothing to reconcile')).toBeInTheDocument()
    expect(
      screen.getByText('There is no reconciliation item for Rangoli, in any state.'),
    ).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/every payment/iu)
  })
})

describe('refusals', () => {
  it('offers the step-up when the FINANCE_VIEW window has lapsed', async () => {
    const { container } = await renderPage({
      answer: Object.assign(new Error('Authenticate at /v1/auth/step-up'), {
        status: 403,
        code: 'STEP_UP_REQUIRED',
      }),
    })

    expect(screen.getByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\/v1\//u)
  })

  it('says the service is not answering rather than showing an empty list', async () => {
    await renderPage({ answer: new TypeError('fetch failed') })

    expect(screen.getByText(/The reconciliation list could not be loaded/u)).toBeInTheDocument()
    expect(screen.queryByText('Nothing to reconcile')).not.toBeInTheDocument()
  })
})
