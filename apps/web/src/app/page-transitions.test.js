/**
 * Page transitions: the content crossfades, the shell never moves, a tap is
 * never eaten, and reduced motion stops all of it.
 *
 * The rules live in CSS (`globals.css`, the theme's reduced-motion block),
 * where no component test can see them, so they are read here as text: a
 * header that slid with its page, or a fade slower than the theme allows,
 * would otherwise ship unnoticed.
 *
 * @module app/page-transitions.test
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.join(HERE, 'globals.css'), 'utf8')
const theme = readFileSync(path.join(HERE, '../../../../packages/config/src/tailwind.css'), 'utf8')

/**
 * The declarations of the first rule whose selector list contains a selector.
 *
 * @param {string} source A stylesheet.
 * @param {string} selector One selector of the rule.
 * @returns {string} Its body, between the braces.
 */
function ruleFor(source, selector) {
  const at = source.indexOf(selector)

  expect(at, `no rule names ${selector}`).toBeGreaterThan(-1)

  const open = source.indexOf('{', at)

  return source.slice(open + 1, source.indexOf('}', open))
}

describe('page transitions', () => {
  it('let taps through to the page while a transition runs', () => {
    expect(ruleFor(css, '::view-transition {')).toMatch(/pointer-events:\s*none/u)
  })

  it.each(['site-header', 'app-rail', 'site-footer'])(
    'hold the shell’s %s in place: no animation, and never two copies at once',
    (name) => {
      expect(ruleFor(css, `::view-transition-group(${name})`)).toMatch(/animation:\s*none/u)
      expect(ruleFor(css, `::view-transition-old(${name})`)).toMatch(/display:\s*none/u)
      expect(ruleFor(css, `::view-transition-new(${name})`)).toMatch(/animation:\s*none/u)
    },
  )

  it('crossfade the content in 180ms on the site and 150ms in the workspace, on the exit curve', () => {
    const site = ruleFor(css, '::view-transition-group(.page-fade)')
    const workspace = ruleFor(css, '::view-transition-group(.workspace-fade)')

    expect(site).toMatch(/animation-duration:\s*180ms/u)
    expect(workspace).toMatch(/animation-duration:\s*150ms/u)
    expect(site).toMatch(/animation-timing-function:\s*var\(--ease-out\)/u)
    expect(workspace).toMatch(/animation-timing-function:\s*var\(--ease-out\)/u)
  })

  it('stay under the theme’s ceiling for interface feedback', () => {
    const durations = [...css.matchAll(/::view-transition[^{]*\{[^}]*?(\d+)ms/gu)].map((match) =>
      Number(match[1]),
    )

    expect(durations.length).toBeGreaterThan(0)
    for (const duration of durations) expect(duration).toBeLessThanOrEqual(250)
  })

  it('leave the page’s own root still, so only the content box fades', () => {
    expect(ruleFor(css, '::view-transition-group(root)')).toMatch(/animation:\s*none/u)
  })

  it('stop entirely for somebody who asked for reduced motion', () => {
    const reduced = theme.slice(theme.indexOf('@media (prefers-reduced-motion: reduce)'))

    expect(reduced).toMatch(
      /::view-transition-group\(\*\),\s*::view-transition-old\(\*\),\s*::view-transition-new\(\*\)\s*\{\s*animation:\s*none !important;/u,
    )
  })
})
