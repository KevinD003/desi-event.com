/**
 * The second factor asked for in the middle of a write, with the real prompt
 * (SPEC3 §12.12): in the four SPEC3 forms that use `useStepUpRetry`, the
 * prompt is drawn outside the form it waits for, so confirming it — by the
 * button or by Enter in "Your password" — sends the waiting write once more,
 * and only once, and the page says one outcome. The prompt takes focus when it
 * is drawn, and backing out of it puts focus on what was not changed.
 *
 * Every other test of these forms replaces the prompt with a plain element,
 * which is a form of nothing: a prompt drawn inside the form passed them all
 * and sent each write twice, made two live referral codes, and refunded a
 * booking fee three times.
 *
 * @module components/step-up-retry.test
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { PaymentTermsPanel } = await import('./payment-terms-panel.jsx')
const { ReferralCodeForm } = await import('../app/admin/referral-codes/referral-code-form.jsx')
const { FeeRefundForm } = await import('../app/admin/fee-refunds/fee-refund-form.jsx')
const { STEP_UP_DECLINED_SENTENCE } = await import('./step-up-retry.jsx')

/** A reason long enough for the server. */
const REASON = 'Agreed with the organiser for this launch.'

/**
 * A Response-shaped stub.
 *
 * @param {number} status The status.
 * @param {object} body The body.
 * @returns {object} The stub.
 */
function answer(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  }
}

const STEP_UP = answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Step up.' } })

/**
 * A server that wants a second factor before the write at `path`, and counts
 * every write sent there.
 *
 * @param {string} path The end of the write's path.
 * @param {function(object, number): object} succeed The answer to the nth write once the factor is fresh.
 * @param {Array<Array<*>>} [reads] Other paths and their answers, as `[path, answer]` pairs.
 * @returns {{writes: object[]}} The bodies of the writes sent, in order.
 */
function server(path, succeed, reads = []) {
  const writes = []
  let stepped = false

  apiFetch.mockImplementation(async (url, options = {}) => {
    if (url === '/v1/auth/step-up') {
      stepped = true
      return answer(200, { data: { ok: true } })
    }

    if (url.endsWith(path) && options.method) {
      const body = JSON.parse(options.body)

      writes.push(body)
      return stepped ? succeed(body, writes.length) : STEP_UP
    }

    const read = reads.find(([readPath]) => url.endsWith(readPath))

    return read ? read[1] : answer(500, {})
  })

  return { writes }
}

/**
 * Whether an element is drawn inside a form other than the one it is part of.
 *
 * @param {HTMLElement} element An element of the prompt.
 * @returns {boolean} True for a form inside a form.
 */
function insideAnotherForm(element) {
  return Boolean(element.closest('form')?.parentElement?.closest('form'))
}

/**
 * Confirm the prompt now on screen, by its button or by Enter in the password.
 *
 * @param {object} user A userEvent instance.
 * @param {'click'|'enter'} how Which way.
 * @returns {Promise<void>}
 */
async function confirm(user, how) {
  const password = await screen.findByLabelText(/Your password/u)

  expect(insideAnotherForm(password)).toBe(false)

  if (how === 'enter') {
    await user.type(password, 'correct horse{Enter}')
  } else {
    await user.type(password, 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
  }
}

/**
 * The admin view of an event's terms.
 *
 * @param {object} [venuePayment] Fields of the switch to change.
 * @param {number} [sequence] The fee's sequence.
 * @returns {object} The view.
 */
function terms(venuePayment = {}, sequence = 0) {
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
      sequence,
      changedAt: null,
      changedByName: null,
      reason: null,
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
  }
}

/**
 * Render the panel of the team at The Desi Events.
 *
 * @param {object} [view] The terms.
 * @returns {void}
 */
function renderPanel(view = terms()) {
  render(
    <PaymentTermsPanel
      eventId="cevent0000000000000000001"
      terms={view}
      example={{ priceCents: 4_000, currency: 'USD' }}
      timeZone="UTC"
    />,
  )
}

beforeEach(() => {
  apiFetch.mockReset()
})

describe('the booking fee', () => {
  it.each(['click', 'enter'])(
    'sends the waiting write once more when the prompt is confirmed by %s, and says one outcome',
    async (how) => {
      const user = userEvent.setup()
      // The fee's sequence moves on with a write, so a second write would be
      // refused as "changed by someone else".
      const { writes } = server('/platform-fee', (body, count) =>
        count === 2
          ? answer(200, { data: terms({}, 1) })
          : answer(409, {
              error: {
                code: 'PAYMENT_TERMS_CHANGED',
                message: 'The booking fee was changed by someone else meanwhile.',
              },
            }),
      )

      renderPanel()
      await user.type(screen.getAllByLabelText(/^Reason/u)[0], REASON)
      await user.click(screen.getByRole('button', { name: 'Save booking fee' }))

      // The prompt takes focus; the button that sent the write stays, disabled.
      const prompt = (await screen.findByLabelText(/Your password/u)).closest(
        '[data-slot="step-up-retry"]',
      )

      await waitFor(() => expect(prompt).toHaveFocus())
      expect(screen.getByRole('button', { name: 'Save booking fee' })).toBeDisabled()

      await confirm(user, how)

      expect(
        await screen.findByText('Booking fee saved. It applies to new orders from now.'),
      ).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Save booking fee' })).toHaveFocus(),
      )
      expect(writes).toHaveLength(2)
      expect(screen.queryByText('The booking fee was not changed')).toBeNull()
      expect(screen.queryByText(/changed by someone else/u)).toBeNull()
    },
  )

  it('puts focus on what was not changed when the second factor is declined', async () => {
    const user = userEvent.setup()
    const { writes } = server('/platform-fee', () => answer(200, { data: terms({}, 1) }))

    renderPanel()
    await user.type(screen.getAllByLabelText(/^Reason/u)[0], REASON)
    await user.click(screen.getByRole('button', { name: 'Save booking fee' }))
    await user.click(await screen.findByRole('button', { name: 'Not now' }))

    const said = await screen.findByText(STEP_UP_DECLINED_SENTENCE)

    await waitFor(() => expect(said.closest('[tabindex="-1"]')).toHaveFocus())
    expect(writes).toHaveLength(1)
  })
})

