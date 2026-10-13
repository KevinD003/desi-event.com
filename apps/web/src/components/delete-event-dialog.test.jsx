import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { DeleteEventDialog } = await import('./delete-event-dialog.jsx')

const EVENT = { id: 'cevent0000000000000000001', title: 'Diwali Mela', slug: 'diwali-mela-2026' }
const REASON = 'The venue closed for repairs and no other date works.'

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

/**
 * A deletion preview.
 *
 * @param {object} [overrides] Fields to change.
 * @param {object} [counts] Counts to change.
 * @returns {object} The preview.
 */
function preview(overrides = {}, counts = {}) {
  return {
    eventId: EVENT.id,
    status: 'ON_SALE',
    revision: 7,
    outcome: 'CANCEL_AND_REFUND',
    choices: null,
    needsTookPlaceConfirmation: false,
    refusal: null,
    authority: 'ORGANIZATION',
    permitted: true,
    missing: null,
    counts: {
      paidOrders: 12,
      refundableCents: 48_000,
      currency: 'USD',
      pendingOrders: 0,
      paymentsInFlight: 0,
      activeHolds: 0,
      tickets: 30,
      checkIns: 0,
      zeroValueOrders: 0,
      disputedOrders: 0,
      partlyRefundedOrders: 0,
      ...counts,
    },
    slug: { value: EVENT.slug, keptRetired: true },
    paymentMode: 'MOCK',
    ...overrides,
  }
}

/**
 * Route the mocked API by path.
 *
 * @param {Record<string, Function|object>} routes Answers by `METHOD path`, in order for repeats.
 * @returns {void}
 */
function routes(routes) {
  const queues = Object.fromEntries(
    Object.entries(routes).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : [value],
    ]),
  )

  apiFetch.mockImplementation(async (path, options = {}) => {
    const key = `${options.method ?? 'GET'} ${path}`
    const queue = queues[key]

    if (!queue || queue.length === 0) throw new Error(`unexpected ${key}`)

    const next = queue.length > 1 ? queue.shift() : queue[0]

    return typeof next === 'function' ? next(options) : next
  })
}

const PREVIEW = `GET /v1/events/${EVENT.id}/deletion`
const DELETE = `POST /v1/events/${EVENT.id}/delete`
const FINISH = `POST /v1/events/${EVENT.id}/refunds/finish`

/**
 * Render the dialog and open it.
 *
 * @returns {Promise<object>} The user-event instance.
 */
