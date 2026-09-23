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
 * The text between an opening line's brace and the brace that closes it.
 *
 * Comments are stripped first, so a brace inside one cannot unbalance the
 * count. Throws rather than returning nothing, because a test that silently
 * measured an empty block would pass for the wrong reason.
 *
 * @param {string} css The stylesheet.
 * @param {string} opener The text that begins the block, e.g. `@theme`.
 * @returns {string} The block's body.
 */
function blockBody(css, opener) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const start = source.indexOf(opener)

  if (start === -1) throw new Error(`No block opens with ${opener}`)

  const open = source.indexOf('{', start)
  let depth = 0

  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(open + 1, index)
  }

  throw new Error(`The block opened by ${opener} never closes`)
}

/**
 * Every `--color-*: oklch(...)` declaration in a block.
 *
 * @param {string} body A block's body.
 * @returns {Map<string, {l: number, c: number, h: number}>} Token name to its oklch components.
 */
function tokensIn(body) {
  const tokens = new Map()
  const pattern = /--color-([a-z0-9-]+):\s*oklch\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\)/g

  for (const [, name, l, c, h] of body.matchAll(pattern)) {
    tokens.set(name, { l: Number(l), c: Number(c), h: Number(h) })
  }

  return tokens
}

/**
 * The two registers, each as the complete set of values a component sees.
 *
 * The editorial register is the theme itself. The courtyard register is the
 * theme with the courtyard block's redefinitions laid over it — exactly what
 * the cascade does for an element inside `data-register="courtyard"`.
 *
 * @type {Record<string, Map<string, {l: number, c: number, h: number}>>}
 */
const theme = tokensIn(blockBody(stylesheet, '@theme'))
const courtyardOverrides = tokensIn(blockBody(stylesheet, "[data-register='courtyard']"))
const REGISTERS = Object.freeze({
  editorial: theme,
  courtyard: new Map([...theme, ...courtyardOverrides]),
})

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
 * `kind` sets the bar. `text` is WCAG 1.4.3, 4.5:1 for text under 18.66px.
 * `focus` is a focus indicator and `boundary` is the edge that identifies a
 * control; both are WCAG 1.4.11, 3:1 against what they are drawn on.
 *
 * Every pairing is measured in both registers unless `registers` says
 * otherwise. `hover` marks the ones axe cannot see.
 *
 * @type {ReadonlyArray<{foreground: string, background: string, where: string, kind: 'text'|'focus'|'boundary', hover?: boolean, registers?: string[]}>}
 */
