/**
 * The workspace rail's behaviour: the sheet on a phone, the fold on a desk,
 * the door folding it by itself, and the bar's area switcher and page finder.
 *
 * @module components/workspace-nav.test
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** What the mocked router reports; set per test. */
const location = { pathname: '/organizer/events' }
const push = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}))

const {
  AreaSwitcher,
  DOOR_PATH,
  PageFinder,
  RAIL_STORAGE_KEY,
  RailProvider,
  RailToggle,
  WorkspaceRail,
} = await import('./workspace-nav.jsx')

/** Two groups, as `workspaceGroups` hands them over. */
const GROUPS = [
  {
    id: 'events',
    label: 'Events and venues',
    items: [
      { href: '/organizer', label: 'Overview' },
      { href: '/organizer/events', label: 'Events' },
      { href: '/organizer/check-in', label: 'Check-in' },
    ],
  },
  { id: 'money', label: 'Money', items: [{ href: '/finance', label: 'Finance' }] },
]

/**
 * The shell's moving parts, as the shell assembles them.
 *
 * @returns {object} The render result.
 */
function drawRail() {
  return render(
    <RailProvider railId="workspace-rail">
      <header>
        <RailToggle />
      </header>
      <WorkspaceRail groups={GROUPS} />
    </RailProvider>,
  )
}

beforeEach(() => {
  location.pathname = '/organizer/events'
  push.mockClear()
  window.localStorage.clear()
})

afterEach(cleanup)

describe('the rail', () => {
  it('is one navigation named Workspace, its entries in the order given, with the current one marked', () => {
    drawRail()

    const nav = screen.getByRole('navigation', { name: 'Workspace' })

    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Overview', 'Events', 'Check-in', 'Finance'])
    expect(within(nav).getByRole('link', { name: 'Events' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // Group labels are words, not headings.
    expect(within(nav).queryAllByRole('heading')).toHaveLength(0)
    expect(within(nav).getByRole('list', { name: 'Money' })).toBeTruthy()
  })

  it('draws an icon beside every entry, as decoration', () => {
    drawRail()

    for (const link of within(screen.getByRole('navigation', { name: 'Workspace' })).getAllByRole(
      'link',
    )) {
      const icon = link.querySelector('svg')

      expect(icon).not.toBeNull()
      expect(icon.getAttribute('aria-hidden')).toBe('true')
    }
  })
})

describe('the rail as a sheet, on a phone', () => {
  it('opens from the bar, says so, and takes focus', () => {
    drawRail()

    const toggle = screen.getByRole('button', { name: 'Workspace menu' })
    const rail = document.getElementById('workspace-rail')

    expect(toggle.getAttribute('aria-controls')).toBe('workspace-rail')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(rail.className).toContain('hidden')

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(rail.className).toContain('fixed')
    expect(document.activeElement).toBe(rail)
  })

  it('closes on Escape and gives focus back to the bar’s button', () => {
    drawRail()

    const toggle = screen.getByRole('button', { name: 'Workspace menu' })

    fireEvent.click(toggle)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
  })

  it('is a 44px target', () => {
    drawRail()

    const toggle = screen.getByRole('button', { name: 'Workspace menu' })

    expect(toggle.className).toContain('min-h-11')
    expect(toggle.className).toContain('min-w-11')
  })
})

describe('the rail folded to icons, on a desk', () => {
  it('keeps every entry’s words in its name when folded, and remembers the choice in this browser', () => {
    drawRail()

    const fold = screen.getByRole('button', { name: 'Collapse the menu' })
    const nav = screen.getByRole('navigation', { name: 'Workspace' })

    fireEvent.click(fold)

    expect(screen.getByRole('button', { name: 'Expand the menu' })).toBeTruthy()
    expect(document.getElementById('workspace-rail').hasAttribute('data-collapsed')).toBe(true)
    expect(within(nav).getByRole('link', { name: 'Events' })).toBeTruthy()
    expect(within(nav).getByText('Events').className).toContain('lg:sr-only')
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBe('collapsed')

    fireEvent.click(screen.getByRole('button', { name: 'Expand the menu' }))

    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBeNull()
  })

  it('starts folded when it was left folded', async () => {
    window.localStorage.setItem(RAIL_STORAGE_KEY, 'collapsed')

    await act(async () => {
      drawRail()
    })

    expect(screen.getByRole('button', { name: 'Expand the menu' })).toBeTruthy()
  })

  it('still works when the browser refuses storage', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    try {
      drawRail()
      fireEvent.click(screen.getByRole('button', { name: 'Collapse the menu' }))

      expect(screen.getByRole('button', { name: 'Expand the menu' })).toBeTruthy()
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })

  it('folds by itself at the door, without changing what is remembered', () => {
    location.pathname = DOOR_PATH
    drawRail()

    expect(screen.getByRole('button', { name: 'Expand the menu' })).toBeTruthy()
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expand the menu' }))

    expect(screen.getByRole('button', { name: 'Collapse the menu' })).toBeTruthy()
    expect(window.localStorage.getItem(RAIL_STORAGE_KEY)).toBeNull()
  })
})

describe('AreaSwitcher', () => {
  it('names a lone area in words, with nothing to open', () => {
    render(
      <AreaSwitcher
        areas={[{ key: 'organizer', href: '/organizer', label: 'Organiser workspace' }]}
        current="organizer"
      />,
    )

    expect(screen.getByText('Organiser workspace').tagName).toBe('SPAN')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers the other areas behind a button that says where you are', () => {
    render(
      <AreaSwitcher
        areas={[
          { key: 'organizer', href: '/organizer', label: 'Organiser workspace' },
          { key: 'finance', href: '/finance', label: 'Finance' },
        ]}
        current="finance"
      />,
    )

    expect(screen.getByRole('button', { name: 'Finance. Switch area' })).toBeTruthy()
  })
})

describe('PageFinder', () => {
  const ITEMS = GROUPS.flatMap((group) => group.items)

  it('finds the rail’s pages by name and goes to the first on Enter', async () => {
    render(<PageFinder items={ITEMS} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Find a page' }))
    })

    const search = await screen.findByRole('search', { name: 'Find a page in the workspace' })
    const box = within(search).getByLabelText('Page name')

    fireEvent.change(box, { target: { value: 'check' } })

    expect(screen.getByRole('status')).toHaveTextContent('1 page')
    expect(screen.getByRole('link', { name: 'Check-in' })).toHaveAttribute(
      'href',
      '/organizer/check-in',
    )
    expect(screen.queryByRole('link', { name: 'Finance' })).toBeNull()

    fireEvent.submit(search)

    expect(push).toHaveBeenCalledWith('/organizer/check-in')
  })

  it('goes nowhere when nothing matches', async () => {
    render(<PageFinder items={ITEMS} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Find a page' }))
    })

    const search = await screen.findByRole('search', { name: 'Find a page in the workspace' })

    fireEvent.change(within(search).getByLabelText('Page name'), { target: { value: 'zzz' } })
    fireEvent.submit(search)

    expect(screen.getByRole('status')).toHaveTextContent('0 pages')
    expect(push).not.toHaveBeenCalled()
  })
})
