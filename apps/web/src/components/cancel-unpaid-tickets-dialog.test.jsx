/**
 * Cancelling unpaid tickets of one booking (SPEC3-XI §12.14, §14.5).
 *
 * The properties worth pinning:
 *
 *   - **Every cancellable ticket starts ticked**, a ticket whose night is over
 *     is disabled with its reason, and "Select all" is checked, unchecked or
 *     `indeterminate` exactly as the ticks are.
 *   - **The intro says what happens to the booking fee**: kept when one was
 *     paid online, and "nothing was paid online" for a waived booking.
 *   - **Field errors go to a summary that takes focus.**
 *   - **Every refusal is the API's sentence**; `VENUE_BOOKING_CHANGED` reads
 *     the booking again and takes focus to the dialog's heading.
 *   - **The outcome's words** for `ALL`, `SOME` and `NONE`, the organiser-only
 *     "Open sales" line, and the replay.
 *   - **A second factor** is asked for on reading (FINANCE_VIEW) and on
 *     cancelling (FINANCE_ACTION), and the same request is sent again.
 *   - **Focus**: the heading on opening; the dialog is labelled by it.
 *
 * @module components/cancel-unpaid-tickets-dialog.test
 */

import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const {
  CancelUnpaidTicketsDialog,
  cancellationOutcome,
  cancellationProblems,
  instantWords,
  ticketWords,
} = await import('./cancel-unpaid-tickets-dialog.jsx')

const EVENT_ID = 'eventaaaaaaaaaaaaaaaaaaaa'
const REFERENCE = 'DE-7Q2K9P'
const IDS = ['ticketaaaaaaaaaaaaaaaaaaa', 'ticketbbbbbbbbbbbbbbbbbbb', 'ticketccccccccccccccccccc']

/**
 * One unpaid ticket of the booking.
 *
 * @param {number} index Which.
 * @param {object} [overrides] Fields to change.
 * @returns {object} The ticket.
 */
function ticket(index, overrides = {}) {
  return {
    ticketId: IDS[index],
    label: `Ticket ${index + 1} of 3`,
    attendeeName: null,
    nightLabel: null,
    everyNight: true,
    dueCents: 4500,
    heldBy: 'BUYER',
    offerPending: false,
    cancellable: true,
    notCancellable: null,
    ...overrides,
  }
}

const BOOKING = {
  orderReference: REFERENCE,
  placedAt: '2026-10-10T10:00:00.000Z',
  buyerName: 'Asha Rao',
  feesCents: 729,
  feeHeldCents: 729,
  unpaidTickets: 3,
  unpaidCents: 13500,
  tickets: [
    ticket(0, { attendeeName: 'Asha Rao' }),
    ticket(1, {
      everyNight: false,
      nightLabel: 'Saturday',
      heldBy: 'SOMEONE_ELSE',
      offerPending: true,
    }),
    ticket(2, {
      everyNight: false,
      nightLabel: 'Friday',
      cancellable: false,
      notCancellable: 'NIGHT_OVER',
    }),
  ],
}

/**
 * The `venueBookings.unpaid` answer for one booking.
 *
 * @param {object|null} [booking] The booking, or none.
 * @returns {object} The body.
 */
function list(booking = BOOKING) {
  return {
    data: {
      eventId: EVENT_ID,
      eventTitle: 'Navratri Garba Night',
      currency: 'USD',
      bookings: booking ? [booking] : [],
      pagination: { page: 1, perPage: 20, total: booking ? 1 : 0 },
    },
  }
}

/**
 * A cancellation answer.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The body.
 */
