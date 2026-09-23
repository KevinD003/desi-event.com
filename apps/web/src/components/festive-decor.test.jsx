import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import {
  BrandMark,
  Diamond,
  GarbaRings,
  MirrorBand,
  MirrorDivider,
  ScallopHem,
  Toran,
  Wordmark,
} from './festive-decor.jsx'

/** Every ornament, rendered alone. */
const ORNAMENTS = [
  ['BrandMark', <BrandMark key="mark" />],
  ['Toran', <Toran key="toran" />],
  ['GarbaRings', <GarbaRings key="rings" />],
  ['ScallopHem', <ScallopHem key="hem" />],
  ['MirrorDivider', <MirrorDivider key="divider" />],
  ['MirrorBand', <MirrorBand key="band" />],
  ['Diamond', <Diamond key="diamond" />],
]

describe('the ornaments', () => {
  it.each(ORNAMENTS)('%s is hidden from assistive technology and holds no words', (_, node) => {
    const { container } = render(node)
    const root = container.firstElementChild

    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(container.textContent).toBe('')
  })

  it.each(ORNAMENTS)('%s cannot take keyboard focus', (_, node) => {
    const { container } = render(node)

    for (const svg of container.querySelectorAll('svg')) {
      expect(svg.getAttribute('focusable')).toBe('false')
    }
    expect(container.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0)
  })

  it.each(ORNAMENTS)('%s is drawn in the theme’s tokens, never a literal colour', (_, node) => {
    const { container } = render(node)

    for (const element of container.querySelectorAll('*')) {
      const fill = element.getAttribute('fill')
      const stroke = element.getAttribute('stroke')

      // `none` is the only colour written as an attribute; every paint is a
      // `fill-*` or `stroke-*` class naming a token.
      expect([null, 'none']).toContain(fill)
      expect([null, 'none', 'currentColor']).toContain(stroke)
    }
  })
})

describe('Toran', () => {
  it('twinkles only for somebody who has not asked for reduced motion', () => {
    const { container } = render(<Toran />)
    const bulbs = [...container.querySelectorAll('circle')].filter((circle) =>
      circle.getAttribute('class').includes('animate-twinkle'),
    )

    expect(bulbs.length).toBeGreaterThan(0)

    for (const bulb of bulbs) {
      // `motion-safe:` and nothing unconditional: the animation class exists
      // only behind the platform's preference.
      expect(bulb.getAttribute('class')).toMatch(/(^|\s)motion-safe:animate-twinkle(\s|$)/)
      expect(bulb.getAttribute('class')).not.toMatch(/(^|\s)animate-twinkle(\s|$)/)
    }
  })

  it('staggers the bulbs, so they do not flash in unison', () => {
    const { container } = render(<Toran />)
    const delays = new Set(
      [...container.querySelectorAll('circle')]
        .map((circle) => circle.style.animationDelay)
        .filter(Boolean),
    )

    expect(delays.size).toBeGreaterThan(3)
  })
})

describe('Wordmark', () => {
  it('reads as the brand said once: the Devanagari line is hidden', () => {
    const { container } = render(
      <a href="/">
        <Wordmark />
      </a>,
    )

    const hidden = [...container.querySelectorAll('[aria-hidden="true"]')].map(
      (element) => element.textContent,
    )

    expect(hidden).toContain('देसी इवेंट')
    expect(container.querySelector('a')).toHaveAccessibleName('Desi-Event')
  })
})

describe('MirrorBand', () => {
  it('sits on sand by default, and on whatever ground it is given', () => {
    const { container, rerender } = render(<MirrorBand />)

    expect(container.firstElementChild.className).toBe('bg-surface-subtle')
    expect(container.querySelector('.mirror-band')).toBeInTheDocument()

    rerender(<MirrorBand className="bg-surface-inverse" />)
    expect(container.firstElementChild.className).toBe('bg-surface-inverse')
  })
})
