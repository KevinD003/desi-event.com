/**
 * The logo is a picture named "The Desi Events", sized before it arrives, and
 * a link wrapped round it is named by the brand said once.
 *
 * @module components/brand-logo.test
 */

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { BRAND_LOGOS, BrandLogo } from './brand-logo.jsx'

describe('BrandLogo', () => {
  it.each(['light', 'dark', 'icon'])(
    'draws the %s picture at its 1x size, with a 2x copy',
    (variant) => {
      const { container } = render(<BrandLogo variant={variant} />)
      const image = container.querySelector('img')
      const logo = BRAND_LOGOS[variant]

      expect(image).toHaveAttribute('src', logo.src)
      expect(image).toHaveAttribute('srcset', `${logo.src} 1x, ${logo.src2x} 2x`)
      // Explicit, so the browser reserves the box before the file arrives.
      expect(image).toHaveAttribute('width', String(logo.width))
      expect(image).toHaveAttribute('height', String(logo.height))
      expect(image).toHaveAttribute('data-logo', variant)
    },
  )

  it('is drawn for a light surface unless asked otherwise', () => {
    const { container } = render(<BrandLogo />)

    expect(container.querySelector('img')).toHaveAttribute('src', BRAND_LOGOS.light.src)
  })

  it('is named by the brand, so a link round it says the brand once', () => {
    render(
      <a href="/">
        <BrandLogo />
      </a>,
    )

    expect(screen.getByRole('link')).toHaveAccessibleName('The Desi Events')
    expect(screen.getAllByRole('img', { name: 'The Desi Events' })).toHaveLength(1)
  })

  it('is skipped by assistive technology where it is decorative', () => {
    const { container } = render(<BrandLogo variant="icon" decorative />)
    const image = container.querySelector('img')

    expect(image).toHaveAttribute('alt', '')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('is fetched first only when asked, and lazily otherwise', () => {
    const { container, rerender } = render(<BrandLogo priority />)
    const image = () => container.querySelector('img')

    expect(image()).toHaveAttribute('fetchpriority', 'high')
    expect(image()).toHaveAttribute('loading', 'eager')

    rerender(<BrandLogo variant="dark" />)
    expect(image()).not.toHaveAttribute('fetchpriority')
    expect(image()).toHaveAttribute('loading', 'lazy')
  })

  it('keeps its proportions when a class sets a smaller height', () => {
    const { container } = render(<BrandLogo className="h-7 w-auto" />)

    // `max-w-none`: a flex row must not squeeze the width while the height
    // stays put, which would distort the artwork.
    expect(container.querySelector('img').className).toBe('block max-w-none shrink-0 h-7 w-auto')
  })
})