function cancellation(overrides = {}) {
  return {
    data: {
      cancellationId: 'cancelaaaaaaaaaaaaaaaaaa',
      orderReference: REFERENCE,
      ticketCount: 2,
      basisCents: 9000,
      feeKeptCents: 486,
      currency: 'USD',
      cancelledAt: '2026-10-12T21:05:00.000Z',
      by: 'ORGANISER',
      byName: 'Meera Owner',
      reason: 'Not paid before the doors opened',
      seatsReturned: 0,
      placesReturned: { tieraaaaaaaaaaaaaaaaaaaaa: 2 },
      placesOnSale: 'ALL',
      eventSalesStopped: false,
      replayed: false,
      ...overrides,
    },
  }
}

/**
 * A Response-shaped stub.
 *
 * @param {number} status The status.
 * @param {object} body The body.
 * @returns {object} The stub.
 */
function answer(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/**
 * Open the dialog on the booking.
 *
 * @param {object} [props] Props to change.
 * @returns {Promise<{onClose: Function, onCancelled: Function}>} The callbacks.
 */
async function open(props = {}) {
  const onClose = vi.fn()
  const onCancelled = vi.fn()

  render(
    <CancelUnpaidTicketsDialog
      eventId={EVENT_ID}
      orderReference={REFERENCE}
      onClose={onClose}
      onCancelled={onCancelled}
      {...props}
    />,
  )

  await screen.findByRole('group', { name: 'Tickets to cancel' })

  return { onClose, onCancelled }
}

/**
 * Type a reason that passes.
 *
 * @param {object} user A userEvent instance.
 * @returns {Promise<void>}
 */
async function giveReason(user) {
  await user.type(screen.getByLabelText(/^Reason/u), 'Not paid before the doors opened')
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('what it reads, and what is ticked to start with', () => {
  it('reads the one booking by its reference, labels itself by its heading and focuses it', async () => {
    apiFetch.mockResolvedValueOnce(answer(200, list()))

    await open()

    expect(apiFetch).toHaveBeenCalledWith(`/v1/events/${EVENT_ID}/venue-bookings`, {
      query: { order: REFERENCE },
    })

    const dialog = screen.getByRole('dialog', { name: 'Cancel unpaid tickets' })

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText(`Booking ${REFERENCE} — Asha Rao`)).toBeInTheDocument()
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Cancel unpaid tickets' }),
      ),
    )
  })

  it('ticks every cancellable ticket, and disables the one whose night is over, saying why', async () => {
    apiFetch.mockResolvedValueOnce(answer(200, list()))

    await open()

    const first = screen.getByLabelText('Asha Rao — Every night — $45.00')
    const second = screen.getByLabelText('Ticket 2 of 3 — Saturday — $45.00')
    const over = screen.getByLabelText('Ticket 3 of 3 — Friday — $45.00')

    expect(first).toBeChecked()
    expect(second).toBeChecked()
    expect(over).not.toBeChecked()
    expect(over).toBeDisabled()
    expect(over).toHaveAccessibleDescription('That night is over, so this ticket stays as it is.')
    expect(second).toHaveAccessibleDescription(
      'Passed on to someone else Offered to someone else; the offer will be withdrawn',
    )
    expect(screen.getByRole('button', { name: 'Cancel 2 unpaid tickets' })).toBeEnabled()
  })

  it('checks "Select all" when all are ticked, unchecks it when none is, and is indeterminate in between', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, list()))
    await open()

    const all = screen.getByLabelText('Select all 2 unpaid tickets')

    expect(all).toBeChecked()
    expect(all.indeterminate).toBe(false)

    await user.click(screen.getByLabelText(/^Asha Rao/u))

    expect(all).not.toBeChecked()
    expect(all.indeterminate).toBe(true)
    expect(screen.getByRole('button', { name: 'Cancel 1 unpaid ticket' })).toBeEnabled()

    // From in between, it ticks all.
    await user.click(all)

    expect(all).toBeChecked()
    expect(all.indeterminate).toBe(false)
    expect(screen.getByLabelText(/^Asha Rao/u)).toBeChecked()

    await user.click(all)

    expect(all).not.toBeChecked()
    expect(all.indeterminate).toBe(false)
    expect(screen.getByRole('button', { name: 'Cancel 0 unpaid tickets' })).toBeDisabled()
  })

  it('says the booking fee is kept when one was paid online', async () => {
    apiFetch.mockResolvedValueOnce(answer(200, list()))
    await open()

    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveTextContent(
      'These tickets were booked to pay at the door and have not been paid for. Cancelling them frees their places, and nobody owes their price any more.',
    )
    expect(dialog).toHaveTextContent(
      'Desi-Event keeps the booking fee paid online for them; nothing is refunded.',
    )
    expect(dialog).toHaveTextContent("This can't be undone.")
  })

  it('never says the fee is kept, nor that nothing was paid, once the fee paid online was refunded', async () => {
    apiFetch.mockResolvedValueOnce(
      answer(200, list({ ...BOOKING, feesCents: 729, feeHeldCents: 0 })),
    )
    await open()

    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveTextContent(
      'Nothing is left of the booking fee paid online for this booking, so nothing is kept or refunded.',
    )
    expect(dialog).not.toHaveTextContent(/keeps the booking fee/u)
    expect(dialog).not.toHaveTextContent(/Nothing was paid online/u)
  })

  it('says nothing was paid online for a booking whose fee was waived', async () => {
    apiFetch.mockResolvedValueOnce(
      answer(200, list({ ...BOOKING, feesCents: 0, feeHeldCents: 0, buyerName: null })),
    )
    await open()

    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveTextContent('Nothing was paid online for them, so nothing is refunded.')
    expect(dialog).not.toHaveTextContent(/keeps the booking fee/u)
    // A platform reader is sent no name: the sub-title is the booking alone.
    expect(within(dialog).getByText(`Booking ${REFERENCE}`)).toBeInTheDocument()
  })

  it('describes the reason as the buyer and holders will read it', async () => {
    apiFetch.mockResolvedValueOnce(answer(200, list()))
    await open()

    expect(screen.getByLabelText(/^Reason/u)).toHaveAccessibleDescription(
      "Shown to the buyer and to anybody holding these tickets. Do not include anybody's personal details. At least 10 characters.",
    )
  })

  it('asks for a second factor before it can read, then reads again', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Step up.' } }),
    )

    render(
      <CancelUnpaidTicketsDialog
        eventId={EVENT_ID}
        orderReference={REFERENCE}
        onClose={vi.fn()}
        onCancelled={vi.fn()}
      />,
    )

    expect(await screen.findByText(/see this booking’s tickets/u)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Tickets to cancel' })).toBeNull()

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: { ok: true } }))
      .mockResolvedValueOnce(answer(200, list()))
    await user.type(screen.getByLabelText(/Your password/u), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByRole('group', { name: 'Tickets to cancel' })).toBeInTheDocument()
    expect(apiFetch.mock.calls[1][0]).toBe('/v1/auth/step-up')
    expect(apiFetch.mock.calls[2][0]).toBe(`/v1/events/${EVENT_ID}/venue-bookings`)
  })

  it('keeps focus in the dialog when the read asks for a second factor and it is declined, and never says there are no tickets', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    apiFetch.mockResolvedValueOnce(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Step up.' } }),
    )

    render(
      <>
        <button type="button">Page behind</button>
        <CancelUnpaidTicketsDialog
          eventId={EVENT_ID}
          orderReference={REFERENCE}
          onClose={onClose}
          onCancelled={vi.fn()}
        />
      </>,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Cancel unpaid tickets' })

    // The prompt takes focus when it opens.
    await screen.findByLabelText(/Your password/u)
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByText(/see this booking’s tickets/u).closest('[tabindex="-1"]'),
      ),
    )
    expect(dialog).toContainElement(document.activeElement)

    await user.click(screen.getByRole('button', { name: 'Not now' }))

    // Nothing was read, so nothing is said about what the booking holds.
    expect(
      screen.queryByText(
        'This booking has no tickets waiting to be paid at the door now. Nothing was cancelled.',
      ),
    ).toBeNull()

    const declined = screen.getByText(
      'You are signed in, but it has been a while since you confirmed your password and second factor, and this is only shown after a recent confirmation. Confirm to see this booking’s tickets. The window is kept short on purpose; nothing is shown or changed until you do.',
    )

    await waitFor(() => expect(document.activeElement).toBe(declined.closest('[tabindex="-1"]')))
    expect(dialog).toContainElement(document.activeElement)

    // The trap still holds: Escape closes, and Tab stays inside.
    await user.tab()
    expect(dialog).toContainElement(document.activeElement)
    await act(async () => {
      await user.keyboard('{Escape}')
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    // And it asks again on request.
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByLabelText(/Your password/u)).toBeInTheDocument()
    await waitFor(() => expect(dialog).toContainElement(document.activeElement))
    expect(document.activeElement).not.toBe(document.body)
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('says so when the booking has nothing left to cancel', async () => {
    apiFetch.mockResolvedValueOnce(answer(200, list(null)))

    render(
      <CancelUnpaidTicketsDialog
        eventId={EVENT_ID}
        orderReference={REFERENCE}
        onClose={vi.fn()}
        onCancelled={vi.fn()}
      />,
    )

    expect(
      await screen.findByText(
        'This booking has no tickets waiting to be paid at the door now. Nothing was cancelled.',
      ),
    ).toBeInTheDocument()
  })
})

