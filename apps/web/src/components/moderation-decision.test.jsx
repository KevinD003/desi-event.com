import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { ModerationDecision } = await import('./moderation-decision.jsx')

const event = { id: 'evtqawwalibanyan', slug: 'qawwali-under-the-banyan', status: 'REVIEW_PENDING' }

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

describe('requesting changes', () => {
  it('will not send without something the organiser can act on', async () => {
    const user = userEvent.setup()

    render(<ModerationDecision event={event} />)

    await user.click(screen.getByRole('button', { name: 'Request changes' }))

    expect(screen.getByRole('button', { name: /yes, request changes/i })).toBeDisabled()
    expect(screen.getByText(/a reason is required/i)).toBeInTheDocument()
  })

  it('sends the reason', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { status: 'CHANGES_REQUIRED' } }))

    render(<ModerationDecision event={event} />)

    await user.click(screen.getByRole('button', { name: 'Request changes' }))
    await user.type(
      screen.getByLabelText(/what the organiser needs to know/i),
      'The description does not say which language the show is in.',
    )
    await user.click(screen.getByRole('button', { name: /yes, request changes/i }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    const [path, options] = apiFetch.mock.calls[0]

    expect(path).toBe('/v1/moderation/events/evtqawwalibanyan/decision')
    expect(JSON.parse(options.body)).toEqual({
      decision: 'request_changes',
      reason: 'The description does not say which language the show is in.',
    })
  })

  it('carries a note against a specific field when one is added', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { status: 'CHANGES_REQUIRED' } }))

    render(<ModerationDecision event={event} />)

    await user.click(screen.getByRole('button', { name: 'Request changes' }))
    await user.type(
      screen.getByLabelText(/what the organiser needs to know/i),
      'Name the language.',
    )
    await user.selectOptions(screen.getByLabelText(/this note is about/i), 'description')
    await user.click(screen.getByRole('button', { name: /add this note/i }))
    await user.click(screen.getByRole('button', { name: /yes, request changes/i }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      decision: 'request_changes',
      requestedChanges: { description: 'Name the language.' },
    })
  })

  it('lets a note be taken back before it is sent', async () => {
    const user = userEvent.setup()

    render(<ModerationDecision event={event} />)

    await user.click(screen.getByRole('button', { name: 'Request changes' }))
    await user.type(
      screen.getByLabelText(/what the organiser needs to know/i),
      'Name the language.',
    )
    await user.click(screen.getByRole('button', { name: /add this note/i }))

    expect(screen.getByText('Name the language.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /remove/i }))

    expect(screen.queryByText('Name the language.')).not.toBeInTheDocument()
  })
})

describe('approving', () => {
  it('says plainly that approval is not publication', async () => {
    const user = userEvent.setup()

    render(<ModerationDecision event={event} />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(screen.getByText(/the organiser chooses when to publish/i)).toBeInTheDocument()
  })

  it('does not demand a reason', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { status: 'APPROVED' } }))

    render(<ModerationDecision event={event} />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: /yes, approve/i }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ decision: 'approve' })
  })

  it('announces the outcome rather than only drawing it', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { status: 'APPROVED' } }))

    render(<ModerationDecision event={event} />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: /yes, approve/i }))

    await waitFor(() =>
      expect(screen.getByText(/approve — this event is now APPROVED/i)).toBeInTheDocument(),
    )
  })
})

describe('rejecting', () => {
  it('needs a reason and says the submission ends', async () => {
    const user = userEvent.setup()

    render(<ModerationDecision event={event} />)

    await user.click(screen.getByRole('button', { name: 'Reject' }))

    expect(screen.getByText(/ends this submission/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /yes, reject/i })).toBeDisabled()
  })
})

describe('when the server asks the moderator to confirm who they are', () => {
  it('shows the prompt only after being told to', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm your identity.' } }),
    )

    render(<ModerationDecision event={event} />)

    // Not before. The window is server-held — that was NF-11 — and a page that
    // decided for itself when to ask would be guessing at a rule it cannot see.
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(screen.queryByText(/confirm it is you/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /yes, approve/i }))

    await waitFor(() => expect(screen.getByText(/confirm it is you/i)).toBeInTheDocument())
    expect(screen.getByText(/confirm your identity to approve this event/i)).toBeInTheDocument()
  })

  it('retries the decision once the factor is accepted', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm your identity.' } }),
    )

    render(<ModerationDecision event={event} />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: /yes, approve/i }))

    await waitFor(() => expect(screen.getByText(/confirm it is you/i)).toBeInTheDocument())

    apiFetch.mockResolvedValueOnce(answer(200, { ok: true }))
    apiFetch.mockResolvedValueOnce(answer(200, { data: { status: 'APPROVED' } }))

    await user.type(screen.getByLabelText(/your password/i), 'not-a-real-password-for-a-test')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3))

    expect(apiFetch.mock.calls[1][0]).toBe('/v1/auth/step-up')
    expect(apiFetch.mock.calls[2][0]).toBe('/v1/moderation/events/evtqawwalibanyan/decision')
  })

  it('says so when the factor is wrong, and does not decide anything', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValueOnce(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm your identity.' } }),
    )

    render(<ModerationDecision event={event} />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: /yes, approve/i }))

    await waitFor(() => expect(screen.getByText(/confirm it is you/i)).toBeInTheDocument())

    apiFetch.mockResolvedValueOnce(answer(401, { error: { message: 'That code is wrong.' } }))

    await user.type(screen.getByLabelText(/your password/i), 'not-a-real-password-for-a-test')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(screen.getByText('That code is wrong.')).toBeInTheDocument())
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })
})

describe('when the decision is refused', () => {
  it('shows what the server said', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: { message: 'This event is no longer REVIEW_PENDING; it is APPROVED.' },
      }),
    )

    render(<ModerationDecision event={event} />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: /yes, approve/i }))

    // Two moderators pressing at the same moment: the second is told, rather
    // than producing a second decision.
    await waitFor(() =>
      expect(
        screen.getByText('This event is no longer REVIEW_PENDING; it is APPROVED.'),
      ).toBeInTheDocument(),
    )
  })

  it('puts focus back on the button when the panel is dismissed', async () => {
    const user = userEvent.setup()

    render(<ModerationDecision event={event} />)

    const trigger = screen.getByRole('button', { name: 'Approve' })

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: /not now/i }))

    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
