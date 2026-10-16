import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { EVENT_CATEGORIES } from '@desi-event/schemas'
import { GLYPHS } from '@desi-event/ui/icons'

import * as icons from './icons.jsx'
import { CATEGORY_GLYPHS, CategoryIcon } from './icons.jsx'

describe('category icons', () => {
  it('draw a glyph for every category the API has, and for nothing it does not', () => {
    expect(Object.keys(CATEGORY_GLYPHS).sort()).toEqual([...EVENT_CATEGORIES].sort())
    expect(Object.values(CATEGORY_GLYPHS).filter((name) => !GLYPHS[name])).toEqual([])
  })

  it('give every category its own glyph, not the garba circle for half of them', () => {
    const glyphs = Object.values(CATEGORY_GLYPHS)

    expect(new Set(glyphs).size).toBe(glyphs.length)
  })

  it('fall back to the spark for a category the site has not been taught', () => {
    const { container } = render(<CategoryIcon category="KITE_FESTIVAL" />)

    expect(container.querySelector('svg')).toHaveAttribute('data-icon', 'spark')
  })
})

describe('the named icons the pages import', () => {
  const components = Object.entries(icons).filter(
    ([name, value]) => /Icon$/.test(name) && name !== 'CategoryIcon' && typeof value === 'function',
  )

  it.each(components)('%s is decoration from the one family, at its old size', (_name, Drawn) => {
    const { container } = render(<Drawn />)
    const svg = container.querySelector('svg')

    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('data-slot', 'icon')
    expect(svg).toHaveAttribute('stroke-width', '1.75')
    expect(svg).toHaveClass('h-4.5', 'w-4.5')
  })

  it('takes the caller’s size instead', () => {
    const { container } = render(<icons.PinIcon className="h-6 w-6" />)

    expect(container.querySelector('svg')).toHaveClass('h-6', 'w-6')
    expect(container.querySelector('svg')).not.toHaveClass('h-4.5')
  })
})
