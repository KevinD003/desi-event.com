import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { PromoCodeActions, deleteRefusal } = await import('./promo-code-actions.jsx')
const { OutcomeAnnouncer } = await import('./outcome-announcer.jsx')

const ORGANIZATION = 'orgmirrorwork'
const BASE = `/v1/organizations/${ORGANIZATION}/promo-codes/prsave10xxxxx`

/**
 * A code as the table passes it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The code.
 */
function code(overrides = {}) {
  return {
    id: 'prsave10xxxxx',
    code: 'SAVE10',
    status: 'ACTIVE',
    active: true,
    redemptionCount: 0,
    ordersCount: 0,
    ...overrides,
  }
}

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

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('why a code cannot be deleted', () => {
  it('is that somebody used it, or an order names it', () => {
    expect(deleteRefusal(code())).toBeNull()
    expect(deleteRefusal(code({ redemptionCount: 1 }))).toBe(
      'Used 1 time, so it can be paused but not deleted.',
    )
    expect(deleteRefusal(code({ redemptionCount: 3 }))).toBe(
      'Used 3 times, so it can be paused but not deleted.',
    )
    expect(deleteRefusal(code({ ordersCount: 1 }))).toBe(
      'An order names this code, so it can be paused but not deleted.',
    )
  })
})

