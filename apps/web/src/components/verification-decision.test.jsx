/**
 * A moderator's verification decision: what is offered, what is required,
 * and what happens when the API asks for a second factor.
 *
 * @module components/verification-decision.test
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { VerificationDecision } = await import('./verification-decision.jsx')

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

/**
 * Render the form for a state.
 *
 * @param {string} status The verification state.
 * @returns {object} The render result.
 */
function draw(status) {
  return render(
    <VerificationDecision organizationId={ORG} organizationName="Bay Lights" status={status} />,
  )
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('the verification decision', () => {
  it.each([
    ['PENDING', ['Ask for more information', 'Verify', 'Reject']],
    ['REQUIRES_INFORMATION', ['Reject']],
    ['VERIFIED', ['Suspend', 'Revoke']],
    ['SUSPENDED', ['Verify', 'Revoke']],
  ])('offers from %s exactly the decisions the API allows', (status, labels) => {
    draw(status)

    const offered = screen.getByRole('group', { name: 'Decisions' }).querySelectorAll('button')

    expect([...offered].map((button) => button.textContent)).toEqual(labels)
  })

  it('offers nothing from a state only the organiser can move', () => {
    draw('REJECTED')

    expect(screen.queryByRole('group', { name: 'Decisions' })).not.toBeInTheDocument()
    expect(screen.getByText(/No decision is open to a moderator from here/u)).toBeVisible()
  })

  it('needs a reason, and a note when asking for information', async () => {
    const user = userEvent.setup()

    draw('PENDING')
    await user.click(screen.getByRole('button', { name: 'Ask for more information' }))

    const record = screen.getByRole('button', { name: 'Record: ask for more information' })

    expect(record).toBeDisabled()

    await user.type(screen.getByLabelText(/^Reason/u), 'Need the registered name.')

    expect(record).toBeDisabled()

    await user.type(screen.getByLabelText(/What they need to send/u), 'The LLC filing.')

    expect(record).toBeEnabled()
  })

  it('sends the decision, and after a step-up sends it again', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(
        answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate at /v1/auth' } }),
      )
      .mockResolvedValueOnce(answer(200, { data: { ok: true } }))
      .mockResolvedValueOnce(answer(200, { data: { status: 'VERIFIED' } }))
    draw('PENDING')

    await user.click(screen.getByRole('button', { name: 'Verify' }))
    await user.type(screen.getByLabelText(/^Reason/u), 'Registry checked.')
    await user.click(screen.getByRole('button', { name: 'Record: verify' }))

    expect(await screen.findByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()
    expect(screen.queryByText(/\/v1\/auth/u)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/Your password/u), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3))
    expect(apiFetch.mock.calls.map(([path]) => path)).toEqual([
      `/v1/organizations/${ORG}/verification/decision`,
      '/v1/auth/step-up',
      `/v1/organizations/${ORG}/verification/decision`,
    ])
    expect(JSON.parse(apiFetch.mock.calls[2][1].body)).toEqual({
      decision: 'VERIFIED',
      reason: 'Registry checked.',
    })
    expect(await screen.findByText('Recorded: verify Bay Lights.')).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('shows the API’s sentence on a conflict and reads the page again', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: {
          code: 'VERIFICATION_CONCURRENT_CHANGE',
          message:
            'This organisation was changed while you were looking at it. Reload and try again.',
        },
      }),
    )
    draw('PENDING')

    await user.click(screen.getByRole('button', { name: 'Reject' }))
    await user.type(screen.getByLabelText(/^Reason/u), 'No evidence.')
    await user.click(screen.getByRole('button', { name: 'Record: reject' }))

    expect(await screen.findByText(/changed while you were looking/u)).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })
})

describe('where focus goes when the decision panel closes', () => {
  it('returns to the decision that opened it when it is cancelled', async () => {
    const user = userEvent.setup()

    draw('PENDING')

    await user.click(screen.getByRole('button', { name: 'Reject' }))
    expect(screen.getByRole('group', { name: /^Reject: Bay Lights/u })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('group', { name: /^Reject: Bay Lights/u })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reject' })).toHaveFocus()
  })

  it('moves to the outcome once recorded, and keeps saying it when nothing is left to decide', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, { data: { status: 'REJECTED' } }))
    const { rerender } = draw('PENDING')

    await user.click(screen.getByRole('button', { name: 'Reject' }))
    await user.type(screen.getByLabelText(/^Reason/u), 'No evidence.')
    await user.click(screen.getByRole('button', { name: 'Record: reject' }))

    const outcome = await screen.findByText('Recorded: reject Bay Lights.')

    await waitFor(() => expect(outcome).toHaveFocus())

    // The refresh brings the new state, from which no moderator decision is
    // open; the sentence and the focus on it survive that.
    rerender(
      <VerificationDecision organizationId={ORG} organizationName="Bay Lights" status="REJECTED" />,
    )

    expect(screen.getByText('Recorded: reject Bay Lights.')).toHaveFocus()
    expect(screen.getByText(/No decision is open to a moderator from here/u)).toBeVisible()
  })
})
