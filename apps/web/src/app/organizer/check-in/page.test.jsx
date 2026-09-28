/**
 * The check-in page: which list it asked for, and what it says about it.
 *
 * The door itself is tested in `components/door-workspace.test.jsx`. What is
 * here is the page around it: the platform filter appears only for the
 * platform's list, keeps what was asked for, sends only a well-formed
 * organisation id, says when the list was cut, and says the right thing when
 * there is nothing to admit.
 *
 * @module app/organizer/check-in/page.test
 */

import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/organizer/check-in',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../lib/organizer-api.js', () => ({ getAdmissionEvents: vi.fn() }))

const { getAdmissionEvents } = await import('../../../lib/organizer-api.js')
const { default: CheckInPage } = await import('./page.jsx')

const EVENT = {
  id: 'eventaaaaaaaaaaaaaaaaaaaa',
  title: 'Navratri Garba Night',
  startsAt: '2026-10-01T13:30:00.000Z',
  endsAt: '2026-10-01T18:30:00.000Z',
  timezone: 'America/New_York',
  status: 'ON_SALE',
}

const ORGANIZATIONS = [
  { id: 'orgaaaaaaaaaaaaaaaaaaaaaa', name: 'Dhol Nation' },
  { id: 'orgbbbbbbbbbbbbbbbbbbbbbb', name: 'Rangoli' },
]

/**
 * Render the page for a query string.
 *
 * @param {Record<string, string>} [params] The query string.
 * @returns {Promise<object>} The render result.
 */
async function renderPage(params = {}) {
  return render(await CheckInPage({ searchParams: Promise.resolve(params) }))
}

beforeEach(() => {
  getAdmissionEvents.mockReset()
})

describe('the platform list', () => {
  it('offers the filter, with the organisations and what was asked for kept', async () => {
    getAdmissionEvents.mockResolvedValue({
      entries: [
        {
          event: EVENT,
          organization: ORGANIZATIONS[1],
          authority: 'PLATFORM_ROLE',
          role: 'SUPER_ADMIN',
        },
      ],
      meta: { scope: 'PLATFORM', organizations: ORGANIZATIONS, truncated: false },
    })

    await renderPage({ organizationId: ORGANIZATIONS[1].id, q: 'garba' })

    expect(getAdmissionEvents).toHaveBeenCalledWith({
      organizationId: ORGANIZATIONS[1].id,
      q: 'garba',
    })

    const search = screen.getByRole('search', { name: 'Find an event' })

    expect(search.getAttribute('method')).toBe('get')
    expect(search.getAttribute('action')).toBe('/organizer/check-in')
    expect(within(search).getByLabelText('Organisation')).toHaveValue(ORGANIZATIONS[1].id)
    expect(within(search).getByLabelText('Event or organisation name')).toHaveValue('garba')
    expect(
      within(within(search).getByLabelText('Organisation'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All organisations', 'Dhol Nation', 'Rangoli'])
    expect(within(search).getByRole('link', { name: 'Clear' }).getAttribute('href')).toBe(
      '/organizer/check-in',
    )
    expect(
      screen.getByText(/You are admitting with platform administrator authority/u),
    ).toBeTruthy()
    expect(screen.queryByText(/Showing the 100 events/u)).toBeNull()
  })

  it('says when the list was cut at its limit', async () => {
    getAdmissionEvents.mockResolvedValue({
      entries: [
        {
          event: EVENT,
          organization: ORGANIZATIONS[0],
          authority: 'PLATFORM_ROLE',
          role: 'SUPER_ADMIN',
        },
      ],
      meta: { scope: 'PLATFORM', organizations: ORGANIZATIONS, truncated: true },
    })

    await renderPage()

    expect(
      screen.getByText(
        'Showing the 100 events that start soonest. Narrow by organisation or search to see others.',
      ),
    ).toBeTruthy()
  })

  it('says no platform door is open, or that nothing matched the filter', async () => {
    getAdmissionEvents.mockResolvedValue({
      entries: [],
      meta: { scope: 'PLATFORM', organizations: [], truncated: false },
    })

    const { unmount } = await renderPage()

    expect(screen.getByText('No event on the platform has its door open now')).toBeTruthy()
    expect(screen.queryByText(/not assigned to any event/u)).toBeNull()

    unmount()
    await renderPage({ q: 'nothing like this' })

    expect(screen.getByText('No event with its door open now matches that')).toBeTruthy()
  })

  it('sends no organisation id that is not shaped like one, and bounds the search', async () => {
    getAdmissionEvents.mockResolvedValue({
      entries: [],
      meta: { scope: 'PLATFORM', organizations: [], truncated: false },
    })

    await renderPage({ organizationId: 'x; drop', q: `  ${'y'.repeat(150)}  ` })

    expect(getAdmissionEvents).toHaveBeenCalledWith({
      organizationId: undefined,
      q: 'y'.repeat(100),
    })
  })
})

describe('a member’s list', () => {
  it('offers no filter and no platform notice', async () => {
    getAdmissionEvents.mockResolvedValue({
      entries: [
        {
          event: EVENT,
          organization: ORGANIZATIONS[1],
          authority: 'EVENT_SCOPE',
          role: 'SCANNER',
        },
      ],
      meta: { scope: 'MEMBERSHIPS', organizations: [ORGANIZATIONS[1]], truncated: false },
    })

    await renderPage()

    expect(screen.queryByRole('search')).toBeNull()
    expect(screen.queryByText(/platform administrator authority/u)).toBeNull()
    expect(screen.getByText(EVENT.title)).toBeTruthy()
  })

  it('keeps its own words for an account with no door', async () => {
    getAdmissionEvents.mockResolvedValue({
      entries: [],
      meta: { scope: 'MEMBERSHIPS', organizations: [], truncated: false },
    })

    await renderPage()

    expect(screen.getByText("You are not assigned to any event's door")).toBeTruthy()
    expect(screen.queryByText(/on the platform/u)).toBeNull()
  })
})
