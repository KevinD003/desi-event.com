/**
 * The encoder's output, read back by the decoder the scanner uses.
 *
 * Independent libraries on the two sides: `uqr` writes, `jsqr` reads. A pass
 * that round-trips here is one a door will read; a path that drew a
 * different picture from the matrix would fail here first.
 */

import { describe, expect, it } from 'vitest'

import { decodeFrame } from './qr-decode.js'
import { looksLikePass } from './pass-shape.js'
import { QUIET_ZONE, qrMatrix, qrPath } from './qr.js'

/**
 * Rasterise a path of module-unit rectangles into RGBA, the way a screen
 * would show it, scaled up.
 *
 * @param {string} path From {@link qrPath}.
 * @param {number} size Modules per side.
 * @param {number} scale Pixels per module.
 * @returns {{data: Uint8ClampedArray, width: number, height: number}} The frame.
 */
function rasterise(path, size, scale = 6) {
  const width = size * scale
  const data = new Uint8ClampedArray(width * width * 4).fill(255)

  for (const [, x, y, run] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/gu)) {
    for (let px = Number(x) * scale; px < (Number(x) + Number(run)) * scale; px += 1) {
      for (let py = Number(y) * scale; py < (Number(y) + 1) * scale; py += 1) {
        const at = (py * width + px) * 4

        data[at] = 0
        data[at + 1] = 0
        data[at + 2] = 0
      }
    }
  }

  return { data, width, height: width }
}

/**
 * A pass-shaped string: 43 base64url characters, like a real credential.
 *
 * @param {number} seed Varies it.
 * @returns {string} The string.
 */
function passLike(seed) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let value = ''
  let state = seed * 2654435761

  for (let index = 0; index < 43; index += 1) {
    state = (state * 1103515245 + 12345) % 2147483648
    value += alphabet[state % 64]
  }

  return value
}

describe('qrMatrix and qrPath', () => {
  it('round-trips pass-shaped strings through an independent decoder', async () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const pass = passLike(seed)
      const matrix = qrMatrix(pass)

      expect(await decodeFrame(rasterise(qrPath(matrix), matrix.size))).toEqual({ pass })
    }
  })

  it('leaves the quiet zone the specification requires', () => {
    const matrix = qrMatrix(passLike(1))

    for (let index = 0; index < QUIET_ZONE; index += 1) {
      expect(matrix.dark[index].some(Boolean)).toBe(false)
      expect(matrix.dark[matrix.size - 1 - index].some(Boolean)).toBe(false)
      expect(matrix.dark.some((row) => row[index] || row[matrix.size - 1 - index])).toBe(false)
    }
  })

  it('does not put the encoded text into the path', () => {
    const pass = passLike(7)

    expect(qrPath(qrMatrix(pass))).not.toContain(pass)
    expect(qrPath(qrMatrix(pass))).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/u)
  })

  it('refuses to encode nothing', () => {
    expect(() => qrMatrix('')).toThrow(TypeError)
    expect(() => qrMatrix(undefined)).toThrow(TypeError)
  })
})

describe('decodeFrame', () => {
  it('reports a code that is not a pass without handing its text back', async () => {
    const matrix = qrMatrix('https://example.com/menu?table=7')

    expect(await decodeFrame(rasterise(qrPath(matrix), matrix.size))).toEqual({ other: true })
  })

  it('finds nothing in a blank frame', async () => {
    const blank = { data: new Uint8ClampedArray(120 * 120 * 4).fill(255), width: 120, height: 120 }

    expect(await decodeFrame(blank)).toBeNull()
  })
})

describe('looksLikePass', () => {
  it('accepts the door schema’s shape and nothing else', () => {
    expect(looksLikePass(passLike(3))).toBe(true)
    expect(looksLikePass('DE-8F3K2Q-01')).toBe(false)
    expect(looksLikePass('https://example.com')).toBe(false)
    expect(looksLikePass('short')).toBe(false)
    expect(looksLikePass(null)).toBe(false)
  })
})
