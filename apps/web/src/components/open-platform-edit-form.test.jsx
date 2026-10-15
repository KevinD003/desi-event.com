import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()
const push = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { OpenPlatformEditForm, OPEN_EDIT_EXPLANATION } =
  await import('./open-platform-edit-form.jsx')
const { PlatformEditBanner } = await import('./platform-edit-banner.jsx')

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

const EVENT_ID = 'cevent0000000000000000001'
const REASON = 'The organiser asked us to fix the venue directions.'
const SITTING = {
  id: 'cedit00000000000000000001',
  reason: 'The organiser asked us to fix the directions.',
  openedAt: '2026-10-06T18:40:00.000Z',
  expiresAt: '2026-10-06T19:40:00.000Z',
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
  push.mockReset()
})

describe('OpenPlatformEditForm', () => {
  it('says what the organiser sees, then opens a sitting with the reason after a second factor', async () => {
    apiFetch.mockImplementation(async (path) => {
      if (path === '/v1/auth/step-up') return answer(200, { data: {} })

      return apiFetch.mock.calls.filter(([called]) => called.endsWith('/edit')).length === 1
        ? answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Again.' } })
        : answer(200, { data: SITTING })
    })
    const user = userEvent.setup()

    render(<OpenPlatformEditForm eventId={EVENT_ID} />)

    expect(
      screen.getByRole('heading', { name: 'Edit this event as the team at The Desi Events' }),
    ).toBeVisible()
    expect(screen.getByText(OPEN_EDIT_EXPLANATION)).toBeVisible()
    expect(OPEN_EDIT_EXPLANATION).toMatch(/They do not see your name\./)

    await user.type(screen.getByLabelText(/Why are you editing this event/), REASON)
    await user.click(screen.getByRole('button', { name: 'Open for editing' }))
    await user.type(await screen.findByLabelText(/Your password/), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())

    const opens = apiFetch.mock.calls.filter(([path]) => path.endsWith('/edit'))

    expect(opens).toHaveLength(2)
    expect(opens[1][0]).toBe(`/v1/platform/events/${EVENT_ID}/edit`)
    expect(JSON.parse(opens[1][1].body)).toEqual({ reason: REASON })
  })

  it('refuses a reason the server would refuse, without sending it', async () => {
    const user = userEvent.setup()

    render(<OpenPlatformEditForm eventId={EVENT_ID} />)
    await user.type(screen.getByLabelText(/Why are you editing this event/), 'typo')
    await user.click(screen.getByRole('button', { name: 'Open for editing' }))

    expect(await screen.findByText('Give a reason of at least 10 characters.')).toBeVisible()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('shows the server’s refusal for an event that is not posted', async () => {
    apiFetch.mockResolvedValueOnce(
      answer(409, {
        error: {
          code: 'NOT_POSTED',
          message: 'The Desi Events team edits an event only once it has been published.',
        },
      }),
    )
    const user = userEvent.setup()

    render(<OpenPlatformEditForm eventId={EVENT_ID} />)
    await user.type(screen.getByLabelText(/Why are you editing this event/), REASON)
    await user.click(screen.getByRole('button', { name: 'Open for editing' }))

    expect(await screen.findByText(/only once it has been published/)).toBeVisible()
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('PlatformEditBanner', () => {
  const before = () => new Date('2026-10-06T19:00:00.000Z').getTime()
  const after = () => new Date('2026-10-06T19:41:00.000Z').getTime()

  it('names the authority, the reason and when the sitting ends', () => {
    render(
      <PlatformEditBanner
        eventId={EVENT_ID}
        sitting={SITTING}
        timeZone="America/Chicago"
        now={before}
      />,
    )

    expect(screen.getByText('Editing as the team at The Desi Events')).toBeVisible()
    // In the event's zone, named, so the server's text and the browser's agree.
    expect(
      screen.getByText('Reason: The organiser asked us to fix the directions. Until 2:40 PM CDT.'),
    ).toBeVisible()
    expect(
      screen.getByText(
        'Confirm it’s you to keep editing. The Desi Events team confirms every 10 minutes while editing someone else’s event.',
      ),
    ).toBeVisible()
  })

  it('closes the sitting and goes back to the list on “Stop editing”', async () => {
    apiFetch.mockResolvedValueOnce(answer(200, { data: { ...SITTING, open: false } }))
    const user = userEvent.setup()

    render(<PlatformEditBanner eventId={EVENT_ID} sitting={SITTING} now={before} />)
    await user.click(screen.getByRole('button', { name: 'Stop editing' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/events'))
    expect(apiFetch).toHaveBeenCalledWith(`/v1/platform/events/${EVENT_ID}/edit/close`, {
      method: 'POST',
    })
  })

  it('says the session has ended once it has run out, and offers to open it again', () => {
    render(<PlatformEditBanner eventId={EVENT_ID} sitting={SITTING} now={after} />)

    expect(
      screen.getByText('This editing session has ended. Open it again to keep editing.'),
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Open it again' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Stop editing' })).not.toBeInTheDocument()
  })

  it('names whose event it is, when the page says', () => {
    render(
      <PlatformEditBanner
        eventId={EVENT_ID}
        sitting={{ ...SITTING, organizationName: 'Rangoli Arts' }}
        now={before}
      />,
    )

    expect(screen.getByText('This is Rangoli Arts’s event.')).toBeVisible()
    // Without a zone the time is read, and labelled, in UTC.
    expect(screen.getByText(/Until 7:40 PM UTC\.$/)).toBeVisible()
  })

  it('stops saying the session has ended once the page hands it a new one', () => {
    // `router.refresh()` after "Open it again" keeps this component's state:
    // the new sitting has to be read afresh, not the old one's expiry kept.
    const fresh = {
      ...SITTING,
      id: 'cedit00000000000000000002',
      reason: 'Fixing the directions again.',
      expiresAt: '2026-10-06T20:40:00.000Z',
    }
    const { rerender } = render(
      <PlatformEditBanner eventId={EVENT_ID} sitting={SITTING} now={after} />,
    )

    expect(screen.getByText(/This editing session has ended/)).toBeVisible()

    rerender(<PlatformEditBanner eventId={EVENT_ID} sitting={fresh} now={after} />)

    expect(screen.queryByText(/This editing session has ended/)).not.toBeInTheDocument()
    expect(screen.getByText(/^Reason: Fixing the directions again\. Until/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Stop editing' })).toBeVisible()
  })

  it('says the same when a save was refused because the session is not open here', () => {
    render(<PlatformEditBanner eventId={EVENT_ID} sitting={SITTING} ended now={before} />)

    expect(
      screen.getByText('This editing session has ended. Open it again to keep editing.'),
    ).toBeVisible()
  })

  it('lets the administrator confirm it is them before a save is refused', async () => {
    apiFetch.mockResolvedValueOnce(answer(200, { data: {} }))
    const user = userEvent.setup()

    render(<PlatformEditBanner eventId={EVENT_ID} sitting={SITTING} now={before} />)
    await user.click(screen.getByRole('button', { name: 'Confirm it’s you' }))
    await user.type(screen.getByLabelText(/Your password/), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('Confirmed. Saves can carry on.')).toBeVisible()
  })
})
