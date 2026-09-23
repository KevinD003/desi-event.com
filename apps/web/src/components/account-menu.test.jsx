/**
 * The header's account control.
 *
 * Signed out, it brings you back where you were; signed in, it is a
 * disclosure that behaves like one and never shows the email address.
 *
 * @module components/account-menu.test
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Where the mocked router says we are. */
const location = { pathname: '/events/garba-night', search: 'tier=early' }

vi.mock('next/navigation', () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.search),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { AccountMenu, SignInLink } = await import('./account-menu.jsx')

const ITEMS = [
  { href: '/account', label: 'Overview' },
  { href: '/tickets', label: 'My tickets' },
]

afterEach(cleanup)

describe('SignInLink', () => {
  it('carries the page, query and all, so sign-in comes back to it', () => {
    render(<SignInLink />)

    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/sign-in?next=%2Fevents%2Fgarba-night%3Ftier%3Dearly',
    )
  })
})

describe('AccountMenu', () => {
  it('starts closed and says so', () => {
    render(<AccountMenu displayName="Meera" items={ITEMS} workspaceHref={null} />)

    const trigger = screen.getByRole('button', { name: 'Meera, account' })

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('navigation', { name: 'Account' })).toBeNull()
  })

  it('opens onto the account’s pages and sign out', () => {
    render(<AccountMenu displayName="Meera" items={ITEMS} workspaceHref={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Meera, account' }))

    const nav = screen.getByRole('navigation', { name: 'Account' })

    expect(within(nav).getByRole('link', { name: 'Overview' })).toBeTruthy()
    expect(within(nav).getByRole('link', { name: 'My tickets' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('offers the workspace only when there is one', () => {
    const { rerender } = render(
      <AccountMenu displayName="Meera" items={ITEMS} workspaceHref={null} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Meera, account' }))
    expect(screen.queryByRole('link', { name: 'Workspace' })).toBeNull()

    rerender(<AccountMenu displayName="Meera" items={ITEMS} workspaceHref="/organizer" />)
    expect(screen.getByRole('link', { name: 'Workspace' }).getAttribute('href')).toBe('/organizer')
  })

  it('closes on Escape and gives focus back to the trigger', () => {
    render(<AccountMenu displayName="Meera" items={ITEMS} workspaceHref={null} />)

    const trigger = screen.getByRole('button', { name: 'Meera, account' })

    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('shows the display name and never an email address', () => {
    const { container } = render(
      <AccountMenu displayName="Meera" items={ITEMS} workspaceHref="/organizer" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Meera, account' }))

    expect(container.innerHTML).not.toContain('@')
  })
})
