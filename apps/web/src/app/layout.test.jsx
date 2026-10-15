/**
 * The root layout's metadata: a link to the site unfurls as the brand's own
 * picture, at an absolute address, and the browser icons come from the files
 * beside the layout rather than from a list that could drift from them.
 *
 * @module app/layout.test
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/session.js', () => ({ readSession: vi.fn() }))
vi.mock('../lib/request-path.js', () => ({ requestPathname: vi.fn() }))

const { metadata } = await import('./layout.jsx')

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** The share picture as every unfurl should name it. */
const SHARE = {
  url: '/brand/og-default.jpg',
  width: 1200,
  height: 630,
  type: 'image/jpeg',
  alt: 'The Desi Events — Every moment, one place.',
}

describe('root layout metadata', () => {
  it('describes a catalogue in the USA and Canada, and claims US dollars only for tickets sold here', () => {
    for (const words of [
      metadata.title.default,
      metadata.description,
      metadata.openGraph.title,
      metadata.twitter.description,
    ]) {
      expect(words).toMatch(/across the USA and Canada/u)
    }

    expect(metadata.description).toMatch(/Tickets sold here are priced in US dollars/u)
    expect(metadata.description).not.toMatch(/every price shown in US dollars/u)
  })

  it('resolves relative addresses against an absolute base', () => {
    expect(metadata.metadataBase).toBeInstanceOf(URL)
    expect(metadata.metadataBase.protocol).toMatch(/^https?:$/u)
  })

  it('gives Open Graph the brand’s share picture, 1200 × 630, with its words as alt text', () => {
    expect(metadata.openGraph.images).toEqual([SHARE])
    expect(new URL(SHARE.url, metadata.metadataBase).href).toMatch(
      /^https?:\/\/[^/]+\/brand\/og-default\.jpg$/u,
    )
  })

  it('gives a large-image card the same picture', () => {
    expect(metadata.twitter.card).toBe('summary_large_image')
    expect(metadata.twitter.images).toEqual([SHARE])
  })

  it('names a share picture that is really served', () => {
    expect(existsSync(path.join(HERE, '../../public', SHARE.url))).toBe(true)
  })

  it('leaves the icons to the file conventions, whose files are all there', () => {
    // favicon.ico, icon.png and apple-icon.png beside the layout are linked
    // by Next itself; a second list here would be one to keep in step.
    expect(metadata).not.toHaveProperty('icons')

    for (const file of ['favicon.ico', 'icon.png', 'apple-icon.png']) {
      expect(existsSync(path.join(HERE, file)), file).toBe(true)
    }
  })
})
