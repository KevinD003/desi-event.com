/**
 * Reading a QR code back out of the drawing a page made of it.
 *
 * The holder's pass and an order's group pass are both drawn as one SVG path
 * in module units (`lib/qr.js`: `M<x> <y>h<run>v1h-<run>z` per dark run). The
 * door specs need what the drawing encodes, to feed it to the door's camera
 * and to prove it is nowhere else in the page — so they read it from the path
 * the page drew, paint it on a pixel grid and decode it with the same decoder
 * the door uses. Nothing is written anywhere: the decoded value stays in the
 * test's memory, and every spec that calls this turns screenshots, traces and
 * video off at its top level.
 *
 * Moved here from `detail-organizer-checkin.spec.js`, which imports it, so the
 * group pass spec reads its drawing the same way.
 *
 * @module e2e/support/qr-drawing
 */

import jsQRModule from 'jsqr'

const jsQR = jsQRModule.default ?? jsQRModule

/**
 * Decode the QR a page drew, from the path it drew it with.
 *
 * @param {string} path The SVG path, in module units.
 * @param {number} size Modules per side.
 * @returns {string|null} What it encodes.
 */
export function decodeDrawing(path, size) {
  const scale = 6
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

  return jsQR(data, width, width)?.data ?? null
}

/**
 * Read the drawing out of an SVG QR on the page and decode it.
 *
 * @param {object} drawing A locator for the `svg[role="img"]`.
 * @returns {Promise<{path: string, size: number, value: string|null}>} The path, its size, and what it encodes.
 */
export async function readDrawing(drawing) {
  const path = await drawing.locator('path').getAttribute('d')
  const size = Number((await drawing.getAttribute('viewBox')).split(' ')[2])

  return { path, size, value: decodeDrawing(path, size) }
}

/**
 * Every eight-character slice of a string.
 *
 * What "no part of the pass" is checked against. Eight characters of a random
 * base64url string do not turn up anywhere by chance, so a slice found in a
 * page's storage or a request got there from the pass.
 *
 * @param {string} text The string.
 * @returns {string[]} Its slices, overlapping.
 */
export function slices(text) {
  const size = 8

  return Array.from({ length: text.length - size + 1 }, (_, at) => text.slice(at, at + size))
}
