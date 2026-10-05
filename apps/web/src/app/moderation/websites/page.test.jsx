/**
 * The website links worklist: only administrators get it, it filters by link
 * and says which filter is current, each row opens the event's website panel,
 * and an empty list says which list is empty.
 *
 * @module app/moderation/websites/page.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/session.js', () => ({ readSession: vi.fn() }))
vi.mock('../../../lib/organizer-api.js', async () => {
  const actual = await vi.importActual('../../../lib/organizer-api.js')

  return { ...actual, getWebsiteLinks: vi.fn() }
})

const { readSession } = await import('../../../lib/session.js')
const { getWebsiteLinks } = await import('../../../lib/organizer-api.js')
const {
  default: WebsiteLinksPage,
  FILTERS,
  INTRODUCTION,
  NOT_FOR_THIS_ACCOUNT,
  readWebsiteSearch,
} = await import('./page.jsx')

/** A platform administrator. */
const ADMIN = {
  user: { displayName: 'Anil Administrator' },
  platformRole: 'ADMIN',
  capabilities: ['moderation:review', 'website_redirect:manage'],
  memberships: [],
}

/** A moderator: admitted to the area, not to this page. */
const MODERATOR = {
  user: { displayName: 'Mod' },
  platformRole: 'MODERATOR',
  capabilities: ['moderation:review'],
  memberships: [],
}

/**
 * One row as the API sends it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The row.
 */
function row(overrides = {}) {
  return {
    eventId: 'evtwebsitelink01',
    slug: 'rangoli-nights',
    title: 'Rangoli Nights',
    status: 'PUBLISHED',
    organizationName: 'Rangoli Arts',
    organizationVerified: true,
    websiteUrl: 'https://www.rangoli-nights.example/2026/garba?lang=gu',
    websiteHost: 'rangoli-nights.example',
    websiteDecidedUrl: null,
    websiteSubmittedAt: '2026-10-01T08:30:00.000Z',
    pagePublic: true,
    redirect: {
      enabled: false,
      pending: true,
      decidedUrl: null,
      submittedAt: '2026-10-01T08:30:00.000Z',
      changedAt: null,
      reason: null,
      changedByName: null,
      websiteProblem: null,
    },
    ...overrides,
  }
}

/**
 * Render the page.
 *
 * @param {object} [query] The query string.
 * @param {object[]} [links] What the API answers.
 * @param {object|null} [pagination] The API's pagination block.
 * @returns {Promise<object>} The render result.
 */
async function renderPage(query = {}, links = [row()], pagination = null) {
  getWebsiteLinks.mockResolvedValue({ links, pagination })

  return render(await WebsiteLinksPage({ searchParams: Promise.resolve(query) }))
}

beforeEach(() => {
  getWebsiteLinks.mockReset()
  readSession.mockReset()
  readSession.mockResolvedValue(ADMIN)
})

