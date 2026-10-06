import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { ModerationDecision, NO_REVISION_TO_APPROVE } = await import('./moderation-decision.jsx')
const { CONFLICT_OF_INTEREST_NOTICE, IMPORTED_EVENT_NO_EDITOR_NOTICE } =
  await import('../lib/review-independence.js')

// The revision the page showed: every decision names it, and the API refuses
// an approval that does not.
const event = {
  id: 'evtqawwalibanyan',
  slug: 'qawwali-under-the-banyan',
  status: 'REVIEW_PENDING',
  revision: 3,
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
      revision: 3,
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
      revision: 3,
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
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      decision: 'approve',
      revision: 3,
    })
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

describe('the pictures', () => {
  it('offers them as a part a note can be about, sent under the key "images"', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { status: 'CHANGES_REQUIRED' } }))

    render(<ModerationDecision event={event} />)

    await user.click(screen.getByRole('button', { name: 'Request changes' }))

    const about = screen.getByLabelText(/this note is about/i)

    expect(within(about).getByRole('option', { name: 'Pictures' })).toHaveValue('images')
    // The old key named a field that no longer exists.
    expect(within(about).queryByRole('option', { name: /cover image/i })).toBeNull()

    await user.type(
      screen.getByLabelText(/what the organiser needs to know/i),
      'The cover shows a face without consent.',
    )
    await user.selectOptions(about, 'images')
    await user.click(screen.getByRole('button', { name: /add this note/i }))

    expect(screen.getByText('Pictures:')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /yes, request changes/i }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      decision: 'request_changes',
      requestedChanges: { images: 'The cover shows a face without consent.' },
      revision: 3,
    })
  })

  it('does not offer approval when the page could not show them, and says why', async () => {
    const user = userEvent.setup()

    render(
      <ModerationDecision
        event={event}
        approveBlockedReason="Approving is not offered while the pictures cannot be shown."
      />,
    )

    const approve = screen.getByRole('button', { name: 'Approve' })

    expect(approve).toBeDisabled()
    expect(approve).toHaveAccessibleDescription(
      'Approving is not offered while the pictures cannot be shown.',
    )
    // Asking for changes, and rejecting, need no picture to have been seen.
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()

    await user.click(approve)
    expect(apiFetch).not.toHaveBeenCalled()
  })
})

describe('the version decided on', () => {
  it('sends the revision the page showed with every decision', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { status: 'APPROVED' } }))

    render(<ModerationDecision event={{ ...event, revision: 4 }} />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: /yes, approve/i }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      decision: 'approve',
      revision: 4,
    })
  })

  it('shows the refusal when the organiser changed the event since, and decides nothing', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: {
          code: 'STALE_REVISION',
          message:
            'The organiser changed this event after you opened it. Reload to review it as it is now. Nothing was decided.',
        },
      }),
    )

    render(<ModerationDecision event={{ ...event, revision: 4 }} />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: /yes, approve/i }))

    await waitFor(() =>
      expect(screen.getByText(/changed this event after you opened it/)).toBeInTheDocument(),
    )
    expect(screen.queryByText(/this event is now/i)).toBeNull()
  })
})

