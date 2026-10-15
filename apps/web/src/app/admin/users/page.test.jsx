/**
 * People and roles is the super administrators' alone.
 *
 * The administration area admits platform administrators as well, because it
 * is where organisers are invited. A platform administrator who opens this
 * page is told, in words, that changing platform roles and putting people into
 * organisations directly are not theirs — and is not shown a search whose
 * every answer would be a refusal.
 *
 * @module app/admin/users/page.test
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const readSession = vi.fn()

vi.mock('../../../lib/session.js', () => ({ readSession: (...args) => readSession(...args) }))
vi.mock('./user-search.jsx', () => ({ UserSearch: () => <p>the user search</p> }))

const { default: PeopleAndRolesPage, SUPER_ADMINISTRATORS_ONLY } = await import('./page.jsx')

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
  it('tells a platform administrator it is held by super administrators alone', async () => {
    await renderPage({
      user: { displayName: 'Anil', role: 'ADMIN' },
      capabilities: ['organizer:invite', 'moderation:review', 'report:view'],
      memberships: [],
    })

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeInTheDocument()
    expect(screen.getByText(SUPER_ADMINISTRATORS_ONLY)).toBeInTheDocument()
    expect(SUPER_ADMINISTRATORS_ONLY).toBe(
      'Changing platform roles and putting people into organisations directly are held by platform super administrators alone. Your role, platform administrator, does not include them, and nothing on this page can grant them.',
    )
    expect(screen.getByRole('link', { name: 'Back to organiser invitations' })).toHaveAttribute(
      'href',
      '/admin/organizer-invitations',
    )
    expect(screen.queryByText('the user search')).not.toBeInTheDocument()
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
      capabilities: ['platform:admin', 'organizer:invite'],
      memberships: [],
    })

    expect(screen.getByRole('heading', { name: 'People and roles' })).toBeInTheDocument()
    expect(screen.getByText('the user search')).toBeInTheDocument()
    expect(screen.queryByText(SUPER_ADMINISTRATORS_ONLY)).not.toBeInTheDocument()
  })
})
