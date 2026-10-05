/**
 * The organiser's editor page hands the Media step what it read — and when the
 * read of the pictures failed, it hands down the failure, never an empty list
 * that would say "there is no cover" and offer an upload replacing the one it
 * could not show.
 *
 * @file app/organizer/events/id/page.test.jsx
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/organizer/events/evtqawwalibanyan',
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
    getEventTransitions: vi.fn(),
    getModerationHistory: vi.fn(),
    getOrganizerEvent: vi.fn(),
    getPricePreview: vi.fn(),
    listMaps: vi.fn(),
    listVenues: vi.fn(),
  }
})

vi.mock('../../../../lib/session.js', () => ({ readSession: vi.fn() }))

const api = await import('../../../../lib/organizer-api.js')
const { readSession } = await import('../../../../lib/session.js')
const { default: EditEventPage } = await import('./page.jsx')

/** A draft with everything the form needs. */
const EVENT = {
  id: 'evtqawwalibanyan',
  organizationId: 'org1',
  slug: 'qawwali-under-the-banyan',
  title: 'Qawwali Under the Banyan',
  summary: 'An evening of qawwali.',
  description: 'One paragraph about the night.',
  category: 'MUSIC_CONCERT',
  status: 'DRAFT',
  revision: 3,
  timezone: 'America/New_York',
  startsAt: '2026-11-01T23:30:00.000Z',
  endsAt: '2026-11-02T02:30:00.000Z',
  venueId: null,
  isOnline: false,
  onlineUrl: null,
  languages: ['Urdu'],
  artists: [],
  ageRestriction: null,
  policies: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours.' },
  accessibility: { features: [], note: null },
  ticketTypes: [],
}

/** The cover, as the pictures list carries it. */
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
 * Render the page and open its Media step.
 *
 * @returns {Promise<void>} Resolves once the step is open.
 */
async function openMediaStep() {
  const user = userEvent.setup()

  render(await EditEventPage({ params: Promise.resolve({ id: EVENT.id }) }))
  await user.click(screen.getByRole('button', { name: /step 6/i }))
}

beforeEach(() => {
  api.getOrganizerEvent.mockResolvedValue(EVENT)
  api.getEventSessions.mockResolvedValue({ data: [], meta: { revision: 3 } })
  api.getEventTicketTypes.mockResolvedValue({ data: [], meta: { revision: 3 } })
  api.getEventReadiness.mockResolvedValue({
    ready: false,
    status: 'DRAFT',
    publishable: [],
    sellable: [],
    inventory: [],
    organizerVerified: true,
  })
  api.getEventTransitions.mockResolvedValue({ status: 'DRAFT', transitions: [] })
  api.getModerationHistory.mockResolvedValue([])
  api.listVenues.mockResolvedValue([])
  api.listMaps.mockResolvedValue([])
  api.getPricePreview.mockResolvedValue([])
  api.getEventMedia.mockReset()
})

