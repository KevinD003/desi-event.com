import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { apiFetch } = await import('../../lib/api-fetch.js')
const { RequestActions } = await import('./request-actions.jsx')

/** The organisation these tests act in. */
const ORGANIZATION = 'org00000000000000000001'

/**
 * A privacy request in a given state.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} A request payload.
 */
function request(overrides = {}) {
  return {
    id: 'preq0000000000000000001',
    subjectId: 'usr00000000000000000001',
    state: 'REQUESTED',
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

/**
 * The body of the one call that was made, parsed.
 *
 * @returns {object} What the browser sent.
 */
function sentBody() {
  return JSON.parse(apiFetch.mock.calls[0][1].body)
}

beforeEach(() => {
  apiFetch.mockReset()
})

/**
 * The refusal on screen: the live region that is not the hidden announcer.
 *
 * Both are polite now — only the door's outcomes interrupt — so the role alone
 * no longer tells them apart.
 *
 * @returns {Promise<HTMLElement>} The refusal.
 */
async function findRefusal() {
  return waitFor(() => {
    const found = screen
      .getAllByRole('status')
      .find((element) => !element.classList.contains('sr-only'))

    expect(found).toBeTruthy()

    return found
  })
}

describe('the browser is given no authority it should not have', () => {
  // The whole security argument of this component. `privacyRequestConfirmSchema`
  // has no `confirmed`, no `force` and no `skipHolds` precisely so that a
  // replayed request cannot erase somebody; sending one from here would invent
  // the hole the schema was shaped to avoid.
  it('sends the confirmation phrase and nothing else', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: request({ state: 'QUEUED' }) }))

    render(
      <RequestActions organizationId={ORGANIZATION} request={request()} canConfirm canCancel />,
    )

    await user.click(screen.getByRole('button', { name: 'Confirm erasure' }))
    await user.type(screen.getByLabelText('Confirmation phrase'), 'orange-harbour-lantern')
    await user.click(screen.getByRole('button', { name: 'Erase' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    expect(sentBody()).toEqual({ confirmationPhrase: 'orange-harbour-lantern' })
  })

  it.each([
    'confirmed',
    'force',
    'skipHolds',
    'organizationId',
    'state',
    'policyVersion',
    'idempotencyKey',
    'confirmationDigest',
    'leaseOwner',
    'outcomeCode',
  ])('never sends %s', async (field) => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: request({ state: 'QUEUED' }) }))

    render(<RequestActions organizationId={ORGANIZATION} request={request()} canConfirm />)

    await user.click(screen.getByRole('button', { name: 'Confirm erasure' }))
    await user.type(screen.getByLabelText('Confirmation phrase'), 'a-phrase')
    await user.click(screen.getByRole('button', { name: 'Erase' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    expect(sentBody()).not.toHaveProperty(field)
  })

  it('puts the organisation in the path, where the capability guard reads it', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: request({ state: 'QUEUED' }) }))

    render(<RequestActions organizationId={ORGANIZATION} request={request()} canConfirm />)

    await user.click(screen.getByRole('button', { name: 'Confirm erasure' }))
    await user.type(screen.getByLabelText('Confirmation phrase'), 'a-phrase')
    await user.click(screen.getByRole('button', { name: 'Erase' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    expect(apiFetch.mock.calls[0][0]).toBe(
      `/v1/organizations/${ORGANIZATION}/privacy/requests/preq0000000000000000001/confirm`,
    )
  })

  it('sends only a reason code when withdrawing', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: request({ state: 'CANCELLED' }) }))

    render(<RequestActions organizationId={ORGANIZATION} request={request()} canCancel />)

    await user.click(screen.getByRole('button', { name: 'Withdraw request' }))
    await user.click(screen.getByRole('button', { name: 'Withdraw' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    expect(sentBody()).toEqual({ reasonCode: 'NO_LONGER_REQUIRED' })
  })
})

