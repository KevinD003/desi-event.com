import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { SiteFooter } from './site-footer.jsx'

describe('SiteFooter', () => {
  it('says on every page that payments are simulated and the catalogue is fictional, apart from Sulekha listings', () => {
    const { container } = render(<SiteFooter />)

    expect(container.textContent).toMatch(/Payments on this site are simulated/)
    expect(container.textContent).toMatch(
      /Events, organisers and prices on this site are fictional, except events copied from Sulekha\.com listings\./,
    )
    // Imported events are real listings, so the blanket claim would be false
    // wherever an administrator has imported them (ADR 0015).
    expect(container.textContent).not.toMatch(
      /Every event, organiser and price on this site is fictional/,
    )
  })

  it('links to the full list of what the site does not do', () => {
    render(<SiteFooter />)

    expect(screen.getByRole('link', { name: 'The full list' })).toHaveAttribute(
      'href',
      '/limitations',
    )
  })

  it('offers the four ways into the catalogue', () => {
    render(<SiteFooter />)

    const discover = screen.getByRole('navigation', { name: 'Discover' })

    expect(
      within(discover)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/events', '/categories', '/venues', '/organizers'])
  })

  it('lists the US cities the catalogue covers, each leading to its filtered listing', () => {
    render(<SiteFooter />)

    const cities = screen.getByRole('navigation', { name: 'Garba nights in' })
    const links = within(cities).getAllByRole('link')

    expect(links.map((link) => link.textContent)).toContain('Edison')
    expect(links.map((link) => link.textContent)).toContain('Santa Clara')
    expect(within(cities).getByRole('link', { name: 'Jersey City' })).toHaveAttribute(
      'href',
      '/events?city=Jersey+City',
    )
    expect(cities.textContent).not.toMatch(/Mumbai|Ahmedabad|Toronto|Mississauga|London/)
  })

  it('offers the garba season’s categories by their labels', () => {
    render(<SiteFooter />)

    const categories = screen.getByRole('navigation', { name: 'Categories' })

    expect(within(categories).getByRole('link', { name: 'Garba & Dandiya' })).toHaveAttribute(
      'href',
      '/events?category=GARBA_DANDIYA',
    )
  })

  it('promises nothing, and says organisers join by invitation and every event is reviewed', () => {
    const { container } = render(<SiteFooter />)

    expect(container.textContent).not.toMatch(/coming soon|\bsoon\b|\byet\b/i)
    expect(container.textContent).toMatch(
      /Organisers join by invitation from the Desi-Event team, and every event is reviewed by the team before it is published\./,
    )
    expect(screen.getByRole('link', { name: 'Accept an organiser invitation' })).toHaveAttribute(
      'href',
      '/account/organizations/new',
    )
    // Organisations are not made from an account: there is no such link.
    expect(screen.queryByRole('link', { name: /create an organisation/i })).toBeNull()
    expect(container.textContent).not.toMatch(/organisation you create/i)
    // Overtaken by the build: seats are sold through the seat picker.
    expect(container.textContent).not.toMatch(/no sign-up for an organisation/i)
    expect(container.textContent).not.toMatch(/sell seated tickets/i)
  })

  it('says narrowly what is not emailed, true whether or not codes are emailed', () => {
    render(<SiteFooter />)

    const heading = screen.getByRole('heading', { name: 'What this site does not do' })
    const items = within(heading.parentElement)
      .getAllByRole('listitem')
      .map((item) => item.textContent)

    expect(items).toEqual([
      'Take real payments',
      'Calculate US sales tax',
      'Email receipts or password resets',
    ])
    // A deployment with a mail server emails invitation and transfer codes,
    // so a blanket "Send email" in this list would be false there.
    expect(items.some((item) => /^send email$|no email/i.test(item))).toBe(false)
  })

  it('makes every link a 44px target', () => {
    render(<SiteFooter />)

    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toContain('min-h-11')
    }
  })
})
