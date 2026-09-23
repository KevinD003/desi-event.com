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
  it('is the banner, with the mirror-work band along its foot', () => {
    const { container } = render(
      <HeaderFrame>
        <a href="/">Desi-Event</a>
      </HeaderFrame>,
    )

    expect(screen.getByRole('banner')).toContainElement(screen.getByRole('link'))
    expect(container.querySelector('.mirror-band').closest('[aria-hidden="true"]')).not.toBeNull()
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