async function openDialog() {
  const user = userEvent.setup()

  render(<DeleteEventDialog event={EVENT} listHref="/organizer/events" />)
  await user.click(screen.getByRole('button', { name: 'Delete this event…' }))

  return user
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('DeleteEventDialog', () => {
  it('opens on its heading, reads the preview and says what cancelling and refunding does', async () => {
    routes({ [PREVIEW]: answer(200, { data: preview() }) })
    await openDialog()

    const region = screen.getByRole('region', { name: 'Delete “Diwali Mela”' })

    expect(within(region).getByRole('heading', { name: 'Delete “Diwali Mela”' })).toHaveFocus()
    expect(
      await within(region).findByText(
        'Deleting this event cancels it, refunds what is left of each of the 12 paid orders ($480.00 in all, booking fees and tax included) and takes its page off the site.',
      ),
    ).toBeInTheDocument()
    expect(
      within(region).getByText(
        'Payments on this site are simulated, so these refunds move no real money.',
      ),
    ).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Cancel, refund and delete' })).toBeEnabled()
    expect(within(region).getByText('diwali-mela-2026', { selector: 'code' })).toBeInTheDocument()
  })

  it('says that only the booking fee paid online is refunded for bookings paid at the venue, and who holds the door money', async () => {
    routes({
      [PREVIEW]: answer(200, {
        data: preview({ atVenue: { orders: 2, ticketsPaidAtDoor: 3, paidAtDoorCents: 12_000 } }),
      }),
    })
    await openDialog()

    expect(
      await screen.findByText(
        'For tickets paid at the venue, only the booking fee paid online is refunded (simulated).',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Payment taken at the door for 3 of these tickets ($120.00) is held by the organiser. Desi-Event does not hold it and cannot refund it.',
      ),
    ).toBeInTheDocument()
  })

  it('says only who holds the door money when the deletion refunds nothing', async () => {
    routes({
      [PREVIEW]: answer(200, {
        data: preview({
          outcome: 'REMOVE_AFTER_EVENT',
          atVenue: { orders: 2, ticketsPaidAtDoor: 1, paidAtDoorCents: 4_000 },
        }),
      }),
    })
    await openDialog()

    expect(
      await screen.findByText(
        'Payment taken at the door for 1 of these tickets ($40.00) is held by the organiser. Desi-Event does not hold it and cannot refund it.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/only the booking fee paid online is refunded/u)).toBeNull()
  })

  it('says nothing about paying at the venue when no booking was made to pay there', async () => {
    routes({
      [PREVIEW]: answer(200, {
        data: preview({ atVenue: { orders: 0, ticketsPaidAtDoor: 0, paidAtDoorCents: 0 } }),
      }),
    })
    await openDialog()

    await screen.findByRole('button', { name: 'Cancel, refund and delete' })

    expect(screen.queryByText(/paid at the venue/u)).toBeNull()
    expect(screen.queryByText(/held by the organiser/u)).toBeNull()
  })

  it('says what removing an unsold event does', async () => {
    routes({ [PREVIEW]: answer(200, { data: preview({ outcome: 'REMOVE' }, { paidOrders: 0 }) }) })
    await openDialog()

    expect(await screen.findByText(/Nobody has bought a ticket to this event\./)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Delete this event' })).toBeInTheDocument()
  })

  it('shows the server’s refusal, and the sentence for somebody who may not decide', async () => {
    routes({
      [PREVIEW]: [
        answer(200, {
          data: preview({
            outcome: null,
            permitted: false,
            refusal: { code: 'EVENT_IN_PROGRESS', message: 'A night of this event has started.' },
          }),
        }),
        answer(200, {
          data: preview({ permitted: false, missing: 'Ask an organisation owner.' }),
        }),
      ],
    })
    const user = await openDialog()

    expect(await screen.findByText('A night of this event has started.')).toBeVisible()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Delete this event…' }))

    expect(await screen.findByText('Ask an organisation owner.')).toBeVisible()
    expect(screen.queryByRole('button', { name: /refund and delete/ })).not.toBeInTheDocument()
  })

  it('keeps the button enabled and says, in the summary, why a mistyped address does not delete', async () => {
    routes({ [PREVIEW]: answer(200, { data: preview() }) })
    const user = await openDialog()

    await screen.findByText(/refunds what is left/)
    await user.type(screen.getByLabelText(/Why is this event being deleted/), REASON)
    await user.type(screen.getByLabelText(/to confirm/), 'diwali-mela')
    await user.click(screen.getByRole('button', { name: 'Cancel, refund and delete' }))

    const link = await screen.findByRole('link', {
      name: 'That is not this event’s web address. Type it exactly as shown.',
    })

    expect(link.getAttribute('href')).toMatch(/-slug$/)
    expect(screen.getByLabelText(/to confirm/)).toHaveAttribute('aria-invalid', 'true')
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('takes a pasted address, compared without case, and sends the outcome it showed', async () => {
    routes({
      [PREVIEW]: answer(200, { data: preview() }),
      [DELETE]: answer(200, {
        data: {
          event: { id: EVENT.id, status: 'DELETED' },
          refunds: {
            owed: 12,
            settled: 12,
            waiting: 0,
            failed: 0,
            disputed: 0,
            amountCents: 48_000,
            currency: 'USD',
          },
        },
      }),
    })
    const user = await openDialog()

    await screen.findByText(/refunds what is left/)
    await user.type(screen.getByLabelText(/Why is this event being deleted/), REASON)

    const confirm = screen.getByLabelText(/to confirm/)

    expect(confirm).toHaveAttribute('autocomplete', 'off')
    expect(confirm).toHaveAttribute('autocapitalize', 'none')
    expect(confirm).toHaveAttribute('spellcheck', 'false')

    await user.click(confirm)
    await user.paste(' Diwali-Mela-2026 ')
    await user.click(screen.getByRole('button', { name: 'Cancel, refund and delete' }))

    expect(await screen.findByText(/12 orders refunded \(\$480\.00\)\./)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to your events' })).toHaveAttribute(
      'href',
      '/organizer/events?deleted=1',
    )

    const [, options] = apiFetch.mock.calls.find(([, init]) => init?.method === 'POST')

    expect(JSON.parse(options.body)).toEqual({
      revision: 7,
      reason: REASON,
      confirmSlug: 'Diwali-Mela-2026',
      expectedOutcome: 'CANCEL_AND_REFUND',
    })
  })

  it('asks the person to say whether a finished event took place, and confirms it when it did', async () => {
    routes({
      [PREVIEW]: answer(200, {
        data: preview({
          outcome: null,
          choices: ['REMOVE_AFTER_EVENT', 'CANCEL_AND_REFUND'],
          needsTookPlaceConfirmation: true,
        }),
      }),
      [DELETE]: answer(200, { data: { event: { id: EVENT.id }, refunds: null } }),
    })
    const user = await openDialog()

    const group = await screen.findByRole('group', {
      name: 'Nobody was checked in through Desi-Event, so say what happened:',
    })

    await user.type(screen.getByLabelText(/Why is this event being deleted/), REASON)
    await user.type(screen.getByLabelText(/to confirm/), EVENT.slug)
    await user.click(screen.getByRole('button', { name: 'Delete this event' }))

    expect(
      await screen.findByRole('link', { name: 'Say whether the event took place.' }),
    ).toBeVisible()

    await user.click(
      within(group).getByRole('radio', {
        name: 'It took place: take its page down and refund nobody',
      }),
    )

    expect(screen.getByText(/This event has taken place\./)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Delete this event' }))

    expect(await screen.findByText(/Nobody was owed a refund\./)).toBeVisible()

    const [, options] = apiFetch.mock.calls.find(([, init]) => init?.method === 'POST')

    expect(JSON.parse(options.body)).toMatchObject({
      expectedOutcome: 'REMOVE_AFTER_EVENT',
      confirmTookPlace: true,
    })
  })

  it('asks for the second factor when the server does, then sends again', async () => {
    let attempts = 0

    routes({
      [PREVIEW]: answer(200, { data: preview({ outcome: 'REMOVE' }, { paidOrders: 0 }) }),
      [DELETE]: () => {
        attempts += 1

        return attempts === 1
          ? answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate again.' } })
          : answer(200, { data: { event: { id: EVENT.id }, refunds: null } })
      },
      'POST /v1/auth/step-up': answer(200, { data: { ok: true } }),
    })
    const user = await openDialog()

    await screen.findByText(/Nobody has bought a ticket/)
    await user.type(screen.getByLabelText(/Why is this event being deleted/), REASON)
    await user.type(screen.getByLabelText(/to confirm/), EVENT.slug)
    await user.click(screen.getByRole('button', { name: 'Delete this event' }))

    await user.type(await screen.findByLabelText(/Your password/), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText(/Its page is off the site\./)).toBeVisible()
    expect(attempts).toBe(2)
  })

  it('reads the preview again when what deleting does changed, and keeps what was typed', async () => {
    routes({
      [PREVIEW]: [
        answer(200, { data: preview({ outcome: 'REMOVE' }, { paidOrders: 0 }) }),
        answer(200, { data: preview() }),
      ],
      [DELETE]: answer(409, {
        error: { code: 'OUTCOME_CHANGED', message: 'Somebody bought a ticket a moment ago.' },
      }),
    })
    const user = await openDialog()

    await screen.findByText(/Nobody has bought a ticket/)
    await user.type(screen.getByLabelText(/Why is this event being deleted/), REASON)
    await user.type(screen.getByLabelText(/to confirm/), EVENT.slug)
    await user.click(screen.getByRole('button', { name: 'Delete this event' }))

    expect(await screen.findByText(/Somebody bought a ticket a moment ago\./)).toBeVisible()
    expect(await screen.findByText(/refunds what is left of each of the 12/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cancel, refund and delete' })).toBeEnabled()
    expect(screen.getByLabelText(/to confirm/)).toHaveValue(EVENT.slug)
    expect(apiFetch.mock.calls.filter(([path]) => path.endsWith('/deletion')).length).toBe(2)
  })

  it('says which refunds did not go through and offers to try those again', async () => {
    routes({
      [PREVIEW]: answer(200, { data: preview() }),
      [DELETE]: answer(200, {
        data: {
          event: { id: EVENT.id },
          refunds: {
            owed: 12,
            settled: 10,
            waiting: 0,
            failed: 2,
            disputed: 0,
            amountCents: 40_000,
            currency: 'USD',
          },
        },
      }),
      [FINISH]: answer(200, {
        data: {
          owed: 2,
          settled: 2,
          waiting: 0,
          failed: 0,
          disputed: 0,
          amountCents: 8_000,
          currency: 'USD',
        },
      }),
    })
    const user = await openDialog()

    await screen.findByText(/refunds what is left/)
    await user.type(screen.getByLabelText(/Why is this event being deleted/), REASON)
    await user.type(screen.getByLabelText(/to confirm/), EVENT.slug)
    await user.click(screen.getByRole('button', { name: 'Cancel, refund and delete' }))

    expect(await screen.findByText(/10 refunded\. 2 refunds did not go through\./)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Try those again' }))

    expect(await screen.findByText(/2 orders refunded \(\$80\.00\)\./)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Try those again' })).not.toBeInTheDocument()
  })

  it('returns focus to the button that opened it, and never interrupts', async () => {
    routes({ [PREVIEW]: answer(200, { data: preview() }) })
    const user = await openDialog()

    await screen.findByText(/refunds what is left/)
    expect(document.querySelector('[role="alert"], [aria-live="assertive"]')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete this event…' })).toHaveFocus(),
    )
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})
