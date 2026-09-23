import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { SiteFooter } from './site-footer.jsx'

describe('SiteFooter', () => {
  it('says on every page that payments are simulated and the catalogue is fictional', () => {
    const { container } = render(<SiteFooter />)

    expect(container.textContent).toMatch(/Payments on this site are simulated/)
    expect(container.textContent).toMatch(
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

  it('promises nothing and invents no sign-up', () => {
    const { container } = render(<SiteFooter />)

    expect(container.textContent).not.toMatch(/coming soon|\bsoon\b|\byet\b/i)
    expect(container.textContent).toMatch(/there is no sign-up for an organisation/)
  })

  it('makes every link a 44px target', () => {
    render(<SiteFooter />)

    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toContain('min-h-11')
    }
  })
})
