/**
 * The semantic colour tokens, checked against WCAG 2 AA contrast.
 *
 * ## Why this exists
 *
 * Phase 1 shipped `text-accent-strong` on `bg-accent-soft` at 4.43:1. WCAG 2 AA
 * wants 4.5:1 for text below 18.66px, so it failed by 0.07 — invisible by eye,
 * caught by the browser accessibility sweep, and only after a push. That sweep
 * takes minutes, needs a database, a running API and Chromium, and runs in one
 * pinned CI job. This takes milliseconds and runs in the ordinary unit suite.
 *
 * ## What it catches that the sweep cannot
 *
 * axe scans the page as rendered. It never hovers, so a `hover:` pairing is
 * invisible to it. When `--color-accent-strong` was first corrected to L=0.52
 * the default state passed at 5.42:1 and the hover ground — the same text on
 * `bg-accent-line` — still failed at 4.37:1. Nothing in CI would have said so.
 * The pairings below are declared by hand precisely so that a hover state is as
 * checkable as a resting one.
 *
 * ## Why it parses the stylesheet
 *
 * The values come from `src/tailwind.css` at run time rather than being copied
 * here. A test holding its own copy of the palette passes happily while the
 * palette it is meant to guard drifts underneath it.
 *
 * @module
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const stylesheet = readFileSync(path.join(here, '..', 'src', 'tailwind.css'), 'utf8')

/**
 * Every `--color-*: oklch(...)` token declared in the theme.
 *
 * @returns {Map<string, {l: number, c: number, h: number}>} Token name to its oklch components.
 */
function declaredTokens() {
  const tokens = new Map()
  const pattern = /--color-([a-z0-9-]+):\s*oklch\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\)/g

  for (const [, name, l, c, h] of stylesheet.matchAll(pattern)) {
    tokens.set(name, { l: Number(l), c: Number(c), h: Number(h) })
  }

  return tokens
}

/**
 * Convert oklch to sRGB, each channel in 0..1.
 *
 * The oklab matrices and the sRGB transfer function, applied as the CSS Color 4
 * specification defines them. Clamped, because a token outside the sRGB gamut
 * would otherwise produce a luminance no display can show.
 *
 * @param {{l: number, c: number, h: number}} token The colour.
 * @returns {number[]} `[r, g, b]`, each 0..1.
 */
