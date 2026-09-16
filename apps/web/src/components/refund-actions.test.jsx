import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { RefundActions } = await import('./refund-actions.jsx')

/**
 * A refund in a given state.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} A refund payload.
 */
function refund(overrides = {}) {
  return {
    id: 'refund00000000000000001',
    status: 'REQUESTED',
    amountCents: 240_000,
    currency: 'INR',
    ...overrides,
  }
}

/**
 * A response the mocked `apiFetch` will resolve with.
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
})

describe('what is offered', () => {
  it('does not offer sending a refund nobody has approved', () => {
    render(<RefundActions refund={refund()} mayApprove maySubmit />)

    expect(
      screen.queryByRole('button', { name: /send it to the provider/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('does not offer cancelling a refund already sent', () => {
    render(<RefundActions refund={refund({ status: 'SUBMITTED' })} mayApprove maySubmit />)

    // By then the question is what the provider did, not what we intended.
    expect(screen.queryByRole('button', { name: 'Cancel it' })).not.toBeInTheDocument()
    expect(screen.getByText(/nothing to do here/i)).toBeInTheDocument()
  })

  it('offers nothing at all on a settled refund', () => {
    render(<RefundActions refund={refund({ status: 'SUCCEEDED' })} mayApprove maySubmit />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers approval again after a provider refusal', () => {
    render(<RefundActions refund={refund({ status: 'DECLINED' })} mayApprove maySubmit />)

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('offers no approval to an account that cannot approve', () => {
    render(<RefundActions refund={refund()} mayApprove={false} maySubmit={false} />)

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('never asks for a card, a CVC or a token', async () => {
    const user = userEvent.setup()

    render(<RefundActions refund={refund({ status: 'APPROVED' })} mayApprove maySubmit />)

    await user.click(screen.getByRole('button', { name: /send it to the provider/i }))

    for (const input of screen.getAllByRole('textbox')) {
      expect(input.getAttribute('id') ?? '').not.toMatch(/card|cvc|pan|number|expiry/iu)
    }

    expect(document.body.textContent.toLowerCase()).not.toMatch(/cvc|card number|expiry/u)
  })
})

describe('sending a command', () => {
  it('never sends an amount', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: refund({ status: 'APPROVED' }) }))

    render(<RefundActions refund={refund()} mayApprove maySubmit />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.type(screen.getByRole('textbox'), 'The event was cancelled.')
    await user.click(screen.getAllByRole('button', { name: 'Approve' })[0])

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    const [path, options] = apiFetch.mock.calls[0]
    const body = JSON.parse(options.body)

    expect(path).toBe('/v1/refunds/refund00000000000000001/approve')
    // The amount was fixed when the refund was requested, from the order's own
    // lines. A screen that could propose a different one is a screen where the
    // browser decides how much of somebody's money goes back.
    expect(body).toEqual({ reason: 'The event was cancelled.' })
    expect(Object.keys(body)).not.toContain('amountCents')
  })

  it('will not send without a reason the audit record can keep', async () => {
    const user = userEvent.setup()

    render(<RefundActions refund={refund()} mayApprove maySubmit />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    const submit = screen.getAllByRole('button', { name: 'Approve' })[0]

    expect(submit).toBeDisabled()

    await user.click(submit)

    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('sends the seat policy only when sending to the provider', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: refund({ status: 'SUBMITTED' }) }))

    render(<RefundActions refund={refund({ status: 'APPROVED' })} mayApprove maySubmit />)

    await user.click(screen.getByRole('button', { name: /send it to the provider/i }))
    await user.selectOptions(screen.getByRole('combobox'), 'WITHHOLD')
    await user.type(screen.getByRole('textbox'), 'Too close to the event to resell.')
    await user.click(screen.getAllByRole('button', { name: /send it to the provider/i })[0])

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      reason: 'Too close to the event to resell.',
      seatPolicy: 'WITHHOLD',
    })
  })

  it('repeats a separation-of-duties refusal rather than working around it', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(403, {
        error: {
          code: 'SEPARATION_OF_DUTIES',
          message: 'Somebody other than the person who asked has to approve this refund.',
        },
      }),
    )

    render(<RefundActions refund={refund()} mayApprove maySubmit />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.type(screen.getByRole('textbox'), 'I asked for this myself.')
    await user.click(screen.getAllByRole('button', { name: 'Approve' })[0])

    expect(await screen.findByText(/somebody other than the person who asked/i)).toBeInTheDocument()
  })

  it('says nothing was recorded when the service does not answer', async () => {
    const user = userEvent.setup()

    apiFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    render(<RefundActions refund={refund()} mayApprove maySubmit />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.type(screen.getByRole('textbox'), 'The event was cancelled.')
    await user.click(screen.getAllByRole('button', { name: 'Approve' })[0])

    expect(await screen.findByText(/nothing has been recorded/i)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/ECONNREFUSED/)
  })
})