describe('pausing', () => {
  it('pauses a live code in one click and says what that means', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, { data: code({ active: false, status: 'PAUSED' }) }))
    render(<PromoCodeActions organizationId={ORGANIZATION} code={code()} />)

    await user.click(screen.getByRole('button', { name: 'Pause SAVE10' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/pause`, { method: 'POST' })
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('status')).toHaveTextContent(
      'SAVE10 is paused. Orders already placed keep their discount.',
    )
  })
})

describe('resuming', () => {
  it('asks for a second factor when the API does, then resumes', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm your identity.' } }),
    )
    render(
      <PromoCodeActions
        organizationId={ORGANIZATION}
        code={code({ active: false, status: 'PAUSED' })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Resume SAVE10' }))

    expect(await screen.findByText(/Confirm your identity to resume SAVE10\./u)).toBeInTheDocument()

    apiFetch.mockResolvedValueOnce(answer(200, { ok: true }))
    apiFetch.mockResolvedValueOnce(answer(200, { data: code() }))

    await user.type(screen.getByLabelText(/your password/iu), 'not-a-real-password-for-a-test')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3))
    expect(apiFetch.mock.calls[1][0]).toBe('/v1/auth/step-up')
    expect(apiFetch.mock.calls[2]).toEqual([`${BASE}/resume`, { method: 'POST' }])
    expect(await screen.findByText('SAVE10 is live again.')).toBeInTheDocument()
  })

  it('repeats the API’s refusal for a code whose window has ended', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(409, {
        error: {
          code: 'PROMO_ENDED',
          message: 'This code has ended, so it cannot be resumed. Make a new one instead.',
        },
      }),
    )
    render(
      <PromoCodeActions
        organizationId={ORGANIZATION}
        code={code({ active: false, status: 'PAUSED' })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Resume SAVE10' }))

    expect(
      await screen.findByText(
        'This code has ended, so it cannot be resumed. Make a new one instead.',
      ),
    ).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('offers no resume for a paused code whose window has ended', () => {
    // As the API reports it: paused is said before ended, so the end is read.
    render(
      <PromoCodeActions
        organizationId={ORGANIZATION}
        code={code({ active: false, status: 'PAUSED', endsAt: '2026-09-01T00:00:00.000Z' })}
        now={new Date('2026-10-01T00:00:00.000Z')}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Resume SAVE10' })).toBeNull()
    expect(
      screen.getByText('Its window has ended, so it cannot be resumed. Make a new code instead.'),
    ).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('still offers resume for a paused code whose window is open', () => {
    render(
      <PromoCodeActions
        organizationId={ORGANIZATION}
        code={code({ active: false, status: 'PAUSED', endsAt: '2026-12-01T00:00:00.000Z' })}
        now={new Date('2026-10-01T00:00:00.000Z')}
      />,
    )

    expect(screen.getByRole('button', { name: 'Resume SAVE10' })).toBeInTheDocument()
    expect(screen.queryByText(/Its window has ended/u)).toBeNull()
  })

  it('lets a live code whose window ended be paused, and says it cannot come back', () => {
    render(
      <PromoCodeActions
        organizationId={ORGANIZATION}
        code={code({ status: 'ENDED', endsAt: '2026-09-01T00:00:00.000Z' })}
        now={new Date('2026-10-01T00:00:00.000Z')}
      />,
    )

    expect(screen.getByRole('button', { name: 'Pause SAVE10' })).toBeInTheDocument()
    expect(
      screen.getByText('Its window has ended, so it cannot be resumed. Make a new code instead.'),
    ).toBeInTheDocument()
  })
})

describe('deleting', () => {
  it('confirms in place before deleting an unused code', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, { ok: true }))
    render(<PromoCodeActions organizationId={ORGANIZATION} code={code()} />)

    await user.click(screen.getByRole('button', { name: 'Delete SAVE10' }))

    expect(apiFetch).not.toHaveBeenCalled()
    expect(screen.getByText(/Delete SAVE10\? Nobody has used it\./u)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Keep it' }))

    expect(screen.queryByText(/Delete SAVE10\?/u)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Delete SAVE10' }))
    await user.click(screen.getAllByRole('button', { name: 'Delete SAVE10' }).at(-1))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(BASE, { method: 'DELETE' }))
    expect(await screen.findByText('SAVE10 is deleted.')).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('offers no delete for a used code, and says why', () => {
    render(<PromoCodeActions organizationId={ORGANIZATION} code={code({ redemptionCount: 4 })} />)

    expect(screen.queryByRole('button', { name: 'Delete SAVE10' })).toBeNull()
    expect(
      screen.getByText('Used 4 times, so it can be paused but not deleted.'),
    ).toBeInTheDocument()
  })

  it('repeats the API when a checkout used the code in the meantime', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(409, {
        error: {
          code: 'PROMO_IN_USE',
          message: 'Used 1 time, so it can be paused but not deleted.',
        },
      }),
    )
    render(<PromoCodeActions organizationId={ORGANIZATION} code={code()} />)

    await user.click(screen.getByRole('button', { name: 'Delete SAVE10' }))
    await user.click(screen.getAllByRole('button', { name: 'Delete SAVE10' }).at(-1))

    expect(
      await screen.findByText('Used 1 time, so it can be paused but not deleted.'),
    ).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('where focus goes around a deletion', () => {
  it('moves to the question when it opens, and back to Delete when the code is kept', async () => {
    const user = userEvent.setup()

    render(<PromoCodeActions organizationId={ORGANIZATION} code={code()} />)

    await user.click(screen.getByRole('button', { name: 'Delete SAVE10' }))

    expect(screen.getByText(/Delete SAVE10\? Nobody has used it\./u)).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Keep it' }))

    expect(screen.getByRole('button', { name: 'Delete SAVE10' })).toHaveFocus()
    expect(document.body).not.toHaveFocus()
  })

  it('returns to Delete when the API refuses, beside the refusal', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(409, {
        error: {
          code: 'PROMO_IN_USE',
          message: 'Used 1 time, so it can be paused but not deleted.',
        },
      }),
    )
    render(<PromoCodeActions organizationId={ORGANIZATION} code={code()} />)

    await user.click(screen.getByRole('button', { name: 'Delete SAVE10' }))
    await user.click(screen.getAllByRole('button', { name: 'Delete SAVE10' }).at(-1))

    await screen.findByText('Used 1 time, so it can be paused but not deleted.')
    expect(screen.getByRole('button', { name: 'Delete SAVE10' })).toHaveFocus()
  })

  it('says a deletion above the table, where the refresh cannot take it, and focuses it', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, { ok: true }))

    // The row goes when the page refreshes: modelled here by unmounting it.
    const { rerender } = render(
      <OutcomeAnnouncer>
        <PromoCodeActions organizationId={ORGANIZATION} code={code()} />
      </OutcomeAnnouncer>,
    )

    await user.click(screen.getByRole('button', { name: 'Delete SAVE10' }))
    await user.click(screen.getAllByRole('button', { name: 'Delete SAVE10' }).at(-1))

    const region = screen.getByTestId('outcome-announcer')

    await waitFor(() => expect(region).toHaveTextContent('SAVE10 is deleted.'))
    await waitFor(() => expect(region).toHaveFocus())
    expect(refresh).toHaveBeenCalledTimes(1)

    rerender(
      <OutcomeAnnouncer>
        <p>No promo codes</p>
      </OutcomeAnnouncer>,
    )

    expect(screen.getByTestId('outcome-announcer')).toHaveTextContent('SAVE10 is deleted.')
    expect(screen.getByTestId('outcome-announcer')).toHaveFocus()
  })
})
