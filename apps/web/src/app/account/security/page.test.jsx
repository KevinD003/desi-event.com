/**
 * The account security page reads three things and shows each on its own.
 *
 * The property worth pinning is independence: a person locked out of a lost
 * phone's session still needs the two-step controls, so one failed read must
 * not blank the page. And the failure it does show uses the API's refusal
 * vocabulary rather than a bare "could not be loaded".
 *
 * @module app/account/security/page.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const callApi = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../lib/organizer-api.js', () => ({ callApi: (...args) => callApi(...args) }))

const { default: AccountSecurityPage } = await import('./page.jsx')

const MFA = {
  required: true,
  satisfied: true,
  factors: [
    {
      id: 'ckfactor0000000000000002',
      type: 'TOTP',
      label: null,
      confirmed: true,
      createdAt: '2026-09-01T10:00:00.000Z',
      lastUsedAt: '2026-09-22T10:00:00.000Z',
    },
  ],
}

const SESSIONS = [
  {
    id: 'ckses00000000000000000001',
    current: true,
    createdAt: '2026-09-20T09:00:00.000Z',
    lastSeenAt: '2026-09-23T05:00:00.000Z',
    expiresAt: '2026-10-20T09:00:00.000Z',
    userAgent: null,
    deviceLabel: 'Work laptop',
  },
]

/**
 * An error as `callApi` throws it.
 *
 * @param {number} status The status.
 * @param {string} code The API's code.
 * @returns {Error} The error.
 */
function refused(status, code) {
  return Object.assign(new Error(`The API answered ${status}.`), { status, code })
}

/**
 * Answer each read from a table, throwing where the value is an error.
 *
 * @param {Record<string, unknown>} answers Path to data or error.
 * @returns {void}
 */
function answer(answers) {
  callApi.mockImplementation(async (path) => {
    const value = answers[path]

    if (value instanceof Error) throw value

    return { data: value }
  })
}

beforeEach(() => {
  callApi.mockReset()
})

afterEach(cleanup)

describe('AccountSecurityPage', () => {
  it('reads the factors, the sessions and the devices, and shows all three', async () => {
    answer({ '/v1/auth/mfa': MFA, '/v1/auth/sessions': SESSIONS, '/v1/auth/devices': [] })

    render(await AccountSecurityPage())

    expect(screen.getByRole('heading', { level: 1, name: 'Account security' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Turn off two-step sign-in' })).toBeTruthy()
    expect(screen.getByText(/Work laptop/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change password' })).toBeTruthy()
    expect(callApi.mock.calls.map(([path]) => path).sort()).toEqual([
      '/v1/auth/devices',
      '/v1/auth/mfa',
      '/v1/auth/sessions',
    ])
  })

  it('keeps the two-step controls when the session list could not be read', async () => {
    answer({
      '/v1/auth/mfa': MFA,
      '/v1/auth/sessions': refused(503, 'API_UNREACHABLE'),
      '/v1/auth/devices': [],
    })

    render(await AccountSecurityPage())

    const sessions = screen
      .getByRole('heading', { name: 'Where you are signed in' })
      .closest('section')

    expect(within(sessions).getByRole('status')).toBeTruthy()
    expect(within(sessions).queryByRole('button', { name: /sign out of this session/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Turn off two-step sign-in' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change password' })).toBeTruthy()
  })

  it('keeps the session list when the factors could not be read', async () => {
    answer({
      '/v1/auth/mfa': refused(500, 'INTERNAL'),
      '/v1/auth/sessions': SESSIONS,
      '/v1/auth/devices': [],
    })

    render(await AccountSecurityPage())

    const twoStep = screen.getByRole('heading', { name: 'Two-step sign-in' }).closest('section')

    expect(within(twoStep).getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /two-step sign-in/i })).toBeNull()
    expect(screen.getByText(/Work laptop/)).toBeTruthy()
  })

  it('offers no reset by email, because this build cannot deliver one', async () => {
    answer({ '/v1/auth/mfa': MFA, '/v1/auth/sessions': SESSIONS, '/v1/auth/devices': [] })

    const { container } = render(await AccountSecurityPage())

    expect(container.textContent).not.toMatch(/forgot|reset (your|my|the) password|email (you )?a link/i)
  })
})
