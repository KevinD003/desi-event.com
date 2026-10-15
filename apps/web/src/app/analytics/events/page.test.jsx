/**
 * Every event's visits: refused, without asking the API, to anybody without
 * the platform list; the two tables for a platform administrator, with each
 * event linking to its own figures and keeping the period; deleted events
 * marked; empty states; and no money anywhere.
 *
 * @module app/analytics/events/page.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/session.js', async () => {
  const actual = await vi.importActual('../../../lib/capabilities.js')

  return { ...actual, readSession: vi.fn() }
})
vi.mock('../../../lib/organizer-api.js', () => ({ getPlatformTraffic: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/analytics/events',
  useSearchParams: () => new URLSearchParams(''),
}))

const { readSession } = await import('../../../lib/session.js')
const { getPlatformTraffic } = await import('../../../lib/organizer-api.js')
const {
  default: PlatformTrafficPage,
  INTRODUCTION,
  NOT_FOR_YOU,
  metadata,
  readTrafficSearch,
} = await import('./page.jsx')

afterEach(cleanup)

beforeEach(() => {
  readSession.mockReset()
  getPlatformTraffic.mockReset()
})

/** A platform administrator. */
const ADMIN = {
  user: { displayName: 'Anil Administrator' },
  capabilities: ['analytics:view_all', 'report:view', 'website_redirect:manage'],
  memberships: [],
}

/** An organisation owner: their own figures, never the platform list. */
const OWNER = {
  user: { displayName: 'Owner' },
  capabilities: [],
  memberships: [
    { organizationId: 'corgalpha00000000000001', role: 'OWNER', capabilities: ['report:view'] },
  ],
}

/**
 * One row of the platform list.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The row.
 */
function row(overrides = {}) {
  return {
    eventId: 'ceventalpha000000000001',
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
    organization: { id: 'corgalpha00000000000001', name: 'Alpha Garba', slug: 'alpha-garba' },
    ...overrides,
  }
}

/**
 * The API's answer.
 *
 * @param {object} [overrides] Fields to change in `data`.
 * @param {object|null} [pagination] The counters.
 * @returns {{data: object, pagination: object|null}} The answer.
 */
function answer(overrides = {}, pagination = { page: 1, total: 1, totalPages: 1 }) {
  return {
    data: {
      timeZone: 'UTC',
      firstDay: '2026-09-06',
      lastDay: '2026-10-05',
      updatedAt: '2026-10-05T09:10:00.000Z',
      stale: false,
      includesDemonstration: false,
      top: [row()],
      events: [
        row(),
        row({
          eventId: 'ceventgone0000000000002',
          title: 'Dandiya by the River',
          status: 'DELETED',
          deleted: true,
          websiteLinkOn: false,
          organization: { id: 'corgbeta000000000000002', name: 'Beta Bhangra', slug: 'beta' },
        }),
      ],
      ...overrides,
    },
    pagination,
  }
}

