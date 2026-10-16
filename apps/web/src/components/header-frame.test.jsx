import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

import { HeaderFrame } from './header-frame.jsx'

afterEach(() => {
  cleanup()
  window.scrollY = 0
})

/**
 * Scroll the window to a position, the way the browser reports it.
 *
 * @param {number} y Pixels from the top.
 * @returns {void}
 */
function scrollTo(y) {
  act(() => {
    window.scrollY = y
    window.dispatchEvent(new Event('scroll'))
  })
}

describe('HeaderFrame', () => {
  it('is the banner, with the single magenta brand rule along its foot', () => {
    const { container } = render(
      <HeaderFrame>
        <a href="/">The Desi Events</a>
      </HeaderFrame>,
    )
    const banner = screen.getByRole('banner')
    const rule = container.querySelector('[data-brand-rule]')

    expect(banner).toContainElement(screen.getByRole('link'))
    // The last thing in the header, decoration only, 2px of the accent.
    expect(banner.lastElementChild).toBe(rule)
    expect(rule.getAttribute('aria-hidden')).toBe('true')
    expect(rule.className).toContain('h-0.5')
    expect(rule.className).toContain('bg-accent')
    // The mirror-work band it replaced is gone.
    expect(container.querySelector('.mirror-band')).toBeNull()
  })

  it('keeps its place while a page transition crossfades the content', () => {
    render(<HeaderFrame>content</HeaderFrame>)

    expect(screen.getByRole('banner').className).toContain('[view-transition-name:site-header]')
  })

  it('gains a shadow once the page scrolls under it, and loses it at the top', () => {
    render(<HeaderFrame>content</HeaderFrame>)

    const header = screen.getByRole('banner')

    expect(header.hasAttribute('data-scrolled')).toBe(false)
    expect(header.className).toContain('shadow-none')

    scrollTo(240)
    expect(header.hasAttribute('data-scrolled')).toBe(true)
    expect(header.className).toContain('shadow-card-hover')

    scrollTo(0)
    expect(header.hasAttribute('data-scrolled')).toBe(false)
  })
})