const PAIRINGS = Object.freeze([
  // Text on the grounds.
  ...['page', 'surface', 'surface-raised', 'surface-subtle', 'accent-soft'].map((background) => ({
    foreground: 'ink',
    background,
    where: 'headings and body text',
    kind: 'text',
  })),
  ...['page', 'surface-raised', 'surface-subtle', 'accent-soft'].map((background) => ({
    foreground: 'ink-muted',
    background,
    where: 'supporting copy',
    kind: 'text',
  })),
  ...['page', 'surface-raised', 'surface-subtle'].map((background) => ({
    foreground: 'ink-subtle',
    background,
    where: 'metadata, nav-sheet group headings',
    kind: 'text',
  })),
  ...['page', 'surface', 'surface-raised', 'surface-subtle', 'accent-soft'].map((background) => ({
    foreground: 'accent-strong',
    background,
    where: 'links, the active nav entry, the wordmark',
    kind: 'text',
  })),
  {
    foreground: 'accent-strong',
    background: 'accent-line',
    where: 'an accent control, hovered',
    kind: 'text',
    hover: true,
  },

  // The inverse band.
  { foreground: 'ink-inverse', background: 'surface-inverse', where: 'footer text', kind: 'text' },
  {
    foreground: 'ink-inverse-muted',
    background: 'surface-inverse',
    where: 'footer supporting text',
    kind: 'text',
  },
  {
    foreground: 'accent-inverse',
    background: 'surface-inverse',
    where: 'footer headings and links',
    kind: 'text',
  },

  // Actions, resting and hovered.
  {
    foreground: 'action-primary-ink',
    background: 'action-primary',
    where: 'primary button',
    kind: 'text',
  },
  {
    foreground: 'action-primary-ink',
    background: 'action-primary-hover',
    where: 'primary button, hovered',
    kind: 'text',
    hover: true,
  },
  {
    foreground: 'action-secondary-ink',
    background: 'action-secondary',
    where: 'secondary button',
    kind: 'text',
  },
  {
    foreground: 'action-secondary-ink',
    background: 'action-secondary-hover',
    where: 'secondary button, hovered',
    kind: 'text',
    hover: true,
  },
  {
    foreground: 'action-danger-ink',
    background: 'action-danger',
    where: 'danger button',
    kind: 'text',
  },
  {
    foreground: 'action-danger-ink',
    background: 'action-danger-hover',
    where: 'danger button, hovered',
    kind: 'text',
    hover: true,
  },
  ...['page', 'surface-raised'].map((background) => ({
    foreground: 'action-primary',
    background,
    where: 'a primary button against what it sits on',
    kind: 'boundary',
  })),

  // Status: the word on its own chip, the word inline, and body text in an alert.
  ...['success', 'pending', 'warning', 'danger', 'refusal', 'info', 'mock', 'neutral'].flatMap(
    (status) => [
      {
        foreground: `status-${status}`,
        background: `status-${status}-soft`,
        where: `a ${status} chip or alert heading`,
        kind: 'text',
      },
      {
        foreground: `status-${status}`,
        background: 'surface-raised',
        where: `a ${status} word inline on a card`,
        kind: 'text',
      },
      {
        foreground: 'ink',
        background: `status-${status}-soft`,
        where: `body text inside a ${status} alert`,
        kind: 'text',
      },
    ],
  ),

  // Availability, as the buyer reads it.
  ...['open', 'limited', 'closed'].flatMap((state) => [
    {
      foreground: `availability-${state}`,
      background: `availability-${state}-soft`,
      where: `availability chip: ${state}`,
      kind: 'text',
    },
    {
      foreground: `availability-${state}`,
      background: 'surface-raised',
      where: `availability line on a card: ${state}`,
      kind: 'text',
    },
  ]),

  // Seats: every state's label on its own fill, and the outline of a free seat.
  ...['available', 'selected', 'reserved', 'unavailable'].map((state) => ({
    foreground: `seat-${state}-ink`,
    background: `seat-${state}`,
    where: `a ${state} seat's label`,
    kind: 'text',
  })),
  ...['page', 'surface-raised'].map((background) => ({
    foreground: 'seat-available-line',
    background,
    where: 'the outline that marks a seat as free',
    kind: 'boundary',
  })),

  // The operations rail.
  { foreground: 'opsnav-ink', background: 'opsnav', where: 'rail entry', kind: 'text' },
  {
    foreground: 'opsnav-ink',
    background: 'opsnav-hover',
    where: 'rail entry, hovered',
    kind: 'text',
    hover: true,
  },
  {
    foreground: 'opsnav-active-ink',
    background: 'opsnav-active',
    where: 'the current rail entry',
    kind: 'text',
  },
  ...['opsnav', 'opsnav-active'].map((background) => ({
    foreground: 'opsnav-marker',
    background,
    where: 'the marker beside the current rail entry',
    kind: 'boundary',
  })),

  // Focus, on every ground a focusable thing can sit on.
  ...[
    'page',
    'surface',
    'surface-raised',
    'surface-subtle',
    'accent-soft',
    'surface-inverse',
    'opsnav',
    'opsnav-active',
    'status-danger-soft',
    'status-warning-soft',
    'status-info-soft',
  ].map((background) => ({
    foreground: 'focus',
    background,
    where: 'the focus ring',
    kind: 'focus',
  })),
])

