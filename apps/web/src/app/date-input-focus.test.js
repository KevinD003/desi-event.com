import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The global stylesheet, and its base layer on its own.
 *
 * The rule has to be in `@layer base`: there it draws the ring only where no
 * utility does, and the controls' own `focus:` rings keep winning while the
 * box itself has focus.
 */
const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'globals.css'),
  'utf8',
)
const base = css.slice(css.indexOf('@layer base {'), css.indexOf('@layer components {'))

/** Every native control whose picker button Chromium makes a Tab stop of its own. */
const PICKERS = ['date', 'datetime-local', 'time', 'month', 'week']

/**
 * The declarations of the base-layer rule whose selector ends in `ending`.
 *
 * @param {string} ending The end of the selector.
 * @returns {{selector: string, body: string}|null} The rule.
 */
function ruleEndingIn(ending) {
  const pattern = /(input:is\([^{]*?\)[^{]*?)\{([^}]*)\}/gu

  for (const [, selector, body] of base.matchAll(pattern)) {
    if (selector.replace(/\s+/gu, '').endsWith(ending)) return { selector, body }
  }

  return null
}

describe('the focus ring of a date or time box', () => {
  it('is drawn at the picker button’s stop too, where only :focus-within matches', () => {
    const rule = ruleEndingIn(')' + ':focus-within')

    expect(rule).not.toBeNull()
    for (const type of PICKERS) expect(rule.selector).toContain(`[type='${type}']`)
    // The site's own ring: the focus token, 2px, offset, never a raw colour.
    expect(rule.body).toMatch(/outline:\s*2px solid var\(--color-focus\);/u)
    expect(rule.body).toMatch(/outline-offset:\s*2px;/u)
  })

  it('stays the danger colour on a box that failed validation', () => {
    const rule = ruleEndingIn("[aria-invalid='true']:focus-within")

    expect(rule).not.toBeNull()
    for (const type of PICKERS) expect(rule.selector).toContain(`[type='${type}']`)
    expect(rule.body).toMatch(/outline-color:\s*var\(--color-status-danger\);/u)
  })
})
