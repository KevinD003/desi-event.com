/**
 * The Desi-Event team's "Booking fee and payment" panel (SPEC3 §12.3,
 * SPEC3-XI §12.3): every state says the specification's words, a write sends
 * what the administrator read as its precondition, a refused form puts focus
 * on its summary, and the server's demand for a second factor is answered by
 * asking for one and sending the same write again.
 *
 * @module components/payment-terms-panel.test
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
// A form of its own, as the real prompt is, so a prompt inside the panel's
// forms would be a form inside a form.
vi.mock('./step-up-prompt.jsx', () => ({
  StepUpPrompt: ({ action, onConfirmed }) => (
    <div role="group" aria-label="Confirm it is you">
      <button type="button" onClick={onConfirmed}>
        Confirm to {action}
      </button>
    </div>
  ),
}))

const { apiFetch } = await import('../lib/api-fetch.js')
const { FEE_NOTE, PaymentTermsPanel, VENUE_INTRODUCTION, VENUE_LIMIT_HINT, VENUE_OFF_NOTE } =
  await import('./payment-terms-panel.jsx')

/** A reason long enough for the server. */
const REASON = 'Agreed with the organiser for this launch.'

/**
 * The admin view of an event's terms.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The view.
 */
function terms(overrides = {}) {
  const { fee = {}, venuePayment = {}, ...rest } = overrides

  return {
    eventId: 'cevent0000000000000000001',
    eventStatus: 'ON_SALE',
    isOnline: false,
    soldOnSource: false,
    posted: true,
    fee: {
      source: 'SITE_DEFAULT',
      percentageBps: 450,
      flatCentsPerTicket: 151,
      currency: 'USD',
      sequence: 0,
      changedAt: null,
      changedByName: null,
      reason: null,
      ...fee,
    },
    siteDefault: { currency: 'USD', percentageBps: 450, flatCentsPerTicket: 151 },
    venuePayment: {
      enabled: false,
      limit: null,
      offered: false,
      changedAt: null,
      changedByName: null,
      reason: null,
      hasOrders: false,
      unpaidTickets: 0,
      paidAtDoorTickets: 0,
      paidAtDoorCents: 0,
      ...venuePayment,
    },
    history: [],
    historyHasMore: false,
    ...rest,
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
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  }
}

/**
 * Render the panel.
 *
 * @param {object} [props] Props to change.
 * @returns {object} A userEvent session.
 */