describe('the Media step on the editor page', () => {
  it('shows the pictures the page read', async () => {
    api.getEventMedia.mockResolvedValue({ data: [COVER], meta: { revision: 3 } })

    await openMediaStep()

    expect(screen.getByRole('listitem', { name: 'The cover' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Replace the cover' })).toBeInTheDocument()
  })

  it('shows the failure, and no upload, when the pictures could not be read', async () => {
    api.getEventMedia.mockRejectedValue(
      Object.assign(new Error('refused'), { status: 429, code: 'RATE_LIMITED' }),
    )

    await openMediaStep()

    expect(screen.getByText(/Until this event’s pictures load/)).toBeInTheDocument()
    expect(screen.getByText('Too many attempts')).toBeInTheDocument()
    // Neither the untrue sentence nor the upload that could replace a cover.
    expect(screen.queryByText(/There is no cover/)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Upload a cover' })).toBeNull()
    expect(screen.queryByRole('form')).toBeNull()
  })
})

describe('booking from a hidden tier, on the editor page', () => {
  const LIVE = { ...EVENT, status: 'ON_SALE' }
  const GUEST_LIST = {
    id: 'ttguestlist',
    name: 'Guest list',
    status: 'ON_SALE',
    visibility: 'HIDDEN',
    complimentary: true,
    priceCents: 0,
  }

  /**
   * A signed-in member with these capabilities in the event's organisation.
   *
   * @param {string[]} capabilities What the membership holds.
   * @returns {object} The session payload.
   */
  const member = (capabilities) => ({
    user: { id: 'u1', displayName: 'Meera Shah', email: 'meera@example.test' },
    capabilities: [],
    memberships: [{ organizationId: EVENT.organizationId, capabilities }],
  })

  beforeEach(() => {
    readSession.mockReset()
    api.getOrganizerEvent.mockResolvedValue(LIVE)
    api.getEventTicketTypes.mockResolvedValue({ data: [GUEST_LIST], meta: { revision: 3 } })
    api.getEventMedia.mockResolvedValue({ data: [], meta: { revision: 3 } })
  })

  it('sends a member who may book it to the event’s own checkout', async () => {
    readSession.mockResolvedValue(member(['ticketType:manage', 'event:update']))

    render(await EditEventPage({ params: Promise.resolve({ id: EVENT.id }) }))

    const panel = screen.getByTestId('team-booking-panel')
    expect(panel).toHaveTextContent('Book from a hidden tier')
    expect(panel).toHaveTextContent('handed on to a guest with a transfer code')
    expect(screen.getByRole('link', { name: 'Book team tickets' })).toHaveAttribute(
      'href',
      '/events/qawwali-under-the-banyan/checkout',
    )
  })

  it('offers nothing to a member who may not, before the event is on sale, or with no hidden tier', async () => {
    readSession.mockResolvedValue(member(['event:update']))
    const first = render(await EditEventPage({ params: Promise.resolve({ id: EVENT.id }) }))
    expect(screen.queryByTestId('team-booking-panel')).toBeNull()
    first.unmount()

    readSession.mockResolvedValue(member(['ticketType:manage']))
    api.getOrganizerEvent.mockResolvedValue(EVENT)
    const draft = render(await EditEventPage({ params: Promise.resolve({ id: EVENT.id }) }))
    expect(screen.queryByTestId('team-booking-panel')).toBeNull()
    draft.unmount()

    api.getOrganizerEvent.mockResolvedValue(LIVE)
    api.getEventTicketTypes.mockResolvedValue({
      data: [{ ...GUEST_LIST, visibility: 'PUBLIC', complimentary: false }],
      meta: { revision: 3 },
    })
    render(await EditEventPage({ params: Promise.resolve({ id: EVENT.id }) }))
    expect(screen.queryByTestId('team-booking-panel')).toBeNull()
  })
})

describe('the link to the event’s visits and sales', () => {
  beforeEach(() => {
    readSession.mockReset()
    api.getOrganizerEvent.mockResolvedValue(EVENT)
    api.getEventMedia.mockResolvedValue({ data: [], meta: { revision: 3 } })
  })

  /**
   * Render the editor page for a session.
   *
   * @param {object|null} session The session.
   * @returns {Promise<void>} Resolves once rendered.
   */
  async function renderFor(session) {
    readSession.mockResolvedValue(session)
    render(await EditEventPage({ params: Promise.resolve({ id: EVENT.id }) }))
  }

  it('links a member who may read the organisation’s reports to this event’s figures', async () => {
    await renderFor({
      user: { id: 'u1' },
      capabilities: [],
      memberships: [{ organizationId: EVENT.organizationId, capabilities: ['report:view'] }],
    })

    expect(screen.getByRole('link', { name: 'Visits and sales for this event' })).toHaveAttribute(
      'href',
      '/analytics?organizationId=org1&eventId=evtqawwalibanyan',
    )
  })

  it('links a platform administrator too, whose report:view holds in every organisation', async () => {
    await renderFor({
      user: { id: 'u2' },
      capabilities: ['report:view', 'analytics:view_all', 'moderation:review'],
      memberships: [],
    })

    expect(
      screen.getByRole('link', { name: 'Visits and sales for this event' }),
    ).toBeInTheDocument()
  })

  it('offers nothing to a member who may not read reports, such as a scanner', async () => {
    await renderFor({
      user: { id: 'u3' },
      capabilities: [],
      memberships: [{ organizationId: EVENT.organizationId, capabilities: ['ticket:check_in'] }],
    })

    expect(screen.queryByRole('link', { name: 'Visits and sales for this event' })).toBeNull()
  })
})
