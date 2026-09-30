/**
 * Accepting an invitation code: what is sent, what is kept, what is said.
 *
 * @module app/account/invitations/invitation-accept-form.test
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { CODE_STILL_GOOD, InvitationAcceptForm, UNUSABLE_CODE } =
  await import('./invitation-accept-form.jsx')

const CODE = 'Ab3_dE6-gH9iJ2kL5mN8oP1qR4sT7uV0wX3yZ6aB9cD'

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @param {object} [headers] Response headers.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  }
}

/**
 * The success body.
 *
 * @param {object} session What the session now needs.
 * @param {boolean} [gained] Whether the account joined, or already belonged.
 * @returns {object} The body.
 */
function joined(session, gained = true) {
  return {
    data: {
      organizationId: 'org00000000000000000001',
      organizationName: 'Rangoli Collective',
      role: 'ADMIN',
      joined: gained,
      session,
    },
  }
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('the invitation accept form', () => {
  it('is a hidden, non-autocompleting field that says why a part of a code is not sent', async () => {
    const user = userEvent.setup()

    render(<InvitationAcceptForm />)

    const field = screen.getByLabelText(/Invitation code/u)
    const join = screen.getByRole('button', { name: 'Join the organisation' })

    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('autocomplete', 'off')
    // Never a greyed button with no reason: it can be pressed, and says why
    // nothing was sent.
    expect(join).toBeEnabled()

    await user.click(join)

    expect(field).toHaveAccessibleDescription(/Type or paste the invitation code first\./u)
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveFocus()

    // A truncated paste: the field hides it, so the sentence says what is wrong.
    await user.type(field, 'short')

    expect(field).not.toHaveAttribute('aria-invalid')
    expect(join).toBeEnabled()

    await user.click(join)

    expect(field).toHaveAccessibleDescription(
      /That is shorter than any invitation code, so part of it is missing\. Paste the whole code again\./u,
    )
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveFocus()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('sends the code, clears it, and says where the account now is', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, joined({ mfaRequired: false, mfaEnrolled: false })))

    const { container } = render(<InvitationAcceptForm />)

    await user.type(screen.getByLabelText(/Invitation code/u), CODE)
    await user.click(screen.getByRole('button', { name: 'Join the organisation' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(apiFetch.mock.calls[0][0]).toBe('/v1/invitations/accept')
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ token: CODE })

    expect(
      await screen.findByText(/You are now in Rangoli Collective as administrator/u),
    ).toBeInTheDocument()
    expect(container.innerHTML).not.toContain(CODE)
    expect(screen.queryByRole('link', { name: 'Set up two-step sign-in' })).not.toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('sends a newly privileged account to set up two-step sign-in', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, joined({ mfaRequired: true, mfaEnrolled: false })))
    render(<InvitationAcceptForm />)

    await user.type(screen.getByLabelText(/Invitation code/u), CODE)
    await user.click(screen.getByRole('button', { name: 'Join the organisation' }))

    expect(await screen.findByRole('link', { name: 'Set up two-step sign-in' })).toHaveAttribute(
      'href',
      '/account/security',
    )
  })

  it.each([
    [403, 'FORBIDDEN', 'This invitation was sent to a different address.'],
    [403, 'FORBIDDEN', 'This invitation is not valid any more. Ask for a new one.'],
    [409, 'CONFLICT', 'This invitation has already been accepted.'],
  ])('says one sentence for every unusable code (%s)', async (status, code, message) => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(status, { error: { code, message } }))
    render(<InvitationAcceptForm />)

    await user.type(screen.getByLabelText(/Invitation code/u), CODE)
    await user.click(screen.getByRole('button', { name: 'Join the organisation' }))

    expect(await screen.findByText(UNUSABLE_CODE)).toBeInTheDocument()
    expect(screen.queryByText(message)).not.toBeInTheDocument()
  })

  it('moves focus to what joining did, since the form and its button are gone', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, joined({ mfaRequired: false, mfaEnrolled: false })))
    render(<InvitationAcceptForm />)

    await user.type(screen.getByLabelText(/Invitation code/u), CODE)
    await user.click(screen.getByRole('button', { name: 'Join the organisation' }))

    const panel = (await screen.findByText(/You are now in Rangoli Collective/u)).closest(
      '[tabindex="-1"]',
    )

    expect(panel).not.toBeNull()
    await waitFor(() => expect(panel).toHaveFocus())
  })

  it('never says other sessions ended when the account already belonged', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, joined({ mfaRequired: true, mfaEnrolled: true }, false)))
    render(<InvitationAcceptForm />)

    await user.type(screen.getByLabelText(/Invitation code/u), CODE)
    await user.click(screen.getByRole('button', { name: 'Join the organisation' }))

    expect(await screen.findByText('You were already a member')).toBeInTheDocument()
    expect(
      screen.getByText(/You already belong to Rangoli Collective as administrator/u),
    ).toBeInTheDocument()
    expect(screen.queryByText(/sessions have ended/u)).not.toBeInTheDocument()
    expect(screen.queryByText('You have joined')).not.toBeInTheDocument()
  })

  it('tells an account that needs two-step sign-in first that, and not that the code is dead', async () => {
    // The enrolment guard refuses every workspace route before the code is
    // looked at. Calling this an unusable code sent people to ask for a new
    // one, and a new code stops the one that works.
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(403, {
        error: {
          code: 'MFA_ENROLMENT_REQUIRED',
          message: 'Enrol one at /v1/auth/mfa/totp before continuing.',
        },
      }),
    )
    render(<InvitationAcceptForm />)

    const field = screen.getByLabelText(/Invitation code/u)

    await user.type(field, CODE)
    await user.click(screen.getByRole('button', { name: 'Join the organisation' }))

    expect(await screen.findByText(/needs a second factor/u)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(CODE_STILL_GOOD.slice(0, 30), 'u'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set up two-step sign-in' })).toHaveAttribute(
      'href',
      '/account/security',
    )
    expect(screen.queryByText(UNUSABLE_CODE)).not.toBeInTheDocument()
    expect(screen.queryByText(/\/v1\/auth/u)).not.toBeInTheDocument()
    // Kept, so it can be entered again once the factor is set up.
    expect(field).toHaveValue(CODE)
  })

  it('says how long to wait when rate limited', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(429, { error: { code: 'RATE_LIMITED' } }, { 'retry-after': '120' }),
    )
    render(<InvitationAcceptForm />)

    await user.type(screen.getByLabelText(/Invitation code/u), CODE)
    await user.click(screen.getByRole('button', { name: 'Join the organisation' }))

    expect(await screen.findByText(/Wait about 2 minutes/u)).toBeInTheDocument()
    // The refusal takes focus, so it is read out where the person is.
    await waitFor(() =>
      expect(screen.getByText(/Wait about 2 minutes/u).closest('[tabindex="-1"]')).toHaveFocus(),
    )
  })
})