function renderPanel(props = {}) {
  render(
    <PaymentTermsPanel
      eventId="cevent0000000000000000001"
      terms={terms()}
      example={{ priceCents: 4_000, currency: 'USD' }}
      timeZone="UTC"
      {...props}
    />,
  )

  return userEvent.setup()
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('the booking fee', () => {
  it('says which fee is in force and gives a live example for the cheapest paid ticket', async () => {
    const user = renderPanel()

    expect(screen.getByRole('heading', { name: 'Booking fee and payment' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Site default: 4.50% of the ticket price plus $1.51 per ticket. The site default is set in the server’s settings.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByTestId('fee-example')).toHaveTextContent(
      'A $40.00 ticket would carry a booking fee of $3.31.',
    )
    expect(screen.getByText(FEE_NOTE)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Set this event’s own fee' }))
    await user.clear(screen.getByLabelText('Percentage of the ticket price'))
    await user.type(screen.getByLabelText('Percentage of the ticket price'), '3')
    await user.clear(screen.getByLabelText('Amount per ticket (USD)'))
    await user.type(screen.getByLabelText('Amount per ticket (USD)'), '1.00')

    expect(screen.getByTestId('fee-example')).toHaveTextContent(
      'A $40.00 ticket would carry a booking fee of $2.20.',
    )
  })

  it('says there is no booking fee when there are no paid tickets', () => {
    renderPanel({ example: null })

    expect(screen.getByTestId('fee-example')).toHaveTextContent(
      'This event has no paid tickets, so no booking fee is charged.',
    )
  })

  it('reads 0% + $0.00 as no booking fee', () => {
    renderPanel({
      terms: terms({ fee: { source: 'EVENT', percentageBps: 0, flatCentsPerTicket: 0 } }),
    })

    expect(screen.getByText('This event has no booking fee.')).toBeInTheDocument()
  })

  it('shows the amount with its currency’s sign in front, and the reason’s description', async () => {
    const user = renderPanel()

    await user.click(screen.getByRole('radio', { name: 'Set this event’s own fee' }))

    const amount = screen.getByLabelText('Amount per ticket (USD)')

    expect(amount.parentElement).toHaveTextContent('$')
    expect(screen.getAllByLabelText(/^Reason/u)[0]).toHaveAccessibleDescription(
      expect.stringContaining(
        "Shown to the organiser with your name. Do not include anybody's personal details. At least 10 characters.",
      ),
    )
  })

  it('puts every problem in a summary that takes focus, and under each field', async () => {
    const user = renderPanel()

    await user.click(screen.getByRole('radio', { name: 'Set this event’s own fee' }))
    await user.clear(screen.getByLabelText('Percentage of the ticket price'))
    await user.type(screen.getByLabelText('Percentage of the ticket price'), '31')
    await user.clear(screen.getByLabelText('Amount per ticket (USD)'))
    await user.type(screen.getByLabelText('Amount per ticket (USD)'), '100.01')
    await user.click(screen.getByRole('button', { name: 'Save booking fee' }))

    const summary = await screen.findByText('Check these and try again')
    const box = summary.closest('[tabindex="-1"]')

    await waitFor(() => expect(box).toHaveFocus())
    expect(
      within(box).getByRole('link', {
        name: 'Enter a percentage from 0 to 30, with at most two decimal places.',
      }),
    ).toBeInTheDocument()
    expect(
      within(box).getByRole('link', { name: 'Enter an amount from $0.00 to $100.00.' }),
    ).toBeInTheDocument()
    expect(
      within(box).getByRole('link', { name: 'Give a reason of at least 10 characters.' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Percentage of the ticket price')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('asks for a second factor when the server does, sends the same write again, and says it saved', async () => {
    apiFetch
      .mockResolvedValueOnce(
        answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Step up.' } }),
      )
      .mockResolvedValueOnce(
        answer(200, {
          data: terms({
            fee: {
              source: 'EVENT',
              percentageBps: 300,
              flatCentsPerTicket: 100,
              sequence: 1,
              changedAt: '2026-10-11T10:00:00.000Z',
              changedByName: 'Anil',
              reason: REASON,
            },
          }),
        }),
      )
    const user = renderPanel()

    await user.click(screen.getByRole('radio', { name: 'Set this event’s own fee' }))
    await user.clear(screen.getByLabelText('Percentage of the ticket price'))
    await user.type(screen.getByLabelText('Percentage of the ticket price'), '3')
    await user.clear(screen.getByLabelText('Amount per ticket (USD)'))
    await user.type(screen.getByLabelText('Amount per ticket (USD)'), '1')
    await user.type(screen.getAllByLabelText(/^Reason/u)[0], REASON)
    await user.click(screen.getByRole('button', { name: 'Save booking fee' }))

    await user.click(
      await screen.findByRole('button', {
        name: 'Confirm to change this event’s booking fee',
      }),
    )

    expect(
      await screen.findByText('Booking fee saved. It applies to new orders from now.'),
    ).toBeInTheDocument()
    expect(apiFetch).toHaveBeenCalledTimes(2)

    const [path, options] = apiFetch.mock.calls[1]

    expect(path).toBe('/v1/platform/events/cevent0000000000000000001/platform-fee')
    expect(JSON.parse(options.body)).toEqual({
      source: 'EVENT',
      percentageBps: 300,
      flatCentsPerTicket: 100,
      reason: REASON,
      expectedSequence: 0,
    })
    expect(
      screen.getByText('This event: 3.00% of the ticket price plus $1.00 per ticket.'),
    ).toBeInTheDocument()
  })

  it('offers Reload when somebody else changed the terms first', async () => {
    apiFetch.mockResolvedValueOnce(
      answer(409, {
        error: {
          code: 'PAYMENT_TERMS_CHANGED',
          message:
            "Another administrator changed this event's payment settings after you opened the page. Reload to see them. Nothing was changed.",
        },
      }),
    )
    const user = renderPanel()

    await user.type(screen.getAllByLabelText(/^Reason/u)[0], REASON)
    await user.click(screen.getByRole('button', { name: 'Save booking fee' }))

    const refusal = await screen.findByText(
      "Another administrator changed this event's payment settings after you opened the page. Reload to see them. Nothing was changed.",
    )

    await waitFor(() => expect(refusal.closest('[tabindex="-1"]')).toHaveFocus())
    await user.click(screen.getByRole('button', { name: 'Reload' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('a change that waited too long behind another', () => {
  it('says the API’s sentence for a 503, not a fault nothing can fix', async () => {
    const sentence =
      'Another change to this event was being saved at the same moment, so the booking fee was not changed. Try again in a moment.'

    apiFetch.mockResolvedValueOnce(
      answer(503, { error: { code: 'SERVICE_UNAVAILABLE', message: sentence } }),
    )
    const user = renderPanel()

    await user.type(screen.getAllByLabelText(/^Reason/u)[0], REASON)
    await user.click(screen.getByRole('button', { name: 'Save booking fee' }))

    const refusal = await screen.findByText(sentence)

    await waitFor(() => expect(refusal.closest('[tabindex="-1"]')).toHaveFocus())
    expect(screen.queryByText(/nothing you do on this page will fix it/u)).toBeNull()
  })
})

describe('paying at the venue', () => {
  it('reads off as "Off", with what it would do, and offers to turn it on', async () => {
    apiFetch.mockResolvedValueOnce(
      answer(200, { data: terms({ venuePayment: { enabled: true, limit: 50, offered: true } }) }),
    )
    const user = renderPanel()

    expect(screen.getByTestId('venue-status')).toHaveTextContent('Off')
    expect(screen.getByText(VENUE_INTRODUCTION)).toBeInTheDocument()
    expect(screen.getByLabelText('Most tickets waiting to be paid at the door')).toHaveValue(50)
    expect(
      screen.getByLabelText('Most tickets waiting to be paid at the door'),
    ).toHaveAccessibleDescription(VENUE_LIMIT_HINT)
    // The limit counts every unpaid ticket, whatever its night, and one whose
    // night is over can no longer be cancelled: whoever sets it is told.
    expect(VENUE_LIMIT_HINT).toBe(
      'Across all buyers. Once this many are booked and unpaid, buyers pay by card. Unpaid tickets for nights that are over still count.',
    )

    await user.type(screen.getAllByLabelText(/^Reason/u)[1], REASON)
    await user.click(screen.getByRole('button', { name: 'Turn on paying at the venue' }))

    expect(
      await screen.findByText(
        'Paying at the venue turned on, up to 50 tickets waiting to be paid at the door.',
      ),
    ).toBeInTheDocument()
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      enabled: true,
      limit: 50,
      seen: { enabled: false, limit: null },
      reason: REASON,
    })
  })

  it('reads on with its limit, how many wait now, and links to the bookings for one who may cancel', () => {
    renderPanel({
      terms: terms({
        venuePayment: { enabled: true, limit: 1500, offered: true, unpaidTickets: 3 },
      }),
      canCancelUnpaid: true,
    })

    expect(screen.getByTestId('venue-status')).toHaveTextContent(
      'On — up to 1,500 tickets waiting to be paid at the door',
    )
    expect(screen.getByText('3 tickets are waiting now.')).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'Bookings waiting to be paid at the door: 3 tickets — review',
      }),
    ).toHaveAttribute('href', '/admin/events/cevent0000000000000000001/venue-bookings')
    expect(screen.getByRole('button', { name: 'Save limit' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Turn off paying at the venue' }),
    ).toHaveAccessibleDescription(VENUE_OFF_NOTE)
  })

  it('moves focus to the button drawn in place of the one pressed, turning off and on', async () => {
    apiFetch
      .mockResolvedValueOnce(answer(200, { data: terms() }))
      .mockResolvedValueOnce(
        answer(200, { data: terms({ venuePayment: { enabled: true, limit: 50, offered: true } }) }),
      )
    const user = renderPanel({
      terms: terms({ venuePayment: { enabled: true, limit: 50, offered: true } }),
    })

    await user.type(screen.getAllByLabelText(/^Reason/u)[1], REASON)
    await user.click(screen.getByRole('button', { name: 'Turn off paying at the venue' }))

    expect(await screen.findByText(/^Paying at the venue turned off\./u)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Turn on paying at the venue' })).toHaveFocus(),
    )

    await user.type(screen.getAllByLabelText(/^Reason/u)[1], REASON)
    await user.click(screen.getByRole('button', { name: 'Turn on paying at the venue' }))

    expect(await screen.findByText(/^Paying at the venue turned on,/u)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save limit' })).toHaveFocus())
  })

  it('moves focus to the switch’s state when turning off leaves no button (an online event)', async () => {
    apiFetch.mockResolvedValueOnce(answer(200, { data: terms({ isOnline: true }) }))
    const user = renderPanel({
      terms: terms({ isOnline: true, venuePayment: { enabled: true, limit: 50 } }),
    })

    await user.type(screen.getAllByLabelText(/^Reason/u)[1], REASON)
    await user.click(screen.getByRole('button', { name: 'Turn off paying at the venue' }))

    await waitFor(() => expect(screen.getByTestId('venue-status')).toHaveFocus())
    expect(screen.getByTestId('venue-status')).toHaveTextContent('Off')
  })

  it('keeps the buttons drawn, and disabled, while a second factor is asked for', async () => {
    apiFetch.mockResolvedValueOnce(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Step up.' } }),
    )
    const user = renderPanel({
      terms: terms({ venuePayment: { enabled: true, limit: 50, offered: true } }),
    })

    await user.type(screen.getAllByLabelText(/^Reason/u)[1], REASON)
    await user.click(screen.getByRole('button', { name: 'Save limit' }))

    expect(
      await screen.findByRole('button', {
        name: 'Confirm to change paying at the venue for this event',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save limit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Turn off paying at the venue' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save booking fee' })).toBeEnabled()
  })

  it('says "ticket", not "tickets", for a limit of one', async () => {
    apiFetch.mockResolvedValueOnce(
      answer(200, { data: terms({ venuePayment: { enabled: true, limit: 1, offered: true } }) }),
    )
    const user = renderPanel()
    const box = screen.getByLabelText('Most tickets waiting to be paid at the door')

    await user.clear(box)
    await user.type(box, '1')
    await user.type(screen.getAllByLabelText(/^Reason/u)[1], REASON)
    await user.click(screen.getByRole('button', { name: 'Turn on paying at the venue' }))

    expect(
      await screen.findByText(
        'Paying at the venue turned on, up to 1 ticket waiting to be paid at the door.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByTestId('venue-status')).toHaveTextContent(
      /^On — up to 1 ticket waiting to be paid at the door$/u,
    )
  })

  it('offers no review link to a session that may not cancel unpaid tickets', () => {
    renderPanel({
      terms: terms({ venuePayment: { enabled: true, limit: 50, unpaidTickets: 1 } }),
      canCancelUnpaid: false,
    })

    expect(screen.queryByRole('link', { name: /Bookings waiting/u })).toBeNull()
  })

  it('refuses a limit out of bounds before sending anything', async () => {
    const user = renderPanel({ terms: terms({ venuePayment: { enabled: true, limit: 50 } }) })
    const box = screen.getByLabelText('Most tickets waiting to be paid at the door')

    await user.clear(box)
    await user.type(box, '0')
    await user.type(screen.getAllByLabelText(/^Reason/u)[1], REASON)
    await user.click(screen.getByRole('button', { name: 'Save limit' }))

    expect(
      await screen.findByRole('link', { name: 'Enter a whole number from 1 to 100,000.' }),
    ).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('says an online event has no venue, and offers no Turn on', () => {
    renderPanel({ terms: terms({ isOnline: true }) })

    expect(
      screen.getByText('This is an online event, so there is no venue to pay at.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Turn on paying at the venue' })).toBeNull()
  })

  it('says an online event with the switch on is not offered, and offers to turn it off', () => {
    renderPanel({ terms: terms({ isOnline: true, venuePayment: { enabled: true, limit: 50 } }) })

    expect(
      screen.getByText(
        'This event is online, so paying at the venue is not offered even though the switch is on.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn off paying at the venue' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save limit' })).toBeNull()
  })
})

describe('who may change it', () => {
  it('shows a member of the event’s organisation the terms, read-only, and why', () => {
    renderPanel({ readOnly: 'member' })

    expect(
      screen.getByText(
        'You belong to this event’s organisation, so another administrator has to change its booking fee and payment settings.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save booking fee' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Turn on paying at the venue' })).toBeNull()
  })

  it('shows a deleted event’s terms read-only, with no review link', () => {
    renderPanel({
      readOnly: 'deleted',
      canCancelUnpaid: true,
      terms: terms({ venuePayment: { enabled: true, limit: 50, unpaidTickets: 2 } }),
    })

    expect(
      screen.getByText(
        'This event was deleted. Its booking fee and payment settings are kept as they were and come back if it is restored.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Bookings waiting/u })).toBeNull()
  })

  it('says a draft can have its terms set before it is published', () => {
    renderPanel({ terms: terms({ posted: false, eventStatus: 'DRAFT' }) })

    expect(
      screen.getByText(
        'You can set this event’s booking fee and whether it can be paid for at the venue now, before it is published.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save booking fee' })).toBeInTheDocument()
  })
})

describe('the changes', () => {
  it('says when nothing was ever changed', () => {
    renderPanel()

    expect(
      screen.getByText('The booking fee and payment settings have never been changed.'),
    ).toBeInTheDocument()
  })

  it('lists the changes newest first, and offers the older ones', () => {
    renderPanel({
      terms: terms({
        history: [
          {
            kind: 'FEE',
            at: '2026-10-10T12:00:00.000Z',
            byName: 'Anil',
            source: 'EVENT',
            percentageBps: 300,
            flatCentsPerTicket: 149,
            currency: 'USD',
            reason: 'Launch rate.',
          },
        ],
        historyHasMore: true,
      }),
    })

    const list = screen.getByRole('list')

    expect(within(list).getByRole('listitem')).toHaveTextContent(
      'Sat, Oct 10, 2026 — Anil set the booking fee to 3.00% + $1.49: “Launch rate.”',
    )
    expect(screen.getByRole('link', { name: 'Show older changes' })).toHaveAttribute(
      'href',
      '/admin/events/cevent0000000000000000001?changesBefore=2026-10-10T12%3A00%3A00.000Z#payment-terms',
    )
  })
})
