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

const { AccountShell, AreaRefusal, WorkspaceShell, monogram } = await import('./shells.jsx')

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

  it('draws the name’s initial as decoration, not as a second name', () => {
    const { container } = render(
      <WorkspaceShell session={FINANCE} area="finance">
        <p>page</p>
      </WorkspaceShell>,
    )

    const initial = [...container.querySelectorAll('[aria-hidden="true"]')].find(
      (element) => element.textContent === 'F',
    )

    expect(initial).toBeTruthy()
    // The rail's only headings are the page's own: group labels and the
    // monogram are not in the outline.
    expect(screen.queryAllByRole('heading')).toHaveLength(0)
  })
})

describe('the workspace shell’s chrome', () => {
  it('draws its own bar, page and footer: one banner, one main, one contentinfo, and no public header', () => {
    render(
      <WorkspaceShell session={FINANCE} area="finance">
        <p>page</p>
      </WorkspaceShell>,
    )

    const banner = screen.getByRole('banner')
    const main = screen.getByRole('main')

    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
    // The skip link's target.
    expect(main.id).toBe('main-content')
    expect(main.getAttribute('tabindex')).toBe('-1')
    expect(within(main).getByText('page')).toBeTruthy()
    // The bar: the D home, named by its picture, and none of the public
    // header's discovery links.
    expect(within(banner).getByRole('link', { name: 'The Desi Events' })).toHaveAttribute(
      'href',
      '/',
    )
    expect(within(banner).queryByRole('link', { name: 'Discover events' })).toBeNull()
    expect(within(banner).getByRole('button', { name: 'Farah, account' })).toBeTruthy()
    expect(within(banner).getByRole('button', { name: 'Find a page' })).toBeTruthy()
    // The bar stays put while a page transition crossfades the content.
    expect(banner.className).toContain('[view-transition-name:site-header]')
  })

  it('names the area in the bar, as words when it is the only one this account opens', () => {
    render(
      <WorkspaceShell session={FINANCE} area="finance">
        <p>page</p>
      </WorkspaceShell>,
    )

    // Finance, operations and analytics admit this member: a switcher.
    expect(
      within(screen.getByRole('banner')).getByRole('button', { name: 'Finance. Switch area' }),
    ).toBeTruthy()
  })

  it('opens the rail as a sheet on a phone from the bar, and the rail is the one Workspace navigation', () => {
    render(
      <WorkspaceShell session={FINANCE} area="finance">
        <p>page</p>
      </WorkspaceShell>,
    )

    const toggle = screen.getByRole('button', { name: 'Workspace menu' })
    const rail = document.getElementById(toggle.getAttribute('aria-controls'))

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(rail).toContainElement(screen.getByRole('navigation', { name: 'Workspace' }))
    expect(screen.getAllByRole('navigation', { name: 'Workspace' })).toHaveLength(1)
  })

  it('ends on a slim footer with the ways back to the site, and no marketing', () => {
    render(
      <WorkspaceShell session={FINANCE} area="finance">
        <p>page</p>
      </WorkspaceShell>,
    )

    const footer = screen.getByRole('contentinfo')

    expect(
      within(footer)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Back to the site', '/'],
      ['What this site does not do', '/limitations'],
      ['Contact', '/contact'],
    ])
    expect(footer.textContent).not.toMatch(/Garba|Every moment, one place/u)
    for (const link of within(footer).getAllByRole('link')) {
      expect(link.className).toContain('min-h-11')
    }
  })

  it('says nothing about platform reach to somebody whose reach is their own organisation', () => {
    const { container } = render(
      <WorkspaceShell session={FINANCE} area="finance">
        <p>page</p>
      </WorkspaceShell>,
    )

    expect(container.querySelector('[data-authority]')).toBeNull()
    expect(container.querySelector('[data-authority-line]')).toBeNull()
  })

  it('badges a platform administrator in the bar, and opens every page with what that means', () => {
    const { container } = render(
      <WorkspaceShell
        session={{ ...FINANCE, capabilities: ['platform:admin', 'organizer:invite'] }}
        area="admin"
      >
        <p>page</p>
      </WorkspaceShell>,
    )

    const badge = container.querySelector('[data-authority]')
    const line = container.querySelector('[data-authority-line]')

    expect(screen.getByRole('banner')).toContainElement(badge)
    expect(badge.getAttribute('data-authority')).toBe('admin')
    expect(badge).toHaveTextContent('Platform administrator')
    expect(badge.className).not.toContain('bg-highlight')
    expect(screen.getByRole('main')).toContainElement(line)
    expect(line).toHaveTextContent(
      'Platform administrator. You can act on every organisation on the platform. Each change is recorded against your account.',
    )
    // Not a live region, and not the door's own notice.
    expect(line.getAttribute('role')).toBeNull()
    expect(line.textContent).not.toMatch(/Platform administrator authority/u)
  })

  it('marks a super administrator in gold foil', () => {
    const { container } = render(
      <WorkspaceShell
        session={{
          ...FINANCE,
          capabilities: ['platform:admin', 'platform:role_manage', 'organizer:invite'],
        }}
        area="admin"
      >
        <p>page</p>
      </WorkspaceShell>,
    )

    const badge = container.querySelector('[data-authority]')

    expect(badge.getAttribute('data-authority')).toBe('super')
    expect(badge).toHaveTextContent('Super administrator')
    expect(badge.className).toContain('bg-highlight')
    expect(badge.className).toContain('text-highlight-ink')
    expect(container.querySelector('[data-authority-line]')).toHaveTextContent(
      /change anybody’s platform role/u,
    )
  })

  it('lets the door fill the space beside the rail, in its own register', () => {
    render(
      <WorkspaceShell session={FINANCE} area="organizer">
        <div data-register="door">door</div>
      </WorkspaceShell>,
    )

    const content = screen.getByText('door').closest('[data-page-content]')

    expect(content.getAttribute('data-page-content')).toBe('workspace')
    expect(content.className).toContain('has-[[data-register=door]]:p-0')
  })
})

