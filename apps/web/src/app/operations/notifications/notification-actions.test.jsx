/**
 * Retrying and withdrawing a message: a reason, the step-up when the server
 * asks, and a plain sentence when the message moved on.
 *
 * The properties worth pinning:
 *
 *   - **A reason of four characters or more** before anything is sent.
 *   - **The step-up path**: a `STEP_UP_REQUIRED` refusal draws the prompt, and
 *     once it is confirmed the same action is sent again — not a dead end, and
 *     not a different action.
 *   - **409 says the message moved on**, with the API's own reason, and offers
 *     a reload — except for `REDACTED`, which is not a race: reloading would
 *     draw the same button, so it gets the API's sentence and no reload.
 *
 * @module app/operations/notifications/notification-actions.test
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { NotificationActions } = await import('./notification-actions.jsx')

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
 * Draw the panel for a message in a status.
 *
 * @param {string} status The status.
 * @param {boolean} [leaseLapsed] For a claimed message.
 * @returns {object} The render result.
 */
function draw(status, leaseLapsed = false) {
  return render(
    <NotificationActions notification={{ id: 'n1', status }} leaseLapsed={leaseLapsed} />,
  )
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('sending', () => {
  it('will not send without a reason of four characters, then sends it to the retry route', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { id: 'n1', status: 'QUEUED' } }))
    draw('DEAD_LETTER')

    await user.click(screen.getByRole('button', { name: 'Put it back in the queue' }))

    const submit = screen.getByRole('button', { name: 'Put it back in the queue' })

    await user.type(screen.getByRole('textbox', { name: /Why/u }), 'fix')
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(apiFetch).not.toHaveBeenCalled()

    await user.type(screen.getByRole('textbox', { name: /Why/u }), 'ed the template')
    await user.click(submit)

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(apiFetch.mock.calls[0][0]).toBe('/v1/operations/notifications/n1/retry')
    expect(apiFetch.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ reason: 'fixed the template' })
    expect(await screen.findByText(/Back in the queue/u)).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('withdraws a claimed message only when told its lease lapsed', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { id: 'n1', status: 'CANCELLED' } }))
    draw('CLAIMED', true)

    expect(screen.queryByRole('button', { name: 'Put it back in the queue' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Withdraw it' }))
    await user.type(screen.getByRole('textbox', { name: /Why/u }), 'worker died mid-send')
    await user.click(screen.getByRole('button', { name: 'Withdraw it' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(apiFetch.mock.calls[0][0]).toBe('/v1/operations/notifications/n1/cancel')
  })
})

describe('the step-up path', () => {
  it('offers the prompt on STEP_UP_REQUIRED, then sends the same action again', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(
        answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate at /v1/auth' } }),
      )
      .mockResolvedValueOnce(answer(200, { data: { ok: true } }))
      .mockResolvedValueOnce(answer(200, { data: { id: 'n1', status: 'CANCELLED' } }))

    draw('FAILED')

    await user.click(screen.getByRole('button', { name: 'Withdraw it' }))
    await user.type(screen.getByRole('textbox', { name: /Why/u }), 'never to be sent')
    await user.click(screen.getByRole('button', { name: 'Withdraw it' }))

    expect(await screen.findByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()
    expect(screen.queryByText(/\/v1\/auth/u)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/Your password/u), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3))

    const paths = apiFetch.mock.calls.map(([path]) => path)

    expect(paths).toEqual([
      '/v1/operations/notifications/n1/cancel',
      '/v1/auth/step-up',
      '/v1/operations/notifications/n1/cancel',
    ])
    expect(JSON.parse(apiFetch.mock.calls[2][1].body)).toEqual({ reason: 'never to be sent' })
    expect(await screen.findByText('Withdrawn. It will not be sent.')).toBeInTheDocument()
  })
})

describe('refusals', () => {
  it('says the message moved on when the API answers 409, with its reason and a reload', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: {
          code: 'CONFLICT',
          reason: 'CHANGED',
          message: 'Somebody else changed this message while you were looking at it.',
        },
      }),
    )
    draw('RETRY_SCHEDULED')

    await user.click(screen.getByRole('button', { name: 'Put it back in the queue' }))
    await user.type(screen.getByRole('textbox', { name: /Why/u }), 'provider is back up')
    await user.click(screen.getByRole('button', { name: 'Put it back in the queue' }))

    expect(
      await screen.findByText('The notification moved on while you were looking; reload.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Somebody else changed this message/u)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reload this message' }))
    expect(refresh).toHaveBeenCalled()
  })

  it('treats a redacted message as settled, not as a race, and offers no reload', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: {
          code: 'CONFLICT',
          reason: 'REDACTED',
          message: 'This message was redacted for privacy. There is nobody left to send it to.',
        },
      }),
    )
    draw('DEAD_LETTER')

    await user.click(screen.getByRole('button', { name: 'Put it back in the queue' }))
    await user.type(screen.getByRole('textbox', { name: /Why/u }), 'provider is back up')
    await user.click(screen.getByRole('button', { name: 'Put it back in the queue' }))

    expect(await screen.findByText(/redacted for privacy/u)).toBeInTheDocument()
    expect(screen.getByText('Nothing was changed')).toBeInTheDocument()
    expect(
      screen.queryByText('The notification moved on while you were looking; reload.'),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload this message' })).not.toBeInTheDocument()
  })

  it('says a status that changed underneath the page moved on, with a reload', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: {
          code: 'CONFLICT',
          reason: 'NOT_CANCELLABLE',
          message: 'A sent message cannot be withdrawn.',
        },
      }),
    )
    draw('QUEUED')

    await user.click(screen.getByRole('button', { name: 'Withdraw it' }))
    await user.type(screen.getByRole('textbox', { name: /Why/u }), 'never to be sent')
    await user.click(screen.getByRole('button', { name: 'Withdraw it' }))

    expect(
      await screen.findByText('The notification moved on while you were looking; reload.'),
    ).toBeInTheDocument()
    expect(screen.getByText('A sent message cannot be withdrawn.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload this message' })).toBeInTheDocument()
  })

  it('says nothing reached the service when the request never arrived', async () => {
    const user = userEvent.setup()

    apiFetch.mockRejectedValue(new TypeError('offline'))
    draw('DEAD_LETTER')

    await user.click(screen.getByRole('button', { name: 'Put it back in the queue' }))
    await user.type(screen.getByRole('textbox', { name: /Why/u }), 'provider is back up')
    await user.click(screen.getByRole('button', { name: 'Put it back in the queue' }))

    expect(await screen.findByText(/Nothing reached Desi-Event/u)).toBeInTheDocument()
  })
})
