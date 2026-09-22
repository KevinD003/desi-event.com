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

vi.mock('next/navigation', () => ({
  usePathname: () => '/finance',
}))

const { PrimaryNav } = await import('./primary-nav.jsx')

/** The groups a signed-in finance lead would be handed by the server. */
const GROUPS = [
  {
    id: 'discover',
    label: 'Discover',
    items: [{ href: '/events', label: 'All events' }],
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

afterEach(cleanup)

describe('PrimaryNav', () => {
  it('renders every offered entry on a wide viewport', () => {
    render(<PrimaryNav groups={GROUPS} />)

    const wide = screen.getAllByRole('navigation', { name: 'Primary' })[0]

    expect(within(wide).getByRole('link', { name: 'All events' })).toBeTruthy()
    expect(within(wide).getByRole('link', { name: 'My tickets' })).toBeTruthy()
    expect(within(wide).getByRole('link', { name: 'Finance' })).toBeTruthy()
  })

  it('marks the current entry with aria-current, not colour alone', () => {
    render(<PrimaryNav groups={GROUPS} />)

    const current = screen.getAllByRole('link', { name: 'Finance' })[0]

    expect(current.getAttribute('aria-current')).toBe('page')
    expect(
      screen.getAllByRole('link', { name: 'All events' })[0].getAttribute('aria-current'),
    ).toBe(null)
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
