/**
 * The primary navigation's keyboard and assistive-technology contract.
 *
 * What is worth pinning here is not that links render. It is the disclosure
 * behaviour, because every part of it has a plausible implementation that
 * leaves a keyboard user stranded: a sheet that opens without moving focus, an
 * Escape key that closes it and drops focus at the top of the document, a
 * trigger whose `aria-expanded` disagrees with what is on screen.
 *
 * Each test below fails against one of those wrong implementations.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** What the mocked router reports; set per test. */
const location = { pathname: '/finance', search: '' }

vi.mock('next/navigation', () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.search),
}))

const { PrimaryNav } = await import('./primary-nav.jsx')

/** The groups a signed-in finance lead would be handed by the server. */
const GROUPS = [
  {
    id: 'discover',
    label: 'Discover',
    items: [
      { href: '/events', label: 'All events' },
      { href: '/events?category=COMEDY', label: 'Comedy' },
    ],
  },
  {
    id: 'account',
    label: 'Your account',
    items: [{ href: '/tickets', label: 'My tickets' }],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    items: [{ href: '/finance', label: 'Finance' }],
  },
]

afterEach(() => {
  cleanup()
  location.pathname = '/finance'
  location.search = ''
})

describe('PrimaryNav', () => {
  it('renders the account control between the wide row and the Menu button, and the sheet last', () => {
    render(<PrimaryNav groups={GROUPS} account={<a href="/sign-in">Sign in</a>} />)

    const [wide] = screen.getAllByRole('navigation', { name: 'Primary' })
    const account = screen.getByRole('link', { name: 'Sign in' })
    const menu = screen.getByRole('button', { name: /menu/i })

    fireEvent.click(menu)

    const sheet = document.getElementById(menu.getAttribute('aria-controls'))
    const order = [wide, account, menu, sheet]

    for (let index = 1; index < order.length; index += 1) {
      expect(
        order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
  })

  it('keeps the wide row to discovery; the account and workspace have their own controls', () => {
    render(<PrimaryNav groups={GROUPS} />)

    const wide = screen.getAllByRole('navigation', { name: 'Primary' })[0]

    expect(within(wide).getByRole('link', { name: 'All events' })).toBeTruthy()
    expect(within(wide).queryByRole('link', { name: 'My tickets' })).toBeNull()
    expect(within(wide).queryByRole('link', { name: 'Finance' })).toBeNull()
  })

  it('carries every group in the narrow sheet', () => {
    render(<PrimaryNav groups={GROUPS} />)
    fireEvent.click(screen.getByRole('button', { name: /menu/i }))

    const sheet = screen.getAllByRole('navigation', { name: 'Primary' })[1]

    for (const name of ['All events', 'Comedy', 'My tickets', 'Finance']) {
      expect(within(sheet).getByRole('link', { name })).toBeTruthy()
    }
  })

  it('marks one entry current, with aria-current rather than colour alone', () => {
    location.pathname = '/events'
    location.search = 'category=COMEDY'
    render(<PrimaryNav groups={GROUPS} />)

    const wide = screen.getAllByRole('navigation', { name: 'Primary' })[0]

    // Both entries point at /events. Before Phase 4 both were current at once.
    expect(within(wide).getByRole('link', { name: 'Comedy' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(
      within(wide).getByRole('link', { name: 'All events' }).getAttribute('aria-current'),
    ).toBe(null)
  })

  it('marks a workspace entry current in the sheet', () => {
    render(<PrimaryNav groups={GROUPS} />)
    fireEvent.click(screen.getByRole('button', { name: /menu/i }))

    const sheet = screen.getAllByRole('navigation', { name: 'Primary' })[1]

    expect(within(sheet).getByRole('link', { name: 'Finance' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('starts closed and says so', () => {
    render(<PrimaryNav groups={GROUPS} />)

    expect(screen.getByRole('button', { name: /menu/i }).getAttribute('aria-expanded')).toBe(
      'false',
    )
  })

  it('moves focus into the sheet when it opens', () => {
    render(<PrimaryNav groups={GROUPS} />)

    const trigger = screen.getByRole('button', { name: /menu/i })
    fireEvent.click(trigger)

    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    const sheet = document.getElementById(trigger.getAttribute('aria-controls'))

    expect(sheet).toBeTruthy()
    expect(document.activeElement).toBe(sheet)
  })

  it('groups the sheet under real headings tied to their lists', () => {
    render(<PrimaryNav groups={GROUPS} />)
    fireEvent.click(screen.getByRole('button', { name: /menu/i }))

    const heading = screen.getByRole('heading', { name: 'Workspace' })
    const list = screen.getByRole('list', { name: 'Workspace' })

    expect(heading.id).toBe(list.getAttribute('aria-labelledby'))
  })

  it('closes on Escape and returns focus to the trigger', () => {
    render(<PrimaryNav groups={GROUPS} />)

    const trigger = screen.getByRole('button', { name: /menu/i })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('closes and restores focus when a destination is chosen', () => {
    render(<PrimaryNav groups={GROUPS} />)

    const trigger = screen.getByRole('button', { name: /menu/i })
    fireEvent.click(trigger)

    const sheet = document.getElementById(trigger.getAttribute('aria-controls'))
    fireEvent.click(within(sheet).getByRole('link', { name: 'My tickets' }))

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  it('offers a touch target big enough to hit', () => {
    render(<PrimaryNav groups={GROUPS} />)

    // 44px, via Tailwind's min-h-11/min-w-11. Asserted on the class rather than
    // a computed height because jsdom applies no stylesheet — the class is the
    // contract the sweep then verifies for real in a browser.
    const trigger = screen.getByRole('button', { name: /menu/i })

    expect(trigger.className).toContain('min-h-11')
    expect(trigger.className).toContain('min-w-11')
  })
})
