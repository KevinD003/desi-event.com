import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/events/cevent1',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../../lib/organizer-api.js', () => ({
  getDeletionPreview: vi.fn(),
  getEventMedia: vi.fn(),
  getEventReadiness: vi.fn(),
  getEventSessions: vi.fn(),
  getEventTicketTypes: vi.fn(),
  getOrganizerEvent: vi.fn(),
  getPlatformEdits: vi.fn(),
  getPricePreview: vi.fn(),
  listMaps: vi.fn(),
  listVenues: vi.fn(),
}))
vi.mock('../../../../lib/session.js', () => ({ readSession: vi.fn() }))

const api = await import('../../../../lib/organizer-api.js')
const { readSession } = await import('../../../../lib/session.js')
const { default: AdminEventPage, NOT_FOR_THIS_ACCOUNT } = await import('./page.jsx')

const ADMIN = {
  user: { id: 'u1' },
  capabilities: ['event:platform_edit', 'event:platform_delete', 'event:view_draft'],
  memberships: [],
}

const EVENT = {
  id: 'cevent1',
  organizationId: 'corg1',
  organization: { name: 'Rangoli Arts' },
  slug: 'diwali-mela-2026',
  title: 'Diwali Mela',
  summary: 'A night of garba.',
  description: 'One paragraph.',
  category: 'MUSIC_CONCERT',
  status: 'ON_SALE',
  revision: 7,
  timezone: 'America/Chicago',
  startsAt: '2026-10-17T23:30:00.000Z',
  endsAt: '2026-10-18T03:30:00.000Z',
  venueId: null,
  isOnline: false,
  onlineUrl: null,
  languages: [],
  artists: [],
  ageRestriction: null,
  policies: null,
  accessibility: null,
  ticketTypes: [],
}

const SITTING = {
  id: 'cedit1',
  openedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  expiresAt: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
  closedAt: null,
  endedBy: null,
  open: true,
  mine: true,
  reason: 'The organiser asked us to fix the description',
  administratorName: 'Anil Rao',
  changes: [],
}

