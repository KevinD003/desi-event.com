import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

const { apiFetch } = await import('../lib/api-fetch.js')
const { ModerationMediaReview } = await import('./moderation-media-review.jsx')

/**
 * A picture as the moderator's list carries it.
 *
 * @param {object} [overrides] Field overrides.
 * @returns {object} The payload.
 */
function picture(overrides = {}) {
  const id = overrides.id ?? 'cmedia0000000000000000001'

  return {
    id,
    url: `/v1/media/${id}`,
    altText: 'Dancers circling a lit garbo',
    width: 1200,
    height: 630,
    contentType: 'image/png',
    kind: 'EVENT_COVER',
    position: null,
    byteSize: 204_800,
    checksum: 'a'.repeat(64),
    moderationStatus: 'PENDING',
    rejectionReason: null,
    publiclyVisible: false,
    createdAt: '2026-09-01T10:00:00.000Z',
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

const GALLERY = picture({
  id: 'cmedia0000000000000000002',
  kind: 'EVENT_GALLERY',
  position: 0,
  altText: 'The band at soundcheck',
  width: 800,
  height: 800,
  contentType: 'image/jpeg',
})

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('ModerationMediaReview', () => {
  it('shows every picture through this site, with its description as text, size and state', () => {
    render(<ModerationMediaReview media={[picture(), GALLERY]} />)

    const cover = screen.getByRole('listitem', { name: 'Cover' })
    const gallery = screen.getByRole('listitem', { name: 'Gallery picture 1 of 1' })

    expect(
      within(cover).getByRole('img', { name: 'Dancers circling a lit garbo' }),
    ).toHaveAttribute('src', '/api/v1/media/cmedia0000000000000000001')
    expect(within(cover).getByText('Dancers circling a lit garbo')).toBeInTheDocument()
    expect(within(cover).getByText(/1200 × 630 · 200 KB · PNG/)).toBeInTheDocument()
    expect(within(cover).getByText('Waiting for review')).toBeInTheDocument()
    expect(within(gallery).getByText(/JPEG/)).toBeInTheDocument()
  })

  it('says so when there are no pictures', () => {
    render(<ModerationMediaReview media={[]} />)

    expect(screen.getByText('This event has no pictures.')).toBeInTheDocument()
  })

  it('needs a reason to take a picture down, and sends nothing without one', async () => {
    const user = userEvent.setup()

    render(<ModerationMediaReview media={[picture()]} />)

    await user.click(screen.getByRole('button', { name: 'Reject this picture' }))

    const reason = screen.getByLabelText(/^Why is it being taken down/)

    expect(reason).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Take this picture down' }))

    expect(apiFetch).not.toHaveBeenCalled()
    expect(reason).toHaveAttribute('aria-invalid', 'true')
  })

  it('takes a picture down with the reason, then refreshes', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(200, {
        data: picture({ moderationStatus: 'REJECTED', rejectionReason: 'Shows a child’s face.' }),
        meta: { revision: 2 },
      }),
    )

    render(<ModerationMediaReview media={[picture()]} />)

    await user.click(screen.getByRole('button', { name: 'Reject this picture' }))
    await user.type(
      screen.getByLabelText(/^Why is it being taken down/),
      '  Shows a child’s face. ',
    )
    await user.click(screen.getByRole('button', { name: 'Take this picture down' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())

    const [path, init] = apiFetch.mock.calls[0]

    expect(path).toBe('/v1/moderation/media/cmedia0000000000000000001/decision')
    expect(JSON.parse(init.body)).toEqual({ decision: 'reject', reason: 'Shows a child’s face.' })
    expect(screen.getByText('Taken down')).toBeInTheDocument()
    expect(
      screen.getByText('Cover taken down. It is off every public page now.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve this picture' })).toBeInTheDocument()
  })

  it('asks for a step-up when the server says so, and retries once confirmed', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'x' } }))
      .mockResolvedValueOnce(answer(200, {}))
      .mockResolvedValueOnce(
        answer(200, { data: picture({ moderationStatus: 'APPROVED' }), meta: { revision: 2 } }),
      )

    render(
      <ModerationMediaReview
        media={[picture({ moderationStatus: 'REJECTED', rejectionReason: 'Earlier.' })]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Approve this picture' }))

    expect(await screen.findByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()

    await user.type(screen.getByLabelText(/^Your password/), 'correct-horse-battery')
    await user.type(screen.getByLabelText(/^Code from your authenticator/), '123456')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3))

    expect(apiFetch.mock.calls[1][0]).toBe('/v1/auth/step-up')
    expect(JSON.parse(apiFetch.mock.calls[2][1].body)).toEqual({ decision: 'approve' })
    expect(await screen.findByText('Approved')).toBeInTheDocument()
  })

  it('says what a refusal means, and focuses it', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: { code: 'MEDIA_CHANGED', message: 'Somebody else decided on this picture.' },
      }),
    )

    render(
      <ModerationMediaReview
        media={[picture({ moderationStatus: 'REJECTED', rejectionReason: 'x' })]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Approve this picture' }))

    const message = await screen.findByText('Somebody else decided on this picture.')

    await waitFor(() => expect(message.closest('[tabindex="-1"]')).toHaveFocus())
    expect(refresh).not.toHaveBeenCalled()
  })

  it('shows a member of the organisation every picture, says somebody else decides, and offers no decision', () => {
    const notice =
      'You belong to this organisation, so somebody else on the team at The Desi Events has to decide this.'

    render(
      <ModerationMediaReview
        media={[
          picture(),
          picture({ ...GALLERY, moderationStatus: 'REJECTED', rejectionReason: 'x' }),
        ]}
        notYours={notice}
      />,
    )

    // The pictures are still there to see, with their descriptions.
    expect(screen.getByRole('listitem', { name: 'Cover' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'The band at soundcheck' })).toBeInTheDocument()
    // The sentence is said once, above them, and no picture offers a decision
    // the API would refuse (CONFLICT_OF_INTEREST).
    expect(screen.getByText('Somebody else decides this')).toBeInTheDocument()
    expect(screen.getAllByText(notice)).toHaveLength(1)
    expect(screen.queryByRole('button')).toBeNull()
    expect(apiFetch).not.toHaveBeenCalled()
  })
})

