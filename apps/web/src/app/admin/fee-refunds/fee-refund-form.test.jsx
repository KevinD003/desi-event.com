/**
 * Refunding one order's booking fee by hand (SPEC3 §12.6, SPEC3-XI §12.6).
 *
 * A reference not in the form references take is refused before anything is
 * sent; one no order has is said under the box; a found order shows its
 * booking-fee figures, the share kept when unpaid tickets were cancelled and,
 * for a disputed payment, a note in place of the form. The refund asks for a
 * reason, a second factor when the server wants one, sends the amount shown as
 * a precondition and says it is simulated; a refusal is the API's own words.
 * The amount is the fee left and the tax on it together, as the API refunds
 * and checks it; a refund is announced as refunded only when its status says
 * it settled.
 *
 * @module app/admin/fee-refunds/fee-refund-form.test
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../components/step-up-prompt.jsx', () => ({
  StepUpPrompt: ({ action, onConfirmed, onCancel }) => (
    <div role="group" aria-label="Confirm it is you">
      <button type="button" onClick={onConfirmed}>
        Confirm to {action}
      </button>
      <button type="button" onClick={onCancel}>
        Not now
      </button>
    </div>
  ),
}))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { FeeRefundForm } = await import('./fee-refund-form.jsx')
const { DISPUTED_NOTE, MALFORMED_REFERENCE, NO_SUCH_ORDER } =
  await import('./fee-refund-vocabulary.js')
const { STEP_UP_DECLINED_SENTENCE } = await import('../../../components/step-up-retry.jsx')

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

/**
 * An order's booking-fee figures as `platformFees.preview` reads them.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The preview.
 */
function preview(overrides = {}) {
  return {
    reference: 'DE-7K2M-9QPX',
    eventId: 'cevent0000000000000000001',
    eventTitle: 'Diwali Mela',
    status: 'PAID',
    paymentMethod: 'AT_VENUE',
    currency: 'USD',
    feesCents: 700,
    feeWaivedCents: 0,
    feeRefundedCents: 0,
    refundableFeeCents: 336,
    taxOnFeeCents: 0,
    feeKeptCents: 364,
    disputed: false,
    ...overrides,
  }
}

/** A reason long enough to send. */
const REASON = 'The buyer was charged the fee twice by mistake'

/**
 * Type a reference and find the order.
 *
 * @param {object} user The user-event instance.
 * @param {string} typed What to type.
 * @returns {Promise<void>} Resolves once the button was pressed.
 */
