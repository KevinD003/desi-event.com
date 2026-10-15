/**
 * Drawing an entry pass as a QR code, in the browser, from a matrix.
 *
 * The encoder is `uqr` at an exact version — see the QR decision in
 * `docs/PHASE4_IMPLEMENTATION_REPORT.md` for why it and nothing else. It is
 * asked for a boolean matrix rather than markup, and the matrix becomes one
 * SVG path drawn by React: no `dangerouslySetInnerHTML`, no canvas, no data
 * URL that could be copied out of an attribute.
 *
 * Two settings are not left to the library's defaults, because its defaults
 * are wrong for a door: error correction `M` rather than `L`, so a scuffed or
 * glare-struck phone screen still reads, and a four-module quiet zone rather
 * than one, which is what the QR specification requires and what a scanner
 * needs to find the code at all.
 *
 * Nothing here keeps the text it was given. The caller encodes and discards.
 *
 * @module lib/qr
 */

import { encode } from 'uqr'

/**
 * Modules of blank margin on every side, as the QR specification requires.
 *
 * @type {number}
 */
export const QUIET_ZONE = 4

/**
 * Encode text as a QR matrix, quiet zone included.
 *
 * @param {string} text What to encode.
 * @returns {{size: number, dark: boolean[][]}} The matrix, `true` for a dark module.
 * @throws {TypeError} For an empty or non-string input.
 */
export function qrMatrix(text) {
  if (typeof text !== 'string' || text === '') {
    throw new TypeError('A QR code needs something to encode.')
  }

  const { size, data } = encode(text, { ecc: 'M', border: QUIET_ZONE })

  return { size, dark: data }
}

/**
 * One SVG path covering every dark module, in module units.
 *
 * Adjacent dark modules in a row are merged into one run, which keeps the path
 * short without changing what is drawn.
 *
 * @param {{size: number, dark: boolean[][]}} matrix From {@link qrMatrix}.
 * @returns {string} A path `d` attribute.
 */
export function qrPath(matrix) {
  const parts = []

  for (let y = 0; y < matrix.size; y += 1) {
    let x = 0

    while (x < matrix.size) {
      if (!matrix.dark[y][x]) {
        x += 1
        continue
      }

      const start = x

      while (x < matrix.size && matrix.dark[y][x]) x += 1

      parts.push(`M${start} ${y}h${x - start}v1h${start - x}z`)
    }
  }

  return parts.join('')
}