describe('a picture waiting on a posted event', () => {
  const waiting = picture({
    id: 'cmedia0000000000000000009',
    replacesMediaId: 'cmedia0000000000000000001',
  })

  it('is not approved on its own where the event’s own approval approves it', () => {
    render(<ModerationMediaReview media={[picture()]} />)

    expect(screen.queryByRole('button', { name: 'Approve this picture' })).not.toBeInTheDocument()
  })

  it('can be approved on its own, and a new cover says it takes the old one’s place', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(200, {
        data: { ...waiting, moderationStatus: 'APPROVED', replacesMediaId: null },
        meta: { revision: 2 },
      }),
    )

    render(<ModerationMediaReview media={[waiting]} approvePending />)

    expect(screen.getByRole('listitem', { name: 'New cover' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Approve this picture' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(apiFetch.mock.calls[0][0]).toBe(
      '/v1/moderation/media/cmedia0000000000000000009/decision',
    )
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ decision: 'approve' })
    expect(
      screen.getByText('New cover approved. It takes the old cover’s place on the event’s page.'),
    ).toBeInTheDocument()
  })

  it('shows the server’s sentence when the person approving uploaded it', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(403, {
        error: {
          code: 'SELF_REVIEW',
          message:
            'You uploaded this picture, so somebody else on the team at The Desi Events approves it.',
        },
      }),
    )

    render(<ModerationMediaReview media={[waiting]} approvePending />)

    await user.click(screen.getByRole('button', { name: 'Approve this picture' }))

    expect(
      await screen.findByText(/somebody else on the team at The Desi Events approves it/),
    ).toBeVisible()
    expect(refresh).not.toHaveBeenCalled()
  })
})
