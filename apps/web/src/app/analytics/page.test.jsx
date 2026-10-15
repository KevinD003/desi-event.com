/**
 * The analytics page: the organisation view shows the six visit figures, the
 * chart with its table, the sources, the card placements and each event; the
 * event view names the event and its website link; a platform administrator
 * may open an organisation they do not belong to, and an organiser asking for
 * one is still refused; the funnel's title matches its first step; and the
 * counting notes say who is left out.
 *
 * @module app/analytics/page.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/session.js', async () => {
  const actual = await vi.importActual('../../lib/capabilities.js')

  return { ...actual, readSession: vi.fn() }
})
vi.mock('../../lib/organizer-api.js', () => ({ getAnalytics: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/analytics',
  useSearchParams: () => new URLSearchParams(''),
}))

const { readSession } = await import('../../lib/session.js')
const { getAnalytics } = await import('../../lib/organizer-api.js')
const {
  default: AnalyticsPage,
  FUNNEL_TITLE,
  VENUE_COUNTING_NOTE,
  bookedUnpaidSentence,
  cancelledUnpaidSentence,
} = await import('./page.jsx')
const { VISIT_COUNTING_NOTES } = await import('../../lib/traffic.js')

const ORG = 'corgalpha00000000000001'
const OTHER_ORG = 'corgbeta000000000000002'
const EVENT = 'ceventalpha000000000001'

afterEach(cleanup)

beforeEach(() => {
  readSession.mockReset()
  getAnalytics.mockReset()
})

/** An owner of one organisation. */
const OWNER = {
  user: { displayName: 'Owner' },
  capabilities: [],
  memberships: [
    {
      organizationId: ORG,
      organizationName: 'Alpha Garba',
      role: 'OWNER',
      capabilities: ['report:view', 'finance:view'],
    },
  ],
}

/** A platform administrator with no organisation. */
const ADMIN = {
  user: { displayName: 'Anil Administrator' },
  capabilities: [
    'analytics:view_all',
    'event:view_draft',
    'moderation:review',
    'organizer:invite',
    'report:view',
    'venue:manage',
    'website_redirect:manage',
  ],
  memberships: [],
}

/**
 * The `traffic` branch.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The branch.
 */
function traffic(overrides = {}) {
  return {
    timeZone: 'UTC',
    firstDay: '2026-10-01',
    lastDay: '2026-10-03',
    updatedAt: '2026-10-03T14:20:00.000Z',
    stale: false,
    includesDemonstration: false,
    totals: {
      views: 1204,
      visitors: 800,
      anonymousViews: 12,
      cardClicks: 90,
      ticketClicks: 40,
      seatClicks: 2,
      ticketClickVisitors: 30,
      websiteRedirects: 7,
      websiteRedirectVisitors: 6,
    },
    sources: [
      { source: 'DIRECT', views: 300 },
      { source: 'INTERNAL', views: 600 },
      { source: 'SEARCH', views: 200 },
      { source: 'SOCIAL', views: 100 },
      { source: 'OTHER', views: 4 },
    ],
    cardPlacements: [
      { placement: 'HOME', clicks: 50 },
      { placement: 'LISTING', clicks: 30 },
      { placement: 'SEARCH', clicks: 10 },
    ],
    byDay: ['2026-10-01', '2026-10-02', '2026-10-03'].map((day, index) => ({
      day,
      views: 400 + index,
      visitors: 260 + index,
      cardClicks: 30,
      ticketClicks: 13,
      seatClicks: 1,
      websiteRedirects: 2,
      ordersPaid: 3,
    })),
    seriesTruncated: false,
    byEvent: [
      {
        eventId: EVENT,
        title: 'Navratri on the Lawn',
        slug: 'navratri-on-the-lawn',
        status: 'ON_SALE',
        deleted: false,
        startsAt: '2026-10-20T00:00:00.000Z',
        views: 1204,
        visitors: 800,
        cardClicks: 90,
        ticketClicks: 40,
        seatClicks: 2,
        websiteRedirects: 7,
        websiteLinkOn: true,
        ordersPaid: 9,
      },
    ],
    conversion: {
      visitors: 800,
      ticketClickVisitors: 30,
      ordersPaid: 9,
      visitorToOrderPercent: 1.1,
    },
    event: null,
    ...overrides,
  }
}

/**
 * The whole summary payload.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The payload.
 */
