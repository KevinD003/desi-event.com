import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { apiFetch } = await import('../../lib/api-fetch.js')
const { HoldActions } = await import('./hold-actions.jsx')

/** The organisation these tests act in. */
const ORGANIZATION = 'org00000000000000000001'

/**
 * An active hold.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} A hold payload.
 */
function hold(overrides = {}) {
  return {
    id: 'hold0000000000000000001',
    subjectId: 'usr00000000000000000001',
    kind: 'LEGAL',
    state: 'ACTIVE',
    matterReference: 'MATTER-2026-0001',
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

describe('placing a hold', () => {
  it('sends exactly the three fields the schema allows', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, { data: hold() }))

    render(<HoldActions organizationId={ORGANIZATION} />)

    await user.click(screen.getByRole('button', { name: 'Place a hold' }))
    await user.type(screen.getByLabelText('Subject id'), 'usr00000000000000000001')
    await user.type(screen.getByLabelText('Matter reference'), 'MATTER-2026-0001')
    await user.click(screen.getByRole('button', { name: 'Place' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    expect(sentBody()).toEqual({
      subjectId: 'usr00000000000000000001',
      kind: 'LEGAL',
      matterReference: 'MATTER-2026-0001',
    })
  })

  it.each(['organizationId', 'state', 'placedById', 'placedAt', 'releasedAt'])(
    'never sends %s',
    async (field) => {
      const user = userEvent.setup()

      apiFetch.mockResolvedValue(answer(201, { data: hold() }))

      render(<HoldActions organizationId={ORGANIZATION} />)

      await user.click(screen.getByRole('button', { name: 'Place a hold' }))
      await user.type(screen.getByLabelText('Subject id'), 'usr00000000000000000001')
      await user.type(screen.getByLabelText('Matter reference'), 'MATTER-1')
      await user.click(screen.getByRole('button', { name: 'Place' }))

      await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

      expect(sentBody()).not.toHaveProperty(field)
    },
  )

  it('puts the organisation in the path', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, { data: hold() }))

    render(<HoldActions organizationId={ORGANIZATION} />)

    await user.click(screen.getByRole('button', { name: 'Place a hold' }))
    await user.type(screen.getByLabelText('Subject id'), 'usr00000000000000000001')
    await user.type(screen.getByLabelText('Matter reference'), 'MATTER-1')
    await user.click(screen.getByRole('button', { name: 'Place' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    expect(apiFetch.mock.calls[0][0]).toBe(`/v1/organizations/${ORGANIZATION}/privacy/holds`)
  })

  it('warns at the point of entry that the matter reference is not a description', async () => {
    // The warning has to be visible while somebody is typing, not after they
    // submitted. What the matter is about is personal data about the person the
    // hold blocks.
    const user = userEvent.setup()

    render(<HoldActions organizationId={ORGANIZATION} />)

    await user.click(screen.getByRole('button', { name: 'Place a hold' }))

    const field = screen.getByLabelText('Matter reference')

    expect(field).toHaveAccessibleDescription(/not a description of it/iu)
    expect(field).toHaveAttribute('maxLength', '120')
  })

  it('will not submit without a subject and a usable matter reference', async () => {
    const user = userEvent.setup()

    render(<HoldActions organizationId={ORGANIZATION} />)

    await user.click(screen.getByRole('button', { name: 'Place a hold' }))

    expect(screen.getByRole('button', { name: 'Place' })).toBeDisabled()

    await user.type(screen.getByLabelText('Subject id'), 'usr00000000000000000001')
    // Two characters is under the API's minimum of three.
    await user.type(screen.getByLabelText('Matter reference'), 'ab')

    expect(screen.getByRole('button', { name: 'Place' })).toBeDisabled()
    expect(apiFetch).not.toHaveBeenCalled()
  })
})

describe('releasing a hold', () => {
  it('sends only a release reason code', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: hold({ state: 'RELEASED' }) }))

    render(<HoldActions organizationId={ORGANIZATION} hold={hold()} releaseOnly />)

    await user.click(screen.getByRole('button', { name: 'Release' }))
    await user.click(screen.getByRole('button', { name: 'Release', hidden: false }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    expect(sentBody()).toEqual({ releaseReasonCode: 'MATTER_CLOSED' })
    expect(apiFetch.mock.calls[0][0]).toBe(
      `/v1/organizations/${ORGANIZATION}/privacy/holds/hold0000000000000000001/release`,
    )
  })

  it('does not offer the placing fields', async () => {
    const user = userEvent.setup()

    render(<HoldActions organizationId={ORGANIZATION} hold={hold()} releaseOnly />)

    await user.click(screen.getByRole('button', { name: 'Release' }))

    expect(screen.queryByLabelText('Subject id')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Matter reference')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Why it is being released')).toBeInTheDocument()
  })
})

describe('refusals and step-up', () => {
  it('shows the step-up prompt rather than deciding for itself', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(403, { error: { code: 'STEP_UP_REQUIRED' } }))

    render(<HoldActions organizationId={ORGANIZATION} hold={hold()} releaseOnly />)

    await user.click(screen.getByRole('button', { name: 'Release' }))
    await user.click(screen.getAllByRole('button', { name: 'Release' })[0])

    await waitFor(() => expect(screen.getByLabelText(/password/iu)).toBeInTheDocument())
  })

  it('never repeats a server message verbatim', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(500, { error: { code: null, message: 'hold for buyer@example.test failed' } }),
    )

    render(<HoldActions organizationId={ORGANIZATION} hold={hold()} releaseOnly />)

    await user.click(screen.getByRole('button', { name: 'Release' }))
    await user.click(screen.getAllByRole('button', { name: 'Release' })[0])

    const alert = await findRefusal()

    expect(alert.textContent).not.toMatch(/buyer@example\.test/u)
  })
})

describe('keyboard behaviour', () => {
  it('moves focus into the panel on open', async () => {
    const user = userEvent.setup()

    render(<HoldActions organizationId={ORGANIZATION} />)

    await user.click(screen.getByRole('button', { name: 'Place a hold' }))

    await waitFor(() => expect(screen.getByRole('group')).toHaveFocus())
  })

  it('returns focus to the trigger after backing out', async () => {
    // The trigger is unmounted while the panel is open, so this only works if
    // focus is restored by effect against a live node rather than against the
    // element captured on the way in.
    const user = userEvent.setup()

    render(<HoldActions organizationId={ORGANIZATION} />)

    await user.click(screen.getByRole('button', { name: 'Place a hold' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Place a hold' })).toHaveFocus())
  })

  it('announces the outcome in a live region', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, { data: hold() }))

    render(<HoldActions organizationId={ORGANIZATION} />)

    await user.click(screen.getByRole('button', { name: 'Place a hold' }))
    await user.type(screen.getByLabelText('Subject id'), 'usr00000000000000000001')
    await user.type(screen.getByLabelText('Matter reference'), 'MATTER-1')
    await user.click(screen.getByRole('button', { name: 'Place' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/placed/iu))
  })
})