function toSrgb({ l: lightness, c: chroma, h: hue }) {
  const radians = (hue * Math.PI) / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)

  const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3

  /**
   * Apply the sRGB transfer function and clamp to the displayable range.
   *
   * @param {number} value A linear-light channel.
   * @returns {number} The encoded channel, 0..1.
   */
  const encode = (value) => {
    const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055

    return Math.min(1, Math.max(0, encoded))
  }

  return [
    encode(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
    encode(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
    encode(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
  ]
}

/**
 * Relative luminance, as WCAG 2 defines it.
 *
 * @param {number[]} rgb `[r, g, b]`, each 0..1.
 * @returns {number} The luminance.
 */
function luminance([r, g, b]) {
  /**
   * Linearise one channel.
   *
   * @param {number} value The encoded channel.
   * @returns {number} The linear-light channel.
   */
  const linear = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)

  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/**
 * The WCAG 2 contrast ratio between two tokens.
 *
 * @param {{l: number, c: number, h: number}} foreground The text colour.
 * @param {{l: number, c: number, h: number}} background The ground behind it.
 * @returns {number} The ratio, 1..21.
 */
function contrast(foreground, background) {
  const [lighter, darker] = [luminance(toSrgb(foreground)), luminance(toSrgb(background))].sort(
    (a, b) => b - a,
  )

  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * The pairings the application actually renders.
 *
 * Declared rather than derived, because only a human knows which token is put
 * on which ground. A pairing that stops being used should be deleted from here;
 * a new one must be added, and that is the point — the list is the record of
 * what the design system claims is legible.
 *
 * `hover` marks the ones axe cannot see.
 *
 * @type {ReadonlyArray<{foreground: string, background: string, where: string, hover?: boolean}>}
 */
const PAIRINGS = Object.freeze([
  {
    foreground: 'accent-strong',
    background: 'accent-soft',
    where: 'sign-in button; active nav entry',
  },
  {
    foreground: 'accent-strong',
    background: 'accent-line',
    where: 'sign-in button, hovered',
    hover: true,
  },
  { foreground: 'accent-strong', background: 'surface', where: 'the Devanagari wordmark' },
  {
    foreground: 'accent-strong',
    background: 'canvas-muted',
    where: 'nav entry, hovered',
    hover: true,
  },
  { foreground: 'ink', background: 'surface', where: 'body text on a page' },
  { foreground: 'ink', background: 'canvas', where: 'body text on an operations ground' },
  {
    foreground: 'ink',
    background: 'canvas-muted',
    where: 'body text on a raised operations panel',
  },
  { foreground: 'ink', background: 'surface-muted', where: 'body text on a tinted panel' },
  { foreground: 'ink-muted', background: 'surface', where: 'secondary text; resting nav entry' },
  { foreground: 'ink-muted', background: 'canvas', where: 'secondary text, operations' },
  { foreground: 'ink-subtle', background: 'surface', where: 'group headings in the nav sheet' },
  { foreground: 'ink-subtle', background: 'canvas', where: 'subtle text, operations ground' },
  { foreground: 'ink-subtle', background: 'canvas-muted', where: 'subtle text on a raised panel' },
  { foreground: 'status-success', background: 'status-success-soft', where: 'a success chip' },
  { foreground: 'status-pending', background: 'status-pending-soft', where: 'a pending chip' },
  { foreground: 'status-warning', background: 'status-warning-soft', where: 'a warning chip' },
  { foreground: 'status-danger', background: 'status-danger-soft', where: 'an error chip' },
  { foreground: 'status-refusal', background: 'status-refusal-soft', where: 'a refusal chip' },
  { foreground: 'status-info', background: 'status-info-soft', where: 'an informational chip' },
  { foreground: 'status-mock', background: 'status-mock-soft', where: 'a mock-mode chip' },
])

/** WCAG 2 AA, for text under 18.66px or under 14px bold. */
const AA_NORMAL_TEXT = 4.5

describe('the semantic token layer', () => {
  const tokens = declaredTokens()

  it('declares every token each pairing names', () => {
    const missing = PAIRINGS.flatMap(({ foreground, background }) =>
      [foreground, background].filter((name) => !tokens.has(name)),
    )

    expect([...new Set(missing)]).toEqual([])
  })

  it('reproduces the contrast figure the browser sweep measured', () => {
    // The sweep reported 4.43 for accent-strong on accent-soft when
    // accent-strong was oklch(0.567 0.148 48.6). If this model cannot
    // reproduce a number axe actually produced, none of the rest is evidence.
    const asShipped = { l: 0.567, c: 0.148, h: 48.6 }
    const measured = contrast(asShipped, tokens.get('accent-soft'))

    expect(measured).toBeGreaterThan(4.4)
    expect(measured).toBeLessThan(4.5)
  })

  it.each(PAIRINGS)(
    'meets AA: $foreground on $background — $where',
    ({ foreground, background }) => {
      const ratio = contrast(tokens.get(foreground), tokens.get(background))

      expect(
        Number(ratio.toFixed(2)),
        `${foreground} on ${background} is ${ratio.toFixed(2)}:1, below ${AA_NORMAL_TEXT}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
    },
  )

  it('covers hover grounds, which axe never reaches', () => {
    // Not a formality. The first correction to accent-strong passed the resting
    // state and failed the hover one, and no browser check in this repository
    // would have caught it.
    expect(PAIRINGS.filter((pairing) => pairing.hover).length).toBeGreaterThanOrEqual(2)
  })
})
