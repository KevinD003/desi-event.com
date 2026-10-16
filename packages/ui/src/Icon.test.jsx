import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ICON_STROKE, Icon } from './icons/Icon.jsx'
import { GLYPHS, glyphNames } from './icons/glyphs.js'

/** The operational set the workspaces, the door and the wallet need. */
const OPERATIONAL = [
  'scan',
  'camera',
  'check-circle',
  'x-circle',
  'ticket',
  'users',
  'chart',
  'wallet',
  'shield',
  'flag',
  'inbox',
  'settings',
  'search',
  'filter',
  'sort',
  'external',
  'copy',
  'chevron-down',
  'chevron-up',
  'chevron-left',
  'chevron-right',
  'close',
  'menu',
  'qr',
  'door',
  'alert-triangle',
]

/**
 * Every coordinate a glyph's attributes and path data name.
 *
 * @param {Array<Array<string|object>>} glyph The glyph: `[element, attributes]` pairs.
 * @returns {number[]} The numbers.
 */
function coordinates(glyph) {
  return glyph.flatMap(([, attributes]) =>
    Object.entries(attributes)
      .filter(([name]) => ['d', 'cx', 'cy', 'x', 'y'].includes(name))
      .flatMap(([name, value]) =>
        name === 'd'
          ? // Absolute moves only: relative segments are offsets, not positions.
            [...String(value).matchAll(/M\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].flatMap(([, x, y]) => [
              Number(x),
              Number(y),
            ])
          : [Number(value)],
      ),
  )
}

describe('Icon', () => {
  it.each(glyphNames())(
    '%s is drawn on the 24 grid, 1.75 strokes, round caps and joins',
    (name) => {
      const markup = renderToStaticMarkup(<Icon name={name} />)

      expect(markup).toContain('viewBox="0 0 24 24"')
      expect(markup).toContain(`stroke-width="${ICON_STROKE}"`)
      expect(markup).toContain('stroke-linecap="round"')
      expect(markup).toContain('stroke-linejoin="round"')
      expect(markup).toContain('stroke="currentColor"')
      // Nothing starts off the drawing area.
      expect(coordinates(GLYPHS[name]).every((value) => value >= 0 && value <= 24)).toBe(true)
    },
  )

  it('is drawn at one weight: no glyph overrides the family stroke', () => {
    const overriding = Object.entries(GLYPHS).filter(([, glyph]) =>
      glyph.some(([, attributes]) => 'strokeWidth' in attributes),
    )

    expect(overriding.map(([name]) => name)).toEqual([])
    expect(ICON_STROKE).toBe(1.75)
  })

  it('carries the operational set', () => {
    expect(OPERATIONAL.filter((name) => !GLYPHS[name])).toEqual([])
  })

  it('is decoration by default: hidden from assistive technology and unfocusable', () => {
    const { container } = render(<Icon name="ticket" />)
    const svg = container.querySelector('svg')

    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).not.toHaveAttribute('role')
  })

  it('becomes a named image when it stands alone', () => {
    render(<Icon name="verified" label="Verified organiser" />)

    expect(screen.getByRole('img', { name: 'Verified organiser' })).toBeInTheDocument()
  })

  it('sizes from the caller’s classes, which win', () => {
    const { container } = render(<Icon name="pin" className="h-4 w-4" />)

    expect(container.querySelector('svg')).toHaveClass('h-4', 'w-4', 'shrink-0')
    expect(container.querySelector('svg')).not.toHaveClass('h-5')
  })

  it('refuses a name nobody drew, rather than drawing a gap', () => {
    expect(() => renderToStaticMarkup(<Icon name="rocket" />)).toThrow(/rocket/)
  })

  it('draws no emoji and no text: strokes only', () => {
    for (const glyph of Object.values(GLYPHS)) {
      expect(
        glyph.every(([element]) => ['path', 'circle', 'rect', 'ellipse'].includes(element)),
      ).toBe(true)
    }
  })
})
