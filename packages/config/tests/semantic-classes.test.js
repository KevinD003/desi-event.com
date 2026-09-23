/**
 * Components colour themselves with semantic tokens, never with the ramp.
 *
 * ## Why this exists
 *
 * Phase 4 moved some 1,300 literal classes — `text-slate-700`,
 * `ring-marigold-500`, `bg-rose-50` — onto the semantic layer in
 * `src/tailwind.css`. Several of those literals were not merely off-brand but
 * wrong: `ring-marigold-500` was the focus ring on most controls and is
 * 2.29:1 on white, below the 3:1 WCAG 1.4.11 asks of a focus indicator, and
 * `text-marigold-700` links were 4.45:1 on the warm page. Nothing measured
 * them, because a literal is a colour nobody declared a pairing for.
 *
 * A token is measured: `token-contrast.test.js` pins every pairing in both
 * registers. So the rule this file enforces is the one that keeps that true —
 * a component may not reach past the tokens to the ramp, or to Tailwind's own
 * palette, or to a hex value.
 *
 * ## What is allowed, and why
 *
 * Each exception names the file and the reason. None is a convenience:
 *
 * - `bg-black` behind the door camera's video. It is the letterbox of a live
 *   camera feed, not an interface colour, and it must not change with the
 *   register.
 * - A QR code's `#ffffff` and `#000000`, on the ticket pass and on the
 *   two-step sign-in set-up. A scanner needs maximum contrast between modules,
 *   and a themed QR code is one a door phone or an authenticator app fails to
 *   read.
 * - Hex in the few places a stylesheet cannot reach: `global-error.jsx`,
 *   which renders when the root layout itself has failed, the browser's own
 *   chrome colour (`themeColor`) and the web app manifest, which are metadata
 *   rather than CSS, and the app icon, which is an image. Every such value
 *   must equal a token's colour exactly; a test below checks it.
 * - `poster.jsx`'s artwork, drawn from the brand ramp. It is illustration, not
 *   interface; every `oklch()` it uses must still be a value the ramp declares.
 *
 * @module
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** Tailwind's palette families and this repository's ramps. */
const FAMILIES = [
  'white',
  'black',
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'rose',
  'amber',
  'yellow',
  'orange',
  'emerald',
  'green',
  'lime',
  'teal',
  'sky',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'marigold',
  'indigo-night',
  'henna',
].join('|')

/** Utilities that take a colour. */
const UTILITIES = [
  'bg',
  'text',
  'border',
  'ring',
  'ring-offset',
  'outline',
  'fill',
  'stroke',
  'divide',
  'from',
  'to',
  'via',
  'decoration',
  'accent',
  'caret',
  'placeholder',
  'shadow',
].join('|')

/** A literal colour class, with any variant prefix and opacity suffix. */
const LITERAL_CLASS = new RegExp(
  `(?<![\\w-])(?:[a-z0-9-]+:)*(?:${UTILITIES})-(?:${FAMILIES})(?:-[0-9]{2,3})?(?:/[0-9]+)?(?![\\w-])`,
  'g',
)