async function findOrder(user, typed) {
  await user.type(screen.getByLabelText('Order reference'), typed)
  await user.click(screen.getByRole('button', { name: 'Find order' }))
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('finding the order', () => {
  it('refuses a reference not in the form references take, before sending anything', async () => {
    const user = userEvent.setup()

    render(<FeeRefundForm />)
    await findOrder(user, 'ab')

    const box = screen.getByLabelText('Order reference')

    expect(screen.getByText(MALFORMED_REFERENCE)).toBeInTheDocument()
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveAccessibleDescription(MALFORMED_REFERENCE)
    await waitFor(() => expect(box).toHaveFocus())
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('says under the box when no order has the reference', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(404, { error: { code: 'NOT_FOUND', message: 'Order not found.' } }),
    )
    render(<FeeRefundForm />)
    await findOrder(user, ' de-7k2m-9qpx ')

    expect(await screen.findByText(NO_SUCH_ORDER)).toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledWith('/v1/platform/orders/DE-7K2M-9QPX/fee')
    await waitFor(() => expect(screen.getByLabelText('Order reference')).toHaveFocus())
    expect(screen.queryByRole('button', { name: /^Refund/u })).toBeNull()
  })

  it('shows the order’s booking-fee figures, the share kept, and takes focus to them', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(200, { data: preview({ feeWaivedCents: 0, feeRefundedCents: 0 }) }),
    )
    render(<FeeRefundForm />)
    await findOrder(user, 'DE-7K2M-9QPX')

    const heading = await screen.findByRole('heading', { level: 2, name: 'Order DE-7K2M-9QPX' })

    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByRole('link', { name: 'Diwali Mela' })).toHaveAttribute(
      'href',
      '/admin/events/cevent0000000000000000001',
    )
    expect(screen.getByText('At the venue')).toBeInTheDocument()
    expect(screen.getByText('Paid — simulated')).toBeInTheDocument()
    expect(screen.getByText('Booking fee charged').nextSibling).toHaveTextContent('$7.00')
    expect(screen.getByText('Waived with a referral code').nextSibling).toHaveTextContent('$0.00')
    expect(screen.getByText('Already refunded').nextSibling).toHaveTextContent('$0.00')
    expect(screen.queryByText('Tax on the booking fee')).toBeNull()
    expect(screen.getByTestId('fee-refundable')).toHaveTextContent('Can be refunded: $3.36')
    expect(
      screen.getByText('Kept when unpaid tickets were cancelled: $3.64. It can’t be refunded.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Refund $3.36 booking fee (simulated)' }),
    ).toBeInTheDocument()
  })

  it('names the tax on the fee when there was some', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: preview({ paymentMethod: 'CARD', feeKeptCents: 0, taxOnFeeCents: 57 }),
      }),
    )
    render(<FeeRefundForm />)
    await findOrder(user, 'DE-7K2M-9QPX')

    expect(await screen.findByText('Tax on the booking fee')).toBeInTheDocument()
    expect(screen.getByText('Card')).toBeInTheDocument()
    expect(screen.queryByText(/Kept when unpaid tickets were cancelled/u)).toBeNull()
  })

  it('shows a disputed payment’s note in place of the refund form', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, { data: preview({ disputed: true }) }))
    render(<FeeRefundForm />)
    await findOrder(user, 'DE-7K2M-9QPX')

    expect(await screen.findByText(DISPUTED_NOTE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Refund/u })).toBeNull()
    expect(screen.queryByLabelText(/^Reason/u)).toBeNull()
  })

  it('offers no refund when nothing is left to refund', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(200, { data: preview({ refundableFeeCents: 0, feeRefundedCents: 336 }) }),
    )
    render(<FeeRefundForm />)
    await findOrder(user, 'DE-7K2M-9QPX')

    expect(await screen.findByTestId('fee-refundable')).toHaveTextContent('Can be refunded: $0.00')
    expect(screen.queryByRole('button', { name: /^Refund/u })).toBeNull()
  })

  it('gives another refusal in the API’s words, and takes focus there', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(403, { error: { code: 'FORBIDDEN', message: 'You can’t read this order’s fee.' } }),
    )
    render(<FeeRefundForm />)
    await findOrder(user, 'DE-7K2M-9QPX')

    const sentence = await screen.findByText('You can’t read this order’s fee.')

    expect(screen.getByText('The order was not found')).toBeInTheDocument()
    await waitFor(() => expect(sentence.closest('[tabindex="-1"]')).toHaveFocus())
  })
})