/**
 * Render the page.
 *
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderPage() {
  render(await AdminEventPage({ params: Promise.resolve({ id: EVENT.id }) }))
}

beforeEach(() => {
  readSession.mockResolvedValue(ADMIN)
  api.getOrganizerEvent.mockResolvedValue(EVENT)
  api.getPlatformEdits.mockResolvedValue([])
  api.getEventSessions.mockResolvedValue({ data: [], meta: { revision: 7 } })
  api.getEventTicketTypes.mockResolvedValue({ data: [], meta: { revision: 7 } })
  api.getEventReadiness.mockResolvedValue(null)
  api.getEventMedia.mockResolvedValue({ data: [], meta: { revision: 7 } })
  api.getPricePreview.mockResolvedValue([])
  api.listVenues.mockResolvedValue([])
  api.listMaps.mockResolvedValue([])
})

describe('one event, for the Desi-Event team', () => {
  it('offers to open an editing session with a reason, and the danger zone, before any editor', async () => {
    await renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Diwali Mela' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Edit this event as the Desi-Event team' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/Why are you editing this event/)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Editor steps' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete this event…' })).toBeInTheDocument()
    expect(api.getEventSessions).not.toHaveBeenCalled()
  })

  it('shows the editor, under the Desi-Event team’s authority, once its own session is open', async () => {
    api.getPlatformEdits.mockResolvedValue([SITTING])

    await renderPage()

    expect(screen.getByRole('navigation', { name: 'Editor steps' })).toBeInTheDocument()
    expect(screen.getByText('Editing as the Desi-Event team')).toBeInTheDocument()
    expect(
      screen.getByText(/^Reason: The organiser asked us to fix the description\. Until/),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeInTheDocument()
    // Whose event it is, in the banner over the editor.
    expect(screen.getByText('This is Rangoli Arts’s event.')).toBeInTheDocument()
  })

  it('says where a deleted event’s refunds stand, without the refund queue for an administrator who may not read money', async () => {
    api.getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      status: 'DELETED',
      deletion: {
        deletedAt: '2026-10-01T15:00:00.000Z',
        reason: 'The hall closed.',
        outcome: 'CANCEL_AND_REFUND',
        authority: 'PLATFORM',
        statusBefore: 'ON_SALE',
        restoreTo: 'SALES_PAUSED',
        deletedByName: 'Anil Rao',
      },
    })
    api.getDeletionPreview.mockResolvedValue({
      counts: {
        paidOrders: 0,
        refundableCents: 0,
        currency: null,
        pendingOrders: 0,
        paymentsInFlight: 0,
        activeHolds: 0,
        tickets: 0,
        checkIns: 0,
        zeroValueOrders: 0,
        disputedOrders: 0,
        partlyRefundedOrders: 0,
      },
    })

    await renderPage()

    expect(api.getDeletionPreview).toHaveBeenCalledWith(EVENT.id)
    expect(screen.getByText('Every paid order has been refunded in full.')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'The organisation’s refund queue' }),
    ).not.toBeInTheDocument()
  })

  it('does not take another administrator’s session, or a closed one, as its own', async () => {
    api.getPlatformEdits.mockResolvedValue([
      { ...SITTING, mine: false },
      { ...SITTING, id: 'cedit0', open: false, endedBy: 'CLOSED' },
    ])

    await renderPage()

    expect(screen.queryByRole('navigation', { name: 'Editor steps' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Edit this event as the Desi-Event team' }),
    ).toBeInTheDocument()
  })

  it('says an event that is not posted is the organiser’s draft, and still offers deleting it', async () => {
    api.getOrganizerEvent.mockResolvedValue({ ...EVENT, status: 'REVIEW_PENDING' })

    await renderPage()

    expect(screen.getByText(/edits an event only once it has been published/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Why are you editing this event/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Its review page' })).toHaveAttribute(
      'href',
      '/moderation/events/cevent1',
    )
    expect(screen.getByRole('button', { name: 'Delete this event…' })).toBeInTheDocument()
  })

  it('shows a deleted event’s record with the restore, which says an on-sale event comes back paused', async () => {
    api.getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      status: 'DELETED',
      deletion: {
        deletedAt: '2026-10-01T15:00:00.000Z',
        reason: 'Deleted by mistake.',
        outcome: 'REMOVE',
        authority: 'ORGANIZATION',
        statusBefore: 'ON_SALE',
        restoreTo: 'SALES_PAUSED',
        deletedByName: 'Priya Shah',
      },
    })

    await renderPage()

    expect(screen.getByRole('heading', { name: 'This event was deleted' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore…' })).toBeInTheDocument()
    expect(api.getPlatformEdits).not.toHaveBeenCalled()
  })

  it('offers no danger zone or restore to an administrator who may not delete', async () => {
    readSession.mockResolvedValue({ ...ADMIN, capabilities: ['event:platform_edit'] })

    await renderPage()

    expect(screen.queryByRole('heading', { name: 'Danger zone' })).not.toBeInTheDocument()
  })

  it('refuses an account that does not edit events as the Desi-Event team, and reads nothing', async () => {
    readSession.mockResolvedValue({
      user: { id: 'u2' },
      capabilities: ['moderation:review'],
      memberships: [],
    })

    await renderPage()

    expect(screen.getByText(NOT_FOR_THIS_ACCOUNT)).toBeInTheDocument()
    expect(api.getOrganizerEvent).not.toHaveBeenCalled()
  })

  it('offers to move an event copied from Sulekha to an organisation, to an account that imports', async () => {
    readSession.mockResolvedValue({
      ...ADMIN,
      capabilities: [...ADMIN.capabilities, 'event:import'],
    })
    api.getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      status: 'REVIEW_PENDING',
      organization: { name: 'Sulekha Events' },
      importedFrom: {
        sourceName: 'Sulekha',
        presentedBy: 'Raga Nights Houston',
        listedOn: '2026-09-30',
        prices: [],
        priceListed: false,
        ticketsOnSource: false,
      },
    })

    await renderPage()

    expect(screen.getByRole('heading', { name: 'Copied from Sulekha' })).toBeInTheDocument()
    expect(screen.getByText(/presented by Raga Nights Houston/u)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move to an organisation…' })).toBeInTheDocument()
  })

  it('says the listing names no organiser when it gave none, never "presented by null"', async () => {
    readSession.mockResolvedValue({
      ...ADMIN,
      capabilities: [...ADMIN.capabilities, 'event:import'],
    })
    api.getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      status: 'REVIEW_PENDING',
      organization: { name: 'Sulekha Events' },
      importedFrom: {
        sourceName: 'Sulekha',
        presentedBy: null,
        listedOn: '2026-09-30',
        prices: [],
        priceListed: false,
        ticketsOnSource: false,
      },
    })

    await renderPage()

    expect(
      screen.getByText(/copied from its Sulekha listing, which names no organiser/u),
    ).toBeVisible()
    expect(document.body.textContent).not.toMatch(/presented by (null|undefined)/u)
    expect(screen.getByRole('button', { name: 'Move to an organisation…' })).toBeInTheDocument()
  })

  it('offers no move for an event not held for an import, or to an account that does not import', async () => {
    readSession.mockResolvedValue({
      ...ADMIN,
      capabilities: [...ADMIN.capabilities, 'event:import'],
    })

    await renderPage()

    expect(screen.queryByRole('button', { name: 'Move to an organisation…' })).toBeNull()

    readSession.mockResolvedValue(ADMIN)
    api.getOrganizerEvent.mockResolvedValue({
      ...EVENT,
      importedFrom: {
        sourceName: 'Sulekha',
        presentedBy: 'Raga Nights Houston',
        listedOn: '2026-09-30',
        prices: [],
        priceListed: false,
        ticketsOnSource: false,
      },
    })

    await renderPage()

    expect(screen.queryByRole('button', { name: 'Move to an organisation…' })).toBeNull()
  })
})