/** A hex colour in source. `&#…;` entities and `#id` fragments are not colours. */
const HEX_COLOUR = /(?<![&\w/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g

/** An `oklch()` colour written outside the theme. */
const OKLCH = /oklch\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\)/g

/** The exceptions described above, by file and exact match. */
const ALLOWED = Object.freeze({
  'apps/web/src/components/door-camera.jsx': { classes: ['bg-black'] },
  'apps/web/src/components/ticket-pass.jsx': { hex: ['#ffffff', '#000000'] },
  'apps/web/src/app/account/security/two-step.jsx': { hex: ['#ffffff', '#000000'] },
  'apps/web/src/app/global-error.jsx': { hex: 'tokens-only' },
  'apps/web/src/app/layout.jsx': { hex: 'tokens-only' },
  'apps/web/src/app/manifest.js': { hex: 'tokens-only' },
  // Not a component, so not in the list the other checks walk; named here so
  // the icon's two colours are held to the tokens as the manifest's are.
  'apps/web/src/app/icon.svg': { hex: 'tokens-only' },
  'apps/web/src/components/poster.jsx': { hex: ['#ffffff'], oklch: 'ramp-only' },
})

/**
 * Every component source file in the web app and the component library.
 *
 * From git rather than a directory walk, so a build output or a stray local
 * file cannot make this pass or fail.
 *
 * @returns {string[]} Repository-relative paths.
 */
function componentSources() {
  const listed = execFileSync(
    'git',
    [
      'ls-files',
      '--',
      'apps/web/src/*.js',
      'apps/web/src/*.jsx',
      'packages/ui/src/*.js',
      'packages/ui/src/*.jsx',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  )

  return listed.split('\n').filter((file) => file && !/\.test\.jsx?$/.test(file))
}

/**
 * Every `oklch()` value the theme declares for the brand ramp.
 *
 * @returns {Set<string>} Normalised `l c h` strings.
 */
function rampValues() {
  const css = readFileSync(path.join(repoRoot, 'packages/config/src/tailwind.css'), 'utf8')
  const values = new Set()
  const pattern =
    /--color-(?:marigold|indigo-night|henna)-[0-9]+:\s*oklch\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\)/g

  for (const [, l, c, h] of css.matchAll(pattern))
    values.add(`${Number(l)} ${Number(c)} ${Number(h)}`)

  return values
}

describe('components use the semantic tokens', () => {
  const files = componentSources()

  it('finds the sources it is meant to police', () => {
    // A glob that matched nothing would pass every check below.
    expect(files.length).toBeGreaterThan(100)
    expect(files).toContain('packages/ui/src/Button.jsx')
    expect(files).toContain('apps/web/src/app/layout.jsx')
  })

  it('uses no literal palette class outside the documented exceptions', () => {
    const offences = files.flatMap((file) => {
      const source = readFileSync(path.join(repoRoot, file), 'utf8')
      const allowed = new Set(ALLOWED[file]?.classes ?? [])

      return (
        [...source.matchAll(LITERAL_CLASS)]
          .filter(({ 0: match }) => !allowed.has(match.split(':').at(-1)))
          // A class named inside a comment is history, not styling.
          .filter(({ index }) => !isInComment(source, index))
          .map(({ 0: match }) => `${file}: ${match}`)
      )
    })

    expect(offences).toEqual([])
  })

  it('uses no hex colour outside the documented exceptions', () => {
    const offences = files.flatMap((file) => {
      const source = readFileSync(path.join(repoRoot, file), 'utf8')
      const allowed = ALLOWED[file]?.hex

      if (allowed === 'tokens-only') return []

      return [...source.matchAll(HEX_COLOUR)]
        .map(([match]) => match.toLowerCase())
        .filter((match) => !(allowed ?? []).includes(match))
        .map((match) => `${file}: ${match}`)
    })

    expect(offences).toEqual([])
  })

  it('writes no oklch() outside the theme, except poster artwork drawn from the ramp', () => {
    const ramp = rampValues()
    const offences = files.flatMap((file) => {
      const source = readFileSync(path.join(repoRoot, file), 'utf8')
      const found = [...source.matchAll(OKLCH)].map(
        ([, l, c, h]) => `${Number(l)} ${Number(c)} ${Number(h)}`,
      )

      if (ALLOWED[file]?.oklch === 'ramp-only') {
        return found
          .filter((value) => !ramp.has(value))
          .map((value) => `${file}: oklch(${value}) is not a ramp value`)
      }

      return found.map((value) => `${file}: oklch(${value})`)
    })

    expect(offences).toEqual([])
  })

  it('keeps every hex outside a stylesheet equal to the token it stands in for', () => {
    // These files cannot use the stylesheet — one renders when the root layout
    // has failed, the other sets the browser's own chrome — so they write hex.
    // It must still be the tokens' colour, or the pages nobody looks at drift
    // off the palette unnoticed.
    const css = readFileSync(path.join(repoRoot, 'packages/config/src/tailwind.css'), 'utf8')
    // The rule, not the first mention: the theme's own comments name the
    // courtyard selector long before the rule that uses it.
    const themeBody = css.slice(
      css.indexOf('@theme'),
      css.search(/^\[data-register='courtyard'\]\s*\{/m),
    )
    const tokenHex = new Map()
    const pattern = /--color-([a-z0-9-]+):\s*oklch\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\)/g

    for (const [, name, l, c, h] of themeBody.matchAll(pattern)) {
      tokenHex.set(name, toHex([Number(l), Number(c), Number(h)]))
    }

    const semantic = [...tokenHex.keys()].filter(
      (name) => !/^(marigold|indigo-night|henna)-/.test(name),
    )
    const allowed = new Map(semantic.map((name) => [tokenHex.get(name), name]))
    const checked = Object.entries(ALLOWED).filter(([, rule]) => rule.hex === 'tokens-only')

    expect(checked.length).toBeGreaterThanOrEqual(2)

    for (const [file] of checked) {
      const source = readFileSync(path.join(repoRoot, file), 'utf8')
      const used = [...source.matchAll(HEX_COLOUR)].map(([match]) => match.toLowerCase())

      expect(used.length, `${file} declares no colour to check`).toBeGreaterThan(0)
      expect(
        used.filter((hex) => !allowed.has(hex)),
        `${file} uses a hex that is no semantic token`,
      ).toEqual([])
    }
  })

  it('would catch the literals this layer replaced', () => {
    // Proves the pattern can fail, rather than only that it passes today.
    for (const literal of [
      'text-slate-700',
      'focus-visible:ring-marigold-500',
      'hover:bg-rose-50',
      'border-indigo-night-100',
      'bg-white/90',
      'text-emerald-900',
    ]) {
      expect(`className="${literal}"`.match(LITERAL_CLASS), literal).not.toBeNull()
    }

    for (const token of [
      'text-ink-muted',
      'ring-focus',
      'bg-status-danger-soft',
      'bg-surface/90',
    ]) {
      expect(`className="${token}"`.match(LITERAL_CLASS), token).toBeNull()
    }
  })
})

/**
 * Whether the text at an index sits inside a comment.
 *
 * Deliberately simple — a line comment or JSDoc star earlier on the same line,
 * or a block comment opened before the index and not yet closed — because the
 * files it reads are this repository's own, and they name literal classes in
 * comments only to explain what a token replaced. Every occurrence is checked
 * at its own index, so a literal used in code after being mentioned in a
 * comment is still caught.
 *
 * @param {string} source The file.
 * @param {number} index Where the match starts.
 * @returns {boolean} True when it is commentary.
 */
function isInComment(source, index) {
  const lineStart = source.lastIndexOf('\n', index) + 1
  const line = source.slice(lineStart, index)

  if (/\/\/|^\s*\*|\{\/\*/.test(line)) return true

  const lastOpen = source.lastIndexOf('/*', index)
  const lastClose = source.lastIndexOf('*/', index)

  return lastOpen > lastClose
}

/**
 * An oklch colour as the `#rrggbb` a browser would paint, for comparing the
 * one file that cannot use the stylesheet with the tokens it copies.
 *
 * The same conversion `token-contrast.test.js` uses, clamped to sRGB.
 *
 * @param {number[]} lch `[l, c, h]`.
 * @returns {string} Lower-case hex.
 */
function toHex([lightness, chroma, hue]) {
  const radians = (hue * Math.PI) / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)
  const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3

  /**
   * Encode and clamp one channel.
   *
   * @param {number} value A linear-light channel.
   * @returns {string} Two hex digits.
   */
  const channel = (value) => {
    const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055

    return Math.round(Math.min(1, Math.max(0, encoded)) * 255)
      .toString(16)
      .padStart(2, '0')
  }

  return `#${channel(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short)}${channel(
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
  )}${channel(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short)}`
}