describe('refunding the fee', () => {
  it('asks for a reason of at least 10 characters before sending', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, { data: preview() }))
    render(<FeeRefundForm />)
    await findOrder(user, 'DE-7K2M-9QPX')

    await user.click(
      await screen.findByRole('button', { name: 'Refund $3.36 booking fee (simulated)' }),
    )

    const reason = screen.getByLabelText(/^Reason/u)

    await waitFor(() => expect(reason).toHaveFocus())
    expect(reason).toHaveAttribute('aria-invalid', 'true')
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('refunds with a second factor, sends the amount shown, and says it is simulated', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: preview() }))
      .mockResolvedValueOnce(
        answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm it is you.' } }),
      )
      .mockResolvedValueOnce(
        answer(200, {
          data: {
            refund: { id: 'crefund00000000000000001', amountCents: 336, status: 'SUCCEEDED' },
            fee: preview({ refundableFeeCents: 0, feeRefundedCents: 336 }),
          },
        }),
      )
    render(<FeeRefundForm />)
    await findOrder(user, 'DE-7K2M-9QPX')

    await user.type(await screen.findByLabelText(/^Reason/u), REASON)
    await user.click(screen.getByRole('button', { name: 'Refund $3.36 booking fee (simulated)' }))
    await user.click(
      await screen.findByRole('button', { name: 'Confirm to refund this booking fee' }),
    )

    const done = await screen.findByText('Booking fee refunded (simulated): $3.36.')

    await waitFor(() => expect(done).toHaveFocus())
    expect(apiFetch).toHaveBeenCalledTimes(3)
    expect(apiFetch.mock.calls[2][0]).toBe('/v1/platform/orders/DE-7K2M-9QPX/fee-refund')
    expect(apiFetch.mock.calls[2][1].method).toBe('POST')
    expect(JSON.parse(apiFetch.mock.calls[2][1].body)).toEqual({
      reason: REASON,
      expectedRefundableCents: 336,
    })
    // The figures after the refund: nothing is left, so no form is offered.
    expect(screen.getByTestId('fee-refundable')).toHaveTextContent('Can be refunded: $0.00')
    expect(screen.queryByRole('button', { name: /^Refund/u })).toBeNull()
  })

  it('says the refund was not made when the second factor is declined', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: preview() }))
      .mockResolvedValueOnce(
        answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm it is you.' } }),
      )
    render(<FeeRefundForm />)
    await findOrder(user, 'DE-7K2M-9QPX')

    await user.type(await screen.findByLabelText(/^Reason/u), REASON)
    await user.click(screen.getByRole('button', { name: 'Refund $3.36 booking fee (simulated)' }))
    await user.click(await screen.findByRole('button', { name: 'Not now' }))

    expect(await screen.findByText(STEP_UP_DECLINED_SENTENCE)).toBeInTheDocument()
    expect(screen.queryByText(/Booking fee refunded/u)).toBeNull()
  })

  it.each([
    ['NO_FEE_TO_REFUND', 409, 'There is no booking fee left to refund on this order.'],
    [
      'CONFLICT_OF_INTEREST',
      403,
      'This is your own order, so another administrator has to refund its booking fee.',
    ],
  ])(
    'gives a %s refusal in the API’s words, and takes focus there',
    async (code, status, sentence) => {
      const user = userEvent.setup()

      apiFetch
        .mockResolvedValueOnce(answer(200, { data: preview() }))
        .mockResolvedValueOnce(answer(status, { error: { code, message: sentence } }))
      render(<FeeRefundForm />)
      await findOrder(user, 'DE-7K2M-9QPX')

      await user.type(await screen.findByLabelText(/^Reason/u), REASON)
      await user.click(screen.getByRole('button', { name: 'Refund $3.36 booking fee (simulated)' }))

      const said = await screen.findByText(sentence)

      expect(screen.getByText('The booking fee was not refunded')).toBeInTheDocument()
      await waitFor(() => expect(said.closest('[tabindex="-1"]')).toHaveFocus())
      expect(screen.queryByText(/Booking fee refunded/u)).toBeNull()
    },
  )

  it('says the service is not responding when the request fails', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: preview() }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<FeeRefundForm />)
    await findOrder(user, 'DE-7K2M-9QPX')

    await user.type(await screen.findByLabelText(/^Reason/u), REASON)
    await user.click(screen.getByRole('button', { name: 'Refund $3.36 booking fee (simulated)' }))

    expect(
      await screen.findByText('The service is not responding. The booking fee was not refunded.'),
    ).toBeInTheDocument()
  })
})

