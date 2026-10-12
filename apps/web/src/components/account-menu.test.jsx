/**
 * The header's account control.
 *
 * Signed out, it offers sign-in and sign-up, and both bring you back where you
 * were; signed in, it is a disclosure that behaves like one and never shows
 * the email address.
 *
 * @module components/account-menu.test
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Where the mocked router says we are. */
const HERE = Object.freeze({ pathname: '/events/garba-night', search: 'tier=early' })
const location = { ...HERE }

vi.mock('next/navigation', () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.search),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { AccountMenu, SignInLink, SignUpLink } = await import('./account-menu.jsx')

const ITEMS = [
  { href: '/account', label: 'Overview' },
  { href: '/tickets', label: 'My tickets' },
]

afterEach(() => {
  cleanup()
  Object.assign(location, HERE)
})

describe('SignInLink', () => {
  it('carries the page, query and all, so sign-in comes back to it', () => {
    render(<SignInLink />)

    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/sign-in?next=%2Fevents%2Fgarba-night%3Ftier%3Dearly',
    )
  })

  it('on the account-creation page, carries where that page is going instead', () => {
    location.pathname = '/register'
    location.search = 'next=%2Ftickets'
    render(<SignInLink />)

    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/sign-in?next=%2Ftickets',
    )
  })
})

describe('SignUpLink', () => {
  it('goes to account creation carrying the page, query and all', () => {
    render(<SignUpLink />)

    expect(screen.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe(
      '/register?next=%2Fevents%2Fgarba-night%3Ftier%3Dearly',
    )
  })

  it('carries nothing from the home page', () => {
    location.pathname = '/'
    location.search = ''
    render(<SignUpLink />)

    expect(screen.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe('/register')
  })

  it('on the sign-in page, carries the same next as its "Create an account" link', () => {
    location.pathname = '/sign-in'
    location.search = 'next=%2Fevents%2Fqawwali%2Fcheckout'
    render(<SignUpLink />)

    expect(screen.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe(
      '/register?next=%2Fevents%2Fqawwali%2Fcheckout',
    )
  })

  it.each([
    ['leaves the site', 'next=%2F%2Fevil.example%2Fsteal'],
    ['hides a backslash', 'next=%2F%5Cevil.example'],
    ['is an absolute URL', 'next=https%3A%2F%2Fevil.example%2F'],
    ['loops back to sign-in', 'next=%2Fsign-in'],
  ])('drops a next that %s', (_why, search) => {
    location.pathname = '/sign-in'
    location.search = search
    render(<SignUpLink />)

    expect(screen.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe('/register')
  })

  it('is the filled call to action beside an outlined sign-in, both 44px targets', () => {
    render(
      <>
        <SignInLink />
        <SignUpLink />
      </>,
    )

    const signIn = screen.getByRole('link', { name: 'Sign in' })
    const signUp = screen.getByRole('link', { name: 'Sign up' })

    expect(signUp.className).toContain('bg-action-primary')
    expect(signUp.className).toContain('text-action-primary-ink')
    expect(signIn.className).toContain('border-ink')
    expect(signIn.className).not.toContain('bg-action-primary')

    for (const link of [signIn, signUp]) {
      expect(link.className).toContain('min-h-11')
      expect(link.className).toContain('min-w-11')
    }
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
