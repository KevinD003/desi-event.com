/**
 * The organiser invitations screen: filters by link and says which is current,
 * captions its table, says how codes go out in the mode the API reports,
 * links an accepted invitation to its organisation, and reads nothing from its
 * address but the status, the name search and the page.
 *
 * @module app/admin/organizer-invitations/page.test
 */

import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/workspace-api.js', async () => {
  const actual = await vi.importActual('../../../lib/workspace-api.js')

  return { ...actual, getOrganizerInvitations: vi.fn() }
})
vi.mock('../../../lib/session.js', () => ({ readSession: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/organizer-invitations',
  useSearchParams: () => new URLSearchParams(''),
}))

const { getOrganizerInvitations } = await import('../../../lib/workspace-api.js')
const { readSession } = await import('../../../lib/session.js')
const { default: OrganizerInvitationsPage, readNameSearch } = await import('./page.jsx')
const { DELIVERY_LINES, STATUS_FILTERS } = await import('./organizer-invitation-vocabulary.js')

/**
 * One invitation, as the list answers it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The summary.
 */
function invitation(overrides = {}) {
  return {
    id: 'inv00000000000000000001',
    email: 'priya@rangoli.example',
    organizationName: 'Rangoli Collective',
    organizationDescription: null,
    organizationWebsiteUrl: null,
    organization: null,
    note: null,
    status: 'PENDING',
    deliveryMode: 'MANUAL',
    invitedByName: 'Anil Administrator',
    acceptedByName: null,
    revokedByName: null,
    supersedesId: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    expiresAt: '2026-10-15T10:00:00.000Z',
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  }
}

/**
 * Render the page.
 *
 * @param {object} [query] The query string.
 * @param {object} [answer] What the API answers.
 * @returns {Promise<object>} The render result.
 */
async function renderPage(query = {}, answer = {}) {
  getOrganizerInvitations.mockResolvedValue({
    invitations: [invitation()],
    pagination: { page: 1, perPage: 20, total: 1, totalPages: 1 },
    deliveryMode: 'MANUAL',
    ...answer,
  })

  return render(await OrganizerInvitationsPage({ searchParams: Promise.resolve(query) }))
}

beforeEach(() => {
  getOrganizerInvitations.mockReset()
  readSession.mockReset()
  readSession.mockResolvedValue({
    user: { displayName: 'Anil Administrator', role: 'ADMIN' },
    capabilities: ['organizer:invite'],
    memberships: [],
    deliveryMode: 'MANUAL',
  })
})

