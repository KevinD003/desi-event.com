/**
 * One message: its facts, never its lease, and only the actions the API accepts.
 *
 * The properties worth pinning:
 *
 *   - **Forbidden without `reconciliation:manage`**, before the API is asked.
 *   - **`leaseExpiresAt` is never rendered**, even on the one status where the
 *     page reads it to decide what to offer.
 *   - **Retry and withdraw follow the API's rule**, status by status, including
 *     a claimed message whose lease has lapsed (withdraw only) and one whose
 *     lease is live (neither).
 *   - **"Sent" is not claimed without `sentAt`.**
 *   - **A missing message and a refused one read the same.**
 *
 * @module app/operations/notifications/id/page.test
 */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/operations/notifications/n1',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const readSession = vi.fn()

vi.mock('../../../../lib/session.js', async () => {
  const actual = await vi.importActual('../../../../lib/session.js')

  return { ...actual, readSession: (...args) => readSession(...args) }
})
vi.mock('../../../../lib/workspace-api.js', async () => {
  const actual = await vi.importActual('../../../../lib/workspace-api.js')

  return { ...actual, getNotification: vi.fn() }
})

const { getNotification } = await import('../../../../lib/workspace-api.js')
const { default: NotificationDetailPage } = await import('./page.jsx')

/** A lease that lapsed long ago, in a year nothing else on the page uses. */
const LAPSED = '2019-03-04T05:06:00.000Z'

/** A lease that is still live, in a year nothing else on the page uses. */
const LIVE = '2099-11-12T13:14:00.000Z'

/**
 * A platform operator.
 *
 * @returns {object} The session.
 */
function operator() {
  return { user: {}, capabilities: ['reconciliation:manage'], memberships: [] }
}

/**
 * One message.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The message.
 */
function message(overrides = {}) {
  return {
    id: 'n1',
    template: 'event.cancelled',
    channel: 'EMAIL',
    status: 'DEAD_LETTER',
    businessEvent: null,
    templateVersion: 2,
    attempts: 5,
    maxAttempts: 5,
    scheduledFor: '2026-09-20T10:00:00.000Z',
    sentAt: null,
    lastAttemptAt: '2026-09-20T10:05:00.000Z',
    failureCategory: 'PERMANENT',
    lastError: 'Mailbox unavailable for Hidden email',
    leaseExpiresAt: null,
    suppressible: false,
    createdAt: '2026-09-20T09:59:00.000Z',
    ...overrides,
  }
}

/**
 * Render the page.
 *
 * @param {object|Error} answer The message, or an error to throw.
 * @param {object} [as] The session.
 * @returns {Promise<object>} The render result.
 */
async function renderPage(answer, as = operator()) {
  readSession.mockResolvedValue(as)

  if (answer instanceof Error) getNotification.mockRejectedValue(answer)
  else getNotification.mockResolvedValue(answer)

  return render(await NotificationDetailPage({ params: Promise.resolve({ id: 'n1' }) }))
}

/**
 * Which of the two actions are on the page.
 *
 * @returns {{retry: boolean, cancel: boolean}} What is offered.
 */
function offered() {
  return {
    retry: screen.queryByRole('button', { name: 'Put it back in the queue' }) !== null,
    cancel: screen.queryByRole('button', { name: 'Withdraw it' }) !== null,
  }
}

beforeEach(() => {
  getNotification.mockReset()
})

describe('who may see it', () => {
  it('refuses without the platform capability, before asking the API', async () => {
    await renderPage(message(), {
      user: {},
      capabilities: [],
      memberships: [{ organizationId: 'o1', role: 'OWNER', capabilities: ['finance:view'] }],
    })

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeInTheDocument()
    expect(getNotification).not.toHaveBeenCalled()
  })

  it('reads a missing message and a refused one the same way', async () => {
    const { container: refused } = await renderPage(
      Object.assign(new Error('forbidden'), { status: 403 }),
    )
    const refusedText = refused.textContent

    refused.remove()

    const { container: missing } = await renderPage(
      Object.assign(new Error('No such notification.'), { status: 404 }),
    )

    expect(refusedText).toMatch(/Not for this account/u)
    expect(missing.textContent).toBe(refusedText)
  })
})

describe('the lease', () => {
  it('is never rendered, even when it decides that withdrawing is offered', async () => {
    const { container } = await renderPage(message({ status: 'CLAIMED', leaseExpiresAt: LAPSED }))

    expect(container.innerHTML).not.toContain(LAPSED)
    expect(container.innerHTML).not.toMatch(/2019/u)
    // Not even in words: the only trace of the lease is the offer itself.
    expect(container.textContent).not.toMatch(/lapsed|hold on it/iu)
    expect(offered()).toEqual({ retry: false, cancel: true })
  })

  it('is never rendered when it is live, and nothing is offered', async () => {
    const { container } = await renderPage(message({ status: 'CLAIMED', leaseExpiresAt: LIVE }))

    expect(container.innerHTML).not.toContain(LIVE)
    expect(container.innerHTML).not.toMatch(/2099/u)
    expect(offered()).toEqual({ retry: false, cancel: false })
    expect(screen.getByText(/A worker holds this message/u)).toBeInTheDocument()
  })
})

describe('retry and withdraw follow the API’s rule', () => {
  it.each([
    ['DEAD_LETTER', { retry: true, cancel: true }],
    ['FAILED', { retry: true, cancel: true }],
    ['RETRY_SCHEDULED', { retry: true, cancel: true }],
    ['QUEUED', { retry: false, cancel: true }],
    ['SENT', { retry: false, cancel: false }],
    ['CANCELLED', { retry: false, cancel: false }],
    ['SUPPRESSED', { retry: false, cancel: false }],
    ['SENDING', { retry: false, cancel: false }],
  ])('%s offers %o', async (status, expected) => {
    await renderPage(
      message({ status, sentAt: status === 'SENT' ? '2026-09-20T10:06:00.000Z' : null }),
    )

    expect(offered()).toEqual(expected)
  })
})

describe('what it says about sending', () => {
  it('says a sent message was handed to the simulated mail service, and no more', async () => {
    const { container } = await renderPage(
      message({ status: 'SENT', sentAt: '2026-09-20T10:06:00.000Z', lastError: null }),
    )

    expect(screen.getAllByText(/\(simulated\) mail service/u).length).toBeGreaterThan(0)
    expect(container.textContent).not.toMatch(/deliver/iu)
  })

  it('does not claim a hand-over that has no time recorded', async () => {
    await renderPage(message({ status: 'SENT', sentAt: null }))

    expect(
      screen.getByText(/Marked sent, but no time of hand-over was recorded/u),
    ).toBeInTheDocument()
    expect(screen.getByText('Not handed over')).toBeInTheDocument()
  })

  it('prints the stored error as text', async () => {
    const { container } = await renderPage(message({ lastError: '<script>x()</script> bounced' }))

    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText('<script>x()</script> bounced')).toBeInTheDocument()
  })
})