/** WCAG 2 AA thresholds, by kind of pairing. */
const MINIMUM = Object.freeze({ text: 4.5, focus: 3, boundary: 3 })

/** Every pairing, once per register it is rendered in. */
const MEASURED = PAIRINGS.flatMap((pairing) =>
  (pairing.registers ?? Object.keys(REGISTERS)).map((register) => ({ ...pairing, register })),
)

describe('the semantic token layer', () => {
  it('finds both registers, and the courtyard redefines only names the theme declares', () => {
    expect(theme.size).toBeGreaterThan(60)
    expect(courtyardOverrides.size).toBeGreaterThan(0)
    expect([...courtyardOverrides.keys()].filter((name) => !theme.has(name))).toEqual([])
  })

  it('declares every token each pairing names', () => {
    const missing = PAIRINGS.flatMap(({ foreground, background }) =>
      [foreground, background].filter((name) => !theme.has(name)),
    )

    expect([...new Set(missing)]).toEqual([])
  })

  it('names every semantic token the brief requires', () => {
    // Page background, raised and subtle surfaces, three text levels, border,
    // focus ring, primary and secondary action, the four statuses, ticket
    // availability, three seat states and operational navigation.
    const required = [
      'page',
      'surface-raised',
      'surface-subtle',
      'ink',
      'ink-muted',
      'ink-subtle',
      'line',
      'focus',
      'action-primary',
      'action-secondary',
      'status-success',
      'status-warning',
      'status-danger',
      'status-info',
      'availability-open',
      'availability-limited',
      'availability-closed',
      'seat-selected',
      'seat-unavailable',
      'seat-reserved',
      'opsnav',
    ]

    expect(required.filter((name) => !theme.has(name))).toEqual([])
  })

  it('reproduces the contrast figure the browser sweep measured', () => {
    // The sweep reported 4.43 for accent-strong on accent-soft when
    // accent-strong was oklch(0.567 0.148 48.6) and accent-soft was
    // marigold-50. If this model cannot reproduce a number axe actually
    // produced, none of the rest is evidence.
    const asShipped = { l: 0.567, c: 0.148, h: 48.6 }
    const measured = contrast(asShipped, theme.get('marigold-50'))

    expect(measured).toBeGreaterThan(4.4)
    expect(measured).toBeLessThan(4.5)
  })

  it.each(MEASURED)(
    '$register: $foreground on $background ($kind) — $where',
    ({ foreground, background, kind, register }) => {
      const tokens = REGISTERS[register]
      const ratio = contrast(tokens.get(foreground), tokens.get(background))

      expect(
        Number(ratio.toFixed(2)),
        `${foreground} on ${background} in ${register} is ${ratio.toFixed(2)}:1, below ${MINIMUM[kind]}:1`,
      ).toBeGreaterThanOrEqual(MINIMUM[kind])
    },
  )

  it('covers hover grounds, which axe never reaches', () => {
    // Not a formality. The first correction to accent-strong passed the resting
    // state and failed the hover one, and no browser check in this repository
    // would have caught it.
    expect(PAIRINGS.filter((pairing) => pairing.hover).length).toBeGreaterThanOrEqual(5)
  })

  it('measures focus on the dark band too, where the old ring needed its own colour', () => {
    const ratio = contrast(theme.get('focus'), theme.get('surface-inverse'))

    expect(ratio).toBeGreaterThanOrEqual(MINIMUM.focus)
  })

  it('would have failed the focus rings this layer replaced', () => {
    // marigold-500 was the ring on most controls, and marigold-600 the global
    // outline. Both are below 3:1 on the grounds they were drawn on; this
    // proves the check above can fail, rather than only that it passes.
    expect(contrast(theme.get('marigold-500'), theme.get('surface'))).toBeLessThan(MINIMUM.focus)
    expect(contrast(theme.get('marigold-600'), theme.get('page'))).toBeLessThan(MINIMUM.focus)
  })
})
