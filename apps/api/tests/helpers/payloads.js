/**
 * Scanning a response for things that must never be in it.
 *
 * Several suites assert that a payload carries no buyer identity and no card
 * data by searching the serialised body for short needles — `cvc`, `card`,
 * `pan`, `4242`. The assertion is right and the instrument needs one correction
 * before it works: **a cuid is twenty-five random base-36 characters, so it will
 * eventually contain any three-letter needle by chance.**
 *
 * That is not hypothetical. CI run `35227997764` failed
 * `reconciliation.test.js` on exactly this, and the id that did it is worth
 * quoting because it looks so ordinary:
 *
 * ```
 * "organizationid":"caqg3dml7cvcjm00000000000"
 *                          ^^^
 * ```
 *
 * An identifier is not content. What the scan is about is a leaked *field* — a
 * `receipt_email` that survived a presenter, a `last4` that reached a browser —
 * and masking the ids keeps every one of those detectable while removing the
 * coincidence. A needle in a field name or in a real value is still caught.
 *
 * This lived as a local function in one suite and as an inline `replace` in
 * another, and the third was written without either. One exported helper is
 * what stops a fourth from forgetting.
 *
 * @module @desi-event/api/tests/helpers/payloads
 */

/**
 * Twenty to thirty-two lower-case alphanumerics, standing alone.
 *
 * Wide enough for a cuid and for the other opaque references this API returns,
 * and narrow enough that it cannot swallow a leak: an address contains `@` and
 * `.`, a card fragment like `4242` is four characters, and a provider key like
 * `receipt_email` contains an underscore. None of them match.
 *
 * @type {RegExp}
 */
const IDENTIFIER = /\b[a-z0-9]{20,32}\b/gu

/**
 * A payload with its identifiers blanked, ready for a needle scan.
 *
 * @param {string} body The response body, as text.
 * @returns {string} The same text with every identifier-shaped run removed.
 */
export function withoutIdentifiers(body) {
  return String(body).replace(IDENTIFIER, '')
}

/**
 * Assert that none of these needles survives in a payload.
 *
 * Lower-cases both sides and masks identifiers first, so the failure message
 * names the needle rather than making somebody diff two blobs of JSON.
 *
 * @param {object} expect Vitest's `expect`, passed in so this file imports nothing.
 * @param {string} body The response body, as text.
 * @param {ReadonlyArray<string>} needles What must not be there.
 * @returns {void} Nothing.
 */
export function expectNoNeedles(expect, body, needles) {
  const scanned = withoutIdentifiers(body).toLowerCase()

  for (const needle of needles) {
    expect(scanned, `the payload carries "${needle}"`).not.toContain(needle.toLowerCase())
  }
}