describe('the organiser invitations screen', () => {
  it('opens on the waiting invitations, and marks that filter current', async () => {
    await renderPage()

    expect(getOrganizerInvitations).toHaveBeenCalledWith({
      status: 'PENDING',
      q: undefined,
      page: 1,
    })

    const filters = screen.getByRole('navigation', { name: 'Filter by status' })
    const links = within(filters).getAllByRole('link')

    expect(links.map((link) => link.textContent)).toEqual(STATUS_FILTERS.map((f) => f.label))
    expect(within(filters).getByRole('link', { name: 'Waiting' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(filters).getByRole('link', { name: 'Withdrawn' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('asks for the chosen status, marks it current, and falls back on one it does not offer', async () => {
    await renderPage({ status: 'REVOKED' })

    expect(getOrganizerInvitations).toHaveBeenLastCalledWith({
      status: 'REVOKED',
      q: undefined,
      page: 1,
    })
    expect(screen.getByRole('link', { name: 'Withdrawn' })).toHaveAttribute('aria-current', 'page')

    await renderPage({ status: 'DROP TABLE' })

    expect(getOrganizerInvitations).toHaveBeenLastCalledWith({
      status: 'PENDING',
      q: undefined,
      page: 1,
    })
  })

  it('captions the table with the filter it shows', async () => {
    await renderPage({ status: 'ALL' })

    expect(screen.getByRole('table', { name: 'Organiser invitations, All' })).toBeInTheDocument()
  })

  it('draws each status as a word and a date, never a colour alone', async () => {
    await renderPage(
      { status: 'ALL' },
      {
        invitations: [
          invitation({ id: 'inv00000000000000000001', status: 'PENDING' }),
          invitation({
            id: 'inv00000000000000000002',
            email: 'meera@garba.example',
            status: 'REVOKED',
            revokedAt: '2026-10-03T12:00:00.000Z',
            revokedByName: 'Root Admin',
          }),
          invitation({ id: 'inv00000000000000000003', email: 'x@y.example', status: 'EXPIRED' }),
        ],
      },
    )

    const table = screen.getByRole('table')

    expect(within(table).getByText(/^Waiting until Oct 15, 2026/u)).toBeInTheDocument()
    expect(within(table).getByText(/^Withdrawn on Oct 3, 2026.* by Root Admin$/u)).toBeVisible()
    expect(within(table).getByText(/^Expired on Oct 15, 2026/u)).toBeInTheDocument()
    expect(within(table).getAllByText('Status:')).toHaveLength(3)
  })

  it('links an accepted invitation to the organisation it created', async () => {
    await renderPage(
      { status: 'ACCEPTED' },
      {
        invitations: [
          invitation({
            status: 'ACCEPTED',
            acceptedAt: '2026-10-02T09:00:00.000Z',
            acceptedByName: 'Priya Shah',
            organization: {
              id: 'org00000000000000000042',
              name: 'Rangoli Collective',
              slug: 'rangoli-collective',
              verificationStatus: 'VERIFIED',
            },
          }),
        ],
      },
    )

    expect(screen.getByRole('link', { name: 'Rangoli Collective' })).toHaveAttribute(
      'href',
      '/moderation/organizations/org00000000000000000042',
    )
    expect(screen.getByText(/^Accepted on Oct 2, 2026.* by Priya Shah$/u)).toBeVisible()
    // Nothing left to withdraw or replace.
    expect(screen.queryByRole('button', { name: /Withdraw the invitation/u })).toBeNull()
    expect(screen.queryByRole('button', { name: /Issue a new code/u })).toBeNull()
  })

  it('offers a waiting invitation both actions, and an expired one only a new code', async () => {
    await renderPage(
      { status: 'ALL' },
      {
        invitations: [
          invitation({ id: 'inv00000000000000000001', email: 'a@one.example', status: 'PENDING' }),
          invitation({ id: 'inv00000000000000000002', email: 'b@two.example', status: 'EXPIRED' }),
        ],
      },
    )

    expect(
      screen.getByRole('button', { name: 'Withdraw the invitation to a@one.example' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Issue a new code for a@one.example' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Issue a new code for b@two.example' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Withdraw the invitation to b@two.example' }),
    ).toBeNull()
  })

  it('says, when codes are not emailed, that each is shown once to whoever sends it', async () => {
    await renderPage()

    expect(screen.getByText(DELIVERY_LINES.MANUAL)).toBeVisible()
    expect(DELIVERY_LINES.MANUAL).toMatch(/shown to you once/u)
    expect(screen.getByRole('button', { name: 'Create the invitation' })).toBeInTheDocument()
    expect(screen.getByText('Shown once to whoever sent it')).toBeVisible()
  })

  it('says, when codes are emailed, that the sender will not see them', async () => {
    await renderPage(
      {},
      { deliveryMode: 'EMAIL', invitations: [invitation({ deliveryMode: 'EMAIL' })] },
    )

    expect(screen.getByText(DELIVERY_LINES.EMAIL)).toBeVisible()
    expect(DELIVERY_LINES.EMAIL).toBe(
      'Codes are emailed to the address you enter. You will not see them.',
    )
    expect(screen.getByRole('button', { name: 'Send the invitation' })).toBeInTheDocument()
    expect(screen.getByText('Emailed')).toBeVisible()
    expect(screen.queryByText(DELIVERY_LINES.MANUAL)).toBeNull()
  })

  it('says no invitations match when the list is empty', async () => {
    await renderPage({}, { invitations: [], pagination: { page: 1, total: 0, totalPages: 0 } })

    expect(screen.getByText('No invitations match.')).toBeVisible()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('reads no code or token from its address, and puts none in a link', async () => {
    const code = 'Zz9_secret-code-from-a-link-0123456789abcd'
    const { container } = await renderPage({ code, token: code, status: 'PENDING' })

    expect(getOrganizerInvitations).toHaveBeenCalledWith({
      status: 'PENDING',
      q: undefined,
      page: 1,
    })
    expect(container.innerHTML).not.toContain(code)
  })

  it('searches by organisation name only, and keeps the search in the filter links', async () => {
    await renderPage({ q: '  Rangoli  ', status: 'ALL', email: 'priya@rangoli.example' })

    expect(getOrganizerInvitations).toHaveBeenCalledWith({ status: 'ALL', q: 'Rangoli', page: 1 })
    expect(screen.getByRole('searchbox', { name: 'Organisation name' })).toHaveValue('Rangoli')
    expect(screen.getByRole('link', { name: 'Accepted' })).toHaveAttribute(
      'href',
      '/admin/organizer-invitations?status=ACCEPTED&q=Rangoli',
    )
    expect(screen.getByRole('link', { name: 'Waiting' })).toHaveAttribute(
      'href',
      '/admin/organizer-invitations?q=Rangoli',
    )
  })

  it('draws the refusal when the list cannot be read', async () => {
    getOrganizerInvitations.mockRejectedValue(
      Object.assign(new Error('x'), { status: 403, code: 'FORBIDDEN' }),
    )

    render(await OrganizerInvitationsPage({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByRole('table')).toBeNull()
    expect(
      screen.getByText(
        /^The list of organiser invitations is not something this account can open/u,
      ),
    ).toBeInTheDocument()
  })
})

describe('readNameSearch', () => {
  it('keeps a search the API would take, trimmed, and drops any other', () => {
    expect(readNameSearch('  Bay Lights ')).toBe('Bay Lights')
    expect(readNameSearch('B')).toBeUndefined()
    expect(readNameSearch('x'.repeat(121))).toBeUndefined()
    expect(readNameSearch('Bay\u0000Lights')).toBeUndefined()
    expect(readNameSearch(['Bay', 'Lights'])).toBeUndefined()
    expect(readNameSearch(undefined)).toBeUndefined()
  })
})
