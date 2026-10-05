/**
 * The analytics shell admits an organisation's people who may see its
 * reports, and the platform administrators who hold the list of every event's
 * visits; it offers the two sections as tabs only to somebody who has both,
 * and refuses a moderator, who has neither.
 *
 * @module app/analytics/layout.test
 */

import { PLATFORM_ROLE_CAPABILITIES } from '@desi-event/permissions'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const readSession = vi.fn()

vi.mock('../../lib/session.js', async () => {
  const actual = await vi.importActual('../../lib/session.js')

  return { ...actual, readSession: (...args) => readSession(...args) }
})
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  usePathname: () => '/analytics',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-desi-request-path': '/analytics' }),
  cookies: async () => ({ getAll: () => [] }),
}))

const { default: AnalyticsLayout } = await import('./layout.jsx')

afterEach(cleanup)

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

/** A viewer membership: report:view in one organisation. */
const VIEWER_MEMBERSHIP = {
  organizationId: 'corgalpha00000000000001',
  organizationName: 'Alpha Garba',
  role: 'VIEWER',
  capabilities: ['report:view'],
}

/**
 * Render the shell for a session.
 *
 * @param {object} value What `readSession` resolves with.
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderShell(value) {
  readSession.mockResolvedValue(value)
  render(await AnalyticsLayout({ children: <p>inside</p> }))
}

describe('who the analytics shell admits', () => {
  it('admits a platform administrator with no organisation, with no tab bar', async () => {
    await renderShell(
      session({ capabilities: [...PLATFORM_ROLE_CAPABILITIES.ADMIN], memberships: [] }),
    )

    expect(screen.getByText('inside')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Analytics' })).not.toBeInTheDocument()
  })

  it('offers both sections to a platform administrator who also belongs to an organisation', async () => {
    await renderShell(
      session({
        capabilities: [...PLATFORM_ROLE_CAPABILITIES.ADMIN],
        memberships: [VIEWER_MEMBERSHIP],
      }),
    )

    const tabs = screen.getByRole('navigation', { name: 'Analytics' })

    expect(Array.from(tabs.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toEqual(
      ['/analytics', '/analytics/events'],
    )
    expect(Array.from(tabs.querySelectorAll('a')).map((link) => link.textContent)).toEqual([
      'Your organisations',
      'Every event',
    ])
  })

  it('admits an organisation’s viewer, with no tab bar', async () => {
    await renderShell(session({ memberships: [VIEWER_MEMBERSHIP] }))

    expect(screen.getByText('inside')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Analytics' })).not.toBeInTheDocument()
  })

  it('refuses a moderator, who holds neither', async () => {
    await renderShell(session({ capabilities: [...PLATFORM_ROLE_CAPABILITIES.MODERATOR] }))

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeInTheDocument()
    expect(screen.queryByText('inside')).not.toBeInTheDocument()
  })
})
