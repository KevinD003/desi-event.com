import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { RestoreEventDialog } = await import('./restore-event-dialog.jsx')

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const EVENT = {
  id: 'cevent0000000000000000001',
  title: 'Diwali Mela',
  revision: 9,
  deletion: {
    deletedAt: '2026-10-01T10:00:00.000Z',
    reason: 'Deleted by mistake, the organiser asked for it back.',
    outcome: 'REMOVE',
    authority: 'ORGANIZATION',
    statusBefore: 'ON_SALE',
    restoreTo: 'SALES_PAUSED',
    deletedByName: null,
  },
}
const REASON = 'The organiser deleted it by mistake and asked for it back.'

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('RestoreEventDialog', () => {
  it('says an on-sale event comes back paused, and sends the reason with the revision', async () => {
    apiFetch.mockResolvedValueOnce(answer(200, { data: { id: EVENT.id, status: 'SALES_PAUSED' } }))
    const user = userEvent.setup()

    render(<RestoreEventDialog event={EVENT} />)
    await user.click(screen.getByRole('button', { name: 'Restore…' }))

    expect(screen.getByRole('heading', { name: 'Restore “Diwali Mela”' })).toHaveFocus()
    expect(
      screen.getByText('It comes back paused: the organiser reopens sales.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Shown with the event's history\. Do not include anybody's personal details\./,
      ),
    ).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Why is this event being restored/), REASON)
    await user.click(screen.getByRole('button', { name: 'Restore this event' }))

    expect(await screen.findByText('It is sales paused now.')).toBeVisible()
    expect(refresh).toHaveBeenCalled()

    const [path, options] = apiFetch.mock.calls[0]

    expect(path).toBe(`/v1/platform/events/${EVENT.id}/restore`)
    expect(JSON.parse(options.body)).toEqual({ revision: 9, reason: REASON })
  })

  it('refuses a short reason before sending anything', async () => {
    const user = userEvent.setup()

    render(<RestoreEventDialog event={EVENT} />)
    await user.click(screen.getByRole('button', { name: 'Restore…' }))
    await user.type(screen.getByLabelText(/Why is this event being restored/), 'oops')
    await user.click(screen.getByRole('button', { name: 'Restore this event' }))

    expect(await screen.findByText('Give a reason of at least 10 characters.')).toBeVisible()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('asks for the second factor when the server does, then restores', async () => {
    apiFetch.mockImplementation(async (path) => {
      if (path === '/v1/auth/step-up') return answer(200, { data: {} })

      return apiFetch.mock.calls.filter(([called]) => called.endsWith('/restore')).length === 1
        ? answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Again.' } })
        : answer(200, { data: { id: EVENT.id, status: 'SALES_PAUSED' } })
    })
    const user = userEvent.setup()

    render(<RestoreEventDialog event={EVENT} />)
    await user.click(screen.getByRole('button', { name: 'Restore…' }))
    await user.type(screen.getByLabelText(/Why is this event being restored/), REASON)
    await user.click(screen.getByRole('button', { name: 'Restore this event' }))
    await user.type(await screen.findByLabelText(/Your password/), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('It is sales paused now.')).toBeVisible()
  })

  it('shows the server’s refusal, and returns focus to its opener on cancelling', async () => {
    apiFetch.mockResolvedValueOnce(
      answer(409, {
        error: {
          code: 'ORGANIZER_NOT_VERIFIED',
          message: 'The organisation is suspended, so the event cannot come back public.',
        },
      }),
    )
    const user = userEvent.setup()

    render(<RestoreEventDialog event={EVENT} />)
    await user.click(screen.getByRole('button', { name: 'Restore…' }))
    await user.type(screen.getByLabelText(/Why is this event being restored/), REASON)
    await user.click(screen.getByRole('button', { name: 'Restore this event' }))

    expect(await screen.findByText(/organisation is suspended/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore…' })).toHaveFocus())
  })
})
