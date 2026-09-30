/**
 * The step-up prompt says why it did not confirm, and puts focus on the reason.
 *
 * The refusal is drawn only once the API has answered — after an `await` — so
 * these pin that focus reaches it rather than falling to the page while the
 * Confirm button is disabled.
 *
 * @module components/step-up-prompt.test
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { StepUpPrompt } = await import('./step-up-prompt.jsx')

/**
 * A response as `apiFetch` returns it.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The body.
 * @returns {object} The response.
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
 * Type a password and confirm.
 *
 * @param {object} user A userEvent instance.
 * @returns {Promise<void>} Resolves once pressed.
 */
async function confirm(user) {
  await user.type(screen.getByLabelText(/Your password/u), 'correct horse')
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('the step-up prompt', () => {
  it('calls back once the second factor is accepted, and shows no refusal', async () => {
    const user = userEvent.setup()
    const onConfirmed = vi.fn()

    apiFetch.mockResolvedValue(answer(200, { data: {} }))
    render(
      <StepUpPrompt action="approve this event" onConfirmed={onConfirmed} onCancel={vi.fn()} />,
    )

    await confirm(user)

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Not confirmed')).not.toBeInTheDocument()
  })

  it('moves focus to the refusal, which is drawn only once the answer is in', async () => {
    const user = userEvent.setup()
    const onConfirmed = vi.fn()

    apiFetch.mockResolvedValue(
      answer(401, { error: { code: 'INVALID_CREDENTIALS', message: 'That password is wrong.' } }),
    )
    render(
      <StepUpPrompt action="approve this event" onConfirmed={onConfirmed} onCancel={vi.fn()} />,
    )

    await confirm(user)

    const refusal = (await screen.findByText('That password is wrong.')).closest('[tabindex="-1"]')

    expect(refusal).not.toBeNull()
    await waitFor(() => expect(refusal).toHaveFocus())
    expect(onConfirmed).not.toHaveBeenCalled()
  })

  it('moves focus to the refusal when the service does not answer', async () => {
    const user = userEvent.setup()

    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<StepUpPrompt action="approve this event" onConfirmed={vi.fn()} onCancel={vi.fn()} />)

    await confirm(user)

    const refusal = (await screen.findByText(/The service is not responding/u)).closest(
      '[tabindex="-1"]',
    )

    expect(refusal).not.toBeNull()
    await waitFor(() => expect(refusal).toHaveFocus())
  })
})
