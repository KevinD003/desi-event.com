/**
 * The header's contract: the brand leads home, the four ways into the
 * catalogue sit in one row, and the account control says who is signed in —
 * or offers sign-in — without the header deciding anything about access.
 *
 * @module components/site-header.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  usePathname: () => '/events',
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('../lib/session.js', () => ({ readSession: vi.fn() }))
vi.mock('../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { readSession } = await import('../lib/session.js')
const { SiteHeader } = await import('./site-header.jsx')

beforeEach(() => {
  readSession.mockReset()
})

afterEach(cleanup)

describe('SiteHeader', () => {
  it('leads home from the wordmark, named once as the brand', async () => {
    readSession.mockResolvedValue(null)
    render(await SiteHeader())

    expect(screen.getByRole('link', { name: 'Desi-Event' })).toHaveAttribute('href', '/')
  })

  it('offers the four ways into the catalogue, marking the current one', async () => {
    readSession.mockResolvedValue(null)
    render(await SiteHeader())

    const [row] = screen.getAllByRole('navigation', { name: 'Primary' })
    const links = within(row).getAllByRole('link')

    expect(links.map((link) => link.textContent)).toEqual([
      'Discover events',
      'Categories',
      'Venues',
      'Organisers',
    ])
    expect(within(row).getByRole('link', { name: 'Discover events' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('offers sign-in to a visitor, bringing them back to the page they were on', async () => {
    readSession.mockResolvedValue(null)
    render(await SiteHeader())

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in?next=%2Fevents',
    )
  })

  it('shows who is signed in instead, by display name', async () => {
    readSession.mockResolvedValue({ user: { displayName: 'Priya' }, capabilities: [] })
    render(await SiteHeader())

    expect(screen.getByRole('button', { name: 'Priya, account' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
  })

  it('is the page’s banner, and the Menu button is a 44px target', async () => {
    readSession.mockResolvedValue(null)
    render(await SiteHeader())

    const banner = screen.getByRole('banner')
    const menu = within(banner).getByRole('button', { name: /menu/i })

    expect(menu.className).toContain('min-h-11')
    expect(menu.className).toContain('min-w-11')
  })

  it.each([
    ['a visitor', null, { role: 'link', name: 'Sign in' }],
    [
      'somebody signed in',
      { user: { displayName: 'Priya' }, capabilities: [] },
      { role: 'button', name: 'Priya, account' },
    ],
  ])(
    'puts the controls in the DOM in the order the eye reads them, for %s',
    async (_who, session, account) => {
      // Narrow, the row reads wordmark, account control, Menu, and the open
      // sheet below. Tab order follows the DOM, not CSS `order`, so the DOM
      // has to run the same way (WCAG 2.4.3) — and nothing may reorder it.
      readSession.mockResolvedValue(session)
      render(await SiteHeader())

      const banner = screen.getByRole('banner')
      const sequence = [
        within(banner).getByRole('link', { name: 'Desi-Event' }),
        within(banner).getByRole(account.role, { name: account.name }),
        within(banner).getByRole('button', { name: /menu/i }),
      ]

      for (const [earlier, later] of sequence
        .slice(0, -1)
        .map((node, i) => [node, sequence[i + 1]])) {
        expect(
          earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy()
      }
      const reordered = [...banner.querySelectorAll('[class]')].filter((node) =>
        [...node.classList].some((token) => /^(?:[\w[\]-]+:)*-?order-/.test(token)),
      )

      expect(reordered).toEqual([])
    },
  )
})
