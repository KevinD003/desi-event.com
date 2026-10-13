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
    getDeletionPreview: vi.fn(),
    getEventMedia: vi.fn(),
    getEventReadiness: vi.fn(),
    getEventSessions: vi.fn(),
    getEventTicketTypes: vi.fn(),
    getEventTransitions: vi.fn(),
    getModerationHistory: vi.fn(),
    getOrganizerEvent: vi.fn(),
    getPlatformEdits: vi.fn(),
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
  api.getPlatformEdits.mockResolvedValue([])
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

describe('the controls the organisation’s membership allows', () => {
  /**
   * Render the page for a session, on the review step.
   *
   * @param {object} session The session.
   * @param {object} [event] The event.
   * @returns {Promise<void>} Resolves once the review step is open.
   */
  async function reviewFor(session, event = { ...EVENT, status: 'ON_SALE' }) {
    api.getOrganizerEvent.mockResolvedValue(event)
    api.getEventMedia.mockResolvedValue({ data: [], meta: { revision: 3 } })
    readSession.mockResolvedValue(session)

    const user = userEvent.setup()

    render(await EditEventPage({ params: Promise.resolve({ id: EVENT.id }) }))
    await user.click(screen.getByRole('button', { name: /step 9/i }))
  }

  it('offers a member who may delete the danger zone, and lists the Desi-Event team’s changes', async () => {
    api.getPlatformEdits.mockResolvedValue([
      {
        id: 'cedit00000000000000000001',
        openedAt: '2026-10-05T15:00:00.000Z',
        expiresAt: '2026-10-05T16:00:00.000Z',
        closedAt: '2026-10-05T15:20:00.000Z',
        endedBy: 'CLOSED',
        open: false,
        mine: false,
        reason: 'Fixing the directions.',
        administratorName: null,
        changes: [],
      },
    ])

    await reviewFor({
      user: { id: 'u1' },
      capabilities: [],
      memberships: [
        {
          organizationId: EVENT.organizationId,
          capabilities: ['event:view_draft', 'event:update', 'event:delete_unsold', 'event:cancel'],
        },
      ],
    })

    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Changes made by the Desi-Event team' }),
    ).toBeInTheDocument()
    expect(api.getPlatformEdits).toHaveBeenCalledWith(EVENT.id)
  })

  it('asks the membership, not the platform role: a super administrator who is not a member is offered no editor and no danger zone here, only the way to the Desi-Event team’s editor', async () => {
    // Reached by a link inside the organiser area, where the layout's redirect
    // does not run again (SPEC2-XI O9): the page itself sends them on.
    api.getOrganizerEvent.mockResolvedValue({ ...EVENT, status: 'ON_SALE' })
    api.getEventMedia.mockResolvedValue({ data: [], meta: { revision: 3 } })
    readSession.mockResolvedValue({
      user: { id: 'u2' },
      capabilities: [
        'platform:admin',
        'event:platform_edit',
        'event:platform_delete',
        'event:delete_unsold',
      ],
      memberships: [],
    })

    render(await EditEventPage({ params: Promise.resolve({ id: EVENT.id }) }))

    expect(
      screen.getByRole('heading', { name: 'Edited by the Desi-Event team elsewhere' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Open it in the Desi-Event team’s editor' }),
    ).toHaveAttribute('href', `/admin/events/${EVENT.id}`)
    expect(screen.queryByRole('navigation', { name: 'Editor steps' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Danger zone' })).not.toBeInTheDocument()
    expect(api.getEventSessions).not.toHaveBeenCalled()
  })

  it('asks the membership, not the platform role: platform capabilities that do not edit as the Desi-Event team offer no danger zone in the editor', async () => {
    await reviewFor({
      user: { id: 'u4' },
      capabilities: ['event:delete_unsold', 'event:cancel', 'event:view_draft'],
      memberships: [],
    })

    expect(screen.getByRole('navigation', { name: 'Editor steps' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Danger zone' })).not.toBeInTheDocument()
  })

  it('leaves a member who also edits as the Desi-Event team in the organiser’s editor', async () => {
    await reviewFor({
      user: { id: 'u5' },
      capabilities: ['event:platform_edit'],
      memberships: [
        {
          organizationId: EVENT.organizationId,
          capabilities: ['event:view_draft', 'event:update', 'event:delete_unsold'],
        },
      ],
    })

    expect(screen.getByRole('navigation', { name: 'Editor steps' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeInTheDocument()
  })

  it('offers no danger zone to a member who may not delete', async () => {
    await reviewFor({
      user: { id: 'u3' },
      capabilities: [],
      memberships: [
        {
          organizationId: EVENT.organizationId,
          capabilities: ['event:view_draft', 'event:update'],
        },
      ],
    })

    expect(screen.queryByRole('heading', { name: 'Danger zone' })).not.toBeInTheDocument()
  })
})

describe('a deleted event', () => {
  it('shows its record instead of the editor, and sends nobody to restore it but the Desi-Event team', async () => {
    api.getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      status: 'DELETED',
      deletion: {
        deletedAt: '2026-10-01T15:00:00.000Z',
        reason: 'Nobody bought tickets and the hall closed.',
        outcome: 'REMOVE',
        authority: 'ORGANIZATION',
        statusBefore: 'PUBLISHED',
        restoreTo: 'PUBLISHED',
        deletedByName: 'Priya Shah',
      },
    })
    readSession.mockResolvedValue({
      user: { id: 'u1' },
      capabilities: [],
      memberships: [
        {
          organizationId: EVENT.organizationId,
          capabilities: ['event:view_draft', 'event:delete', 'event:cancel'],
        },
      ],
    })

    render(await EditEventPage({ params: Promise.resolve({ id: EVENT.id }) }))

    expect(screen.getByRole('heading', { name: 'This event was deleted' })).toBeInTheDocument()
    expect(screen.getByText(/by Priya Shah, of the organisation\./)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Editor steps' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restore…' })).not.toBeInTheDocument()
    expect(api.getEventSessions).not.toHaveBeenCalled()
  })

  it('says where its refunds stand when deleting it refunded its orders, with the refund queue for finance', async () => {
    api.getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      status: 'DELETED',
      deletion: {
        deletedAt: '2026-10-01T15:00:00.000Z',
        reason: 'The hall closed.',
        outcome: 'CANCEL_AND_REFUND',
        authority: 'ORGANIZATION',
        statusBefore: 'ON_SALE',
        restoreTo: 'SALES_PAUSED',
        deletedByName: 'Priya Shah',
      },
    })
    api.getDeletionPreview.mockResolvedValue({
      counts: {
        paidOrders: 3,
        refundableCents: 9000,
        currency: 'USD',
        pendingOrders: 0,
        paymentsInFlight: 0,
        activeHolds: 0,
        tickets: 0,
        checkIns: 0,
        zeroValueOrders: 0,
        disputedOrders: 1,
        partlyRefundedOrders: 0,
      },
    })
    readSession.mockResolvedValue({
      user: { id: 'u1' },
      capabilities: [],
      memberships: [
        {
          organizationId: EVENT.organizationId,
          capabilities: ['event:view_draft', 'event:delete', 'event:cancel', 'finance:view'],
        },
      ],
    })

    render(await EditEventPage({ params: Promise.resolve({ id: EVENT.id }) }))

    expect(api.getDeletionPreview).toHaveBeenCalledWith(EVENT.id)
    expect(
      screen.getByText(
        '2 paid orders have not been refunded in full: $90.00 in all is still to go back, counting any refund the payment provider has not confirmed.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('1 order is disputed and is left to the finance team.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'The organisation’s refund queue' })).toHaveAttribute(
      'href',
      '/finance/refunds?organizationId=org1',
    )
    expect(screen.getByRole('button', { name: 'Finish refunds' })).toBeInTheDocument()
  })

  it('names a never-public deleted event by its title, not by the placeholder its address became', async () => {
    api.getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      slug: `deleted-${EVENT.id}`,
      status: 'DELETED',
      deletion: {
        deletedAt: '2026-10-01T15:00:00.000Z',
        reason: 'Started again as a new event.',
        outcome: 'REMOVE',
        authority: 'ORGANIZATION',
        statusBefore: 'DRAFT',
        restoreTo: 'DRAFT',
        deletedByName: 'Priya Shah',
      },
    })
    api.getDeletionPreview.mockReset()
    readSession.mockResolvedValue({
      user: { id: 'u1' },
      capabilities: [],
      memberships: [{ organizationId: EVENT.organizationId, capabilities: ['event:view_draft'] }],
    })

    render(await EditEventPage({ params: Promise.resolve({ id: EVENT.id }) }))

    expect(
      screen.getByText(/naming it by its title, “Qawwali Under the Banyan”/),
    ).toBeInTheDocument()
    expect(screen.queryByText(`deleted-${EVENT.id}`)).not.toBeInTheDocument()
    expect(screen.queryByText('Refunds')).not.toBeInTheDocument()
    expect(api.getDeletionPreview).not.toHaveBeenCalled()
  })
})

describe('the read-only "Booking fee and payment" panel (SPEC3 §12.4)', () => {
  const TERMS = {
    fee: {
      source: 'EVENT',
      percentageBps: 300,
      flatCentsPerTicket: 149,
      currency: 'USD',
      sequence: 1,
      changedAt: '2026-10-09T10:00:00.000Z',
      changedByName: 'Meera Admin',
      reason: 'Partner rate agreed for this season.',
    },
    siteDefault: { currency: 'USD', percentageBps: 250, flatCentsPerTicket: 99 },
    venuePayment: {
      enabled: false,
      limit: 50,
      offered: false,
      changedAt: null,
      changedByName: null,
      reason: null,
      hasOrders: true,
      unpaidTickets: 2,
      paidAtDoorTickets: 1,
      paidAtDoorCents: 4000,
    },
  }

  beforeEach(() => {
    readSession.mockReset()
    api.getEventMedia.mockResolvedValue({ data: [], meta: { revision: 3 } })
  })

  /**
   * Render the editor page for a session and an event.
   *
   * @param {object} session The session.
   * @param {object} event The event.
   * @returns {Promise<void>} Resolves once rendered.
   */
  async function renderFor(session, event) {
    readSession.mockResolvedValue(session)
    api.getOrganizerEvent.mockResolvedValue(event)
    render(await EditEventPage({ params: Promise.resolve({ id: event.id }) }))
  }

  it('shows the Desi-Event team’s decisions, with no controls, and links finance to the payments at the venue', async () => {
    await renderFor(
      {
        user: { id: 'u1' },
        capabilities: [],
        memberships: [
          {
            organizationId: EVENT.organizationId,
            capabilities: ['event:view_draft', 'finance:view'],
          },
        ],
      },
      { ...EVENT, paymentTerms: TERMS },
    )

    const panel = screen.getByRole('region', { name: 'Booking fee and payment' })

    expect(panel).toHaveTextContent(
      'Booking fee on this event: 3.00% of the ticket price plus $1.49 per ticket. Set by the Desi-Event team.',
    )
    expect(panel).toHaveTextContent(
      'Pay at the venue: Off. Only the Desi-Event team can change this.',
    )
    expect(panel.querySelectorAll('input, button, select, textarea')).toHaveLength(0)
    // Off now, but bookings made while it was on remain: the page stays reachable.
    expect(screen.getByRole('link', { name: 'Payments at the venue' })).toHaveAttribute(
      'href',
      '/organizer/events/evtqawwalibanyan/venue-payments',
    )
  })

  it('offers no link to a member who may not read the organisation’s finance', async () => {
    await renderFor(
      {
        user: { id: 'u2' },
        capabilities: [],
        memberships: [{ organizationId: EVENT.organizationId, capabilities: ['event:view_draft'] }],
      },
      { ...EVENT, paymentTerms: TERMS },
    )

    expect(screen.getByRole('region', { name: 'Booking fee and payment' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Payments at the venue' })).toBeNull()
  })

  it('draws no panel when the server sent no terms', async () => {
    await renderFor(
      { user: { id: 'u3' }, capabilities: [], memberships: [] },
      { ...EVENT, paymentTerms: undefined },
    )

    expect(screen.queryByRole('region', { name: 'Booking fee and payment' })).toBeNull()
  })
})