/**
 * Render the page.
 *
 * @param {object|null} session The session.
 * @param {Record<string, string>} [query] The query string.
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderPage(session, query = {}) {
  readSession.mockResolvedValue(session)
  render(await PlatformTrafficPage({ searchParams: Promise.resolve(query) }))
}

describe('who may see every event’s visits', () => {
  it.each([
    ['an organisation owner', OWNER],
    ['a moderator', { user: {}, capabilities: ['moderation:review'], memberships: [] }],
    ['a signed-out visitor', null],
  ])('refuses %s, without asking the API', async (_name, session) => {
    await renderPage(session)

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeTruthy()
    expect(screen.getByText(NOT_FOR_YOU)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Analytics' }).getAttribute('href')).toBe('/analytics')
    expect(getPlatformTraffic).not.toHaveBeenCalled()
  })

  it('names itself and keeps itself out of search engines', () => {
    expect(metadata).toEqual({
      title: 'Every event’s visits',
      robots: { index: false, follow: false },
    })
  })
})

describe('the platform list', () => {
  it('asks for the last 30 days of public events by default, a page of 50', async () => {
    getPlatformTraffic.mockResolvedValue(answer())
    await renderPage(ADMIN)

    const options = getPlatformTraffic.mock.calls[0][0]

    expect(options).toMatchObject({ scope: 'public', page: 1, perPage: 50 })
    expect(options.q).toBeUndefined()

    const from = Date.parse(options.from)
    const days = Math.round((Date.now() - from) / 86_400_000)

    expect(days).toBeGreaterThanOrEqual(29)
    expect(days).toBeLessThanOrEqual(30)
    expect(screen.getByRole('link', { name: 'Last 30 days' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(screen.getByText(INTRODUCTION)).toBeTruthy()
  })

  it('passes the search, the scope and the period it was given', async () => {
    getPlatformTraffic.mockResolvedValue(answer())
    await renderPage(ADMIN, { q: '  garba  ', scope: 'all', range: 'all', page: '2' })

    expect(getPlatformTraffic.mock.calls[0][0]).toMatchObject({
      q: 'garba',
      scope: 'all',
      from: undefined,
      page: 2,
    })
    expect(screen.getByRole('radio', { name: 'All events' }).checked).toBe(true)
    expect(screen.getByLabelText('Search by event, web address or organiser').value).toBe('garba')
  })

  it('shows the most visited and every event, each linking to its own figures with the period', async () => {
    getPlatformTraffic.mockResolvedValue(answer())
    await renderPage(ADMIN, { range: '7' })

    const top = screen.getByRole('table', { name: 'Most visited in this period' })
    const events = screen.getByRole('table', { name: 'Events, newest start first' })

    expect(within(top).getAllByRole('row')).toHaveLength(2)

    const link = within(events).getByRole('link', { name: 'Navratri on the Lawn' })
    const href = new URL(link.getAttribute('href'), 'https://desi-event.test')

    expect(href.pathname).toBe('/analytics')
    expect(Object.fromEntries(href.searchParams)).toEqual({
      organizationId: 'corgalpha00000000000001',
      eventId: 'ceventalpha000000000001',
      range: '7',
    })
  })

  it('marks a deleted event Deleted and lists it, because it was seen and sold', async () => {
    getPlatformTraffic.mockResolvedValue(answer())
    await renderPage(ADMIN)

    const events = screen.getByRole('table', { name: 'Events, newest start first' })
    const gone = within(events).getByRole('row', { name: /Dandiya by the River/u })

    expect(within(gone).getByText('Deleted')).toBeTruthy()
    expect(within(gone).getByText('Beta Bhangra')).toBeTruthy()
  })

  it('links the website link’s state to its panel for somebody who decides it', async () => {
    getPlatformTraffic.mockResolvedValue(answer())
    await renderPage(ADMIN)

    const events = screen.getByRole('table', { name: 'Events, newest start first' })
    const on = within(events).getByRole('link', { name: 'On' })

    expect(on.getAttribute('href')).toBe('/moderation/events/ceventalpha000000000001#website-link')

    cleanup()
    getPlatformTraffic.mockResolvedValue(answer())
    await renderPage({ ...ADMIN, capabilities: ['analytics:view_all', 'report:view'] })

    expect(
      within(screen.getByRole('table', { name: 'Events, newest start first' })).queryByRole(
        'link',
        { name: 'On' },
      ),
    ).toBeNull()
  })

  it('carries no money column', async () => {
    getPlatformTraffic.mockResolvedValue(answer())
    await renderPage(ADMIN)

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)

    expect(headers.join(' ')).not.toMatch(/\$|revenue|amount|value|owed|gross/iu)
  })

  it('says when nothing was viewed and no event matches', async () => {
    getPlatformTraffic.mockResolvedValue(answer({ top: [], events: [] }, { page: 1, total: 0 }))
    await renderPage(ADMIN, { q: 'nothing like this' })

    expect(screen.getByText('No page views were counted in this period.')).toBeTruthy()
    expect(screen.getByText('No events match.')).toBeTruthy()
  })

  it('pages through the list, keeping the filters', async () => {
    getPlatformTraffic.mockResolvedValue(
      answer({}, { page: 2, total: 120, totalPages: 3, hasPreviousPage: true, hasNextPage: true }),
    )
    await renderPage(ADMIN, { q: 'garba', page: '2' })

    expect(screen.getByRole('link', { name: 'Previous page' }).getAttribute('href')).toBe(
      '/analytics/events?q=garba',
    )
    expect(screen.getByRole('link', { name: 'Next page' }).getAttribute('href')).toBe(
      '/analytics/events?q=garba&page=3',
    )
  })

  it('marks demonstration figures', async () => {
    getPlatformTraffic.mockResolvedValue(answer({ includesDemonstration: true }))
    await renderPage(ADMIN)

    expect(screen.getByText('Demonstration figures')).toBeTruthy()
  })

  it('draws the refusal the API gave', async () => {
    getPlatformTraffic.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { status: 403, code: 'FORBIDDEN' }),
    )
    await renderPage(ADMIN)

    expect(screen.getByText('Not for this account')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('readTrafficSearch', () => {
  it('trims a search and drops one the API would refuse', () => {
    expect(readTrafficSearch('  garba ')).toBe('garba')
    expect(readTrafficSearch('')).toBeUndefined()
    expect(readTrafficSearch('a\u0000b')).toBeUndefined()
    expect(readTrafficSearch('x'.repeat(101))).toBeUndefined()
    expect(readTrafficSearch(['garba'])).toBeUndefined()
  })
})
