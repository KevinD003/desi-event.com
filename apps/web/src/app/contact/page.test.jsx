/**
 * The contact page lists the company's own channels, each a real link named
 * for where it goes, and promises nothing it cannot keep: no form, no reply
 * time.
 *
 * @module app/contact/page.test
 */

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import ContactPage, { metadata } from './page.jsx'

/** Each channel: the link's accessible name, its visible text, and where it goes. */
const CHANNELS = [
  ['Email info@thedesievents.com', 'info@thedesievents.com', 'mailto:info@thedesievents.com'],
  ['Call +1 972 694 9043', '+1 972 694 9043', 'tel:+19726949043'],
  ['WhatsApp +1 972 694 9043', '+1 972 694 9043', 'https://wa.me/19726949043'],
  [
    'facebook.com/the.desievents',
    'facebook.com/the.desievents',
    'https://www.facebook.com/the.desievents',
  ],
  [
    'instagram.com/the.desievents',
    'instagram.com/the.desievents',
    'https://www.instagram.com/the.desievents',
  ],
]

describe('ContactPage', () => {
  it('names itself, for the tab and a link preview', () => {
    expect(metadata.title).toBe('Contact')
    expect(metadata.description).toMatch(/The Desi Events/u)
    expect(metadata.alternates.canonical).toBe('/contact')
  })

  it('has one h1 that names the company', () => {
    render(<ContactPage />)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Contact The Desi Events' }),
    ).toBeInTheDocument()
  })

  it.each(CHANNELS)('links “%s” to where it goes', (name, text, href) => {
    render(<ContactPage />)

    const link = within(screen.getByRole('list', { name: 'Ways to reach the team' })).getByRole(
      'link',
      { name },
    )

    expect(link).toHaveAttribute('href', href)
    expect(link).toHaveTextContent(text)
    // The visible words are inside the name (WCAG 2.5.3), and the link opens
    // in the same tab, as every other link on the site.
    expect(name).toContain(link.textContent)
    expect(link).not.toHaveAttribute('target')
  })

  it('lists the five channels and nothing else, each with what it is', () => {
    render(<ContactPage />)

    const list = screen.getByRole('list', { name: 'Ways to reach the team' })
    const items = within(list).getAllByRole('listitem')

    expect(items).toHaveLength(5)
    expect(items.map((item) => item.firstChild.textContent)).toEqual([
      'Email',
      'Phone',
      'WhatsApp',
      'Facebook',
      'Instagram',
    ])
  })

  it('tells organisers they reach the team the same way about listing an event', () => {
    render(<ContactPage />)

    expect(
      screen.getByText(
        'Organisers reach the team the same way about listing an event on The Desi Events.',
      ),
    ).toBeVisible()
  })

  it('has no form, promises no reply time, and says nothing is coming', () => {
    const { container } = render(<ContactPage />)

    expect(container.querySelector('form')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText(/There is no contact form on this site\./u)).toBeVisible()
    expect(container.textContent).not.toMatch(
      /within \d|\bhours?\b|\bdays?\b|reply|respond|24\/7|\bsoon\b|\byet\b|planned/iu,
    )
  })

  it('makes every link a 44px target', () => {
    render(<ContactPage />)

    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toContain('min-h-11')
    }
  })
})
