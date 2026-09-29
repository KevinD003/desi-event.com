import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { PromoCodeForm, promoFormProblems, promoRequestBody } = await import('./promo-code-form.jsx')

const ORGANIZATION = 'orgmirrorwork'
const EVENTS = [
  { id: 'evninenights', title: 'Nine Nights', timezone: 'America/Chicago', currency: 'USD' },
  { id: 'evcanadanight', title: 'Toronto Night', timezone: 'America/Toronto', currency: 'CAD' },
]

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

/** What the API answers for a made code. */
const MADE = {
  data: {
    id: 'prsave10xxxxx',
    organizationId: ORGANIZATION,
    code: 'SAVE10',
    type: 'PERCENTAGE',
    value: 1000,
    status: 'ACTIVE',
  },
}

/**
 * Render the form.
 *
 * @param {object} [props] Props overriding the defaults.
 * @returns {object} A `userEvent` session.
 */
function renderForm(props = {}) {
  render(
    <PromoCodeForm
      organizationId={ORGANIZATION}
      events={EVENTS}
      timeZone="America/New_York"
      {...props}
    />,
  )

  return userEvent.setup()
}

/**
 * The body of the n-th call to the API.
 *
 * @param {number} index Which call.
 * @returns {object} The parsed body.
 */
function sentBody(index = 0) {
  return JSON.parse(apiFetch.mock.calls[index][1].body)
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('what the form sends', () => {
  it('turns a percentage into basis points and a window into instants in the stated zone', () => {
    expect(
      promoRequestBody(
        {
          code: ' save10 ',
          type: 'PERCENTAGE',
          value: '12.5',
          currency: 'USD',
          eventId: '',
          maxRedemptions: '50',
          startsAt: '2026-10-01T09:00',
          endsAt: '',
          startPaused: true,
        },
        'America/New_York',
      ),
    ).toEqual({
      code: 'SAVE10',
      type: 'PERCENTAGE',
      value: 1250,
      currency: null,
      eventId: null,
      maxRedemptions: 50,
      startsAt: '2026-10-01T13:00:00.000Z',
      endsAt: null,
      active: false,
    })
  })

  it('turns an amount into minor units in its currency', () => {
    expect(
      promoRequestBody(
        {
          code: 'FIVE',
          type: 'FIXED_AMOUNT',
          value: '5.00',
          currency: 'CAD',
          eventId: 'evcanadanight',
          maxRedemptions: '',
          startsAt: '',
          endsAt: '',
          startPaused: false,
        },
        'America/Toronto',
      ),
    ).toMatchObject({ value: 500, currency: 'CAD', eventId: 'evcanadanight', maxRedemptions: null })
  })

  it('finds every problem before anything is sent', () => {
    expect(
      promoFormProblems({
        code: 'x',
        type: 'PERCENTAGE',
        value: '12.555',
        currency: 'USD',
        maxRedemptions: '0',
        startsAt: '2026-10-02T10:00',
        endsAt: '2026-10-01T10:00',
      }),
    ).toEqual({
      code: 'A code is 3 to 32 letters, numbers, hyphens or underscores.',
      value: 'Enter a percentage above 0 and at most 100, with up to two decimals.',
      maxRedemptions: 'Leave it empty for no limit, or enter a whole number from 1.',
      endsAt: 'The end must be after the start.',
    })
  })
})

describe('making a code', () => {
  it('sends it to the organisation’s codes, says so politely and refreshes the list', async () => {
    const user = renderForm()

    apiFetch.mockResolvedValueOnce(answer(201, MADE))

    await user.type(screen.getByLabelText('Code'), 'save10')
    await user.type(screen.getByLabelText('Percentage off (%)'), '10')
    await user.click(screen.getByRole('button', { name: 'Make the code' }))

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(apiFetch.mock.calls[0][0]).toBe(`/v1/organizations/${ORGANIZATION}/promo-codes`)
    expect(apiFetch.mock.calls[0][1].method).toBe('POST')
    expect(sentBody()).toMatchObject({
      code: 'SAVE10',
      type: 'PERCENTAGE',
      value: 1000,
      active: true,
    })
    expect(screen.getByText('SAVE10 made: live.')).toBeInTheDocument()
    // The code never goes into the address.
    expect(apiFetch.mock.calls[0][0]).not.toMatch(/SAVE10/iu)
  })

  it('asks for a second factor when the API does, beside the form, then sends it again', async () => {
    const user = renderForm()

    apiFetch.mockResolvedValueOnce(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm your identity.' } }),
    )

    await user.type(screen.getByLabelText('Code'), 'save10')
    await user.type(screen.getByLabelText('Percentage off (%)'), '10')
    await user.click(screen.getByRole('button', { name: 'Make the code' }))

    const prompt = await screen.findByText(/Confirm your identity to make a promo code\./u)

    // Not nested: the prompt is a form of its own.
    expect(prompt.closest('form')).not.toBe(
      screen.getByRole('button', { name: 'Make the code' }).closest('form'),
    )
    expect(screen.getByRole('button', { name: 'Make the code' })).toBeDisabled()

    apiFetch.mockResolvedValueOnce(answer(200, { ok: true }))
    apiFetch.mockResolvedValueOnce(answer(201, MADE))

    await user.type(screen.getByLabelText(/your password/iu), 'not-a-real-password-for-a-test')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3))
    expect(apiFetch.mock.calls[1][0]).toBe('/v1/auth/step-up')
    expect(apiFetch.mock.calls[2][0]).toBe(`/v1/organizations/${ORGANIZATION}/promo-codes`)
    expect(await screen.findByText('SAVE10 made: live.')).toBeInTheDocument()
  })

  it('says beside the box when the organiser already has that code', async () => {
    const user = renderForm()

    apiFetch.mockResolvedValueOnce(
      answer(409, { error: { code: 'PROMO_CODE_TAKEN', message: 'Taken.' } }),
    )

    await user.type(screen.getByLabelText('Code'), 'save10')
    await user.type(screen.getByLabelText('Percentage off (%)'), '10')
    await user.click(screen.getByRole('button', { name: 'Make the code' }))

    const box = screen.getByLabelText('Code')

    await waitFor(() => expect(box).toHaveAttribute('aria-invalid', 'true'))
    expect(box).toHaveAccessibleDescription('This organiser already has a code called SAVE10.')
  })

  it('repeats the API’s own words for any other refusal, and marks the field it names', async () => {
    const user = renderForm()

    apiFetch.mockResolvedValueOnce(
      answer(422, {
        error: {
          code: 'UNPROCESSABLE',
          message: 'That window has already ended. Choose an end in the future.',
          issues: [{ path: 'body.endsAt', message: 'Choose an end in the future.' }],
        },
      }),
    )

    await user.type(screen.getByLabelText('Code'), 'late')
    await user.type(screen.getByLabelText('Percentage off (%)'), '10')
    await user.click(screen.getByRole('button', { name: 'Make the code' }))

    expect(
      await screen.findByText('That window has already ended. Choose an end in the future.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/^Ends/u)).toHaveAttribute('aria-invalid', 'true')
  })

  it('sends nothing while a field is wrong', async () => {
    const user = renderForm()

    await user.type(screen.getByLabelText('Code'), 'x')
    await user.click(screen.getByRole('button', { name: 'Make the code' }))

    expect(apiFetch).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Code')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('what the form offers', () => {
  it('scopes to an event, taking its currency and its zone', async () => {
    const user = renderForm()

    expect(screen.getByText(/Times are America\/New_York/u)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Applies to'), 'Toronto Night')
    await user.click(screen.getByLabelText('Fixed amount off'))

    expect(screen.getByLabelText('Currency')).toHaveValue('CAD')
    expect(screen.getByLabelText('Amount off (CAD)')).toBeInTheDocument()
    expect(screen.getByText(/Times are America\/Toronto/u)).toBeInTheDocument()
  })

  it('starts scoped to the event it was opened from', () => {
    renderForm({ defaultEventId: 'evninenights' })

    expect(screen.getByLabelText('Applies to')).toHaveValue('evninenights')
  })

  it('suggests a long code for a large discount', async () => {
    const user = renderForm()

    await user.type(screen.getByLabelText('Percentage off (%)'), '60')

    expect(
      screen.getByText('A large discount is worth a long code: a short one is easier to guess.'),
    ).toBeInTheDocument()
  })

  it('can start a code paused', async () => {
    const user = renderForm()

    apiFetch.mockResolvedValueOnce(answer(201, { data: { ...MADE.data, status: 'PAUSED' } }))

    await user.type(screen.getByLabelText('Code'), 'later')
    await user.type(screen.getByLabelText('Percentage off (%)'), '5')
    await user.click(screen.getByLabelText('Start paused'))
    await user.click(screen.getByRole('button', { name: 'Make the code' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(sentBody().active).toBe(false)
    expect(await screen.findByText('SAVE10 made: paused.')).toBeInTheDocument()
  })
})
