import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { SiteFooter } from './site-footer.jsx'

describe('SiteFooter', () => {
  it('leads home from the logo drawn for the night band, named once as the brand', () => {
    render(<SiteFooter />)

    const brand = screen.getByRole('link', { name: 'The Desi Events' })
    const images = within(brand).getAllByRole('img')

    expect(brand).toHaveAttribute('href', '/')
    expect(images).toHaveLength(1)
    expect(images[0]).toHaveAccessibleName('The Desi Events')
    expect(brand.textContent).toBe('')
    // The dark-surface variant: the light one's crimson would sink into the night.
    expect(images[0]).toHaveAttribute('data-logo', 'dark')
    expect(images[0]).toHaveAttribute('src', '/brand/logo-dark-1x.webp')
    expect(images[0]).toHaveAttribute('width', '186')
    expect(images[0]).toHaveAttribute('height', '56')
    // Below the fold on every page: it waits its turn.
    expect(images[0]).toHaveAttribute('loading', 'lazy')
    expect(images[0]).not.toHaveAttribute('fetchpriority')
  })

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

  it('describes a catalogue in the USA and Canada, and claims US dollars only for tickets sold here', () => {
    const { container } = render(<SiteFooter />)

    expect(container.textContent).toMatch(
      /Garba, dandiya and Navratri nights across the USA and Canada\. Tickets sold here are priced in US dollars alongside their booking fee\./,
    )
    // A Canadian listing copied from Sulekha is priced in CA$, not US dollars.
    expect(container.textContent).not.toMatch(/every price shown in US dollars/)
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
      /Organisers join by invitation from the team at The Desi Events, and every event is reviewed by the team before it is published\./,
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

  it('lists every way to reach the team, each a link named for where it goes', () => {
    render(<SiteFooter />)

    const contact = screen.getByRole('list', { name: 'Contact' })
    const expected = [
      ['Email info@thedesievents.com', 'mailto:info@thedesievents.com'],
      ['Call +1 972 694 9043', 'tel:+19726949043'],
      ['WhatsApp +1 972 694 9043', 'https://wa.me/19726949043'],
      ['The Desi Events on Facebook', 'https://www.facebook.com/the.desievents'],
      ['The Desi Events on Instagram', 'https://www.instagram.com/the.desievents'],
      ['Contact page', '/contact'],
    ]

    expect(
      within(contact)
        .getAllByRole('link')
        .map((link) => [
          link.getAttribute('aria-label') ?? link.textContent,
          link.getAttribute('href'),
        ]),
    ).toEqual(expected)

    for (const [name, href] of expected) {
      expect(within(contact).getByRole('link', { name })).toHaveAttribute('href', href)
    }
  })

  it('keeps each contact link’s visible words inside its name, and opens it in the same tab', () => {
    render(<SiteFooter />)

    for (const link of within(screen.getByRole('list', { name: 'Contact' })).getAllByRole('link')) {
      const name = link.getAttribute('aria-label') ?? link.textContent

      expect(name).toContain(link.textContent)
      expect(link).not.toHaveAttribute('target')
    }
  })

  it('lets the contact row wrap rather than overflow on a narrow screen', () => {
    render(<SiteFooter />)

    const contact = screen.getByRole('list', { name: 'Contact' })

    expect(contact.className).toContain('flex-wrap')
    for (const link of within(contact).getAllByRole('link')) {
      expect(link.className).not.toMatch(/whitespace-nowrap|\btruncate\b/u)
    }
    expect(
      within(contact).getByRole('link', { name: 'Email info@thedesievents.com' }).className,
    ).toContain('[overflow-wrap:anywhere]')
  })

  it('promises no reply time and offers no contact form', () => {
    const { container } = render(<SiteFooter />)

    expect(container.textContent).not.toMatch(/within \d|\bhours?\b|reply|respond|24\/7/i)
    expect(container.querySelector('form')).toBeNull()
  })

  it('makes every link a 44px target', () => {
    render(<SiteFooter />)

    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toContain('min-h-11')
    }
  })
})
