/**
 * The notification queue is platform work, never shows a worker's lease, and
 * claims nothing about delivery that `sentAt` does not say.
 *
 * The properties worth pinning:
 *
 *   - **Forbidden without `reconciliation:manage`**, and the API is not asked:
 *     the operations area admits organisation finance staff, who must not be
 *     sent into this queue.
 *   - **`leaseExpiresAt` is never rendered**, searched for in the markup in
 *     both its stored and printed forms.
 *   - **Every status can be filtered by**, and a status the API does not know
 *     is dropped rather than sent.
 *   - **"Sent" means handed over**: an unsent row says so, and nothing says
 *     "delivered".
 *   - **Each row links to its detail page**, and paging keeps the filters.
 *   - **No false claims about the list**: nothing says trouble comes first
 *     (the API's enum order puts dead letters near the end), and a page past
 *     the end is not "the outbox is empty".
 *
 * @module app/operations/notifications/page.test
 */

import { render, screen, within } from '@testing-library/react'
import { NOTIFICATION_STATUSES } from '@desi-event/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/operations/notifications',
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

  return { ...actual, listNotifications: vi.fn() }
})

const { listNotifications } = await import('../../../lib/workspace-api.js')
const { default: NotificationQueuePage } = await import('./page.jsx')

/** A lease expiry no page may print, in a year nothing else on the page uses. */
const LEASE = '2031-07-19T08:17:00.000Z'

/**
 * A platform operator.
 *
 * @returns {object} The session.
 */
function operator() {
  return { user: {}, capabilities: ['reconciliation:manage', 'finance:view'], memberships: [] }
}

/**
 * One outbox message, as the API returns it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The message.
 */
function message(overrides = {}) {
  return {
    id: 'ntf00000000000000000001',
    template: 'ticket.issued',
    channel: 'EMAIL',
    status: 'DEAD_LETTER',
    businessEvent: 'ticket.issued:ord1',
    templateVersion: 1,
    attempts: 5,
    maxAttempts: 5,
    scheduledFor: '2026-09-20T10:00:00.000Z',
    sentAt: null,
    lastAttemptAt: '2026-09-20T10:05:00.000Z',
    failureCategory: 'TRANSIENT',
    lastError: 'Provider timed out',
    leaseExpiresAt: LEASE,
    suppressible: false,
    createdAt: '2026-09-20T09:59:00.000Z',
    ...overrides,
  }
}

/**
 * Render the page.
 *
 * @param {object} options What the session and the API answer.
 * @param {object} [options.as] The session.
 * @param {object|Error} [options.answer] The queue, or an error to throw.
 * @param {object} [options.query] The query string.
 * @returns {Promise<object>} The render result.
 */
async function renderPage({ as = operator(), answer, query = {} } = {}) {
  readSession.mockResolvedValue(as)

  if (answer instanceof Error) listNotifications.mockRejectedValue(answer)
  else listNotifications.mockResolvedValue(answer ?? { messages: [message()], pagination: null })

  return render(await NotificationQueuePage({ searchParams: Promise.resolve(query) }))
}

beforeEach(() => {
  listNotifications.mockReset()
})

describe('who may see it', () => {
  it('refuses an organisation’s finance member, and does not ask the API', async () => {
    await renderPage({
      as: {
        user: {},
        capabilities: [],
        memberships: [{ organizationId: 'org1', role: 'FINANCE', capabilities: ['finance:view'] }],
      },
    })

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeInTheDocument()
    expect(listNotifications).not.toHaveBeenCalled()
  })
})

