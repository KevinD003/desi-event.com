/**
 * The event review page: what a moderator reads before deciding, and above all
 * that a failed read of the pictures is never drawn as "no pictures" over an
 * approval that approves every picture waiting.
 *
 * @file app/moderation/events/id/page.test.jsx
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/moderation/events/evtqawwalibanyan',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../../lib/organizer-api.js', async () => {
  const actual = await vi.importActual('../../../../lib/organizer-api.js')

  return {
    ...actual,
    getEventMedia: vi.fn(),
    getEventReadiness: vi.fn(),
    getEventSessions: vi.fn(),
    getEventTicketTypes: vi.fn(),
    getModerationHistory: vi.fn(),
    getOrganizerEvent: vi.fn(),
  }
})

const { apiFetch } = await import('../../../../lib/api-fetch.js')
const {
  getEventMedia,
  getEventReadiness,
  getEventSessions,
  getEventTicketTypes,
  getModerationHistory,
  getOrganizerEvent,
} = await import('../../../../lib/organizer-api.js')
const { default: ReviewEventPage } = await import('./page.jsx')

/** The event under review. */
const EVENT = {
  id: 'evtqawwalibanyan',
  slug: 'qawwali-under-the-banyan',
  title: 'Qawwali Under the Banyan',
  summary: 'An evening of qawwali.',
  description: 'One paragraph about the night.',
  status: 'REVIEW_PENDING',
  revision: 6,
  timezone: 'America/New_York',
  startsAt: '2026-11-01T23:30:00.000Z',
  endsAt: '2026-11-02T02:30:00.000Z',
  isOnline: false,
  venue: null,
  organization: { id: 'org1', name: 'Banyan Nights', slug: 'banyan-nights' },
  ticketTypes: [],
  artists: [],
  policies: { refund: 'Refundable up to 48 hours before.' },
}

/** A picture waiting for review. */
const COVER = {
  id: 'cmedia0000000000000000001',
  url: '/v1/media/cmedia0000000000000000001',
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
}

/**
 * Render the page.
 *
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderPage() {
  render(await ReviewEventPage({ params: Promise.resolve({ id: EVENT.id }) }))
}

beforeEach(() => {
  apiFetch.mockReset()
  getOrganizerEvent.mockResolvedValue(EVENT)
  getEventSessions.mockResolvedValue({ data: [] })
  getEventTicketTypes.mockResolvedValue({ data: [], meta: { revision: 6 } })
  getEventReadiness.mockResolvedValue({
    ready: true,
    status: 'REVIEW_PENDING',
    publishable: [],
    sellable: [],
    inventory: [],
    organizerVerified: true,
  })
  getModerationHistory.mockResolvedValue([])
  getEventMedia.mockReset()
})

describe('the pictures on the review page', () => {
  it('lists the pictures and offers every decision when they load', async () => {
    getEventMedia.mockResolvedValue({ data: [COVER], meta: { revision: 6 } })

    await renderPage()

    expect(screen.getByRole('img', { name: COVER.altText })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.queryByText(/Approval is held/)).toBeNull()
  })

  it('says "no pictures" only when the read succeeded with none', async () => {
    getEventMedia.mockResolvedValue({ data: [], meta: { revision: 6 } })

    await renderPage()

    expect(screen.getByText('This event has no pictures.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
  })

  it.each([
    ['the API is unreachable', { status: 0, code: 'API_UNREACHABLE' }],
    ['the shared address is rate-limited', { status: 429, code: 'RATE_LIMITED' }],
    ['the API failed', { status: 500, code: 'INTERNAL' }],
  ])('never says there are no pictures when %s, and holds approval back', async (_why, failure) => {
    const user = userEvent.setup()

    getEventMedia.mockRejectedValue(Object.assign(new Error('refused'), failure))

    await renderPage()

    expect(screen.queryByText('This event has no pictures.')).toBeNull()
    expect(screen.getByText('Approval is held until the pictures can be shown')).toBeVisible()

    const approve = screen.getByRole('button', { name: 'Approve' })

    expect(approve).toBeDisabled()
    expect(approve).toHaveAccessibleDescription(/would also approve pictures you have not seen/)
    // What needs no picture to have been seen is still possible.
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()

    await user.click(approve)
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('sends the revision the page showed with the decision', async () => {
    const user = userEvent.setup()

    getEventMedia.mockResolvedValue({ data: [COVER], meta: { revision: 6 } })
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { status: 'APPROVED' } }),
    })

    await renderPage()

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: /yes, approve/i }))

    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      decision: 'approve',
      revision: 6,
    })
  })
})

describe('what the listing says, as the moderator reads it', () => {
  it('renders the description as the public page will, and every link in full', async () => {
    getEventMedia.mockResolvedValue({ data: [], meta: { revision: 6 } })
    getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      description: 'A **long** night.\n\n- Chai\n- Samosas',
      performers: [{ name: 'Nizami Bandhu', role: 'Qawwals', bio: null }],
      socialLinks: { instagram: 'https://instagram.com/banyan.nights' },
      sponsors: [{ name: 'Chai Point', url: 'https://chai.example/sponsor', level: 'Gold' }],
      dressCode: 'Comfortable.',
    })

    await renderPage()

    expect(screen.getByText('long').tagName).toBe('STRONG')
    expect(screen.getByText('Chai').tagName).toBe('LI')
    expect(screen.getByText('Instagram: https://instagram.com/banyan.nights')).toBeInTheDocument()
    expect(
      screen.getByText(/Chai Point \(Gold\) — https:\/\/chai\.example\/sponsor/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Nizami Bandhu — Qawwals/)).toBeInTheDocument()
    expect(screen.getByText('Comfortable.')).toBeInTheDocument()
  })

  it('writes out where every link in the description goes, not only its label', async () => {
    getEventMedia.mockResolvedValue({ data: [], meta: { revision: 6 } })
    getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      description:
        'Buy from [Official tickets](https://phish.example/buy?ref=1) only.\n\n- See https://banyan.example/faq',
    })

    await renderPage()

    const link = screen.getByRole('link', { name: 'Official tickets' })

    expect(link).toHaveAttribute('href', 'https://phish.example/buy?ref=1')
    // The address, in full, as text beside the label.
    expect(screen.getByText('(https://phish.example/buy?ref=1)')).toBeInTheDocument()
    // A bare address is its own label, and is not written twice.
    expect(screen.getByRole('link', { name: 'https://banyan.example/faq' })).toBeInTheDocument()
    expect(screen.queryByText('(https://banyan.example/faq)')).not.toBeInTheDocument()
  })

  it('flags hidden and complimentary ticket types', async () => {
    getEventMedia.mockResolvedValue({ data: [], meta: { revision: 6 } })
    getEventTicketTypes.mockResolvedValue({
      data: [
        {
          id: 'tguest',
          name: 'Guest list',
          priceCents: 0,
          currency: 'USD',
          visibility: 'HIDDEN',
          complimentary: true,
        },
        {
          id: 'tgeneral',
          name: 'General',
          priceCents: 3500,
          currency: 'USD',
          visibility: 'PUBLIC',
        },
      ],
      meta: { revision: 6 },
    })

    await renderPage()

    expect(screen.getByText('Hidden')).toBeInTheDocument()
    expect(screen.getByText('Complimentary')).toBeInTheDocument()
    expect(screen.getByText(/General — \$35\.00/)).toBeInTheDocument()
  })
})
