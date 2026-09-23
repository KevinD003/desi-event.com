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

describe('manifest', () => {
  const value = manifest()

  it('names the site and opens at the front page, inside the site', () => {
    expect(value.name).toBe('Desi-Event')
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

  it('points at an icon that exists', () => {
    expect(value.icons.length).toBeGreaterThan(0)

    for (const icon of value.icons) {
      const file = path.join(HERE, icon.src.replace(/^\//u, ''))

      expect(readFileSync(file, 'utf8')).toMatch(/<svg\b/u)
    }
  })

  it('says payments are simulated, as the site does', () => {
    expect(value.description).toMatch(/simulated/u)
  })
})