describe('the website links worklist', () => {
  it('refuses a session without the website capability, and asks the API nothing', async () => {
    for (const session of [MODERATOR, null]) {
      cleanup()
      readSession.mockResolvedValue(session)

      await renderPage()

      expect(screen.getByRole('heading', { level: 1, name: 'Website links' })).toBeInTheDocument()
      expect(screen.getByText(NOT_FOR_THIS_ACCOUNT)).toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: 'Filter by state' })).toBeNull()
      expect(screen.queryByRole('search')).toBeNull()
    }

    expect(getWebsiteLinks).not.toHaveBeenCalled()
  })

  it('opens on the waiting list, marks that filter current, and offers every state', async () => {
    await renderPage()

    expect(getWebsiteLinks).toHaveBeenCalledWith({
      state: 'waiting',
      q: undefined,
      page: 1,
      perPage: 50,
    })
    expect(screen.getByText(INTRODUCTION)).toBeInTheDocument()

    const filters = screen.getByRole('navigation', { name: 'Filter by state' })
    const links = within(filters).getAllByRole('link')

    expect(links.map((link) => link.textContent)).toEqual([
      'Waiting for a decision',
      'Drafts and others',
      'On',
      'Off',
      'All',
    ])
    expect(within(filters).getByRole('link', { name: 'Waiting for a decision' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(filters).getByRole('link', { name: 'Waiting for a decision' })).toHaveAttribute(
      'href',
      '/moderation/websites',
    )
    expect(within(filters).getByRole('link', { name: 'Drafts and others' })).toHaveAttribute(
      'href',
      '/moderation/websites?state=drafts',
    )
  })

  it('asks for the chosen state and marks it current, and ignores one it does not offer', async () => {
    await renderPage({ state: 'on' })

    expect(getWebsiteLinks).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'on' }))
    expect(screen.getByRole('link', { name: 'On' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Waiting for a decision' })).not.toHaveAttribute(
      'aria-current',
    )

    cleanup()
    await renderPage({ state: 'DELETED' })

    expect(getWebsiteLinks).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'waiting' }))
  })

  it('shows each event with its organiser, state, address and the last decision, linked to its panel', async () => {
    const { container } = await renderPage({}, [
      row(),
      row({
        eventId: 'evtwebsitelink02',
        title: 'Diwali Mela',
        status: 'REVIEW_PENDING',
        organizationName: 'Mela Friends',
        organizationVerified: false,
        websiteUrl: 'https://mela.example/',
        websiteDecidedUrl: 'https://mela.example/',
        websiteSubmittedAt: null,
        redirect: {
          enabled: true,
          pending: false,
          decidedUrl: 'https://mela.example/',
          submittedAt: null,
          changedAt: '2026-09-30T10:00:00.000Z',
          reason: 'Checked: their own site.',
          changedByName: 'Anil Administrator',
          websiteProblem: null,
        },
      }),
    ])

    const [first, second] = within(container.querySelector('ol')).getAllByRole('listitem')

    expect(within(first).getByRole('link', { name: 'Rangoli Nights' })).toHaveAttribute(
      'href',
      '/moderation/events/evtwebsitelink01#website-link',
    )
    expect(within(first).getByText('Rangoli Arts')).toBeInTheDocument()
    expect(within(first).getByText('Verified')).toBeInTheDocument()
    expect(within(first).getByText('Published')).toBeInTheDocument()
    expect(
      within(first).getByText('https://www.rangoli-nights.example/2026/garba?lang=gu'),
    ).toHaveClass('break-all')
    expect(within(first).getByText('Off')).toBeInTheDocument()
    expect(within(first).getByText('Waiting for a decision')).toBeInTheDocument()
    expect(
      within(first).getByText(
        'Off. No administrator has decided on this address. Waiting since Oct 1, 2026, 8:30 AM UTC.',
      ),
    ).toBeInTheDocument()

    expect(within(second).getByRole('link', { name: 'Diwali Mela' })).toHaveAttribute(
      'href',
      '/moderation/events/evtwebsitelink02#website-link',
    )
    expect(within(second).queryByText('Verified')).toBeNull()
    expect(within(second).getByText('On')).toBeInTheDocument()
    expect(within(second).queryByText('Waiting for a decision')).toBeNull()
    expect(
      within(second).getByText(
        'On since Sep 30, 2026, 10:00 AM UTC, going to mela.example. Turned on by Anil Administrator. Reason: Checked: their own site.',
      ),
    ).toBeInTheDocument()
  })

  it('says "None given" for a link still on after the organiser removed the address', async () => {
    await renderPage({ state: 'on' }, [
      row({
        websiteUrl: null,
        websiteHost: null,
        websiteDecidedUrl: 'https://rangoli.example/',
        redirect: {
          enabled: true,
          pending: true,
          decidedUrl: 'https://rangoli.example/',
          submittedAt: '2026-10-01T08:30:00.000Z',
          changedAt: '2026-09-30T10:00:00.000Z',
          reason: null,
          changedByName: 'Anil Administrator',
          websiteProblem: null,
        },
      }),
    ])

    expect(screen.getByText('None given')).toBeInTheDocument()
    expect(screen.getByText(/The organiser removed their address/u)).toBeInTheDocument()
  })

  it('says which list is empty, and describes the list each filter shows', async () => {
    for (const filter of FILTERS) {
      cleanup()

      const { container } = await renderPage({ state: filter.value }, [])

      expect(screen.getByText('Nothing here')).toBeInTheDocument()
      expect(screen.getByText(filter.empty)).toBeInTheDocument()
      expect(container.textContent).toContain(filter.intro)
    }

    expect(new Set(FILTERS.map((filter) => filter.empty)).size).toBe(FILTERS.length)
  })

  it('names every kind of event the second list holds, and only those', () => {
    const drafts = FILTERS.find((filter) => filter.value === 'drafts')

    // The API lists there every waiting address whose event is not in review,
    // approved or public: a draft, one sent back, a rejected or an archived one.
    for (const kind of ['drafts', 'sent back for changes', 'rejected', 'archived']) {
      expect(drafts.intro).toContain(kind)
    }
    expect(drafts.intro).not.toMatch(/still being written/u)
    expect(drafts.intro).toContain('shows only while the event’s page is public')
  })

  it('searches by title or address, keeps the search across filters and pages, and offers to clear it', async () => {
    await renderPage({ state: 'all', q: '  rangoli  ' }, [row()], {
      page: 1,
      perPage: 50,
      total: 51,
      totalPages: 2,
      hasNextPage: true,
      hasPreviousPage: false,
    })

    expect(getWebsiteLinks).toHaveBeenLastCalledWith({
      state: 'all',
      q: 'rangoli',
      page: 1,
      perPage: 50,
    })

    const search = screen.getByRole('search')

    expect(within(search).getByLabelText('Search by event title or web address')).toHaveValue(
      'rangoli',
    )
    expect(search).toHaveAttribute('method', 'get')
    expect(search.querySelector('input[type="hidden"][name="state"]')).toHaveValue('all')
    expect(screen.getByRole('link', { name: 'Clear the search' })).toHaveAttribute(
      'href',
      '/moderation/websites?state=all',
    )
    expect(screen.getByRole('link', { name: 'On' })).toHaveAttribute(
      'href',
      '/moderation/websites?state=on&q=rangoli',
    )
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      '/moderation/websites?state=all&q=rangoli&page=2',
    )
  })

  it('does not send a search the API would refuse, and says why the list is not filtered', async () => {
    await renderPage({ q: 'x' })

    expect(getWebsiteLinks).toHaveBeenLastCalledWith(expect.objectContaining({ q: undefined }))
    expect(
      screen.getByLabelText('Search by event title or web address'),
    ).toHaveAccessibleDescription(
      'A search needs 2 to 100 letters, numbers or symbols, so this list is not filtered.',
    )

    expect(readWebsiteSearch('a\u0000b')).toBeUndefined()
    expect(readWebsiteSearch('x'.repeat(101))).toBeUndefined()
    expect(readWebsiteSearch(['rangoli'])).toBeUndefined()
    expect(readWebsiteSearch(' 50%_off ')).toBe('50%_off')
  })

  it('says an empty search result is the search’s, not the list’s', async () => {
    await renderPage({ q: 'mela' }, [])

    expect(screen.getByText('No event in this list matches “mela”.')).toBeInTheDocument()
    expect(screen.queryByText(FILTERS[0].empty)).toBeNull()
  })

  it('says a page past the end is past the end, and links to the first page', async () => {
    await renderPage({ state: 'off', page: '3' }, [], {
      page: 3,
      perPage: 50,
      total: 51,
      totalPages: 2,
      hasNextPage: false,
      hasPreviousPage: true,
    })

    expect(screen.queryByText('Nothing here')).toBeNull()
    expect(screen.getByText('Page 3 is past the end of this list')).toBeInTheDocument()
    expect(screen.getByText('There are 51 events in this list, on 2 pages.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the first page' })).toHaveAttribute(
      'href',
      '/moderation/websites?state=off',
    )
  })

  it('shows the read refusal when the API refuses the list', async () => {
    getWebsiteLinks.mockRejectedValue({ status: 403, code: 'FORBIDDEN', message: 'No.' })

    render(await WebsiteLinksPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText('Not for this account')).toBeInTheDocument()
    expect(
      screen.getByText(/The list of website links is not something this account can open/u),
    ).toBeInTheDocument()
    expect(screen.queryByText('Nothing here')).toBeNull()
  })
})