function analytics(overrides = {}) {
  return {
    organizationId: ORG,
    organizationName: 'Alpha Garba',
    currency: 'USD',
    eventId: null,
    eventSessionId: null,
    from: null,
    to: null,
    timeZone: 'UTC',
    mode: 'MOCK',
    modeNotice: 'DEMO — no money moved.',
    moneyVisible: false,
    moneyWithheld: 'CAPABILITY',
    money: null,
    tickets: { live: 4, lost: 0, byLostState: [] },
    inventory: {
      generalAdmission: [],
      reserved: { bySection: [], byPriceZone: [], statuses: [] },
    },
    sales: { byEvent: [], bySession: [], byTicketType: [], byDate: [] },
    checkIns: { admitted: 1, live: 4, percent: 25 },
    movement: { transfers: [], revoked: 0 },
    traffic: traffic(),
    notifications: [],
    exceptions: { open: 0, escalated: 0, oldestOpenedAt: null, oldestAgeHours: null },
    funnel: {
      steps: [
        { key: 'visitors', label: 'Visitors', count: 800 },
        { key: 'ticketClickVisitors', label: 'Visitors who chose tickets or seats', count: 30 },
        { key: 'holds', label: 'Tickets held', count: 12 },
        { key: 'ordersCreated', label: 'Orders started', count: 10 },
        { key: 'ordersPaid', label: 'Orders paid', count: 9 },
      ],
      missing: ['Robots are not counted as visitors.'],
    },
    limits: { breakdownRows: 200 },
    ...overrides,
  }
}

