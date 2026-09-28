/**
 * The verification request sends a note and a legal name, and never a state.
 *
 * @module app/organizer/organization/verification-request-form.test
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { VerificationRequestForm } = await import('./verification-request-form.jsx')

const ORG = 'org00000000000000000001'

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

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('the verification request', () => {
  it('sends the legal name and the note, and no state', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { status: 'PENDING' } }))
    render(<VerificationRequestForm organizationId={ORG} status="UNVERIFIED" />)

    await user.type(screen.getByLabelText(/Registered legal name/u), 'Bay Lights LLC')
    await user.type(screen.getByLabelText(/A note for the moderator/u), 'Four nights a year.')
    await user.click(screen.getByRole('button', { name: 'Ask for verification' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(apiFetch.mock.calls[0][0]).toBe(`/v1/organizations/${ORG}/verification`)
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      legalName: 'Bay Lights LLC',
      note: 'Four nights a year.',
    })
    expect(await screen.findByText(/It is waiting for a moderator/u)).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('requires the answer when a moderator asked for more information', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { status: 'PENDING' } }))
    render(<VerificationRequestForm organizationId={ORG} status="REQUIRES_INFORMATION" />)

    const send = screen.getByRole('button', { name: 'Send the answer' })

    expect(send).toBeDisabled()

    await user.type(screen.getByLabelText(/Your answer to the moderator/u), 'Here it is.')

    expect(send).toBeEnabled()
  })

  it('repeats the API’s sentence when it refuses', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: {
          code: 'VERIFICATION_INVALID_TRANSITION',
          message: 'An organisation in PENDING can only move to REQUIRES_INFORMATION.',
        },
      }),
    )
    render(<VerificationRequestForm organizationId={ORG} status="UNVERIFIED" />)

    await user.click(screen.getByRole('button', { name: 'Ask for verification' }))

    expect(await screen.findByText(/can only move to/u)).toBeInTheDocument()
  })
})
