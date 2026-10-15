/**
 * The brand files the site serves are the ones the code says they are: each
 * logo, icon and share picture exists, is the format its name says, is the
 * size in pixels the markup and metadata declare for it, and is small enough
 * to send on every page.
 *
 * The files are derived from the owner's brand kit (`docs/BRAND.md`); the
 * masters are not in the repository, so these tests read what is.
 *
 * @module lib/brand.test
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { BRAND_LOGOS } from '../components/brand-logo.jsx'
import { SHARE_IMAGE, SQUARE_LOGO_PATH, TAGLINE } from './brand.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(HERE, '../../public')
const APP = path.join(HERE, '../app')

/**
 * Bytes of a file the site serves at `src`.
 *
 * @param {string} src A root-relative address.
 * @returns {Buffer} The file.
 */
function served(src) {
  return readFileSync(path.join(PUBLIC, src.replace(/^\//u, '')))
}

/**
 * A PNG's size, from its header.
 *
 * @param {Buffer} bytes The file.
 * @returns {Array<number>} Width and height.
 */
function pngSize(bytes) {
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG')

  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

/**
 * A WebP's size, from whichever of its three bitstream headers it carries.
 *
 * @param {Buffer} bytes The file.
 * @returns {{size: Array<number>, alpha: boolean}} Width, height and whether it has an alpha channel.
 */
function webpInfo(bytes) {
  expect(bytes.toString('latin1', 0, 4)).toBe('RIFF')
  expect(bytes.toString('latin1', 8, 12)).toBe('WEBP')

  const chunk = bytes.toString('latin1', 12, 16)

  if (chunk === 'VP8X') {
    return {
      size: [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1],
      alpha: (bytes[20] & 0x10) !== 0,
    }
  }
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21)

    return {
      size: [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1],
      alpha: ((bits >> 28) & 1) === 1,
    }
  }

  return { size: [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff], alpha: false }
}

/**
 * A JPEG's size, from its first start-of-frame segment.
 *
 * @param {Buffer} bytes The file.
 * @returns {Array<number>} Width and height.
 */
function jpegSize(bytes) {
  expect(bytes.readUInt16BE(0)).toBe(0xffd8)

  let offset = 2

  while (offset < bytes.length) {
    const marker = bytes.readUInt16BE(offset)

    if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker)) {
      return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)]
    }
    offset += 2 + bytes.readUInt16BE(offset + 2)
  }

  throw new Error('no start-of-frame segment')
}

/** The most a header or footer logo file may weigh: it is on every page. */
const LOGO_BYTES = 60 * 1024

describe('the logo files', () => {
  it.each(Object.entries(BRAND_LOGOS))(
    '%s is a WebP with transparency at the 1x size it declares, with a 2x copy',
    (_, logo) => {
      const one = webpInfo(served(logo.src))
      const two = webpInfo(served(logo.src2x))

      expect(one).toEqual({ size: [logo.width, logo.height], alpha: true })
      expect(two.alpha).toBe(true)
      // Twice the height exactly, and twice the width to within the pixel
      // each was rounded to.
      expect(two.size[1]).toBe(logo.height * 2)
      expect(Math.abs(two.size[0] - logo.width * 2)).toBeLessThanOrEqual(1)
    },
  )

  it.each(Object.entries(BRAND_LOGOS))('%s is small enough for every page', (_, logo) => {
    for (const src of [logo.src, logo.src2x]) {
      expect(served(src).length, src).toBeLessThan(LOGO_BYTES)
    }
  })

  it('keeps the light and dark logos’ shapes from the kit: wide, with the name beside the D', () => {
    expect(BRAND_LOGOS.light.width / BRAND_LOGOS.light.height).toBeCloseTo(4.04, 1)
    expect(BRAND_LOGOS.dark.width / BRAND_LOGOS.dark.height).toBeCloseTo(3.31, 1)
  })
})

describe('the square logo', () => {
  it('is a 512 × 512 PNG, for structured data', () => {
    expect(SQUARE_LOGO_PATH).toMatch(/\.png$/u)
    expect(pngSize(served(SQUARE_LOGO_PATH))).toEqual([512, 512])
  })
})

describe('the share picture', () => {
  it('is a JPEG of exactly the size the metadata declares, 1200 × 630', () => {
    expect([SHARE_IMAGE.width, SHARE_IMAGE.height]).toEqual([1200, 630])
    expect(SHARE_IMAGE.type).toBe('image/jpeg')
    expect(jpegSize(served(SHARE_IMAGE.url))).toEqual([1200, 630])
  })

  it('says in its alternative text the words drawn in it: the name and the kit’s tagline', () => {
    expect(TAGLINE).toBe('Every moment, one place.')
    expect(SHARE_IMAGE.alt).toBe('The Desi Events — Every moment, one place.')
  })
})

describe('the icons', () => {
  it('serves the kit’s favicon.ico, with its six sizes', () => {
    const bytes = readFileSync(path.join(APP, 'favicon.ico'))
    const count = bytes.readUInt16LE(4)
    const sizes = Array.from({ length: count }, (_, index) => bytes[6 + index * 16] || 256)

    expect(bytes.readUInt16LE(2)).toBe(1)
    expect(sizes).toEqual([16, 32, 48, 64, 128, 256])
  })

  it.each([
    ['icon.png', 512],
    ['apple-icon.png', 180],
  ])('serves app/%s at %i pixels square', (file, size) => {
    expect(pngSize(readFileSync(path.join(APP, file)))).toEqual([size, size])
  })

  it('no longer carries the hand-drawn monogram the kit replaced', () => {
    expect(existsSync(path.join(APP, 'icon.svg'))).toBe(false)
  })

  it('keeps no master file in the repository: every brand file is web-sized', () => {
    for (const file of ['logo-square-512.png', 'og-default.jpg']) {
      expect(statSync(path.join(PUBLIC, 'brand', file)).size, file).toBeLessThan(200 * 1024)
    }
  })
})
