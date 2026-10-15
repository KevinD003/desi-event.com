/**
 * The manifest names the site, starts at the front page, and asks for nothing
 * it would have to cache.
 *
 * @module app/manifest.test
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import manifest from './manifest.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** The web app's `public` folder, which the site serves at its root. */
const PUBLIC = path.join(HERE, '../../public')

/**
 * A PNG's width and height, read from its header.
 *
 * @param {Buffer} bytes The file.
 * @returns {Array<number>} Width and height in pixels.
 */
function pngSize(bytes) {
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  )
  expect(bytes.toString('latin1', 12, 16)).toBe('IHDR')

  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

describe('manifest', () => {
  const value = manifest()

  it('describes a catalogue in the USA and Canada, with US dollars claimed only for tickets sold here', () => {
    expect(value.description).toMatch(/across the USA and Canada/u)
    expect(value.description).toMatch(/Tickets sold here are priced in US dollars/u)
    expect(value.description).not.toMatch(/every price shown in US dollars/u)
  })

  it('names the site and opens at the front page, inside the site', () => {
    expect(value.name).toBe('The Desi Events')
    expect(value.short_name).toBe('The Desi Events')
    expect(value.start_url).toBe('/')
    expect(value.scope).toBe('/')
    expect(value.display).toBe('standalone')
  })

  it('carries no query or fragment in its start page, which would be kept by every install', () => {
    expect(value.start_url).not.toMatch(/[?#]/u)
  })

  it('colours the chrome as the root layout does', () => {
    const layout = readFileSync(path.join(HERE, 'layout.jsx'), 'utf8')
    const themeColor = layout.match(/themeColor:\s*'(#[0-9a-f]{6})'/u)?.[1]

    expect(value.theme_color).toBe(themeColor)
    expect(value.background_color).toBe(themeColor)
  })

  it('points at icons that exist, each a PNG of the size it declares', () => {
    expect(value.icons.length).toBeGreaterThan(0)

    for (const icon of value.icons) {
      const file = path.join(PUBLIC, icon.src.replace(/^\//u, ''))

      expect(icon.type).toBe('image/png')
      expect(icon.sizes).toBe(`${pngSize(readFileSync(file)).join('x')}`)
    }
  })

  it('offers the 192 and 512 pixel icons an installer asks for, for any purpose', () => {
    expect(value.icons.map((icon) => [icon.sizes, icon.purpose])).toEqual([
      ['192x192', 'any'],
      ['512x512', 'any'],
    ])
  })

  it('says payments are simulated, as the site does', () => {
    expect(value.description).toMatch(/simulated/u)
  })
})
