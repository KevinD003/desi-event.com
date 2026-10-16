/**
 * The type scale keeps its own rules: a ceiling on the display size, a floor
 * on tracking and on small text, and a line height for every step.
 *
 * ## Why this exists
 *
 * A poster face invites excess. Set a condensed bold title at 9rem with
 * -0.05em tracking and it looks striking in a screenshot and reads as a
 * smear on a phone: the letters touch and the line no longer fits. The
 * design fixes three limits — display never above 6rem, tracking never
 * tighter than -0.02em, nothing but a chip's word below 13px — and this file
 * reads them out of the theme and the app stylesheet, so a later tweak that
 * crosses one fails here rather than in somebody's eyes.
 *
 * @module
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const theme = readFileSync(path.join(repoRoot, 'packages/config/src/tailwind.css'), 'utf8')
const globals = readFileSync(path.join(repoRoot, 'apps/web/src/app/globals.css'), 'utf8')

/**
 * Every `--text-*` size the theme declares, without its line heights.
 *
 * @returns {Map<string, string>} Step name to its value.
 */
function sizes() {
  const found = new Map()

  for (const [, name, value] of theme.matchAll(/--text-([a-z0-9]+):\s*([^;]+);/g)) {
    found.set(name, value.trim())
  }

  return found
}

/**
 * The largest rem a size can reach: the value itself, or a clamp's maximum.
 *
 * @param {string} value A `--text-*` value.
 * @returns {number} Rem.
 */
function maximumRem(value) {
  const clamp = /^clamp\(\s*([0-9.]+)rem,[^,]+,\s*([0-9.]+)rem\s*\)$/.exec(value)

  if (clamp) return Number(clamp[2])

  const plain = /^([0-9.]+)rem$/.exec(value)

  if (!plain) throw new Error(`Unreadable size ${value}`)

  return Number(plain[1])
}

/**
 * The smallest rem a size can fall to.
 *
 * @param {string} value A `--text-*` value.
 * @returns {number} Rem.
 */
function minimumRem(value) {
  const clamp = /^clamp\(\s*([0-9.]+)rem,/.exec(value)

  return clamp ? Number(clamp[1]) : maximumRem(value)
}

const SCALE = sizes()

describe('the type scale', () => {
  it('declares every step, the three Poster House added among them', () => {
    expect([...SCALE.keys()].sort()).toEqual(
      ['display', 'h1', 'h2', 'h3', 'title', 'body', 'label', 'caption', 'micro'].sort(),
    )
  })

  it('gives every step its own line height', () => {
    const leadings = new Set(
      [...theme.matchAll(/--text-([a-z0-9]+)--line-height:/g)].map(([, name]) => name),
    )

    expect([...SCALE.keys()].filter((name) => !leadings.has(name))).toEqual([])
  })

  it('caps the display at 6rem, and keeps it at least four times the body on a desk', () => {
    const display = maximumRem(SCALE.get('display'))

    expect(display).toBeLessThanOrEqual(6)
    expect(display / maximumRem(SCALE.get('body'))).toBeGreaterThanOrEqual(4)
  })

  it('runs in order, largest to smallest, at both ends of the fluid range', () => {
    const order = ['display', 'h1', 'h2', 'h3', 'title', 'body', 'label', 'caption', 'micro']

    for (const measure of [maximumRem, minimumRem]) {
      const values = order.map((name) => measure(SCALE.get(name)))

      expect(values).toEqual([...values].sort((a, b) => b - a))
    }
  })

  it('sets body text at 16px or more, and nothing but the micro chip below 13px', () => {
    expect(minimumRem(SCALE.get('body'))).toBeGreaterThanOrEqual(1)
    expect(minimumRem(SCALE.get('caption'))).toBeGreaterThanOrEqual(0.8125)
    expect(minimumRem(SCALE.get('label'))).toBeGreaterThan(minimumRem(SCALE.get('caption')))
  })
})

describe('tracking', () => {
  /**
   * Every letter-spacing the stylesheets write, as em.
   *
   * @param {string} css A stylesheet.
   * @returns {number[]} The values.
   */
  const spacings = (css) =>
    [...css.matchAll(/(?:--tracking-[a-z-]+|letter-spacing):\s*(-?[0-9.]+)em/g)].map(([, value]) =>
      Number(value),
    )

  it('never tightens past -0.02em, in the theme or on the headings', () => {
    const all = [...spacings(theme), ...spacings(globals)]

    // Enough to mean the tokens and the heading rules were both read.
    expect(all.length).toBeGreaterThanOrEqual(6)
    expect(all.filter((value) => value < -0.02)).toEqual([])
  })

  it('names the display floor as a token, at exactly the floor', () => {
    expect(theme).toMatch(/--tracking-display:\s*-0\.02em;/)
  })
})
