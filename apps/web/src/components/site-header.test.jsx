/**
 * The header's contract: the brand leads home, the four ways into the
 * catalogue sit in one row, and the account control says who is signed in —
 * or offers sign-in and sign-up — without the header deciding anything about
 * access.
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
  it('leads home from the logo, named once as the brand', async () => {
    readSession.mockResolvedValue(null)
    render(await SiteHeader())

    const brand = screen.getByRole('link', { name: 'The Desi Events' })
    const images = within(brand).getAllByRole('img')

    expect(brand).toHaveAttribute('href', '/')
    // One picture, whose alternative text is the link's whole name: no text
    // beside it, nothing hidden that a screen reader would say twice.
    expect(images).toHaveLength(1)
    expect(images[0]).toHaveAccessibleName('The Desi Events')
    expect(brand.textContent).toBe('')
  })

  it('draws the logo made for a light surface, sized before it loads and fetched first', async () => {
    readSession.mockResolvedValue(null)
    render(await SiteHeader())

    const image = within(screen.getByRole('link', { name: 'The Desi Events' })).getByRole('img')

    // The header is always white: there is no dark scheme in which it turns.
    expect(image).toHaveAttribute('data-logo', 'light')
    expect(image).toHaveAttribute('src', '/brand/logo-light-1x.webp')
    expect(image).toHaveAttribute('width', '162')
    expect(image).toHaveAttribute('height', '40')
    expect(image).toHaveAttribute('fetchpriority', 'high')
    expect(image).toHaveAttribute('loading', 'eager')
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

  it('offers sign-up beside it, after it, also bringing them back', async () => {
    readSession.mockResolvedValue(null)
    render(await SiteHeader())

    const banner = screen.getByRole('banner')
    const signIn = within(banner).getByRole('link', { name: 'Sign in' })
    const signUp = within(banner).getByRole('link', { name: 'Sign up' })

    expect(signUp).toHaveAttribute('href', '/register?next=%2Fevents')
    // Sign in first, then Sign up: the order they are read and tabbed in.
    expect(signIn.compareDocumentPosition(signUp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Side by side in the one account control, not one of them in the sheet.
    expect(signIn.parentElement).toBe(signUp.parentElement)
  })

  it('shrinks the logo on a phone, furthest for a visitor', async () => {
    // Below 520px the row holds the logo, both links and Menu on one 64px
    // line only if the logo is drawn smaller: 28px tall from 380px and 23px
    // below, measured in Chromium (see the header's module comment). Signed
    // in, one button leaves more room, so the logo is 32px below 440px. The
    // brand link is the logo alone, so its classes are only its target.
    readSession.mockResolvedValue(null)
    const { unmount } = render(await SiteHeader())
    const brand = screen.getByRole('link', { name: 'The Desi Events' })

    expect(brand.className).toBe('flex min-h-11 shrink-0 items-center rounded-control')
    expect(within(brand).getByRole('img').className).toBe(
      'block max-w-none shrink-0 h-5.75 w-auto min-[380px]:h-7 min-[520px]:h-9 sm:h-10',
    )
    // The text wordmark and its Devanagari line are gone with it.
    expect(brand.querySelector('[lang="hi"]')).toBeNull()
    expect(brand.querySelector('svg')).toBeNull()
    unmount()

    readSession.mockResolvedValue({ user: { displayName: 'Priya' }, capabilities: [] })
    render(await SiteHeader())

    const signedIn = screen.getByRole('link', { name: 'The Desi Events' })

    expect(signedIn.className).toBe('flex min-h-11 shrink-0 items-center rounded-control')
    expect(within(signedIn).getByRole('img').className).toBe(
      'block max-w-none shrink-0 h-8 w-auto min-[440px]:h-9 sm:h-10',
    )
  })

  it('shows who is signed in instead, by display name', async () => {
    readSession.mockResolvedValue({ user: { displayName: 'Priya' }, capabilities: [] })
    render(await SiteHeader())

    expect(screen.getByRole('button', { name: 'Priya, account' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Sign up' })).toBeNull()
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
    [
      'a visitor',
      null,
      [
        { role: 'link', name: 'Sign in' },
        { role: 'link', name: 'Sign up' },
      ],
    ],
    [
      'somebody signed in',
      { user: { displayName: 'Priya' }, capabilities: [] },
      [{ role: 'button', name: 'Priya, account' }],
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
        within(banner).getByRole('link', { name: 'The Desi Events' }),
        ...account.map((control) => within(banner).getByRole(control.role, { name: control.name })),
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
