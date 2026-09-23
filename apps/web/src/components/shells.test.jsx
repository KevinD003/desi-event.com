/**
 * The two shells and the refusal, drawn from a session.
 *
 * @module components/shells.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/finance',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { AccountShell, AreaRefusal, WorkspaceShell } = await import('./shells.jsx')

/** An organisation finance member, as `GET /v1/auth/me` would describe one. */
const FINANCE = {
  user: { displayName: 'Farah' },
  capabilities: [],
  memberships: [
    {
      organizationId: 'org_1',
      organizationName: 'Rangoli',
      role: 'FINANCE',
      capabilities: ['finance:view', 'report:view', 'connect:manage'],
    },
  ],
}

afterEach(cleanup)

describe('WorkspaceShell', () => {
  it('lists every area the session is admitted to, and marks the current one', () => {
    render(
      <WorkspaceShell session={FINANCE} area="finance">
        <p>page</p>
      </WorkspaceShell>,
    )

    const rail = screen.getByRole('navigation', { name: 'Workspace' })

    expect(within(rail).getByRole('link', { name: 'Finance' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(within(rail).getByRole('link', { name: 'Analytics' })).toBeTruthy()
    expect(within(rail).queryByRole('link', { name: 'Privacy' })).toBeNull()
    expect(screen.getByText('page')).toBeTruthy()
  })

  it('draws an area’s tabs, named for the area, only when it has more than one section', () => {
    const { rerender } = render(
      <WorkspaceShell
        session={FINANCE}
        area="finance"
        tabs={[
          { href: '/finance', label: 'Overview' },
          { href: '/finance/connect', label: 'Payout setup' },
        ]}
      >
        <p>page</p>
      </WorkspaceShell>,
    )

    expect(screen.getByRole('navigation', { name: 'Finance' })).toBeTruthy()

    rerender(
      <WorkspaceShell
        session={FINANCE}
        area="finance"
        tabs={[{ href: '/finance', label: 'Overview' }]}
      >
        <p>page</p>
      </WorkspaceShell>,
    )

    expect(screen.queryByRole('navigation', { name: 'Finance' })).toBeNull()
  })

  it('says who is signed in by name, never by address', () => {
    const { container } = render(
      <WorkspaceShell
        session={{ ...FINANCE, user: { displayName: 'Farah', email: 'farah@rangoli.example' } }}
        area="finance"
      >
        <p>page</p>
      </WorkspaceShell>,
    )

    expect(screen.getByText('Farah')).toBeTruthy()
    expect(container.innerHTML).not.toContain('farah@rangoli.example')
  })
})

describe('AccountShell', () => {
  it('offers the account’s own pages and sign out', () => {
    render(
      <AccountShell session={FINANCE}>
        <p>page</p>
      </AccountShell>,
    )

    const rail = screen.getByRole('navigation', { name: 'Your account' })

    expect(within(rail).getByRole('link', { name: 'My tickets' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })
})

describe('AreaRefusal', () => {
  it('uses the area’s own words and points back to the site', () => {
    render(<AreaRefusal area="privacy" />)

    expect(screen.getByRole('heading', { name: 'Not for you', level: 1 })).toBeTruthy()
    expect(screen.getByText(/ask whoever runs the organisation/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to the site' }).getAttribute('href')).toBe('/')
  })

  it('tells somebody refused the organiser workspace who can help', () => {
    render(<AreaRefusal area="organizer" />)

    expect(screen.getByText(/ask whoever runs the organisation to add you/i)).toBeTruthy()
  })
})