describe('the confirmation phrase is never shown back', () => {
  it('says the phrase is not recoverable from this screen', async () => {
    // The server returns the phrase once, at creation, and stores only its
    // digest. A screen that could show it back would be a screen an accidental
    // replay could act on, so the confirm panel says where the phrase comes
    // from rather than offering it.
    const user = userEvent.setup()

    render(<RequestActions organizationId={ORGANIZATION} request={request()} canConfirm />)

    await user.click(screen.getByRole('button', { name: 'Confirm erasure' }))

    expect(screen.getByRole('group').textContent).toMatch(/not shown here/iu)
    expect(screen.getByLabelText('Confirmation phrase')).toHaveValue('')
  })

  it('will not submit an empty phrase', async () => {
    const user = userEvent.setup()

    render(<RequestActions organizationId={ORGANIZATION} request={request()} canConfirm />)

    await user.click(screen.getByRole('button', { name: 'Confirm erasure' }))

    expect(screen.getByRole('button', { name: 'Erase' })).toBeDisabled()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('says plainly that a mistyped phrase changed nothing', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(422, { error: { code: 'UNPROCESSABLE' } }))

    render(<RequestActions organizationId={ORGANIZATION} request={request()} canConfirm />)

    await user.click(screen.getByRole('button', { name: 'Confirm erasure' }))
    await user.type(screen.getByLabelText('Confirmation phrase'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Erase' }))

    const alert = await findRefusal()

    expect(alert.textContent).toMatch(/nothing was changed/iu)
  })
})

describe('what is offered depends on the state', () => {
  it('offers nothing once the request is terminal', () => {
    render(
      <RequestActions
        organizationId={ORGANIZATION}
        request={request({ state: 'COMPLETED' })}
        canConfirm={false}
        canCancel={false}
      />,
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/nothing to do here/iu)).toBeInTheDocument()
  })

  it('offers withdrawal without confirmation once it is queued', () => {
    render(
      <RequestActions
        organizationId={ORGANIZATION}
        request={request({ state: 'QUEUED' })}
        canConfirm={false}
        canCancel
      />,
    )

    expect(screen.queryByRole('button', { name: 'Confirm erasure' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Withdraw request' })).toBeInTheDocument()
  })
})

describe('refusals are repeated honestly', () => {
  it('shows the step-up prompt rather than guessing when the window lapsed', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(403, { error: { code: 'STEP_UP_REQUIRED' } }))

    render(<RequestActions organizationId={ORGANIZATION} request={request()} canConfirm />)

    await user.click(screen.getByRole('button', { name: 'Confirm erasure' }))
    await user.type(screen.getByLabelText('Confirmation phrase'), 'a-phrase')
    await user.click(screen.getByRole('button', { name: 'Erase' }))

    // The prompt appears; the component never decided on its own that one was
    // needed, because the window is server-held and it cannot see the rule.
    await waitFor(() => expect(screen.getByLabelText(/password/iu)).toBeInTheDocument())
  })

  it('says a hold refusal changed nothing', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(409, { error: { code: 'REFUSED_LEGAL_HOLD' } }))

    render(<RequestActions organizationId={ORGANIZATION} request={request()} canConfirm />)

    await user.click(screen.getByRole('button', { name: 'Confirm erasure' }))
    await user.type(screen.getByLabelText('Confirmation phrase'), 'a-phrase')
    await user.click(screen.getByRole('button', { name: 'Erase' }))

    const alert = await findRefusal()

    expect(alert.textContent).toMatch(/hold is active/iu)
    expect(alert.textContent).toMatch(/nothing was changed/iu)
  })

  it('never repeats a server message verbatim', async () => {
    const user = userEvent.setup()

    // If the API's message reached the screen it could carry whatever the
    // server chose to say — on this surface, possibly a person's address.
    apiFetch.mockResolvedValue(
      answer(500, {
        error: { code: null, message: 'failed redacting buyer@example.test' },
      }),
    )

    render(<RequestActions organizationId={ORGANIZATION} request={request()} canConfirm />)

    await user.click(screen.getByRole('button', { name: 'Confirm erasure' }))
    await user.type(screen.getByLabelText('Confirmation phrase'), 'a-phrase')
    await user.click(screen.getByRole('button', { name: 'Erase' }))

    const alert = await findRefusal()

    expect(alert.textContent).not.toMatch(/buyer@example\.test/u)
  })

  it('records nothing and says so when the service cannot be reached', async () => {
    const user = userEvent.setup()

    apiFetch.mockRejectedValue(new Error('network down'))

    render(<RequestActions organizationId={ORGANIZATION} request={request()} canConfirm />)

    await user.click(screen.getByRole('button', { name: 'Confirm erasure' }))
    await user.type(screen.getByLabelText('Confirmation phrase'), 'a-phrase')
    await user.click(screen.getByRole('button', { name: 'Erase' }))

    const alert = await findRefusal()

    expect(alert.textContent).toMatch(/nothing has been recorded/iu)
  })
})

describe('keyboard and screen-reader behaviour', () => {
  it('moves focus into the panel when a command opens', async () => {
    const user = userEvent.setup()

    render(<RequestActions organizationId={ORGANIZATION} request={request()} canConfirm />)

    await user.click(screen.getByRole('button', { name: 'Confirm erasure' }))

    await waitFor(() => expect(screen.getByRole('group')).toHaveFocus())
  })

  it('puts focus back on the trigger when the panel is dismissed', async () => {
    const user = userEvent.setup()

    render(<RequestActions organizationId={ORGANIZATION} request={request()} canConfirm />)

    const trigger = screen.getByRole('button', { name: 'Confirm erasure' })

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirm erasure' })).toHaveFocus(),
    )
  })

  it('announces the outcome in a live region', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: request({ state: 'QUEUED' }) }))

    render(<RequestActions organizationId={ORGANIZATION} request={request()} canConfirm />)

    await user.click(screen.getByRole('button', { name: 'Confirm erasure' }))
    await user.type(screen.getByLabelText('Confirmation phrase'), 'a-phrase')
    await user.click(screen.getByRole('button', { name: 'Erase' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/confirmed/iu))
  })

  it('labels the panel and every control', async () => {
    const user = userEvent.setup()

    render(
      <RequestActions organizationId={ORGANIZATION} request={request()} canConfirm canCancel />,
    )

    await user.click(screen.getByRole('button', { name: 'Withdraw request' }))

    expect(screen.getByRole('group')).toHaveAccessibleName('Withdraw this request')
    expect(screen.getByLabelText('Why')).toBeInTheDocument()
  })
})