describe('what a row shows', () => {
  it('never renders the worker’s lease, in any form', async () => {
    const { container } = await renderPage({
      answer: {
        messages: [message({ status: 'CLAIMED' }), message({ id: 'n2', status: 'QUEUED' })],
        pagination: null,
      },
    })

    expect(container.innerHTML).not.toContain(LEASE)
    expect(container.innerHTML).not.toMatch(/2031/u)
    expect(container.textContent).not.toMatch(/lease/iu)
  })

  it('shows the status as a word, the attempts as a count, and links to the message', async () => {
    await renderPage({ answer: { messages: [message({ attempts: 3 })], pagination: null } })

    const row = screen.getByRole('link', { name: 'ticket.issued' }).closest('tr')

    expect(within(row).getByText('Dead letter')).toBeInTheDocument()
    expect(within(row).getByText('3 of 5')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ticket.issued' })).toHaveAttribute(
      'href',
      '/operations/notifications/ntf00000000000000000001',
    )
  })

  it('says an unsent message was not handed over, and never claims delivery', async () => {
    const { container } = await renderPage()

    expect(screen.getByText('Not handed over')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/deliver/iu)
  })

  it('prints the stored error as text only', async () => {
    const { container } = await renderPage({
      answer: {
        messages: [message({ lastError: '<img src=x onerror=alert(1)> refused' })],
        pagination: null,
      },
    })

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)> refused')).toBeInTheDocument()
  })
})

describe('filters', () => {
  it('offers every status the outbox has', async () => {
    await renderPage()

    const offered = within(screen.getByRole('combobox', { name: 'Status' }))
      .getAllByRole('option')
      .map((option) => option.value)
      .filter(Boolean)

    expect(offered).toEqual([...NOTIFICATION_STATUSES])
  })

  it('sends the chosen filters to the API', async () => {
    await renderPage({ query: { status: 'FAILED', failureCategory: 'PERMANENT', page: '2' } })

    expect(listNotifications).toHaveBeenCalledWith({
      status: 'FAILED',
      failureCategory: 'PERMANENT',
      page: 2,
      perPage: 50,
    })
  })

  it('drops a status the API does not know, and says so', async () => {
    await renderPage({ query: { status: 'DELIVERED' } })

    expect(listNotifications.mock.calls[0][0].status).toBe('')
    expect(screen.getByText(/was not one this queue knows/u)).toBeInTheDocument()
  })

  it('keeps the filters on the page links', async () => {
    await renderPage({
      query: { status: 'FAILED' },
      answer: {
        messages: [message()],
        pagination: {
          page: 1,
          perPage: 50,
          total: 120,
          totalPages: 3,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      },
    })

    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      '/operations/notifications?status=FAILED&page=2',
    )
    expect(screen.getByText('Showing 1 of 120.')).toBeInTheDocument()
  })
})

describe('refusals', () => {
  it('draws a refused read in the refusal vocabulary, not the API’s words', async () => {
    const { container } = await renderPage({
      answer: Object.assign(new Error('Needs reconciliation:manage at /v1/operations'), {
        status: 403,
      }),
    })

    expect(screen.getByText('Not for this account')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\/v1\//u)
  })

  it('says the queue is empty rather than drawing a blank table', async () => {
    await renderPage({ answer: { messages: [], pagination: null } })

    expect(screen.getByText('The outbox is empty')).toBeInTheDocument()
  })
})

describe('what the page claims about the queue', () => {
  it('says what the API puts first, which is what it now does', async () => {
    const { container } = await renderPage()

    expect(container.textContent).toMatch(
      /dead letters, failures and scheduled retries first, the longest-waiting of them first/u,
    )
  })

  it('says a page past the end is past the end, with the real count and a way back', async () => {
    await renderPage({
      query: { status: 'DEAD_LETTER', page: '4' },
      answer: {
        messages: [],
        pagination: {
          page: 4,
          perPage: 50,
          total: 51,
          totalPages: 2,
          hasNextPage: false,
          hasPreviousPage: true,
        },
      },
    })

    expect(screen.getByText('Page 4 is past the end of the queue')).toBeInTheDocument()
    expect(
      screen.getByText('There are 51 messages matching these filters, on 2 pages.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the first page' })).toHaveAttribute(
      'href',
      '/operations/notifications?status=DEAD_LETTER',
    )
    expect(screen.queryByText('The outbox is empty')).not.toBeInTheDocument()
    expect(screen.queryByText('Nothing matches these filters')).not.toBeInTheDocument()
  })
})
