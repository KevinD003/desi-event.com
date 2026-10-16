/**
 * People and roles is the platform administrators' (ADR 0018).
 *
 * The administration area admits finance administrators as well, for
 * refunding a booking fee by hand. Anybody without `platform:admin` who opens
 * this page is told, in words, that it is not theirs — and is not shown a
 * search whose every answer would be a refusal. A platform administrator is
 * shown the search, and told that changing a platform role is for super
 * administrators; only a super administrator's search is told it may.
 *
 * @module app/admin/users/page.test
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const readSession = vi.fn()

vi.mock('../../../lib/session.js', () => ({ readSession: (...args) => readSession(...args) }))
vi.mock('./user-search.jsx', () => ({
  UserSearch: ({ mayChangePlatformRoles }) => (
    <p>{mayChangePlatformRoles ? 'the user search, with role changes' : 'the user search'}</p>
  ),
}))

const { default: PeopleAndRolesPage, PLATFORM_ADMINISTRATORS_ONLY } = await import('./page.jsx')

/**
 * Render the page for a session.
 *
 * @param {object|null} session What `readSession` resolves with.
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderPage(session) {
  readSession.mockResolvedValue(session)

  render(await PeopleAndRolesPage())
}

describe('people and roles', () => {
  it('tells a finance administrator it is held by platform administrators', async () => {
    await renderPage({
      user: { displayName: 'Farah', role: 'FINANCE_ADMIN' },
      capabilities: ['finance:view', 'platform_fee:refund'],
      memberships: [],
    })

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeInTheDocument()
    expect(screen.getByText(PLATFORM_ADMINISTRATORS_ONLY)).toBeInTheDocument()
    expect(PLATFORM_ADMINISTRATORS_ONLY).toBe(
      'Finding accounts and putting people into organisations directly are held by platform administrators and super administrators. Your role does not include them, and nothing on this page can grant them.',
    )
    expect(screen.getByRole('link', { name: 'Back to platform administration' })).toHaveAttribute(
      'href',
      '/admin',
    )
    expect(screen.queryByText(/the user search/u)).not.toBeInTheDocument()
  })

  it('draws the search for a platform administrator, without platform-role changes', async () => {
    await renderPage({
      user: { displayName: 'Anil', role: 'ADMIN' },
      capabilities: ['platform:admin', 'organizer:invite', 'moderation:review', 'report:view'],
      memberships: [],
    })

    expect(screen.getByRole('heading', { name: 'People and roles' })).toBeInTheDocument()
    expect(screen.getByText('the user search')).toBeInTheDocument()
    expect(screen.queryByText('the user search, with role changes')).not.toBeInTheDocument()
    expect(
      screen.getByText(/Changing a platform role is for super administrators\./u),
    ).toBeVisible()
    expect(screen.queryByText(PLATFORM_ADMINISTRATORS_ONLY)).not.toBeInTheDocument()
  })

  it('does not believe an organisation membership claiming platform administration', async () => {
    await renderPage({
      user: { displayName: 'Owner', role: 'ATTENDEE' },
      capabilities: ['organizer:invite'],
      memberships: [
        {
          organizationId: 'org00000000000000000001',
          role: 'OWNER',
          capabilities: ['platform:admin'],
        },
      ],
    })

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeInTheDocument()
    expect(screen.queryByText('the user search')).not.toBeInTheDocument()
  })

  it('draws the search for a super administrator', async () => {
    await renderPage({
      user: { displayName: 'Root', role: 'SUPER_ADMIN' },
      capabilities: ['platform:admin', 'platform:role_manage', 'organizer:invite'],
      memberships: [],
    })

    expect(screen.getByRole('heading', { name: 'People and roles' })).toBeInTheDocument()
    expect(screen.getByText('the user search, with role changes')).toBeInTheDocument()
    expect(screen.queryByText(PLATFORM_ADMINISTRATORS_ONLY)).not.toBeInTheDocument()
  })
})