describe('monogram', () => {
  it.each([
    ['Farah', 'F'],
    ['  asha door', 'A'],
    ['Élodie', 'É'],
    ['', ''],
    [undefined, ''],
  ])('reads %j as %j', (name, expected) => {
    expect(monogram(name)).toBe(expected)
  })

  it('never splits a character outside the basic plane in half', () => {
    expect(monogram('𝒜da')).toBe('𝒜')
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

  it('is one list laid out two ways: a row of segments on a phone, a rail on a desk, with no disclosure to open', () => {
    render(
      <AccountShell session={FINANCE}>
        <p>page</p>
      </AccountShell>,
    )

    const nav = screen.getByRole('navigation', { name: 'Your account' })
    const list = within(nav).getByRole('list')

    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Overview', 'My tickets', 'Orders', 'Transfers', 'Security', 'Privacy'])
    // A row that scrolls sideways inside itself on a phone, a column on a desk.
    expect(nav.className).toContain('overflow-x-auto')
    expect(list.className).toContain('lg:flex-col')
    expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull()
  })

  it('draws no landmarks of its own: it sits inside the public shell’s main', () => {
    render(
      <AccountShell session={FINANCE}>
        <p>page</p>
      </AccountShell>,
    )

    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('main')).toBeNull()
    expect(screen.queryByRole('contentinfo')).toBeNull()
  })
})

describe('AreaRefusal', () => {
  it('uses the area’s own words and points back to the site', () => {
    render(<AreaRefusal area="privacy" />)

    expect(screen.getByRole('heading', { name: 'Not for you', level: 1 })).toBeTruthy()
    expect(screen.getByText(/ask whoever runs the organisation/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to the site' }).getAttribute('href')).toBe('/')
  })

  it('is a plain page, not a card inside a card', () => {
    const { container } = render(<AreaRefusal area="finance" />)

    expect(container.querySelector('.shadow-card')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Not for you' }).className).toContain(
      'text-h1',
    )
  })

  it('names the area it refuses above the heading, without adding a heading', () => {
    render(<AreaRefusal area="finance" />)

    expect(screen.getByText('Finance').tagName).toBe('P')
    expect(screen.getAllByRole('heading')).toHaveLength(1)
  })

  it('tells somebody refused the organiser workspace who can help', () => {
    render(<AreaRefusal area="organizer" />)

    expect(screen.getByText(/ask whoever runs the organisation to add you/i)).toBeTruthy()
  })

  it('offers somebody refused the organiser workspace the two ways in that are their own', () => {
    render(<AreaRefusal area="organizer" />)

    expect(
      screen.getByRole('link', { name: 'Accept an organiser invitation' }).getAttribute('href'),
    ).toBe('/account/organizations/new')
    expect(
      screen
        .getByRole('link', { name: 'Join a team with an invitation code' })
        .getAttribute('href'),
    ).toBe('/account/invitations')
    // Organisations are not made from an account here.
    expect(screen.queryByRole('link', { name: /create an organisation/iu })).toBeNull()
  })

  it.each(['privacy', 'finance', 'moderation', 'admin'])(
    'offers the %s refusal no alternative, only the way back',
    (area) => {
      render(<AreaRefusal area={area} />)

      expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
        'Back to the site',
      ])
    },
  )

  it('tells somebody refused platform administration that nothing here can grant it', () => {
    render(<AreaRefusal area="admin" />)

    expect(screen.getByText('Platform administration').tagName).toBe('P')
    expect(
      screen.getByText(/platform administrators at The Desi Events: inviting organisers/u),
    ).toBeTruthy()
    expect(screen.getByText(/Nothing on this page can grant it\./u)).toBeTruthy()
  })
})
