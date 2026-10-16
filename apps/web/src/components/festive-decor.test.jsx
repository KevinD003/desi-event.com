import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import * as decor from './festive-decor.jsx'
import { BrandRule } from './festive-decor.jsx'

/** The ornament left, rendered alone and with a caller's classes. */
const ORNAMENTS = [
  ['BrandRule', <BrandRule key="rule" />],
  ['BrandRule with classes', <BrandRule key="placed" className="mt-4" />],
]

/** `apps/web/src`, the sources the decoration budget is held over. */
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every JavaScript source under a directory, tests excluded.
 *
 * @param {string} directory Where to start.
 * @returns {string[]} Absolute paths.
 */
function sourcesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)

    if (statSync(path).isDirectory()) return sourcesUnder(path)

    return /\.jsx?$/u.test(name) && !/\.test\.jsx?$/u.test(name) ? [path] : []
  })
}

describe('the ornament', () => {
  it.each(ORNAMENTS)('%s is hidden from assistive technology and holds no words', (_, node) => {
    const { container } = render(node)
    const root = container.firstElementChild

    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(container.textContent).toBe('')
  })

  it.each(ORNAMENTS)('%s cannot take keyboard focus', (_, node) => {
    const { container } = render(node)

    expect(container.querySelectorAll('a, button, input, [tabindex]')).toHaveLength(0)
  })

  it.each(ORNAMENTS)('%s is drawn in the theme’s tokens, never a literal colour', (_, node) => {
    const { container } = render(node)
    const root = container.firstElementChild

    // A 2px line the full width of its container, in the accent magenta.
    expect(root.className.split(' ')).toEqual(
      expect.arrayContaining(['block', 'h-0.5', 'w-full', 'bg-accent']),
    )
    expect(root.getAttribute('style')).toBeNull()
  })

  it('keeps a caller’s classes for its place in a layout', () => {
    const { container } = render(<BrandRule className="mt-4" />)

    expect(container.firstElementChild.className).toBe('block h-0.5 w-full bg-accent mt-4')
  })
})

describe('the decoration budget', () => {
  it('is one rule: the bunting, rings, hems, bands, dividers and diamonds are gone', () => {
    // Stacked on every page they made the brand wallpaper (docs/DESIGN.md,
    // "Poster House+": one plate moment per page). Bringing one back is a
    // decision to write down, not an import to add.
    expect(Object.keys(decor)).toEqual(['BrandRule'])

    for (const name of [
      'Toran',
      'GarbaRings',
      'ScallopHem',
      'MirrorBand',
      'MirrorDivider',
      'Diamond',
    ]) {
      expect(decor).not.toHaveProperty(name)
    }
  })

  it('leaves no source drawing the mirror-work band or the twinkling bulbs', () => {
    const offenders = sourcesUnder(SOURCE_ROOT).filter((path) =>
      /\bmirror-band\b|animate-twinkle/u.test(readFileSync(path, 'utf8')),
    )

    expect(offenders).toEqual([])
  })
})

describe('the brand', () => {
  it('is not an ornament: the logo is a named picture in brand-logo.jsx, not hidden decoration', () => {
    // The text wordmark and its diamond were replaced by the owner's logo. A
    // brand drawn here would be `aria-hidden` like everything else in this
    // file, which is the wrong thing for the link home; brand-logo.test.jsx
    // holds that link to being named "The Desi Events", once.
    expect(decor).not.toHaveProperty('Wordmark')
    expect(decor).not.toHaveProperty('BrandMark')
  })
})