describe('once the event has left review', () => {
  it('keeps the announcement in the same live region when the event comes back decided', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { status: 'APPROVED' } }))

    const { rerender } = render(<ModerationDecision event={event} />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: /yes, approve/i }))

    const region = (await screen.findByText(/approve — this event is now APPROVED/i)).closest(
      '[role="status"]',
    )

    // The page's refresh hands the same component the event as it now is.
    rerender(<ModerationDecision event={{ ...event, status: 'APPROVED' }} />)

    expect(region).toBeInTheDocument()
    expect(region).toHaveTextContent('Approve — this event is now APPROVED.')
    expect(screen.getByText('Nothing to decide')).toBeInTheDocument()
    expect(screen.getByText(/this event is approved, not public\./i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('offers no decision on an event that is not waiting for review', () => {
    render(<ModerationDecision event={{ ...event, status: 'PUBLISHED' }} />)

    expect(screen.getByText('Nothing to decide')).toBeInTheDocument()
    expect(
      screen.getByText(/a decision can only be taken on something waiting for review/i),
    ).toBeInTheDocument()

    for (const name of ['Request changes', 'Approve', 'Reject']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })
})

describe('approval names the version it approves', () => {
  it('does not offer approving when the page has no revision to send, and says why', async () => {
    const user = userEvent.setup()
    const { revision: _dropped, ...unversioned } = event

    render(<ModerationDecision event={unversioned} />)

    const approve = screen.getByRole('button', { name: 'Approve' })

    expect(approve).toBeDisabled()
    expect(approve).toHaveAccessibleDescription(NO_REVISION_TO_APPROVE)

    await user.click(approve)
    expect(apiFetch).not.toHaveBeenCalled()
    // Asking for changes and rejecting are still there.
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
  })

  it('shows the API’s sentence when an approval names no revision all the same', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message:
            'Send the revision you reviewed, so a version you have not seen cannot be approved.',
        },
      }),
    )
    render(<ModerationDecision event={event} />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: /yes, approve/i }))

    expect(await screen.findByText(/a version you have not seen cannot be approved/u)).toBeVisible()
  })
})

describe('somebody else decides', () => {
  it('draws the sentence instead of the controls for a member of the organisation', () => {
    render(<ModerationDecision event={event} notYours={CONFLICT_OF_INTEREST_NOTICE} />)

    expect(screen.getByText(CONFLICT_OF_INTEREST_NOTICE)).toBeVisible()

    for (const name of ['Request changes', 'Approve', 'Reject']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it.each([
    [
      'SELF_REVIEW',
      'You sent this event for review, so somebody else on the Desi-Event team has to decide it.',
    ],
    [
      'CONFLICT_OF_INTEREST',
      'You belong to this organisation, so somebody else on the Desi-Event team has to decide this.',
    ],
  ])('shows the API’s sentence for %s', async (code, sentence) => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(403, { error: { code, message: sentence } }))
    render(<ModerationDecision event={event} />)

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: /yes, approve/i }))

    expect(await screen.findByText(sentence)).toBeVisible()
    expect(screen.queryByText(/this event is now/i)).toBeNull()
  })
})

describe('an event nobody runs on Desi-Event (a platform-held import, SPEC2-XI O16)', () => {
  it('does not offer "Request changes", and says why', () => {
    render(<ModerationDecision event={event} noEditor={IMPORTED_EVENT_NO_EDITOR_NOTICE} />)

    expect(screen.queryByRole('button', { name: 'Request changes' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
    expect(screen.getByText(IMPORTED_EVENT_NO_EDITOR_NOTICE)).toBeVisible()
    expect(IMPORTED_EVENT_NO_EDITOR_NOTICE).not.toMatch(/\byet\b|\bsoon\b/iu)
  })

  it('never says the reason goes to an organiser, nor that one publishes it', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ModerationDecision event={event} noEditor={IMPORTED_EVENT_NO_EDITOR_NOTICE} />,
    )

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(screen.getByText(/published from its import run/i)).toBeVisible()
    expect(container.textContent).not.toMatch(/organiser/iu)

    await user.click(screen.getByRole('button', { name: 'Not now' }))
    await user.click(screen.getByRole('button', { name: 'Reject' }))

    expect(screen.getByLabelText(/^reason/i)).toHaveAccessibleDescription(/sent to nobody/i)
    expect(screen.getByText(/leaves it alone until the event is deleted/i)).toBeVisible()
    expect(container.textContent).not.toMatch(/organiser/iu)
  })

  it('still rejects with the reason given', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { status: 'REJECTED' } }))
    render(<ModerationDecision event={event} noEditor={IMPORTED_EVENT_NO_EDITOR_NOTICE} />)

    await user.click(screen.getByRole('button', { name: 'Reject' }))
    await user.type(screen.getByLabelText(/^reason/i), 'Not an event we list.')
    await user.click(screen.getByRole('button', { name: /yes, reject/i }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toMatchObject({
      decision: 'reject',
      reason: 'Not an event we list.',
      revision: 3,
    })
  })
})
