import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { CancelSessionDialog } = await import('./cancel-session-dialog.jsx')

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

const EVENT_ID = 'cevent0000000000000000001'
const NIGHT = {
  id: 'csession000000000000000002',
  label: 'Night 2',
  startsAt: '2026-10-17T00:30:00.000Z',
  timezone: 'America/Chicago',
}
const BASE = `/v1/events/${EVENT_ID}/sessions/${NIGHT.id}`
const REASON = 'The singer for night two cancelled at short notice.'

/**
 * A night-cancellation preview.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The preview.
 */
function preview(overrides = {}) {
  return {
    sessionId: NIGHT.id,
    revision: 12,
    permitted: true,
    missing: null,
    refusal: null,
    orders: 8,
    ordersRefunded: 5,
    ordersToldOnly: 2,
    zeroValueOrders: 0,
    disputedOrders: 0,
    ordersCancelled: 1,
    ticketsWithdrawn: 9,
    refundableCents: 15_000,
    currency: 'USD',
    paymentMode: 'MOCK',
    ...overrides,
  }
}

const REFUNDS = {
  owed: 5,
  settled: 5,
  waiting: 0,
  failed: 0,
  disputed: 0,
  amountCents: 15_000,
  currency: 'USD',
}

beforeEach(() => {
  apiFetch.mockReset()
})

/**
 * Render the dialog and open it.
 *
 * @param {Function} [onCancelled] The callback.
 * @returns {Promise<object>} The user-event instance.
 */
