/**
 * The administration shell admits the Desi-Event team's platform
 * administrators and super administrators, and nobody else.
 *
 * `organizer:invite` and `platform:admin` are platform capabilities that no
 * organisation role carries, so the shell asks the unscoped question, as the
 * retention shell does. A moderator — privileged, enrolled, and in the trust
 * and safety group of the rail — is the refusal worth pinning: close to the
 * area, and not in it. So is an organisation owner whose membership claims the
 * capability, which must not be believed.
 *
 * @module app/admin/layout.test
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const readSession = vi.fn()
const redirect = vi.fn()

vi.mock('../../lib/session.js', async () => {
  const actual = await vi.importActual('../../lib/session.js')

  return { ...actual, readSession: (...args) => readSession(...args) }
})
vi.mock('next/navigation', () => ({
  redirect: (...args) => redirect(...args),
  usePathname: () => '/admin/users',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-desi-request-path': '/admin/users' }),
  cookies: async () => ({ getAll: () => [] }),
}))

const { default: AdminLayout } = await import('./layout.jsx')

/**
 * A session payload.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The session.
 */
function session(overrides = {}) {
  return {
    user: { displayName: 'Someone', role: 'ATTENDEE' },
    capabilities: [],
    memberships: [],
    ...overrides,
  }
}

/**
 * Render the shell for a session.
 *
 * @param {object|null} value What `readSession` resolves with.
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderShell(value) {
  readSession.mockResolvedValue(value)

  render(await AdminLayout({ children: <p>inside</p> }))
}

describe('who the administration shell admits', () => {
  it('admits a super administrator, and offers both sections as tabs', async () => {
    await renderShell(
      session({
        user: { displayName: 'Root', role: 'SUPER_ADMIN' },
        capabilities: ['platform:admin', 'organizer:invite', 'moderation:review'],
      }),
    )

    expect(screen.getByText('inside')).toBeInTheDocument()

    const tabs = screen.getByRole('navigation', { name: 'Platform administration' })

    expect(Array.from(tabs.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toEqual(
      ['/admin/organizer-invitations', '/admin/users'],
    )
  })

  it('admits a platform administrator, and offers organiser invitations alone', async () => {
    await renderShell(
      session({
        user: { displayName: 'Anil', role: 'ADMIN' },
        capabilities: [
          'moderation:review',
          'event:view_draft',
          'venue:manage',
          'organizer:invite',
          'report:view',
          'website_redirect:manage',
          'analytics:view_all',
        ],
      }),
    )

    expect(screen.getByText('inside')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Not for you' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Organiser invitations' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: 'People and roles' })).not.toBeInTheDocument()
  })

  it('refuses a moderator, and says nothing on the page can grant it', async () => {
    await renderShell(
      session({
        user: { displayName: 'Mod', role: 'MODERATOR' },
        capabilities: ['moderation:review'],
      }),
    )

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeInTheDocument()
    expect(screen.queryByText('inside')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'This area is for the Desi-Event team’s platform administrators: inviting organisers, and changing who can do what across the platform. Nothing on this page can grant it.',
      ),
    ).toBeInTheDocument()
  })

  it('refuses an organisation owner whose membership claims the capability', async () => {
    await renderShell(
      session({
        memberships: [
          {
            organizationId: 'org00000000000000000001',
            role: 'OWNER',
            capabilities: ['organization:manage', 'platform:admin'],
          },
        ],
      }),
    )

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeInTheDocument()
  })

  it('sends a signed-out visitor to sign in, carrying where they were going', async () => {
    readSession.mockResolvedValue(null)
    redirect.mockClear()

    await AdminLayout({ children: <p>inside</p> }).catch(() => {})

    expect(redirect).toHaveBeenCalledWith('/sign-in?next=%2Fadmin%2Fusers')
  })
})
