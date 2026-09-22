/**
 * Whether a string has the shape of an entry pass.
 *
 * On its own so the scanner can ask without importing the encoder: the door
 * screen decodes QR codes and never draws one, and nothing it loads should
 * carry the weight of a library it does not use.
 *
 * @module lib/pass-shape
 */

/**
 * Whether decoded text has the shape of an entry pass.
 *
 * The same shape the door's request schema accepts. A QR code on a poster, a
 * menu or a payment terminal decodes to something else, and is not sent to the
 * server at all.
 *
 * @param {unknown} text Decoded text.
 * @returns {boolean} True when it could be a pass.
 */
export function looksLikePass(text) {
  return typeof text === 'string' && /^[A-Za-z0-9_-]{16,200}$/u.test(text)
}