describe('sending', () => {
  it('sends the ticked tickets in the booking’s order and the reason, and hands back what happened', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, list()))
    const { onCancelled } = await open()

    await giveReason(user)
    apiFetch.mockResolvedValueOnce(answer(200, cancellation()))
    await user.click(screen.getByRole('button', { name: 'Cancel 2 unpaid tickets' }))

    expect(apiFetch.mock.calls[1][0]).toBe(`/v1/orders/${REFERENCE}/venue-cancellations`)
    expect(apiFetch.mock.calls[1][1].method).toBe('POST')
    expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({
      ticketIds: [IDS[0], IDS[1]],
      reason: 'Not paid before the doors opened',
    })
    await waitFor(() => expect(onCancelled).toHaveBeenCalledWith(cancellation().data))
  })

  it('asks for a second factor before cancelling, then sends the same request again', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, list()))
    const { onCancelled } = await open()

    await giveReason(user)
    apiFetch.mockResolvedValueOnce(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Step up.' } }),
    )
    await user.click(screen.getByRole('button', { name: 'Cancel 2 unpaid tickets' }))

    expect(await screen.findByText(/cancel these tickets/u)).toBeInTheDocument()

    apiFetch
      .mockResolvedValueOnce(answer(200, { data: { ok: true } }))
      .mockResolvedValueOnce(answer(200, cancellation()))
    await user.type(screen.getByLabelText(/Your password/u), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(onCancelled).toHaveBeenCalled())
    expect(apiFetch.mock.calls[3][1].body).toBe(apiFetch.mock.calls[1][1].body)
  })

  it('keeps focus in the dialog while cancelling asks for a second factor, and says nothing was sent when it is declined', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, list()))
    const { onClose, onCancelled } = await open()
    const dialog = screen.getByRole('dialog', { name: 'Cancel unpaid tickets' })

    await giveReason(user)
    apiFetch.mockResolvedValueOnce(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Step up.' } }),
    )
    await user.click(screen.getByRole('button', { name: 'Cancel 2 unpaid tickets' }))

    // The form, and the button that was pressed, are gone: focus is in the prompt.
    await screen.findByText(/cancel these tickets/u)
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByText(/cancel these tickets/u).closest('[tabindex="-1"]'),
      ),
    )
    expect(dialog).toContainElement(document.activeElement)

    await user.click(screen.getByRole('button', { name: 'Not now' }))

    const summary = await screen.findByText(
      'Not saved: confirm it’s you to make this change. Nothing has been sent.',
    )

    await waitFor(() => expect(document.activeElement).toBe(summary.closest('[tabindex="-1"]')))
    expect(
      within(summary.closest('[tabindex="-1"]')).getByText('Nothing was cancelled'),
    ).toBeTruthy()
    expect(dialog).toContainElement(document.activeElement)
    expect(onCancelled).not.toHaveBeenCalled()
    expect(apiFetch).toHaveBeenCalledTimes(2)

    await act(async () => {
      await user.keyboard('{Escape}')
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps focus in the dialog once the second factor is confirmed, until the answer moves it', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, list()))
    await open()
    const dialog = screen.getByRole('dialog', { name: 'Cancel unpaid tickets' })

    await giveReason(user)
    apiFetch.mockResolvedValueOnce(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Step up.' } }),
    )
    await user.click(screen.getByRole('button', { name: 'Cancel 2 unpaid tickets' }))
    await screen.findByText(/cancel these tickets/u)

    let settle

    apiFetch.mockResolvedValueOnce(answer(200, { data: { ok: true } })).mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    await user.type(screen.getByLabelText(/Your password/u), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    // While the cancellation is on its way, the heading holds focus.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Cancel unpaid tickets' })).toHaveFocus(),
    )
    expect(dialog).toContainElement(document.activeElement)

    await act(async () => {
      settle(answer(409, { error: { code: 'VENUE_NIGHT_OVER', message: 'That night is over.' } }))
    })

    const refusal = await screen.findByText('That night is over.')

    await waitFor(() => expect(document.activeElement).toBe(refusal.closest('[tabindex="-1"]')))
  })

  it('puts field errors in a summary that takes focus, and sends nothing', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, list()))
    await open()

    await user.type(screen.getByLabelText(/^Reason/u), 'Too short')
    await user.click(screen.getByRole('button', { name: 'Cancel 2 unpaid tickets' }))

    const summary = await screen.findByText('One thing to fix before cancelling')

    await waitFor(() => expect(document.activeElement).toBe(summary.parentElement))
    expect(
      screen.getByRole('link', { name: 'Give a reason of at least 10 characters.' }),
    ).toHaveAttribute('href', expect.stringMatching(/-reason$/u))
    expect(screen.getByLabelText(/^Reason/u)).toHaveAttribute('aria-invalid', 'true')
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      409,
      'VENUE_NIGHT_OVER',
      'That night is over. Tickets not paid by then stay as they are, and the booking fee is kept.',
    ],
    [
      409,
      'VENUE_CANCEL_NOT_LIVE',
      "This event is not running now, so its unpaid tickets can't be cancelled.",
    ],
    [
      409,
      'REFUND_IN_PROGRESS',
      'A refund of this booking is being processed. Cancel its unpaid tickets once it has finished.',
    ],
    [
      403,
      'CONFLICT_OF_INTEREST',
      'You belong to this event’s organisation, so another administrator has to do this.',
    ],
    // What the API sends for a change that waited too long behind another
    // (`budgetedTransaction`): 503 SERVICE_UNAVAILABLE with its sentence.
    [
      503,
      'SERVICE_UNAVAILABLE',
      'Another change to this booking was being saved at the same moment, so nothing was cancelled. Try again in a moment.',
    ],
  ])('says the API’s sentence for %s %s, and cancels nothing', async (status, code, message) => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, list()))
    const { onCancelled } = await open()

    await giveReason(user)
    apiFetch.mockResolvedValueOnce(answer(status, { error: { code, message } }))
    await user.click(screen.getByRole('button', { name: 'Cancel 2 unpaid tickets' }))

    const said = await screen.findByText(message)

    expect(screen.getByText('Nothing was cancelled')).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(said.parentElement))
    expect(onCancelled).not.toHaveBeenCalled()
  })

  it.each([
    // The busy refusal's code with no sentence of the API's.
    ['SERVICE_UNAVAILABLE', undefined],
    // A code this route never sends for a busy refusal (the specification
    // once called it TRY_AGAIN): not read as one, whatever it says.
    [
      'TRY_AGAIN',
      'Another change to this booking was being saved at the same moment, so nothing was cancelled. Try again in a moment.',
    ],
  ])(
    'reads a 503 %s that is not the API’s busy answer as a fault, and cancels nothing',
    async (code, message) => {
      const user = userEvent.setup()

      apiFetch.mockResolvedValueOnce(answer(200, list()))
      const { onCancelled } = await open()

      await giveReason(user)
      apiFetch.mockResolvedValueOnce(answer(503, { error: { code, message } }))
      await user.click(screen.getByRole('button', { name: 'Cancel 2 unpaid tickets' }))

      expect(await screen.findByText(/could not finish this/u)).toBeInTheDocument()
      expect(screen.getByText('Nothing was cancelled')).toBeInTheDocument()
      expect(
        screen.queryByText(
          'Another change to this booking was being saved at the same moment, so nothing was cancelled. Try again in a moment.',
        ),
      ).toBeNull()
      expect(onCancelled).not.toHaveBeenCalled()
    },
  )

  it('reads the booking again when it changed, says why, and takes focus to the heading', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, list()))
    const { onCancelled } = await open()

    await giveReason(user)

    const changed =
      'This booking changed after you opened it: a ticket you chose was paid for at the door, let in, passed on or cancelled meanwhile. Nothing was cancelled. Look at the booking again.'

    apiFetch
      .mockResolvedValueOnce(
        answer(409, {
          error: {
            code: 'VENUE_BOOKING_CHANGED',
            message: changed,
            details: { ticketIds: [IDS[1]] },
          },
        }),
      )
      .mockResolvedValueOnce(
        answer(200, list({ ...BOOKING, tickets: [BOOKING.tickets[0], BOOKING.tickets[2]] })),
      )
    // The heading is focused on opening: move away first, so the move back is seen.
    await user.click(screen.getByLabelText(/^Reason/u))
    await user.click(screen.getByRole('button', { name: 'Cancel 2 unpaid tickets' }))

    expect(await screen.findByText(changed)).toBeInTheDocument()
    expect(apiFetch.mock.calls[2][0]).toBe(`/v1/events/${EVENT_ID}/venue-bookings`)
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: 'Cancel unpaid tickets' }),
      ),
    )
    expect(screen.queryByLabelText(/^Ticket 2 of 3/u)).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel 1 unpaid ticket' })).toBeInTheDocument()
    // The reason typed is kept.
    expect(screen.getByLabelText(/^Reason/u)).toHaveValue('Not paid before the doors opened')
    expect(onCancelled).not.toHaveBeenCalled()
  })

  it('says nothing was cancelled when the service does not answer', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, list()))
    await open()

    await giveReason(user)
    apiFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await user.click(screen.getByRole('button', { name: 'Cancel 2 unpaid tickets' }))

    expect(
      await screen.findByText('The service is not responding. Nothing has been cancelled.'),
    ).toBeInTheDocument()
  })

  it('closes on "Keep them" without sending anything', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, list()))
    const { onClose } = await open()

    await user.click(screen.getByRole('button', { name: 'Keep them' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(answer(200, list()))
    const { onClose } = await open()

    await act(async () => {
      await user.keyboard('{Escape}')
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('the words', () => {
  it('says every place is back on sale only when every one is', () => {
    expect(cancellationOutcome(cancellation().data)).toBe(
      '2 tickets cancelled. Their places are back on sale.',
    )
    expect(cancellationOutcome(cancellation({ ticketCount: 1 }).data)).toBe(
      '1 ticket cancelled. Its place is back on sale.',
    )
  })

  it('says a freed place is not on sale now when its sales are closed or paused', () => {
    expect(cancellationOutcome(cancellation({ ticketCount: 1, placesOnSale: 'NONE' }).data)).toBe(
      '1 ticket cancelled. Its place is free again but not on sale now: sales for it are closed or paused.',
    )
    expect(cancellationOutcome(cancellation({ placesOnSale: 'NONE' }).data)).toBe(
      '2 tickets cancelled. Their places are free again but not on sale now: sales for them are closed or paused.',
    )
    expect(cancellationOutcome(cancellation({ placesOnSale: 'SOME' }).data)).toBe(
      '2 tickets cancelled. Their places are free again; some are back on sale, and sales for the others are closed or paused.',
    )
  })

  it('tells the organiser, and only the organiser, to open sales when the event’s sales are stopped', () => {
    expect(
      cancellationOutcome(
        cancellation({ placesOnSale: 'NONE', eventSalesStopped: true, by: 'ORGANISER' }).data,
      ),
    ).toBe(
      '2 tickets cancelled. Their places are free again but not on sale now: sales for them are closed or paused. Open sales on the event page to sell them.',
    )
    expect(
      cancellationOutcome(
        cancellation({ ticketCount: 1, placesOnSale: 'NONE', eventSalesStopped: true }).data,
      ),
    ).toMatch(/Open sales on the event page to sell it\.$/u)
    expect(
      cancellationOutcome(
        cancellation({
          placesOnSale: 'NONE',
          eventSalesStopped: true,
          by: 'DESI_EVENT',
          byName: null,
        }).data,
      ),
    ).not.toMatch(/Open sales/u)
  })

  it('says a replay was already done, by whom when named, and when', () => {
    expect(cancellationOutcome(cancellation({ replayed: true }).data)).toBe(
      'These tickets were already cancelled by Meera Owner at Oct 12, 2026, 9:05 PM UTC.',
    )
    expect(cancellationOutcome(cancellation({ replayed: true, byName: null }).data)).toBe(
      'These tickets were already cancelled at Oct 12, 2026, 9:05 PM UTC.',
    )
    expect(instantWords(null)).toBe('')
  })

  it('says when a replay was done as the event keeps time, naming its zone', () => {
    // 21:05 UTC is 4:05 PM in Chicago in October.
    expect(cancellationOutcome(cancellation({ replayed: true }).data, 'America/Chicago')).toBe(
      'These tickets were already cancelled by Meera Owner at Oct 12, 2026, 4:05 PM CDT.',
    )
    expect(instantWords('2026-10-12T21:05:00.000Z', 'America/Chicago')).toBe(
      'Oct 12, 2026, 4:05 PM CDT',
    )
  })

  it('names a ticket by its attendee or its label, its night or every night, and its due', () => {
    expect(ticketWords(BOOKING.tickets[0], 'USD')).toBe('Asha Rao — Every night — $45.00')
    expect(ticketWords(BOOKING.tickets[1], 'USD')).toBe('Ticket 2 of 3 — Saturday — $45.00')
    // An event with no nights has no night to name.
    expect(ticketWords(ticket(0, { everyNight: false }), 'USD')).toBe('Ticket 1 of 3 — $45.00')
  })

  it('asks for a ticket and a reason of 10 to 500 characters', () => {
    expect(cancellationProblems([], 'Not paid before the doors opened')).toEqual([
      { field: 'tickets', message: 'Choose at least one ticket.' },
    ])
    expect(cancellationProblems([IDS[0]], '   short   ')).toEqual([
      { field: 'reason', message: 'Give a reason of at least 10 characters.' },
    ])
    expect(cancellationProblems([IDS[0]], 'x'.repeat(501))).toEqual([
      { field: 'reason', message: '500 characters at most.' },
    ])
    expect(cancellationProblems([IDS[0]], 'x'.repeat(500))).toEqual([])
  })
})
