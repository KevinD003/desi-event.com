/**
 * The browser-safe seating subpath.
 *
 * The public seat picker runs in a browser and needs the companion rule and the
 * per-order ceiling, which live in `seating.js`. The package barrel cannot be
 * given to a browser — it re-exports `ownership.js`, which digests guest tokens
 * with `node:crypto` — so `seating.js` is exported on its own subpath. These
 * tests pin what makes that safe: the subpath points at `seating.js`, and
 * nothing `seating.js` imports reaches `ownership.js` or any Node built-in.
 *
 * @module @desi-event/inventory/seating-subpath.test
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as seating from './seating.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * The specifiers a module imports statically.
 *
 * @param {string} file A file in this directory.
 * @returns {string[]} Its import specifiers.
 */
function importsOf(file) {
  const source = readFileSync(join(HERE, file), 'utf8')

  return [...source.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  )
}

describe('@desi-event/inventory/seating', () => {
  it('is exported as its own subpath, pointing at seating.js', () => {
    const manifest = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'))

    expect(manifest.exports['./seating']).toBe('./src/seating.js')
  })

  it('resolves through the package name to the same module', async () => {
    const viaName = await import('@desi-event/inventory/seating')

    expect(viaName.withCompanions).toBe(seating.withCompanions)
    expect(viaName.MAX_SEATS_PER_ORDER).toBe(10)
  })

  it('imports nothing but errors.js, and errors.js imports nothing', () => {
    expect(importsOf('seating.js')).toEqual(['./errors.js'])
    expect(importsOf('errors.js')).toEqual([])
  })

  it('never reaches ownership.js or a Node built-in', () => {
    const reached = [...importsOf('seating.js'), ...importsOf('errors.js')]

    expect(reached.some((specifier) => specifier.includes('ownership'))).toBe(false)
    expect(reached.some((specifier) => specifier.startsWith('node:'))).toBe(false)
  })

  it('carries the pieces the seat picker uses', () => {
    for (const name of ['withCompanions', 'wouldStrandCompanion', 'groupSeatMap', 'seatCounts']) {
      expect(seating[name], name).toBeTypeOf('function')
    }
    expect(seating.SEAT_STATUS.AVAILABLE).toBe('AVAILABLE')
  })
})
