/**
 * Switching a referral code off or on (SPEC3 §12.5): off with an optional
 * reason of at least 10 characters and no second factor; on with one when the
 * server asks; an expired code's refusal in the API's words; each outcome said
 * once.
 *
 * @module app/admin/referral-codes/referral-code-switch.test
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('../../../components/step-up-prompt.jsx', () => ({
  StepUpPrompt: ({ action, onConfirmed }) => (
    <div role="group" aria-label="Confirm it is you">
      <button type="button" onClick={onConfirmed}>
        Confirm to {action}
      </button>
    </div>
  ),
}))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { ReferralCodeSwitch, SWITCHED_OFF, SWITCHED_ON, SWITCH_OFF_REASON_HINT } =
  await import('./referral-code-switch.jsx')

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body) {
  return { ok: status < 300, status, headers: new Headers(), json: async () => body }
}

const CODE = { id: 'cref00000000000000000001', active: true }

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('ReferralCodeSwitch', () => {
  it('switches a code off with no reason and no second factor, and says what that leaves', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, { data: { ...CODE, active: false } }))
    render(<ReferralCodeSwitch code={CODE} />)

    expect(screen.getByLabelText('Reason (optional)')).toHaveAccessibleDescription(
      expect.stringContaining(SWITCH_OFF_REASON_HINT),
    )
    await user.click(screen.getByRole('button', { name: 'Switch off' }))

    expect(await screen.findByRole('status')).toHaveTextContent(SWITCHED_OFF)
    expect(apiFetch).toHaveBeenCalledWith(
      '/v1/platform/referral-codes/cref00000000000000000001/switch-off',
      { method: 'POST', body: '{}' },
    )
    expect(screen.getByRole('button', { name: 'Switch on' })).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('moves focus to the button drawn in place of the one pressed, switching off and back on', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: { ...CODE, active: false } }))
      .mockResolvedValueOnce(answer(200, { data: { ...CODE, active: true } }))
    render(<ReferralCodeSwitch code={CODE} />)

    await user.click(screen.getByRole('button', { name: 'Switch off' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Switch on' })).toHaveFocus())

    await user.click(screen.getByRole('button', { name: 'Switch on' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Switch off' })).toHaveFocus())
    expect(screen.getByRole('status')).toHaveTextContent(SWITCHED_ON)
  })

  it('refuses a reason shorter than 10 characters, and sends a longer one', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, { data: { ...CODE, active: false } }))
    render(<ReferralCodeSwitch code={CODE} />)

    const reason = screen.getByLabelText('Reason (optional)')

    await user.type(reason, 'too short')
    await user.click(screen.getByRole('button', { name: 'Switch off' }))

    expect(screen.getByText('Give a reason of at least 10 characters.')).toBeInTheDocument()
    await waitFor(() => expect(reason).toHaveFocus())
    expect(apiFetch).not.toHaveBeenCalled()

    await user.type(reason, ' — the partner ended')
    await user.click(screen.getByRole('button', { name: 'Switch off' }))

    await screen.findByText(SWITCHED_OFF)
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      reason: 'too short — the partner ended',
    })
  })

  it('switches a code on with a second factor when the server asks', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(
        answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Step up.' } }),
      )
      .mockResolvedValueOnce(answer(200, { data: { ...CODE, active: true } }))
    render(<ReferralCodeSwitch code={{ ...CODE, active: false }} />)

    await user.click(screen.getByRole('button', { name: 'Switch on' }))
    await user.click(
      await screen.findByRole('button', { name: 'Confirm to switch this referral code on' }),
    )

    expect(await screen.findByText(SWITCHED_ON)).toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledTimes(2)
    expect(apiFetch.mock.calls[1][0]).toBe(
      '/v1/platform/referral-codes/cref00000000000000000001/switch-on',
    )
  })

  it('gives an expired code’s refusal in the API’s words, and takes focus there', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(409, {
        error: {
          code: 'REFERRAL_CODE_EXPIRED',
          message: "This code's expiry has passed. Change its expiry first, or make a new code.",
        },
      }),
    )
    render(<ReferralCodeSwitch code={{ ...CODE, active: false }} />)

    await user.click(screen.getByRole('button', { name: 'Switch on' }))

    const refusal = await screen.findByText(
      "This code's expiry has passed. Change its expiry first, or make a new code.",
    )

    await waitFor(() => expect(refusal.closest('[tabindex="-1"]')).toHaveFocus())
    expect(screen.queryByText(SWITCHED_ON)).toBeNull()
  })
})
