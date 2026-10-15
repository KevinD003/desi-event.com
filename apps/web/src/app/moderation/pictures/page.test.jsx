import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../lib/organizer-api.js', () => ({ getMediaQueue: vi.fn() }))

const { getMediaQueue } = await import('../../../lib/organizer-api.js')
const { default: PicturesWaitingPage, INTRODUCTION } = await import('./page.jsx')

/**
 * A row of the queue.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The row.
 */
function item(overrides = {}) {
  const id = overrides.id ?? 'cmedia0000000000000000009'

  return {
    id,
    url: `/v1/media/${id}`,
    altText: 'The new poster',
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
    replacesMediaId: 'cmedia0000000000000000001',
    createdAt: '2026-10-05T12:00:00.000Z',
    event: {
      id: 'cevent0000000000000000001',
      title: 'Diwali Mela',
      slug: 'diwali-mela-2026',
      status: 'ON_SALE',
      organizationName: 'Rangoli Arts',
    },
    uploadedByOrganiser: true,
    ...overrides,
  }
}

beforeEach(() => {
  getMediaQueue.mockResolvedValue({ pictures: [item()], pagination: null })
})

describe('Pictures waiting for a decision', () => {
  it('shows a new cover beside the cover it would replace, with its event, and offers the decision', async () => {
    render(await PicturesWaitingPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText(INTRODUCTION)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Diwali Mela' })).toHaveAttribute(
      'href',
      '/moderation/events/cevent0000000000000000001',
    )
    expect(screen.getByText('Replaces the current cover')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'The current cover of Diwali Mela' })).toHaveAttribute(
      'src',
      '/api/v1/media/cmedia0000000000000000001',
    )
    expect(screen.getByRole('img', { name: 'The new poster' })).toBeInTheDocument()

    const card = screen.getByRole('listitem', { name: 'New cover' })

    expect(within(card).getByRole('button', { name: 'Approve this picture' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Reject this picture' })).toBeInTheDocument()
    expect(screen.getByText(/Uploaded by the organisation/)).toBeInTheDocument()
    expect(getMediaQueue).toHaveBeenCalledWith({ status: 'PENDING', page: 1, perPage: 50 })
  })

  it('says when the team at The Desi Events uploaded a picture, without naming anybody', async () => {
    getMediaQueue.mockResolvedValue({
      pictures: [
        item({
          kind: 'EVENT_GALLERY',
          position: 0,
          replacesMediaId: null,
          uploadedByOrganiser: false,
        }),
      ],
      pagination: null,
    })

    render(await PicturesWaitingPage({ searchParams: Promise.resolve({}) }))

    expect(
      screen.getByText(/Uploaded by the team at The Desi Events in an editing session/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Replaces the current cover')).not.toBeInTheDocument()
  })

  it('lists the pictures taken down on their own filter', async () => {
    getMediaQueue.mockResolvedValue({ pictures: [], pagination: null })

    render(await PicturesWaitingPage({ searchParams: Promise.resolve({ status: 'REJECTED' }) }))

    expect(screen.getByRole('link', { name: 'Taken down' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('No picture on a posted event was taken down.')).toBeInTheDocument()
    expect(getMediaQueue).toHaveBeenCalledWith({ status: 'REJECTED', page: 1, perPage: 50 })
  })

  it('shows the API’s refusal rather than an empty queue', async () => {
    getMediaQueue.mockRejectedValue(Object.assign(new Error('No.'), { status: 403 }))

    render(await PicturesWaitingPage({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByText('No picture is waiting for a decision.')).not.toBeInTheDocument()
  })
})
