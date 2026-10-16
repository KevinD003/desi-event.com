/**
 * One focus indicator: an outline, everywhere but the seat map.
 *
 * ## Why this exists
 *
 * The site had two focus systems. The component library drew an outline,
 * which survives Windows' forced-colours mode; the app's own link and button
 * kits drew a `ring` — a box-shadow — after `outline-none`, and forced-colours
 * mode removes box-shadows, so for a reader using it those controls showed
 * no focus at all. Some 180 of them were moved to the outline in one pass.
 * This keeps them there.
 *
 * The one exception is the seat on the seat map. Its chip is drawn on a
 * hatched or tinted fill where an outline's offset would bleed into the next
 * seat, and the accessibility sweep pins its focus as a box-shadow ring
 * deliberately.
 *
 * @module
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** A focus ring drawn as a box-shadow. */
const RING = /\b(?:focus|focus-visible|focus-within)(?::[a-z-]+)*:ring-(?:\d|focus|offset)/g

/** The seat: its file and the one class list allowed to draw a ring. */
const SEAT = { file: 'apps/web/src/components/seat-picker.jsx', marker: 'h-9 min-w-9 items-center' }

const sources = execFileSync(
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
  .split('\n')
  .filter((file) => file && !/\.test\.jsx?$/.test(file))

describe('focus is drawn as an outline', () => {
  it('reads the sources it polices', () => {
    expect(sources.length).toBeGreaterThan(100)
    expect(sources).toContain(SEAT.file)
  })

  it('draws no box-shadow focus ring outside the seat map’s seats', () => {
    const offences = sources.flatMap((file) =>
      readFileSync(path.join(repoRoot, file), 'utf8')
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => line.match(RING))
        .filter(({ line }) => !(file === SEAT.file && line.includes(SEAT.marker)))
        .map(({ number }) => `${file}:${number}`),
    )

    expect(offences).toEqual([])
  })

  it('keeps the seat’s ring, which the sweep measures as a box-shadow', () => {
    const seat = readFileSync(path.join(repoRoot, SEAT.file), 'utf8')
      .split('\n')
      .filter((line) => line.includes(SEAT.marker))

    expect(seat).toHaveLength(1)
    expect(seat[0]).toMatch(/focus-visible:ring-2 focus-visible:ring-focus/)
  })

  it('would catch a ring that came back', () => {
    expect('focus-visible:outline-none focus-visible:ring-2'.match(RING)).not.toBeNull()
    expect('focus-within:ring-focus'.match(RING)).not.toBeNull()
    expect(
      'focus-visible:outline-2 focus-visible:outline-focus ring-1 ring-line'.match(RING),
    ).toBeNull()
  })
})
