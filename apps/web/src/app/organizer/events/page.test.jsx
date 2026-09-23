/**
 * "Your events" lists this organiser's events, and nobody else's.
 *
 * The defect this pins: the page asked `GET /v1/events` with no organisation,
 * and the API answered as a listing does — the public catalogue plus the
 * caller's own drafts — so every organisation's public events appeared under
 * "Your events", each linking into an editor that would refuse.
 *
 * @module app/organizer/events/page.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/organizer-api.js', () => ({ listOrganizerEvents: vi.fn() }))
vi.mock('../../../lib/session.js', async () => {
  const capabilities = await import('../../../lib/capabilities.js')

  return {
    readSession: vi.fn(),
    membershipsWith: capabilities.membershipsWith,
    sessionCan: capabilities.sessionCan,
  }
})
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/organizer/events',
  useSearchParams: () => new URLSearchParams(),
}))

const { listOrganizerEvents } = await import('../../../lib/organizer-api.js')
const { readSession } = await import('../../../lib/session.js')
const { default: OrganizerEventsPage, eventCounts } = await import('./page.jsx')

/**
 * A session with the given memberships.
 *
 * @param {Array<object>} memberships Its memberships.
 * @param {string[]} [capabilities] Platform capabilities.
 * @returns {object} The session.
 */
function session(memberships, capabilities = []) {
  return { user: { id: 'u1' }, capabilities, memberships }
}

/** A membership that may see its organisation's drafts. */
const RANGOLI = {
  organizationId: 'org_rangoli',
  organizationName: 'Rangoli',
  role: 'OWNER',
  capabilities: ['event:view_draft', 'event:create'],
}

/**
 * An event summary.
 *
 * @param {string} id Its id.
 * @param {string} organizationName Whose.
 * @param {string} [status] Its lifecycle state.
 * @returns {object} The summary.
 */
function event(id, organizationName, status = 'DRAFT') {
  return {
    id,
    title: `Event ${id}`,
    status,
    startsAt: '2030-01-01T18:00:00.000Z',
    timezone: 'Asia/Kolkata',
    organizationName,
  }
}

beforeEach(() => {
  listOrganizerEvents.mockReset()
  readSession.mockReset()
})

afterEach(cleanup)

