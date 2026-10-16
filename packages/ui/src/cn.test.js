import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'vitest'
import { THEME_SCALES, cn } from './cn.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const theme = readFileSync(path.join(here, '..', '..', 'config', 'src', 'tailwind.css'), 'utf8')

describe('cn', () => {
  it('joins strings with a single space', () => {
    expect(cn('rounded-lg', 'px-4')).toBe('rounded-lg px-4')
  })

  it('drops falsy values so conditional classes stay readable at call sites', () => {
    const isHidden = false

    expect(cn('px-4', isHidden && 'hidden', null, undefined, '', 0)).toBe('px-4')
  })

  it('supports object and array syntax', () => {
    expect(cn({ 'text-ink': true, 'text-ink-muted': false }, ['ring-1', 'ring-inset'])).toBe(
      'text-ink ring-1 ring-inset',
    )
  })

  it('drops the primitive’s conflicting class, so the caller’s override is the only one left', () => {
    expect(cn('px-4 py-2', 'px-8')).toBe('py-2 px-8')
    expect(cn('min-h-9 pointer-coarse:min-h-11', 'min-h-11')).toBe(
      'pointer-coarse:min-h-11 min-h-11',
    )
    expect(cn('bg-action-primary hover:bg-action-primary-hover', 'bg-surface')).toBe(
      'hover:bg-action-primary-hover bg-surface',
    )
  })

  it('returns an empty string when nothing is truthy', () => {
    expect(cn(undefined, null, false)).toBe('')
  })
})

describe('cn knows this theme’s scales', () => {
  it('keeps a type step and a text colour together: they set different properties', () => {
    // Unconfigured, tailwind-merge reads `text-h2` as a colour and drops it.
    expect(cn('text-h2', 'text-ink')).toBe('text-h2 text-ink')
    expect(cn('text-ink', 'text-caption')).toBe('text-ink text-caption')
    expect(cn('text-micro text-ink-subtle', 'sm:text-label')).toBe(
      'text-micro text-ink-subtle sm:text-label',
    )
  })

  it('replaces one type step with another, and one colour with another', () => {
    expect(cn('text-h2 text-ink', 'text-h3')).toBe('text-ink text-h3')
    expect(cn('text-h2 text-ink', 'text-ink-muted')).toBe('text-h2 text-ink-muted')
    expect(cn('text-sm', 'text-label')).toBe('text-label')
  })

  it('treats the theme’s radii, shadows, easings and tracking as one group each', () => {
    expect(cn('rounded-control', 'rounded-card')).toBe('rounded-card')
    expect(cn('rounded-card', 'rounded-plate')).toBe('rounded-plate')
    expect(cn('shadow-card', 'shadow-floating')).toBe('shadow-floating')
    expect(cn('shadow-control', 'shadow-card-hover')).toBe('shadow-card-hover')
    expect(cn('ease-standard', 'ease-drawer')).toBe('ease-drawer')
    expect(cn('tracking-eyebrow', 'tracking-display')).toBe('tracking-display')
    // A shadow's size and a colour are not the same thing.
    expect(cn('shadow-card', 'bg-surface-raised')).toBe('shadow-card bg-surface-raised')
  })

  it('keeps the outline focus ring whole: width, offset and colour are three properties', () => {
    expect(
      cn(
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'rounded-control',
      ),
    ).toBe(
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus rounded-control',
    )
  })

  it('names every step the stylesheet declares, and nothing it does not', () => {
    /**
     * The names after a namespace in the theme, minus modifiers such as `--line-height`.
     *
     * @param {string} namespace e.g. `text`.
     * @returns {string[]} Sorted names.
     */
    const declared = (namespace) =>
      [
        ...new Set(
          [...theme.matchAll(new RegExp(`--${namespace}-([a-z0-9-]+?)(?:--[a-z-]+)?:`, 'g'))].map(
            ([, name]) => name,
          ),
        ),
      ].sort()

    expect([...THEME_SCALES.text].sort()).toEqual(declared('text'))
    expect([...THEME_SCALES.radius].sort()).toEqual(declared('radius'))
    expect([...THEME_SCALES.shadow].sort()).toEqual(declared('shadow'))
    expect([...THEME_SCALES.ease].sort()).toEqual(declared('ease'))
    expect([...THEME_SCALES.tracking].sort()).toEqual(declared('tracking'))
  })
})
