/**
 * The header and footer for the pages that cannot draw the real ones: still
 * one banner and one contentinfo, and a way home.
 *
 * @module components/bare-chrome.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { BareFooter, BareHeader } from './bare-chrome.jsx'

afterEach(cleanup)

describe('BareHeader', () => {
  it('is a banner leading home from the logo, and into the catalogue', () => {
    render(<BareHeader />)

    const banner = screen.getByRole('banner')

    expect(within(banner).getByRole('link', { name: 'The Desi Events' })).toHaveAttribute(
      'href',
      '/',
    )
    expect(within(banner).getByRole('link', { name: 'Discover events' })).toHaveAttribute(
      'href',
      '/events',
    )
    expect(banner.querySelector('[data-brand-rule]')).not.toBeNull()
  })
})

describe('BareFooter', () => {
  it('is a contentinfo with the small print and the ways to reach the team', () => {
    render(<BareFooter />)

    const footer = screen.getByRole('contentinfo')

    expect(footer).toHaveTextContent(
      'Payments on this site are simulated. No card is charged and no money moves.',
    )
    expect(
      within(footer)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/limitations', '/contact'])
    for (const link of within(footer).getAllByRole('link')) {
      expect(link.className).toContain('min-h-11')
    }
  })
})