describe('OrganizerEventsPage', () => {
  it('asks for each of the caller’s organisations by id, never the whole catalogue', async () => {
    readSession.mockResolvedValue(session([RANGOLI]))
    listOrganizerEvents.mockResolvedValue({ events: [event('e1', 'Rangoli')], pagination: null })

    render(await OrganizerEventsPage())

    expect(listOrganizerEvents).toHaveBeenCalledTimes(1)
    expect(listOrganizerEvents).toHaveBeenCalledWith({ organizationId: 'org_rangoli' })
    expect(screen.getByRole('link', { name: 'Event e1' }).getAttribute('href')).toBe(
      '/organizer/events/e1',
    )
  })

  it('asks for every organisation the caller can see drafts in, and names each', async () => {
    readSession.mockResolvedValue(
      session([
        RANGOLI,
        { ...RANGOLI, organizationId: 'org_dhol', organizationName: 'Dhol Collective' },
        // A membership without the capability is not asked about.
        { organizationId: 'org_scan', role: 'SCANNER', capabilities: ['ticket:check_in'] },
      ]),
    )
    listOrganizerEvents.mockImplementation(async ({ organizationId }) => ({
      events: [
        event(organizationId, organizationId === 'org_dhol' ? 'Dhol Collective' : 'Rangoli'),
      ],
      pagination: null,
    }))

    render(await OrganizerEventsPage())

    expect(listOrganizerEvents.mock.calls.map(([options]) => options.organizationId)).toEqual([
      'org_rangoli',
      'org_dhol',
    ])
    expect(screen.getByText('Dhol Collective')).toBeInTheDocument()
  })

  it('shows a platform administrator with no membership the platform, and says so', async () => {
    readSession.mockResolvedValue(session([], ['platform:admin']))
    listOrganizerEvents.mockResolvedValue({ events: [event('e9', 'Somebody')], pagination: null })

    render(await OrganizerEventsPage())

    expect(listOrganizerEvents).toHaveBeenCalledWith()
    expect(screen.getByText(/every organisation’s events, not a list of its own/)).toBeTruthy()
  })

  it('asks nothing for an account that can see no organisation’s drafts', async () => {
    readSession.mockResolvedValue(
      session([{ organizationId: 'org_scan', role: 'SCANNER', capabilities: ['ticket:check_in'] }]),
    )

    render(await OrganizerEventsPage())

    expect(listOrganizerEvents).not.toHaveBeenCalled()
    expect(screen.getByText(/no list of events to show here/)).toBeTruthy()
    expect(screen.queryByText('No events')).toBeNull()
  })

  it('says when an organisation has more events than were listed', async () => {
    readSession.mockResolvedValue(session([RANGOLI]))
    listOrganizerEvents.mockResolvedValue({
      events: [event('e1', 'Rangoli')],
      pagination: { hasNextPage: true, total: 80 },
    })

    render(await OrganizerEventsPage())

    expect(screen.getByText(/older ones are not shown here/)).toBeTruthy()
  })

  it('counts the listed events by whose turn it is, from the rows it drew', async () => {
    readSession.mockResolvedValue(session([RANGOLI]))
    listOrganizerEvents.mockResolvedValue({
      events: [
        event('e1', 'Rangoli', 'DRAFT'),
        event('e2', 'Rangoli', 'REVIEW_PENDING'),
        event('e3', 'Rangoli', 'ON_SALE'),
        event('e4', 'Rangoli', 'CHANGES_REQUIRED'),
      ],
      pagination: null,
    })

    const { container } = render(await OrganizerEventsPage())
    const tiles = Object.fromEntries(
      [...container.querySelectorAll('dl > div')].map((tile) => [
        within(tile).getByRole('term').textContent,
        within(tile).getByRole('definition').textContent,
      ]),
    )

    expect(tiles).toEqual({
      'Listed here': '4',
      'Waiting on you': '2',
      'With a moderator': '1',
      'On sale': '1',
    })
    // The events are still the only second-level headings on the page.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Event e1',
      'Event e2',
      'Event e3',
      'Event e4',
    ])
  })

  it('says the count covers only the listed events when there are more', async () => {
    readSession.mockResolvedValue(session([RANGOLI]))
    listOrganizerEvents.mockResolvedValue({
      events: [event('e1', 'Rangoli')],
      pagination: { hasNextPage: true, total: 80 },
    })

    render(await OrganizerEventsPage())

    expect(screen.getByText(/the most recent; older events are not counted/i)).toBeTruthy()
  })

  it('draws no counts when there is nothing listed to count', async () => {
    readSession.mockResolvedValue(session([RANGOLI]))
    listOrganizerEvents.mockResolvedValue({ events: [], pagination: null })

    render(await OrganizerEventsPage())

    expect(screen.queryByText('Listed here')).toBeNull()
    expect(screen.getByText('No events')).toBeTruthy()
  })

  it('draws each event’s poster as decoration, not as an image to announce', async () => {
    readSession.mockResolvedValue(session([RANGOLI]))
    listOrganizerEvents.mockResolvedValue({ events: [event('e1', 'Rangoli')], pagination: null })

    const { container } = render(await OrganizerEventsPage())

    expect(container.querySelector('[data-slot="poster-thumb"] svg')).not.toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('eventCounts', () => {
  it('counts nothing in an empty list', () => {
    expect(eventCounts([])).toEqual({ listed: 0, yours: 0, moderator: 0, onSale: 0 })
  })

  it('reads a state it has never heard of as nobody’s turn', () => {
    expect(eventCounts([{ status: 'SOMETHING_NEW' }])).toEqual({
      listed: 1,
      yours: 0,
      moderator: 0,
      onSale: 0,
    })
  })
})