/**
 * Render the page for a session and a query.
 *
 * @param {object|null} session The session.
 * @param {Record<string, string>} [query] The query string.
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderPage(session, query = {}) {
  readSession.mockResolvedValue(session)
  render(await AnalyticsPage({ searchParams: Promise.resolve(query) }))
}

describe('the organisation view', () => {
  it('shows the six visit figures in a definition list', async () => {
    getAnalytics.mockResolvedValue(analytics())
    await renderPage(OWNER)

    const section = screen.getByRole('region', { name: 'Visits to your event pages' })
    const terms = within(section)
      .getAllByRole('term')
      .map((term) => term.textContent)

    expect(terms).toEqual([
      'Page views',
      'Visitors',
      'Event card clicks',
      'Ticket and seat clicks',
      'Visits to your website',
      'Visitors to paid orders',
    ])
    expect(within(section).getByText('1,204')).toBeTruthy()
    expect(within(section).getByText('42')).toBeTruthy()
    expect(within(section).getByText('1.1%')).toBeTruthy()
    expect(within(section).getByText(/These figures run to 14:20 UTC on Oct 3\./u)).toBeTruthy()
  })

  it('draws the chart with its table, the sources, the placements and the events', async () => {
    getAnalytics.mockResolvedValue(analytics())
    await renderPage(OWNER)

    expect(screen.getByRole('img', { name: 'Page views and visitors per day (UTC)' })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Visits per day (UTC)' })).toBeTruthy()
    expect(screen.getByText('Visits per day, as a table', { selector: 'summary' })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Where page views came from' })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Where the event card was clicked' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Your events' })).toBeTruthy()

    const link = screen.getByRole('link', { name: 'Navratri on the Lawn' })
    const href = new URL(link.getAttribute('href'), 'https://desi-event.test')

    expect(href.searchParams.get('eventId')).toBe(EVENT)
    expect(href.searchParams.get('range')).toBe('all')
  })

  it('asks for everything by default, and from the start of a named period otherwise', async () => {
    getAnalytics.mockResolvedValue(analytics())
    await renderPage(OWNER)

    expect(getAnalytics.mock.calls[0][0]).toMatchObject({ organizationId: ORG })
    expect(getAnalytics.mock.calls[0][0].from).toBeUndefined()
    expect(screen.getByRole('link', { name: 'Everything' }).getAttribute('aria-current')).toBe(
      'page',
    )

    cleanup()
    getAnalytics.mockClear()
    await renderPage(OWNER, { range: '7' })

    expect(getAnalytics.mock.calls[0][0].from).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/u)
    expect(screen.getByRole('link', { name: 'Last 7 days' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('says an explicit window is a custom period', async () => {
    getAnalytics.mockResolvedValue(analytics())
    await renderPage(OWNER, { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' })

    const periods = screen.getByRole('navigation', { name: 'Choose a period' })

    expect(within(periods).getByText('Custom period').getAttribute('aria-current')).toBe('page')
    expect(getAnalytics.mock.calls[0][0]).toMatchObject({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    })
  })

  it('titles the funnel from visit to payment, as its first step is visitors', async () => {
    getAnalytics.mockResolvedValue(analytics())
    await renderPage(OWNER)

    expect(FUNNEL_TITLE).toBe('From visit to payment')

    const funnel = screen.getByRole('heading', { level: 2, name: FUNNEL_TITLE }).closest('section')
    const table = within(funnel).getByRole('table', { name: FUNNEL_TITLE })

    expect(within(table).getAllByRole('rowheader')[0].textContent).toBe('Visitors')
    expect(within(funnel).getByRole('heading', { name: 'Not counted' })).toBeTruthy()
    expect(within(funnel).getByText('Robots are not counted as visitors.')).toBeTruthy()
    expect(screen.queryByText('From hold to payment')).toBeNull()
  })

  it('says what the figures count, including that the team and staff are left out', async () => {
    getAnalytics.mockResolvedValue(analytics())
    await renderPage(OWNER)

    const notes = screen.getByRole('region', { name: 'What these figures count' })

    for (const note of VISIT_COUNTING_NOTES) {
      expect(within(notes).getByText(note)).toBeTruthy()
    }
  })

  it('marks demonstration figures, and warns when the figures have gone stale', async () => {
    getAnalytics.mockResolvedValue(
      analytics({ traffic: traffic({ includesDemonstration: true, stale: true }) }),
    )
    await renderPage(OWNER)

    expect(screen.getByText('Demonstration figures')).toBeTruthy()
    expect(
      screen.getByText(
        /The job that adds visits up has not finished since, so later visits are missing\./u,
      ),
    ).toBeTruthy()
  })

  it('says nothing has been added up when the roll-up has never run', async () => {
    getAnalytics.mockResolvedValue(analytics({ traffic: traffic({ updatedAt: null }) }))
    await renderPage(OWNER)

    expect(
      screen.getByText(
        /No visits have been added up on this site: the job that adds them up has not run\./u,
      ),
    ).toBeTruthy()
  })

  it('links the export with the period and says it carries no visitor code', async () => {
    getAnalytics.mockResolvedValue(analytics())
    await renderPage(OWNER, { range: '30' })

    const href = new URL(
      screen.getByRole('link', { name: 'Download as CSV' }).getAttribute('href'),
      'https://desi-event.test',
    )

    expect(href.pathname).toBe('/api/v1/analytics/export.csv')
    expect(href.searchParams.get('organizationId')).toBe(ORG)
    expect(href.searchParams.get('from')).toMatch(/T00:00:00\.000Z$/u)
    expect(screen.getByText(/no visitor code/u)).toBeTruthy()
  })
})

describe('the event view', () => {
  const event = {
    id: EVENT,
    title: 'Navratri on the Lawn',
    slug: 'navratri-on-the-lawn',
    status: 'ON_SALE',
    deleted: false,
    startsAt: '2026-10-20T00:00:00.000Z',
    websiteLinkOn: false,
    websiteRedirect: null,
  }

  it('names the event, its organisation and its state, and the website link’s', async () => {
    getAnalytics.mockResolvedValue(
      analytics({ eventId: EVENT, traffic: traffic({ event, byEvent: [] }) }),
    )
    await renderPage(OWNER, { organizationId: ORG, eventId: EVENT })

    expect(
      screen.getByRole('heading', { level: 1, name: 'Analytics for Navratri on the Lawn' }),
    ).toBeTruthy()
    expect(screen.getByText(/Alpha Garba · On sale · starts Oct 20, 2026/u)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Visits to this event’s page' })).toBeTruthy()
    expect(
      screen.getByText(
        'Website link: Off. Only the team at The Desi Events can turn it on or off.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Your events' })).toBeNull()
    expect(getAnalytics.mock.calls[0][0]).toMatchObject({ organizationId: ORG, eventId: EVENT })
  })

  it('says Deleted for a deleted event', async () => {
    getAnalytics.mockResolvedValue(
      analytics({
        eventId: EVENT,
        traffic: traffic({ event: { ...event, status: 'DELETED', deleted: true }, byEvent: [] }),
      }),
    )
    await renderPage(OWNER, { organizationId: ORG, eventId: EVENT })

    expect(screen.getByText(/Alpha Garba · Deleted · starts/u)).toBeTruthy()
  })

  it('says an event of another organisation is not here, and shows the organisation’s own figures', async () => {
    getAnalytics
      .mockResolvedValueOnce(analytics({ eventId: 'cforeign0000000000000001', traffic: traffic() }))
      .mockResolvedValueOnce(analytics())
    await renderPage(OWNER, { organizationId: ORG, eventId: 'cforeign0000000000000001' })

    expect(screen.getByText('No such event here')).toBeTruthy()
    expect(getAnalytics).toHaveBeenCalledTimes(2)
    expect(getAnalytics.mock.calls[1][0].eventId).toBeUndefined()
    expect(screen.getByRole('heading', { name: 'Your events' })).toBeTruthy()
  })
})

describe('who may see which organisation', () => {
  it('still refuses an organiser asking for an organisation they do not belong to', async () => {
    await renderPage(OWNER, { organizationId: OTHER_ORG })

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeTruthy()
    expect(getAnalytics).not.toHaveBeenCalled()
  })

  it('lets a platform administrator open an organisation they do not belong to, and names it', async () => {
    getAnalytics.mockResolvedValue(
      analytics({ organizationId: OTHER_ORG, organizationName: 'Beta Bhangra' }),
    )
    await renderPage(ADMIN, { organizationId: OTHER_ORG })

    expect(getAnalytics.mock.calls[0][0]).toMatchObject({ organizationId: OTHER_ORG })
    expect(screen.getByText('Beta Bhangra', { selector: 'p' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'This organisation’s events' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Not for you' })).toBeNull()
    // The money is the server's to withhold, and it did.
    expect(screen.getByText('Money figures are not included for this account')).toBeTruthy()

    // Nothing about the visits speaks to the administrator as the organiser.
    const section = screen.getByRole('region', {
      name: 'Visits to this organisation’s event pages',
    })
    const terms = within(section)
      .getAllByRole('term')
      .map((term) => term.textContent)

    expect(terms).toContain('Visits to the organiser’s website')
    expect(terms).not.toContain('Visits to your website')
    expect(
      within(section).getByText(
        /^People sent to the organiser’s own website by the event page’s link\./u,
      ),
    ).toBeTruthy()
    expect(within(section).queryByText(/\byour\b/u)).toBeNull()

    // The trail starts at the platform list it was opened from.
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })

    expect(
      within(trail).getByRole('link', { name: 'Every event’s visits' }).getAttribute('href'),
    ).toBe('/analytics/events')
    expect(within(trail).queryByText('Organiser')).toBeNull()
  })

  it('gives a platform administrator from outside the organisation the administrators’ website-link line', async () => {
    getAnalytics.mockResolvedValue(
      analytics({
        organizationId: OTHER_ORG,
        organizationName: 'Beta Bhangra',
        eventId: EVENT,
        traffic: traffic({
          byEvent: [],
          event: {
            id: EVENT,
            title: 'Navratri on the Lawn',
            slug: 'navratri-on-the-lawn',
            status: 'ON_SALE',
            deleted: false,
            startsAt: '2026-10-20T00:00:00.000Z',
            websiteLinkOn: true,
            websiteRedirect: {
              enabled: true,
              pending: false,
              decidedUrl: 'https://mirrorwork.example/',
              submittedAt: null,
              changedAt: '2026-10-01T09:00:00.000Z',
              reason: null,
              changedByName: 'Anil Administrator',
              websiteProblem: null,
            },
          },
        }),
      }),
    )
    await renderPage(ADMIN, { organizationId: OTHER_ORG, eventId: EVENT })

    const section = screen.getByRole('region', { name: 'Visits to this event’s page' })

    expect(
      within(section).getByText(/^Website link: On since .*Turned on by Anil Administrator\./u),
    ).toBeTruthy()
    expect(within(section).queryByText(/Your event page/u)).toBeNull()
    expect(within(section).getByText('Visits to the organiser’s website')).toBeTruthy()
  })

  it('tells a platform administrator with no organisation where every event’s visits are', async () => {
    await renderPage(ADMIN)

    expect(screen.getByText('No organisation of your own')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'See every event’s visits' }).getAttribute('href'),
    ).toBe('/analytics/events')
    expect(getAnalytics).not.toHaveBeenCalled()

    // The organiser area refuses this session, so the trail does not point
    // there: it starts at the platform list.
    const trail = within(screen.getByRole('navigation', { name: 'Breadcrumb' }))
      .getAllByRole('listitem')
      .map((item) => {
        const link = within(item).queryByRole('link')

        // The text after the "/" separator the trail draws between crumbs.
        return link
          ? `${link.textContent} -> ${link.getAttribute('href')}`
          : item.textContent.replace(/^\//u, '')
      })

    expect(trail).toEqual(['Every event’s visits -> /analytics/events', 'Analytics'])
    expect(screen.queryByRole('link', { name: 'Organiser' })).toBeNull()
  })

  it('starts an organiser’s trail at the organiser area, which admits them', async () => {
    getAnalytics.mockResolvedValue(analytics())
    await renderPage(OWNER)

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })

    expect(within(trail).getByRole('link', { name: 'Organiser' }).getAttribute('href')).toBe(
      '/organizer/events',
    )
    expect(within(trail).queryByRole('link', { name: 'Every event’s visits' })).toBeNull()
  })

  it('says so when a platform administrator names an organisation that does not exist', async () => {
    getAnalytics.mockResolvedValue(analytics({ organizationId: OTHER_ORG, organizationName: null }))
    await renderPage(ADMIN, { organizationId: OTHER_ORG })

    expect(screen.getByText('No such organisation')).toBeTruthy()
    expect(screen.queryByRole('region', { name: /^Visits to/u })).toBeNull()
  })

  it('tells somebody with no organisation and no platform list that there is nothing to report', async () => {
    await renderPage({ user: {}, capabilities: [], memberships: [] })

    expect(screen.getByText('No organisation to report on')).toBeTruthy()
    expect(getAnalytics).not.toHaveBeenCalled()
    // Neither the organiser area nor the platform list admits this session,
    // so the trail links to neither.
    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).queryAllByRole('link'),
    ).toEqual([])
  })
})

describe('paying at the venue (SPEC3 §9.10, SPEC3-XI §9.10)', () => {
  it('says how many bookings to pay at the venue wait for their payment, and are not counted as paid', async () => {
    getAnalytics.mockResolvedValue(
      analytics({ funnel: { ...analytics().funnel, atVenue: { bookedUnpaid: 3 } } }),
    )
    await renderPage(OWNER)

    const funnel = screen.getByRole('heading', { name: FUNNEL_TITLE }).closest('section')

    expect(funnel).toHaveTextContent(
      '3 orders booked to pay at the venue are waiting for payment at the door and are not counted as paid.',
    )
  })

  it('says where tickets paid at the venue are counted, and how many unpaid ones were cancelled', async () => {
    getAnalytics.mockResolvedValue(
      analytics({
        venuePayments: {
          ticketsUnpaid: 2,
          unpaidCents: 9000,
          paidAtDoorCents: 4000,
          cancelledUnpaidTickets: 2,
        },
      }),
    )
    await renderPage(OWNER)

    const section = screen.getByRole('region', { name: 'Paying at the venue' })

    expect(section).toHaveTextContent(VENUE_COUNTING_NOTE)
    expect(VENUE_COUNTING_NOTE).toBe(
      'Tickets booked to pay at the venue are in the ticket counts. What is paid at the door is taken by the organiser and is not in the money figures, which come from the ledger.',
    )
    expect(section).toHaveTextContent(
      '2 unpaid tickets booked to pay at the venue were cancelled, and their places were freed.',
    )
  })

  it('says nothing about paying at the venue where nobody booked to pay there', async () => {
    getAnalytics.mockResolvedValue(
      analytics({
        venuePayments: {
          ticketsUnpaid: 0,
          unpaidCents: 0,
          paidAtDoorCents: 0,
          cancelledUnpaidTickets: 0,
        },
        funnel: { ...analytics().funnel, atVenue: { bookedUnpaid: 0 } },
      }),
    )
    await renderPage(OWNER)

    expect(screen.queryByRole('region', { name: 'Paying at the venue' })).toBeNull()
    expect(screen.queryByText(/booked to pay at the venue/u)).toBeNull()
  })

  it('counts cancelled unpaid tickets beside the sold ones in a breakdown that has any', async () => {
    getAnalytics.mockResolvedValue(
      analytics({
        sales: {
          byEvent: [
            {
              id: EVENT,
              label: 'Navratri on the Lawn',
              currency: 'USD',
              quantity: 3,
              lineValueCents: 13500,
              refundedQuantity: 0,
              cancelledQuantity: 1,
            },
          ],
          bySession: [],
          byTicketType: [],
          byDate: [],
        },
      }),
    )
    await renderPage(OWNER)

    const table = screen.getByRole('table', { name: 'Sales by event' })

    expect(within(table).getByRole('columnheader', { name: 'Cancelled unpaid' })).toBeTruthy()
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('1')
  })

  it('puts the sentences in the singular and the plural', () => {
    expect(bookedUnpaidSentence(1)).toBe(
      '1 order booked to pay at the venue is waiting for payment at the door and is not counted as paid.',
    )
    expect(bookedUnpaidSentence(0)).toBeNull()
    expect(cancelledUnpaidSentence(1)).toBe(
      '1 unpaid ticket booked to pay at the venue was cancelled, and its place was freed.',
    )
    expect(cancelledUnpaidSentence(undefined)).toBeNull()
  })
})
