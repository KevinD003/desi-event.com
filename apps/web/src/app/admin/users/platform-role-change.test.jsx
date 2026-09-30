/**
 * Changing a platform role says what it does, and repeats the API's refusals.
 *
 * The properties worth pinning:
 *
 *   - nothing is sent until a different role and a reason are given, and the
 *     panel says the account is signed out everywhere — and, for a privileged
 *     role on an account with no second factor, that one must be set up;
 *   - it posts the role and the reason to the account's role route;
 *   - the last super administrator's refusal is the API's own sentence;
 *   - a step-up refusal offers the prompt, then sends the same request again;
 *   - the caller's own account is never offered.
 *
 * @module app/admin/users/platform-role-change.test
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { PlatformRoleChange } = await import('./platform-role-change.jsx')

const USER = 'usr00000000000000000002'

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  }
}

/**
 * An account as the search answers it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The account.
 */
function account(overrides = {}) {
  return {
    id: USER,
    email: 'ben@example.com',
    displayName: 'Ben',
    role: 'ATTENDEE',
    suspended: false,
    mfaEnrolled: false,
    self: false,
    memberships: [],
    ...overrides,
  }
}

/**
 * Open the panel, choose a role and give a reason.
 *
 * @param {object} user A userEvent instance.
 * @param {string} role The role to choose.
 * @param {string} reason The reason.
 * @returns {Promise<void>} Resolves once filled.
 */
async function choose(user, role, reason) {
  await user.click(screen.getByRole('button', { name: /Change .*platform role/u }))
  await user.selectOptions(screen.getByLabelText(/New platform role/u), role)
  await user.type(screen.getByLabelText(/Reason/u), reason)
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('changing a platform role', () => {
  it('says what saving does, then posts the role and the reason', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()

    apiFetch.mockResolvedValue(
      answer(200, {
        data: { userId: USER, from: 'ATTENDEE', role: 'MODERATOR', sessionsRevoked: 2 },
      }),
    )
    render(<PlatformRoleChange account={account()} onChanged={onChanged} />)

    await user.click(screen.getByRole('button', { name: 'Change Ben’s platform role' }))

    const save = screen.getByRole('button', { name: 'Change the role' })

    expect(save).toBeDisabled()

    await user.selectOptions(screen.getByLabelText(/New platform role/u), 'MODERATOR')
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText(/Reason/u), 'Joining the trust team')

    expect(screen.getByText(/Saving signs Ben out everywhere/u)).toBeVisible()
    expect(
      screen.getByText(/The Moderator role needs two-step sign-in, which Ben has not/u),
    ).toBeVisible()
    expect(save).toBeEnabled()

    await user.click(save)
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    expect(apiFetch.mock.calls[0][0]).toBe(`/v1/platform/users/${USER}/role`)
    expect(apiFetch.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      role: 'MODERATOR',
      reason: 'Joining the trust team',
    })

    const outcome = await screen.findByText(
      /Ben’s platform role is now Moderator\. All 2 of their sessions/u,
    )

    expect(outcome).toHaveAttribute('role', 'status')
    expect(onChanged).toHaveBeenCalledTimes(1)
    // The panel and its button are gone: focus goes back to the control that
    // opened it, which is drawn again only once the answer is in.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Change Ben’s platform role' })).toHaveFocus(),
    )
  })

  it('does not warn about a second factor the account already has', async () => {
    const user = userEvent.setup()

    render(<PlatformRoleChange account={account({ mfaEnrolled: true })} onChanged={vi.fn()} />)
    await choose(user, 'SUPPORT', 'Helps with orders')

    expect(screen.getByText(/Saving signs Ben out everywhere/u)).toBeVisible()
    expect(screen.queryByText(/needs two-step sign-in/u)).not.toBeInTheDocument()
  })

  it('will not offer the role the account already holds', async () => {
    const user = userEvent.setup()

    render(<PlatformRoleChange account={account({ role: 'SUPPORT' })} onChanged={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Change Ben’s platform role' }))

    expect(screen.getByRole('option', { name: 'Support (now)' })).toBeDisabled()
  })

  it('repeats the API’s sentence when the last super administrator would be demoted', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()

    apiFetch.mockResolvedValue(
      answer(422, {
        error: {
          code: 'LAST_SUPER_ADMIN',
          message: 'This is the only super administrator. Make somebody else one first.',
        },
      }),
    )
    render(
      <PlatformRoleChange
        account={account({ role: 'SUPER_ADMIN', mfaEnrolled: true })}
        onChanged={onChanged}
      />,
    )

    await choose(user, 'ATTENDEE', 'Stepping back')
    await user.click(screen.getByRole('button', { name: 'Change the role' }))

    expect(
      await screen.findByText(
        'This is the only super administrator. Make somebody else one first.',
      ),
    ).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('offers the step-up when the API asks for one, then sends the same change again', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(
        answer(403, {
          error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate at /v1/auth/step-up' },
        }),
      )
      .mockResolvedValueOnce(answer(200, { data: { ok: true } }))
      .mockResolvedValueOnce(
        answer(200, {
          data: { userId: USER, from: 'ATTENDEE', role: 'SUPPORT', sessionsRevoked: 0 },
        }),
      )
    render(<PlatformRoleChange account={account()} onChanged={vi.fn()} />)

    await choose(user, 'SUPPORT', 'Helps with orders')
    await user.click(screen.getByRole('button', { name: 'Change the role' }))

    expect(await screen.findByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()
    expect(screen.queryByText(/\/v1\/auth/u)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/Your password/u), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3))
    expect(apiFetch.mock.calls.map(([path]) => path)).toEqual([
      `/v1/platform/users/${USER}/role`,
      '/v1/auth/step-up',
      `/v1/platform/users/${USER}/role`,
    ])
    expect(JSON.parse(apiFetch.mock.calls[2][1].body)).toEqual({
      role: 'SUPPORT',
      reason: 'Helps with orders',
    })
    expect(
      await screen.findByText(/Ben’s platform role is now Support\. They had no session/u),
    ).toBeVisible()
  })

  it('offers nothing to change on the caller’s own account', () => {
    render(<PlatformRoleChange account={account({ self: true })} onChanged={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Change platform role' })).toBeDisabled()
    expect(screen.getByText(/Another super administrator must change/u)).toBeVisible()
  })
})
