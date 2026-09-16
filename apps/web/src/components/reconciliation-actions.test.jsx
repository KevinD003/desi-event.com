import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { ReconciliationActions } = await import('./reconciliation-actions.jsx')

/**
 * A task in a given state.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} A task payload.
 */
function task(overrides = {}) {
  return {
    id: 'rectask0000000000000001',
    kind: 'PAYMENT_TIMEOUT',
    state: 'OPEN',
    attempts: 1,
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

beforeEach(() => {
  apiFetch.mockReset()
})

describe('what is offered', () => {
  it('offers nothing to an account without the platform capability', () => {
    render(<ReconciliationActions task={task()} mayAct={false} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/platform work/i)).toBeInTheDocument()
  })

  it('offers nothing on a resolved item, and says why', () => {
    render(<ReconciliationActions task={task({ state: 'RESOLVED' })} mayAct />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/nothing here can reopen it/i)).toBeInTheDocument()
  })

  it('does not offer claiming an item somebody has already claimed', () => {
    render(<ReconciliationActions task={task({ state: 'IN_PROGRESS' })} mayAct />)

    expect(screen.queryByRole('button', { name: 'Claim it' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolve it' })).toBeInTheDocument()
  })

  it('does not offer escalating something already escalated', () => {
    render(<ReconciliationActions task={task({ state: 'ESCALATED' })} mayAct />)

    expect(screen.queryByRole('button', { name: 'Escalate it' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask the provider again' })).toBeInTheDocument()
  })

  it('never offers editing a payment, an order or a status', () => {
    render(<ReconciliationActions task={task()} mayAct />)

    const labels = screen.getAllByRole('button').map((button) => button.textContent.toLowerCase())

    for (const label of labels) {
      expect(label).not.toMatch(/edit|set status|mark paid|change amount/u)
    }
  })
})

describe('sending an action', () => {
  it('will not send a note shorter than the server accepts', async () => {
    const user = userEvent.setup()

    render(<ReconciliationActions task={task()} mayAct />)

    await user.click(screen.getByRole('button', { name: 'Escalate it' }))
    await user.type(screen.getByRole('textbox'), 'no')

    const submit = screen.getByRole('button', { name: 'Escalate it' })

    expect(submit).toBeDisabled()

    await user.click(submit)

    // Disabled in the markup and refused by the schema either way: the server's
    // minimum is four characters and this page's is the same number, read from
    // the same place rather than guessed.
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('posts the note to the escalate route', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: task({ state: 'ESCALATED' }) }))

    render(<ReconciliationActions task={task()} mayAct />)

    await user.click(screen.getByRole('button', { name: 'Escalate it' }))
    await user.type(screen.getByRole('textbox'), 'The provider support ticket is open.')
    await user.click(screen.getByRole('button', { name: 'Escalate it' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    const [path, options] = apiFetch.mock.calls[0]

    expect(path).toBe('/v1/operations/reconciliation/rectask0000000000000001/escalate')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ note: 'The provider support ticket is open.' })
  })

  it('sends a resolution alongside the note', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: task({ state: 'RESOLVED' }) }))

    render(<ReconciliationActions task={task()} mayAct />)

    await user.click(screen.getByRole('button', { name: 'Resolve it' }))
    await user.type(screen.getByRole('textbox'), 'Stripe confirms the charge succeeded.')
    await user.click(screen.getByRole('button', { name: 'Resolve it' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      resolution: 'SETTLED_FROM_PROVIDER',
      note: 'Stripe confirms the charge succeeded.',
    })
  })

  it('repeats the provider’s reason when a resolve is refused', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: {
          code: 'CONFLICT',
          message:
            'The provider and this system still disagree. Escalate it rather than closing it.',
          details: {
            verdict: 'CONFLICT',
            why: 'the provider reports 150000 INR, this system 240000',
          },
        },
      }),
    )

    render(<ReconciliationActions task={task()} mayAct />)

    await user.click(screen.getByRole('button', { name: 'Resolve it' }))
    await user.type(screen.getByRole('textbox'), 'Looks settled to me.')
    await user.click(screen.getByRole('button', { name: 'Resolve it' }))

    // The item is not closed by pressing the button: the server re-queried and
    // refused, and the screen says what it said rather than pretending.
    expect(await screen.findByText(/still disagree/i)).toBeInTheDocument()
    expect(screen.getByText(/150000 INR/)).toBeInTheDocument()
  })

  it('asks for a second factor only after the server asks for one', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm your identity.' } }),
    )

    render(<ReconciliationActions task={task()} mayAct />)

    // Nothing has been refused yet, so nothing is asked.
    await user.click(screen.getByRole('button', { name: 'Claim it' }))
    expect(screen.queryByLabelText(/code/i)).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Claim it' })[0])

    expect(await screen.findByRole('button', { name: /confirm/i })).toBeInTheDocument()
  })

  it('says nothing was recorded when the service does not answer', async () => {
    const user = userEvent.setup()

    apiFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    render(<ReconciliationActions task={task()} mayAct />)

    await user.click(screen.getByRole('button', { name: 'Claim it' }))
    await user.click(screen.getAllByRole('button', { name: 'Claim it' })[0])

    expect(await screen.findByText(/nothing has been recorded/i)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/ECONNREFUSED/)
  })
})