describe('the tax on the fee', () => {
  /** An order whose booking fee carried tax: $6.00 of fee and $0.78 of tax on it. */
  const taxed = {
    paymentMethod: 'CARD',
    feeKeptCents: 0,
    refundableFeeCents: 600,
    taxOnFeeCents: 78,
  }

  it('shows, offers and sends the fee and its tax together, as the API refunds them', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, { data: preview(taxed) })).mockResolvedValueOnce(
      answer(200, {
        data: {
          refund: { id: 'crefund00000000000000001', amountCents: 678, status: 'SUCCEEDED' },
          fee: preview({ ...taxed, refundableFeeCents: 0, taxOnFeeCents: 0 }),
        },
      }),
    )
    render(<FeeRefundForm />)
    await findOrder(user, 'DE-7K2M-9QPX')

    expect(await screen.findByTestId('fee-refundable')).toHaveTextContent('Can be refunded: $6.78')
    expect(screen.getByText('Tax on the booking fee').nextSibling).toHaveTextContent('$0.78')

    await user.type(screen.getByLabelText(/^Reason/u), REASON)
    await user.click(screen.getByRole('button', { name: 'Refund $6.78 booking fee (simulated)' }))

    expect(await screen.findByText('Booking fee refunded (simulated): $6.78.')).toBeInTheDocument()
    expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({
      reason: REASON,
      expectedRefundableCents: 678,
    })
  })

  it('reads the figures again after PRICE_CHANGED, so the button shows what is left now', async () => {
    const user = userEvent.setup()
    const changed =
      "What is left of this order's booking fee changed after you opened it. Nothing was refunded. Look at the order again."

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: preview(taxed) }))
      .mockResolvedValueOnce(answer(409, { error: { code: 'PRICE_CHANGED', message: changed } }))
      .mockResolvedValueOnce(
        answer(200, { data: preview({ ...taxed, refundableFeeCents: 300, taxOnFeeCents: 39 }) }),
      )
    render(<FeeRefundForm />)
    await findOrder(user, 'DE-7K2M-9QPX')

    await user.type(await screen.findByLabelText(/^Reason/u), REASON)
    await user.click(screen.getByRole('button', { name: 'Refund $6.78 booking fee (simulated)' }))

    const said = await screen.findByText(changed)

    expect(screen.getByText('The booking fee was not refunded')).toBeInTheDocument()
    await waitFor(() => expect(said.closest('[tabindex="-1"]')).toHaveFocus())
    expect(
      await screen.findByRole('button', { name: 'Refund $3.39 booking fee (simulated)' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('fee-refundable')).toHaveTextContent('Can be refunded: $3.39')
    expect(apiFetch).toHaveBeenCalledTimes(3)
    expect(apiFetch.mock.calls[2][0]).toBe('/v1/platform/orders/DE-7K2M-9QPX/fee')
    // The reason typed is kept, so the refund can be sent again as it stands.
    expect(screen.getByLabelText(/^Reason/u)).toHaveValue(REASON)
    expect(screen.queryByText(/Booking fee refunded/u)).toBeNull()
  })
})

