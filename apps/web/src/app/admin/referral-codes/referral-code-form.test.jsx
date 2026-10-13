/**
 * Making and changing a referral code (SPEC3 §12.5): a generated code by
 * default, asked for with a second factor when the server wants one, shown
 * once with "Copy code" and never stored; a form that fails its own checks
 * puts focus on its summary; a change sends only what differs, with when the
 * code was read, and offers Reload when somebody else changed it first.
 *
 * @module app/admin/referral-codes/referral-code-form.test
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('../../../components/step-up-prompt.jsx', () => ({
  StepUpPrompt: ({ action, onConfirmed }) => (
    <div role="group" aria-label="Confirm it is you">
      <button type="button" onClick={onConfirmed}>
        Confirm to {action}
      </button>
    </div>
  ),
}))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { ReferralCodeForm } = await import('./referral-code-form.jsx')

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
 * A code as the API answers with it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The code.
 */
function code(overrides = {}) {
  return {
    id: 'cref00000000000000000001',
    referralCode: 'K7MPQ-3XWZD',
    label: 'Rangoli partners',
    scope: 'ALL_EVENTS',
    events: [],
    eventCount: 0,
    expiresAt: null,
    maxUses: 100,
    useCount: 0,
    usesPlaced: 0,
    usesReturned: 0,
    waived: [],
    status: 'ON',
    active: true,
    createdBy: { id: 'cuser000000000000000001', displayName: 'Anil Rao' },
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  }
}

let setItem

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
  setItem = vi.spyOn(Storage.prototype, 'setItem')
})

afterEach(() => {
  setItem.mockRestore()
})

