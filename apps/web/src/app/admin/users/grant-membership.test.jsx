/**
 * Putting an account into an organisation, owner included.
 *
 * The properties worth pinning:
 *
 *   - organisations are found by name, and one with no owner says so;
 *   - every role is offered, Owner included, and the one the account already
 *     holds there is not;
 *   - the grant posts the account, the role and the reason to the
 *     organisation's members route, after the panel has said the account is
 *     signed out everywhere;
 *   - a step-up refusal offers the prompt, then sends the same grant again;
 *   - a refusal is the API's own sentence;
 *   - a suspended account is not offered a grant at all.
 *
 * @module app/admin/users/grant-membership.test
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { GrantMembership } = await import('./grant-membership.jsx')

const USER = 'usr00000000000000000002'
const ORPHAN = 'org00000000000000000009'
const RANGOLI = 'org00000000000000000001'

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
    role: 'ORGANIZER',
    suspended: false,
    mfaEnrolled: false,
    self: false,
    memberships: [{ organizationId: RANGOLI, organizationName: 'Rangoli', role: 'STAFF' }],
    ...overrides,
  }
}

/** The organisation search's answer. */
const ORGANIZATIONS = {
  data: [
    {
      id: ORPHAN,
      name: 'Garba Nights',
      slug: 'garba-nights',
      verificationStatus: 'VERIFIED',
      suspended: false,
      memberCount: 3,
      ownerCount: 0,
    },
    {
      id: RANGOLI,
      name: 'Rangoli',
      slug: 'rangoli',
      verificationStatus: 'PENDING',
      suspended: false,
      memberCount: 5,
      ownerCount: 1,
    },
  ],
  pagination: {
    page: 1,
    perPage: 20,
    total: 2,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
}

/** A grant's answer. */
const GRANTED = {
  data: {
    membershipId: 'mem00000000000000000001',
    organizationId: ORPHAN,
    userId: USER,
    role: 'OWNER',
    previousRole: null,
    created: true,
    sessionsRevoked: 1,
  },
}

/**
 * Open the panel and find organisations.
 *
 * @param {object} user A userEvent instance.
 * @returns {Promise<void>} Resolves once listed.
 */
async function findOrganizations(user) {
  await user.click(screen.getByRole('button', { name: 'Put Ben into an organisation' }))
  await user.type(screen.getByLabelText(/Organisation name or web address/u), 'garba')
  await user.click(screen.getByRole('button', { name: 'Find organisations' }))
  await screen.findByText('2 organisations found.')
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('putting an account into an organisation', () => {
  it('finds the organisation, offers Owner, and posts the grant', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()

    apiFetch
      .mockResolvedValueOnce(answer(200, ORGANIZATIONS))
      .mockResolvedValueOnce(answer(201, GRANTED))
    render(<GrantMembership account={account()} onChanged={onChanged} />)

    await findOrganizations(user)

    expect(apiFetch.mock.calls[0][0]).toBe('/v1/platform/organizations?q=garba&perPage=20')
    expect(screen.getByText(/Verified · 3 members · No owner/u)).toBeVisible()

    await user.click(screen.getByRole('radio', { name: /Garba Nights/u }))

    const roles = screen.getByLabelText(/Role in Garba Nights/u)

    expect(screen.getByRole('option', { name: 'Owner' })).toBeEnabled()
    expect(screen.getByText('Ben is not a member there.')).toBeVisible()

    const save = screen.getByRole('button', { name: 'Give them the role' })

    expect(save).toBeDisabled()

    await user.selectOptions(roles, 'OWNER')
    await user.type(screen.getByLabelText(/Reason/u), 'The only owner left the company')

    expect(screen.getByText(/Saving signs Ben out everywhere/u)).toBeVisible()
    expect(screen.getByText(/As an owner they can manage Garba Nights fully/u)).toBeVisible()
    expect(screen.getByText(/This role needs two-step sign-in, which Ben has not/u)).toBeVisible()

    await user.click(save)
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2))

    expect(apiFetch.mock.calls[1][0]).toBe(`/v1/platform/organizations/${ORPHAN}/members`)
    expect(apiFetch.mock.calls[1][1].method).toBe('POST')
    expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({
      userId: USER,
      role: 'OWNER',
      reason: 'The only owner left the company',
    })

    const outcome = await screen.findByText(/Ben is now owner of Garba Nights/u)

    expect(outcome).toHaveAttribute('role', 'status')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('will not offer the role the account already holds there', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, ORGANIZATIONS))
    render(<GrantMembership account={account()} onChanged={vi.fn()} />)

    await findOrganizations(user)
    await user.click(screen.getByRole('radio', { name: /Rangoli/u }))

    expect(screen.getByText('Ben is staff there now.')).toBeVisible()
    expect(screen.getByRole('option', { name: 'Staff (now)' })).toBeDisabled()
  })

  it('offers the step-up when the API asks for one, then sends the same grant again', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(200, ORGANIZATIONS))
      .mockResolvedValueOnce(
        answer(403, {
          error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate at /v1/auth/step-up' },
        }),
      )
      .mockResolvedValueOnce(answer(200, { data: { ok: true } }))
      .mockResolvedValueOnce(answer(201, GRANTED))
    render(<GrantMembership account={account({ mfaEnrolled: true })} onChanged={vi.fn()} />)

    await findOrganizations(user)
    await user.click(screen.getByRole('radio', { name: /Garba Nights/u }))
    await user.selectOptions(screen.getByLabelText(/Role in Garba Nights/u), 'OWNER')
    await user.type(screen.getByLabelText(/Reason/u), 'The only owner left')
    await user.click(screen.getByRole('button', { name: 'Give them the role' }))

    expect(await screen.findByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()
    expect(screen.queryByText(/\/v1\/auth/u)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/Your password/u), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(4))
    expect(apiFetch.mock.calls.slice(1).map(([path]) => path)).toEqual([
      `/v1/platform/organizations/${ORPHAN}/members`,
      '/v1/auth/step-up',
      `/v1/platform/organizations/${ORPHAN}/members`,
    ])
    expect(await screen.findByText(/Ben is now owner of Garba Nights/u)).toBeVisible()
  })

  it('repeats the API’s sentence when it refuses', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()

    apiFetch.mockResolvedValueOnce(answer(200, ORGANIZATIONS)).mockResolvedValueOnce(
      answer(422, {
        error: {
          code: 'UNPROCESSABLE',
          message: 'This is the only owner. Make somebody else an owner first.',
        },
      }),
    )
    render(<GrantMembership account={account()} onChanged={onChanged} />)

    await findOrganizations(user)
    await user.click(screen.getByRole('radio', { name: /Rangoli/u }))
    await user.selectOptions(screen.getByLabelText(/Role in Rangoli/u), 'VIEWER')
    await user.type(screen.getByLabelText(/Reason/u), 'Asked to step back')
    await user.click(screen.getByRole('button', { name: 'Give them the role' }))

    expect(
      await screen.findByText('This is the only owner. Make somebody else an owner first.'),
    ).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('offers no grant to a suspended account, and says why', () => {
    render(<GrantMembership account={account({ suspended: true })} onChanged={vi.fn()} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/This account is suspended/u)).toBeVisible()
  })

  it('offers no grant on the caller’s own account, which the API always refuses, and says why', () => {
    render(<GrantMembership account={account({ self: true })} onChanged={vi.fn()} />)

    const control = screen.getByRole('button', { name: 'Put Ben into an organisation' })

    expect(control).toBeDisabled()
    expect(control).toHaveAccessibleDescription(/This is your own account/u)
    expect(apiFetch).not.toHaveBeenCalled()
  })
})