describe('paying at the venue', () => {
  it.each(['click', 'enter'])(
    'turns it off once, and only off, when the prompt is confirmed by %s',
    async (how) => {
      const user = userEvent.setup()
      const { writes } = server('/venue-payment', (body) =>
        answer(200, {
          data: terms(body.enabled ? { enabled: true, limit: body.limit, offered: true } : {}),
        }),
      )

      renderPanel(terms({ enabled: true, limit: 50, offered: true }))
      await user.type(screen.getAllByLabelText(/^Reason/u)[1], REASON)
      await user.click(screen.getByRole('button', { name: 'Turn off paying at the venue' }))

      const prompt = (await screen.findByLabelText(/Your password/u)).closest(
        '[data-slot="step-up-retry"]',
      )

      await waitFor(() => expect(prompt).toHaveFocus())

      await confirm(user, how)

      expect(await screen.findByText(/^Paying at the venue turned off\./u)).toBeInTheDocument()
      // Never the form's own "Save limit", which the administrator did not press.
      expect(writes.map((body) => body.enabled)).toEqual([false, false])
      // The buttons were swapped: focus is on the one drawn now.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Turn on paying at the venue' })).toHaveFocus(),
      )
    },
  )
})

describe('making a referral code', () => {
  it.each(['click', 'enter'])(
    'makes one code when the prompt is confirmed by %s, and shows that one',
    async (how) => {
      const user = userEvent.setup()
      const { writes } = server('/v1/platform/referral-codes', (body, count) =>
        answer(201, {
          data: {
            id: `cref0000000000000000000${count}`,
            referralCode: count === 2 ? 'K7MPQ-3XWZD' : 'ZZZZZ-SECND',
            label: 'Rangoli partners',
            scope: 'ALL_EVENTS',
            events: [],
            eventCount: 0,
            expiresAt: null,
            maxUses: null,
            useCount: 0,
            usesPlaced: 0,
            usesReturned: 0,
            waived: [],
            status: 'ON',
            active: true,
            createdBy: { id: 'cuser000000000000000001', displayName: 'Anil Rao' },
            createdAt: '2026-10-01T10:00:00.000Z',
            updatedAt: '2026-10-01T10:00:00.000Z',
          },
        }),
      )

      render(<ReferralCodeForm mode="create" />)
      await user.type(screen.getByLabelText('Label (optional)'), 'Rangoli partners')
      await user.click(screen.getByRole('button', { name: 'Make referral code' }))

      const prompt = (await screen.findByLabelText(/Your password/u)).closest(
        '[data-slot="step-up-retry"]',
      )

      await waitFor(() => expect(prompt).toHaveFocus())

      await confirm(user, how)

      expect(await screen.findByRole('heading', { name: 'Referral code made' })).toBeTruthy()
      expect(writes).toHaveLength(2)
      expect(screen.getByText('K7MPQ-3XWZD')).toBeInTheDocument()
      expect(screen.queryByText('ZZZZZ-SECND')).toBeNull()
    },
  )
})

describe('refunding a booking fee', () => {
  it.each(['click', 'enter'])(
    'refunds once when the prompt is confirmed by %s, and says one outcome',
    async (how) => {
      const user = userEvent.setup()
      const fee = {
        reference: 'DE-7K2M-9QPX',
        eventId: 'cevent0000000000000000001',
        eventTitle: 'Diwali Mela',
        status: 'PAID',
        paymentMethod: 'CARD',
        currency: 'USD',
        feesCents: 700,
        feeWaivedCents: 0,
        feeRefundedCents: 0,
        refundableFeeCents: 700,
        taxOnFeeCents: 0,
        feeKeptCents: 0,
        disputed: false,
      }
      const { writes } = server(
        '/fee-refund',
        (body, count) =>
          count === 2
            ? answer(200, {
                data: {
                  // As the API answers it: the refund carries its status, and
                  // only a settled one is announced as refunded.
                  refund: { id: 'crefund00000000000000001', amountCents: 700, status: 'SUCCEEDED' },
                  fee: { ...fee, refundableFeeCents: 0, feeRefundedCents: 700 },
                },
              })
            : answer(409, {
                error: {
                  code: 'NO_FEE_TO_REFUND',
                  message: 'There is no booking fee left to refund on this order.',
                },
              }),
        [['/DE-7K2M-9QPX/fee', answer(200, { data: fee })]],
      )

      render(<FeeRefundForm />)
      await user.type(screen.getByLabelText('Order reference'), 'DE-7K2M-9QPX')
      await user.click(screen.getByRole('button', { name: 'Find order' }))
      await user.type(
        await screen.findByLabelText(/^Reason/u),
        'The buyer was charged the fee twice by mistake',
      )
      await user.click(screen.getByRole('button', { name: 'Refund $7.00 booking fee (simulated)' }))

      const prompt = (await screen.findByLabelText(/Your password/u)).closest(
        '[data-slot="step-up-retry"]',
      )

      await waitFor(() => expect(prompt).toHaveFocus())

      await confirm(user, how)

      const done = await screen.findByText('Booking fee refunded (simulated): $7.00.')

      await waitFor(() => expect(done).toHaveFocus())
      expect(writes).toHaveLength(2)
      expect(screen.queryByText('The booking fee was not refunded')).toBeNull()
    },
  )
})