describe('what became of the refund', () => {
  /**
   * Find the order, give a reason and press Refund, the refund answering 200
   * with the given status, as `platformFees.refund` does whatever the payment
   * provider said.
   *
   * @param {string} status The refund's status in the answer.
   * @param {object} fee The figures after it.
   * @param {object} [props] The form's props.
   * @returns {Promise<object>} The user-event instance.
   */
  async function refundAnswered(status, fee, props = {}) {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, { data: preview() })).mockResolvedValueOnce(
      answer(200, {
        data: { refund: { id: 'crefund00000000000000001', amountCents: 336, status }, fee },
      }),
    )
    render(<FeeRefundForm {...props} />)
    await findOrder(user, 'DE-7K2M-9QPX')
    await user.type(await screen.findByLabelText(/^Reason/u), REASON)
    await user.click(screen.getByRole('button', { name: 'Refund $3.36 booking fee (simulated)' }))

    return user
  }

  it.each([
    [
      'DECLINED',
      'The payment provider (simulated) refused this refund, so nothing was refunded. The fee can be refunded again once the cause is fixed.',
    ],
    [
      'FAILED',
      'The refund did not go through to the payment provider (simulated), so nothing was refunded. The fee can be refunded again once the cause is fixed.',
    ],
  ])('says a %s refund refunded nothing, and offers the refund again', async (status, sentence) => {
    // Refused or failed, the refund set nothing aside: the fee is left as it was.
    await refundAnswered(status, preview())

    const said = await screen.findByText(sentence)
    const box = said.closest('[tabindex="-1"]')

    expect(box).toHaveTextContent('The booking fee was not refunded')
    await waitFor(() => expect(box).toHaveFocus())
    expect(screen.queryByText(/Booking fee refunded/u)).toBeNull()
    expect(screen.getByTestId('fee-refundable')).toHaveTextContent('Can be refunded: $3.36')
    expect(
      screen.getByRole('button', { name: 'Refund $3.36 booking fee (simulated)' }),
    ).toBeEnabled()
    expect(screen.getByLabelText(/^Reason/u)).toHaveValue(REASON)
    expect(screen.queryByRole('link', { name: 'See this refund' })).toBeNull()
  })

  it.each([
    [
      'TIMEOUT',
      'The payment provider (simulated) did not say whether the refund went through. An operations item is open to establish it, and the fee stays set aside for this refund until then.',
    ],
    [
      'RECONCILIATION_REQUIRED',
      'The payment provider (simulated) did not say whether the refund went through. An operations item is open to establish it, and the fee stays set aside for this refund until then.',
    ],
    [
      'SUBMITTED',
      'The payment provider (simulated) has not said whether the refund went through. The fee stays set aside for this refund until it does.',
    ],
  ])('says a %s refund has not settled, never that it was refunded', async (status, sentence) => {
    // Unsettled, the refund keeps the fee set aside: nothing is left to refund.
    await refundAnswered(status, preview({ refundableFeeCents: 0 }), { canReadRefunds: true })

    const said = await screen.findByText(sentence)
    const box = said.closest('[tabindex="-1"]')

    expect(box).toHaveTextContent('The booking fee refund has not settled')
    await waitFor(() => expect(box).toHaveFocus())
    expect(screen.queryByText(/Booking fee refunded/u)).toBeNull()
    expect(screen.getByRole('link', { name: 'See this refund' })).toHaveAttribute(
      'href',
      '/finance/refunds/crefund00000000000000001',
    )
    expect(screen.getByTestId('fee-refundable')).toHaveTextContent('Can be refunded: $0.00')
    expect(screen.queryByRole('button', { name: /^Refund/u })).toBeNull()
  })

  it('offers no link to the refund to an account that cannot open it', async () => {
    await refundAnswered('TIMEOUT', preview({ refundableFeeCents: 0 }))

    expect(await screen.findByText('The booking fee refund has not settled')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'See this refund' })).toBeNull()
  })
})

describe('a change that waited too long behind another', () => {
  it('says the API’s sentence for a 503, not a fault nothing can fix', async () => {
    const user = userEvent.setup()
    const sentence =
      'Another change to this order was being saved at the same moment, so its booking fee was not refunded. Try again in a moment.'

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: preview() }))
      .mockResolvedValueOnce(
        answer(503, { error: { code: 'SERVICE_UNAVAILABLE', message: sentence } }),
      )
    render(<FeeRefundForm />)
    await findOrder(user, 'DE-7K2M-9QPX')

    await user.type(await screen.findByLabelText(/^Reason/u), REASON)
    await user.click(screen.getByRole('button', { name: 'Refund $3.36 booking fee (simulated)' }))

    const said = await screen.findByText(sentence)

    await waitFor(() => expect(said.closest('[tabindex="-1"]')).toHaveFocus())
    expect(screen.queryByText(/nothing you do on this page will fix it/u)).toBeNull()
  })
})