async function openDialog(onCancelled = vi.fn()) {
  const user = userEvent.setup()

  render(
    <CancelSessionDialog
      eventId={EVENT_ID}
      session={NIGHT}
      timeZone="America/Chicago"
      onCancelled={onCancelled}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Cancel this night…' }))

  return user
}

describe('CancelSessionDialog', () => {
  it('reads the preview and says what it refunds, from its counts', async () => {
    apiFetch.mockResolvedValueOnce(answer(200, { data: preview() }))
    await openDialog()

    expect(
      screen.getByRole('heading', { name: /Cancel the night of Night 2 · Fri, Oct 16/ }),
    ).toHaveFocus()
    expect(
      await screen.findByText(/^5 paid orders for this night are refunded \(\$150\.00 in all/),
    ).toBeVisible()
    expect(screen.getByText(/2 orders hold tickets for every night/)).toBeVisible()
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/cancellation`)
  })

  it('says what the night’s cancellation means for bookings paid at the venue', async () => {
    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: preview({ atVenue: { orders: 1, ticketsPaidAtDoor: 2, paidAtDoorCents: 9_000 } }),
      }),
    )
    await openDialog()

    expect(
      await screen.findByText(
        'For tickets paid at the venue, only the booking fee paid online is refunded (simulated).',
      ),
    ).toBeVisible()
    expect(
      screen.getByText(
        'Payment taken at the door for 2 of these tickets ($90.00) is held by the organiser. The Desi Events does not hold it and cannot refund it.',
      ),
    ).toBeVisible()
  })

  it('says nothing about paying at the venue for a night with no such bookings', async () => {
    apiFetch.mockResolvedValueOnce(answer(200, { data: preview() }))
    await openDialog()

    await screen.findByText(/^5 paid orders for this night are refunded/)

    expect(screen.queryByText(/paid at the venue/u)).toBeNull()
  })

  it('sends the number of orders the preview showed, with the reason and the confirmation', async () => {
    const onCancelled = vi.fn()

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: preview() }))
      .mockResolvedValueOnce(
        answer(200, { data: { session: { ...NIGHT, status: 'CANCELLED' }, refunds: REFUNDS } }),
      )
    const user = await openDialog(onCancelled)

    await screen.findByText(/paid orders for this night are refunded/)
    await user.type(screen.getByLabelText(/Why is this night being cancelled/), REASON)
    await user.click(
      screen.getByRole('checkbox', {
        name: 'I understand these orders are refunded and this night cannot be brought back',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Cancel this night and refund it' }))

    await waitFor(() => expect(onCancelled).toHaveBeenCalled())

    const [path, options] = apiFetch.mock.calls[1]

    expect(path).toBe(`${BASE}/cancel`)
    expect(JSON.parse(options.body)).toEqual({
      revision: 12,
      reason: REASON,
      confirm: true,
      expectedOrders: 8,
    })
    expect(onCancelled.mock.calls[0][0].refunds).toEqual(REFUNDS)
  })

  it('puts focus on the outcome, keeps it until closed, and offers the night nothing after', async () => {
    const onClosed = vi.fn()

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: preview() }))
      .mockResolvedValueOnce(
        answer(200, { data: { session: { ...NIGHT, status: 'CANCELLED' }, refunds: REFUNDS } }),
      )

    const user = userEvent.setup()

    render(
      <CancelSessionDialog
        eventId={EVENT_ID}
        session={NIGHT}
        timeZone="America/Chicago"
        onCancelled={vi.fn()}
        onClosed={onClosed}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Cancel this night…' }))
    await screen.findByText(/paid orders for this night are refunded/)
    await user.type(screen.getByLabelText(/Why is this night being cancelled/), REASON)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Cancel this night and refund it' }))

    const region = screen.getByRole('region', { name: /^Cancel the night of Night 2/ })

    expect(
      await screen.findByText(
        'Its tickets no longer work at the door. 5 orders refunded ($150.00).',
      ),
    ).toBeVisible()
    await waitFor(() => expect(document.activeElement).toHaveTextContent(/^Night cancelled/))
    expect(region).toContainElement(document.activeElement)

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClosed).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: /^Cancel the night of / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel this night…' })).not.toBeInTheDocument()
  })

  it('drawn again with the outcome it was given, says what happened, with focus on it, until closed', async () => {
    const onClosed = vi.fn()
    const user = userEvent.setup()

    render(
      <CancelSessionDialog
        eventId={EVENT_ID}
        session={NIGHT}
        timeZone="America/Chicago"
        outcome={{ session: { ...NIGHT, status: 'CANCELLED' }, refunds: REFUNDS }}
        onCancelled={vi.fn()}
        onClosed={onClosed}
      />,
    )

    const region = screen.getByRole('region', { name: /^Cancel the night of Night 2/ })

    expect(screen.getByText('Night cancelled', { exact: true })).toBeVisible()
    expect(
      screen.getByText('Its tickets no longer work at the door. 5 orders refunded ($150.00).'),
    ).toBeVisible()
    await waitFor(() => expect(document.activeElement).toHaveTextContent(/^Night cancelled/))
    expect(region).toContainElement(document.activeElement)
    // Nothing is being read: the night is already cancelled.
    expect(screen.queryByText(/^Reading what cancelling/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel this night…' })).not.toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClosed).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: /^Cancel the night of / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel this night…' })).not.toBeInTheDocument()
  })

  it('says why a cancellation was refused, keeps the form, and reports nothing cancelled', async () => {
    const onCancelled = vi.fn()

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: preview() }))
      .mockResolvedValueOnce(
        answer(409, { error: { code: 'SESSION_STARTED', message: 'This night has started.' } }),
      )
    const user = await openDialog(onCancelled)

    await screen.findByText(/paid orders for this night are refunded/)
    await user.type(screen.getByLabelText(/Why is this night being cancelled/), REASON)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Cancel this night and refund it' }))

    expect(await screen.findByText('Not cancelled')).toBeVisible()
    expect(screen.getByText('This night has started.')).toBeVisible()
    await waitFor(() => expect(document.activeElement).toHaveTextContent(/^Not cancelled/))
    expect(screen.getByRole('button', { name: 'Cancel this night and refund it' })).toBeVisible()
    expect(screen.queryByText('Night cancelled', { exact: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(onCancelled).not.toHaveBeenCalled()
  })

  it('asks for the box to be ticked before sending', async () => {
    apiFetch.mockResolvedValueOnce(answer(200, { data: preview() }))
    const user = await openDialog()

    await screen.findByText(/paid orders for this night are refunded/)
    await user.type(screen.getByLabelText(/Why is this night being cancelled/), REASON)
    await user.click(screen.getByRole('button', { name: 'Cancel this night and refund it' }))

    expect(
      await screen.findByRole('link', { name: 'Tick the box to confirm the cancellation.' }),
    ).toBeVisible()
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('reads the preview again when the orders changed, and asks again', async () => {
    apiFetch
      .mockResolvedValueOnce(answer(200, { data: preview() }))
      .mockResolvedValueOnce(
        answer(409, { error: { code: 'ORDERS_CHANGED', message: 'An order came in meanwhile.' } }),
      )
      .mockResolvedValueOnce(answer(200, { data: preview({ orders: 9, ordersRefunded: 6 }) }))
    const user = await openDialog()

    await screen.findByText(/paid orders for this night are refunded/)
    await user.type(screen.getByLabelText(/Why is this night being cancelled/), REASON)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Cancel this night and refund it' }))

    expect(await screen.findByText(/An order came in meanwhile\./)).toBeVisible()
    expect(await screen.findByText(/^6 paid orders for this night are refunded/)).toBeVisible()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('shows the refusal of a night that has started, and offers nothing to press', async () => {
    apiFetch.mockResolvedValueOnce(
      answer(200, {
        data: preview({
          permitted: false,
          refusal: { code: 'SESSION_STARTED', message: 'This night has started.' },
        }),
      }),
    )
    const user = await openDialog()

    expect(await screen.findByText('This night has started.')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Cancel this night and refund it' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel this night…' })).toHaveFocus(),
    )
  })

  it('asks for the second factor when the server does, then sends again', async () => {
    let cancels = 0

    apiFetch.mockImplementation(async (path) => {
      if (path.endsWith('/cancellation')) return answer(200, { data: preview() })
      if (path === '/v1/auth/step-up') return answer(200, { data: {} })

      cancels += 1

      return cancels === 1
        ? answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Again.' } })
        : answer(200, { data: { session: NIGHT, refunds: REFUNDS } })
    })
    const onCancelled = vi.fn()
    const user = await openDialog(onCancelled)

    await screen.findByText(/paid orders for this night are refunded/)
    await user.type(screen.getByLabelText(/Why is this night being cancelled/), REASON)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Cancel this night and refund it' }))
    await user.type(await screen.findByLabelText(/Your password/), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(onCancelled).toHaveBeenCalled())
    expect(cancels).toBe(2)
  })
})
