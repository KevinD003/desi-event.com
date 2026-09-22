/**
 * Reading a QR code out of one camera frame, on this device.
 *
 * The decoder is `jsqr` at an exact version, imported only when the first
 * frame is decoded, so the roughly 47 KB it weighs is paid only by a steward
 * who opened the camera — never by an attendee, and never on first paint of
 * the door screen. It runs synchronously on pixels already in memory: no
 * worker, no WebAssembly, no network. A frame is never sent anywhere or kept;
 * only the decoded text leaves this function, and only when it has the shape
 * of a pass.
 *
 * @module lib/qr-decode
 */

import { looksLikePass } from './pass-shape.js'

/** @type {Promise<Function>|null} */
let loading = null

/**
 * The decoder, loaded once.
 *
 * @returns {Promise<Function>} `jsQR(data, width, height, options)`.
 */
function decoder() {
  loading ??= import('jsqr').then((module) => module.default ?? module)

  return loading
}

/**
 * Decode one frame.
 *
 * @param {{data: Uint8ClampedArray, width: number, height: number}} frame RGBA pixels, as `getImageData` returns them.
 * @returns {Promise<{pass: string}|{other: true}|null>} A pass, something that is not one, or nothing found.
 */
export async function decodeFrame(frame) {
  const jsQR = await decoder()
  const found = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })

  if (!found?.data) return null

  return looksLikePass(found.data) ? { pass: found.data } : { other: true }
}
