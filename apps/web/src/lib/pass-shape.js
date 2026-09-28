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

/**
 * Whether decoded text has the shape of a group pass.
 *
 * `G1.` and 43 url-safe characters — the group door's request schema. The `.`
 * never occurs in a ticket's own pass, so the two shapes cannot both match
 * and a scan is routed to exactly one lookup.
 *
 * @param {unknown} text Decoded text.
 * @returns {boolean} True when it could be a group pass.
 */
export function looksLikeGroupPass(text) {
  return typeof text === 'string' && /^G1\.[A-Za-z0-9_-]{43}$/u.test(text)
}

/**
 * Whether a typed code has the shape of a printed group code.
 *
 * `DEG-` and twelve characters from the ticket-code alphabet, however it was
 * typed: spaces around it and lower case are forgiven, as the server forgives
 * them.
 *
 * @param {unknown} code What the steward typed.
 * @returns {boolean} True when it could be a group code.
 */
export function looksLikeGroupCode(code) {
  return typeof code === 'string' && /^DEG-[2-9A-HJ-NP-Z]{12}$/u.test(code.trim().toUpperCase())
}