describe('making a referral code', () => {
  it('asks for a generated code, with a second factor, and shows it once with Copy code', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(
        answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Step up.' } }),
      )
      .mockResolvedValueOnce(answer(201, { data: code() }))
    render(<ReferralCodeForm mode="create" />)

    expect(screen.getByRole('radio', { name: 'Generate a code for me' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'All events' })).toBeChecked()
    expect(screen.getByLabelText('Label (optional)')).toHaveAccessibleDescription(
      "For the Desi-Event team only, for example the partner organisation or the campaign it is for. Do not include anybody's personal details.",
    )
    expect(screen.getByLabelText('Limit (optional)')).toHaveAccessibleDescription(
      'How many orders can use it in all.',
    )
    expect(screen.getByLabelText(/^Expires \(optional, /u)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Label (optional)'), 'Rangoli partners')
    await user.click(screen.getByRole('button', { name: 'Make referral code' }))
    await user.click(
      await screen.findByRole('button', { name: 'Confirm to make this referral code' }),
    )

    const heading = await screen.findByRole('heading', { name: 'Referral code made' })

    await waitFor(() => expect(heading).toHaveFocus())
    expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toEqual({
      generate: true,
      label: 'Rangoli partners',
      scope: 'ALL_EVENTS',
    })
    expect(screen.getByText('K7MPQ-3XWZD')).toHaveClass('font-mono')
    expect(
      screen.getByRole('button', { name: 'Copy code for Rangoli partners' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Give this code only to the people it is for.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the code’s page' })).toHaveAttribute(
      'href',
      '/admin/referral-codes/cref00000000000000000001',
    )
    expect(setItem).not.toHaveBeenCalled()
    expect(window.location.href).not.toContain('K7MPQ')
  })

  it('puts the typed code’s problem in a summary that takes focus, before sending anything', async () => {
    const user = userEvent.setup()

    render(<ReferralCodeForm mode="create" />)

    await user.click(screen.getByRole('radio', { name: 'I’ll type one' }))

    const typed = screen.getByLabelText('Referral code')

    expect(typed).toHaveAccessibleDescription(
      '6 to 32 letters, numbers or single hyphens. Short or common words are easy to guess.',
    )
    await user.type(typed, 'ab')
    await user.type(screen.getByLabelText('Limit (optional)'), '0')
    await user.click(screen.getByRole('button', { name: 'Make referral code' }))

    const summary = (await screen.findByText('Check these and try again')).closest(
      '[tabindex="-1"]',
    )

    await waitFor(() => expect(summary).toHaveFocus())
    expect(
      within(summary).getByRole('link', {
        name: '6 to 32 letters, numbers or single hyphens, starting and ending with a letter or number.',
      }),
    ).toHaveAttribute('href', expect.stringMatching(/-code$/u))
    expect(within(summary).getByRole('link', { name: 'From 1 to 1,000,000.' })).toBeInTheDocument()
    expect(typed).toHaveAttribute('aria-invalid', 'true')
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('asks for at least one event when the code is for chosen events', async () => {
    const user = userEvent.setup()

    render(<ReferralCodeForm mode="create" />)

    await user.click(screen.getByRole('radio', { name: 'Chosen events' }))
    await user.click(screen.getByRole('button', { name: 'Make referral code' }))

    expect(
      await screen.findByRole('link', { name: 'Choose at least one event.' }),
    ).toBeInTheDocument()
  })

  it('shows the API’s sentence when a typed code is taken, and takes focus there', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(409, {
        error: {
          code: 'REFERRAL_CODE_TAKEN',
          message: 'That code is already in use. Choose another, or generate one.',
        },
      }),
    )
    render(<ReferralCodeForm mode="create" />)

    await user.click(screen.getByRole('radio', { name: 'I’ll type one' }))
    await user.type(screen.getByLabelText('Referral code'), 'partner-2026')
    await user.click(screen.getByRole('button', { name: 'Make referral code' }))

    const refusal = await screen.findByText(
      'That code is already in use. Choose another, or generate one.',
    )

    await waitFor(() => expect(refusal.closest('[tabindex="-1"]')).toHaveFocus())
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toMatchObject({
      referralCode: 'PARTNER-2026',
    })
  })
})

describe('a code the service could not make', () => {
  it('shows the API’s sentence for a 503, not a fault nothing can fix', async () => {
    const user = userEvent.setup()
    const sentence =
      'The generated codes were already in use, so no code was made. Try again in a moment.'

    apiFetch.mockResolvedValueOnce(answer(503, { error: { code: 'TRY_AGAIN', message: sentence } }))
    render(<ReferralCodeForm mode="create" />)

    await user.click(screen.getByRole('button', { name: 'Make referral code' }))

    const refusal = await screen.findByText(sentence)

    await waitFor(() => expect(refusal.closest('[tabindex="-1"]')).toHaveFocus())
    expect(screen.queryByText(/nothing you do on this page will fix it/u)).toBeNull()
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toMatchObject({ generate: true })
  })
})

describe('changing a referral code', () => {
  it('sends only what changed, with when it was read, and says it saved', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(200, { data: code({ maxUses: 250, updatedAt: '2026-10-12T09:00:00.000Z' }) }),
    )
    render(<ReferralCodeForm mode="edit" code={code()} />)

    expect(screen.queryByRole('radio', { name: 'Generate a code for me' })).toBeNull()

    const limit = screen.getByLabelText('Limit (optional)')

    await user.clear(limit)
    await user.type(limit, '250')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument()

    const [path, options] = apiFetch.mock.calls[0]

    expect(path).toBe('/v1/platform/referral-codes/cref00000000000000000001')
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body)).toEqual({
      maxUses: 250,
      expectedUpdatedAt: '2026-10-01T10:00:00.000Z',
    })
    expect(refresh).toHaveBeenCalled()
  })

  it('offers Reload when another administrator changed the code first', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(409, {
        error: {
          code: 'REFERRAL_CODE_CHANGED',
          message: 'Another administrator changed this code after you opened it. Reload to see it.',
        },
      }),
    )
    render(<ReferralCodeForm mode="edit" code={code()} />)

    await user.clear(screen.getByLabelText('Label (optional)'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByText(
        'Another administrator changed this code after you opened it. Reload to see it.',
      ),
    ).toBeInTheDocument()
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      label: null,
      expectedUpdatedAt: '2026-10-01T10:00:00.000Z',
    })

    await user.click(screen.getByRole('button', { name: 'Reload' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shows the API’s sentence for a limit below the uses that count now', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(422, {
        error: {
          code: 'REFERRAL_LIMIT_BELOW_USES',
          message: "It has been used 12 times already, so its limit can't be lower than that.",
        },
      }),
    )
    render(<ReferralCodeForm mode="edit" code={code({ useCount: 12 })} />)

    const limit = screen.getByLabelText('Limit (optional)')

    await user.clear(limit)
    await user.type(limit, '5')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByText(
        "It has been used 12 times already, so its limit can't be lower than that.",
      ),
    ).toBeInTheDocument()
  })

  it('says nothing changed rather than sending an empty change', async () => {
    const user = userEvent.setup()

    render(<ReferralCodeForm mode="edit" code={code()} />)

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByRole('link', {
        name: 'Nothing has changed. Change something, then save.',
      }),
    ).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('says only some of many chosen events can be shown, and that choosing replaces them', () => {
    render(
      <ReferralCodeForm
        mode="edit"
        code={code({
          scope: 'SELECTED_EVENTS',
          events: [{ id: 'e1', title: 'Diwali Mela', slug: 'd', status: 'ON_SALE' }],
          eventCount: 7,
        })}
      />,
    )

    expect(
      screen.getByText(
        'This code works for 7 events; only 1 of them can be shown here. Adding or removing an event replaces all 7 with the events chosen here.',
      ),
    ).toBeInTheDocument()
  })
})
