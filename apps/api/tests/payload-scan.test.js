/**
 * The needle scan that three security assertions depend on.
 *
 * `reconciliation.test.js`, `analytics.test.js` and `refunds.test.js` all prove
 * the same thing about different payloads: no buyer identity, no card data, no
 * provider key. They prove it by searching the serialised body for short
 * needles, and this file is the test of the search itself.
 *
 * It exists because the search was wrong once, in a way that took a CI failure
 * to notice. A cuid is twenty-five random base-36 characters, so it contains any
 * three-letter needle roughly one time in two thousand — and on CI run
 * `35227997764` it contained `cvc`:
 *
 * ```
 * "organizationid":"caqg3dml7cvcjm00000000000"
 * ```
 *
 * Masking identifiers fixes that, and the interesting half of this file is the
 * other one: proving the mask did not also blind the scan. A fix that stopped
 * the false positive by weakening the assertion would be worse than the flake.
 */

import { createHash, randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { expectNoNeedles, expectNoSecret, withoutIdentifiers } from './helpers/payloads.js'

/** The needles the reconciliation detail route is scanned for. */
const NEEDLES = Object.freeze(['priya', '4242', 'receipt_email', 'payment_method', 'cvc'])

/**
 * A body shaped like the route's, with whatever is passed folded in.
 *
 * @param {object} extra Fields to add.
 * @returns {string} The serialised payload.
 */
function body(extra = {}) {
  return JSON.stringify({
    data: {
      id: 'cbquwdxdh005pt00000000000',
      organizationId: 'caqg3dml7cvcjm00000000000',
      orderReference: 'DE-RECON1',
      ...extra,
    },
  })
}

/**
 * Whether the scan would fail on this body.
 *
 * @param {string} payload The serialised payload.
 * @returns {boolean} True when a needle survives the mask.
 */
function caught(payload) {
  try {
    expectNoNeedles(expect, payload, NEEDLES)

    return false
  } catch {
    return true
  }
}

describe('withoutIdentifiers', () => {
  it('removes the identifier that broke CI run 35227997764', () => {
    // The literal id from the failure. `caqg3dml7cvcjm…` contains `cvc`.
    expect(body().toLowerCase()).toContain('cvc')
    expect(withoutIdentifiers(body()).toLowerCase()).not.toContain('cvc')
  })

  it('removes any identifier-shaped run, not just that one', () => {
    for (const id of [
      'cbquwdxdh005pt00000000000',
      'caqg3dml7cvcjm00000000000',
      'ck1234567890abcdefghijklm',
      'abcdefghij0123456789',
    ]) {
      expect(withoutIdentifiers(`"${id}"`)).toBe('""')
    }
  })

  it('leaves a short reference alone, because it is content', () => {
    // An order reference is meaningful and far below the twenty-character floor.
    expect(withoutIdentifiers('"DE-RECON1"')).toBe('"DE-RECON1"')
  })

  it('leaves an address alone — the thing the scan exists to find', () => {
    const address = 'priya@example.com'

    expect(withoutIdentifiers(`"${address}"`)).toContain(address)
  })
})

describe('expectNoNeedles', () => {
  it('passes a payload whose only match is a coincidence inside an identifier', () => {
    expect(caught(body())).toBe(false)
  })

  it.each([
    ['a provider key', { receipt_email: 'someone@example.test' }],
    ['a card fragment', { last4: '4242' }],
    ['a buyer name', { buyer: 'Priya Sharma' }],
    ['a literal cvc field', { cvc: '123' }],
    ['a payment method', { payment_method: 'pm_1' }],
  ])('still catches %s', (_label, leak) => {
    expect(caught(body(leak))).toBe(true)
  })

  it('catches a needle in a field name as readily as in a value', () => {
    expect(caught(body({ receipt_email: null }))).toBe(true)
  })

  it('names the needle it found, so a failure does not mean diffing two blobs', () => {
    let message = ''

    try {
      expectNoNeedles(expect, body({ last4: '4242' }), NEEDLES)
    } catch (error) {
      message = String(error.message)
    }

    expect(message).toContain('4242')
  })

  it('is case-insensitive in both directions', () => {
    expect(caught(body({ note: 'PRIYA' }))).toBe(true)
    expect(caught(body({ note: 'Receipt_Email' }))).toBe(true)
  })
})

/**
 * A fresh code of `length` lower-case letters and digits, made at run time.
 *
 * The shape `withoutIdentifiers` masks, which is the point: a show-once code
 * could come out looking exactly like this.
 *
 * @param {number} length How many characters.
 * @returns {string} The code.
 */
function lowerCaseCode(length) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'

  return [...randomBytes(length)].map((byte) => alphabet[byte % alphabet.length]).join('')
}

/**
 * Whether `expectNoSecret` would fail on this body, and with what message.
 *
 * @param {string|object} payload The payload.
 * @param {string} secret The secret.
 * @returns {{caught: boolean, message: string}} The outcome.
 */
function secretOutcome(payload, secret) {
  try {
    expectNoSecret(expect, payload, secret)

    return { caught: false, message: '' }
  } catch (error) {
    return { caught: true, message: String(error?.message ?? error) }
  }
}

describe('expectNoSecret', () => {
  it('is needed: a 24-character lower-case code is masked, so the needle scan misses it', () => {
    const code = lowerCaseCode(24)
    const leaked = body({ invitationCode: code })

    expect(withoutIdentifiers(leaked)).not.toContain(code)
    expect(() => expectNoNeedles(expect, leaked, [code])).not.toThrow()
  })

  it('catches that same code, which the needle scan let through', () => {
    const code = lowerCaseCode(24)

    expect(secretOutcome(body({ invitationCode: code }), code).caught).toBe(true)
  })

  it('catches a url-safe base64 code like the one a transfer offer returns', () => {
    const code = randomBytes(32).toString('base64url')

    expect(secretOutcome(body({ delivery: { invitationCode: code } }), code).caught).toBe(true)
    // Wherever it sits: in a field that is not called anything like a code.
    expect(secretOutcome(`request rejected ${code} for /v1/x`, code).caught).toBe(true)
  })

  it('never puts the secret in its failure message', () => {
    const code = randomBytes(32).toString('base64url')
    const { caught, message } = secretOutcome(body({ invitationCode: code }), code)

    expect(caught).toBe(true)
    expect(message).toContain('the payload carries the one-time secret')
    expect(message).not.toContain(code)
  })

  it('passes a body that carries only the code’s digest', () => {
    const code = randomBytes(32).toString('base64url')
    const digest = createHash('sha256').update(code).digest('hex')

    expect(secretOutcome(body({ tokenHash: digest }), code).caught).toBe(false)
  })

  it('is case-sensitive, because a code is', () => {
    const code = `${lowerCaseCode(12)}ABC${lowerCaseCode(12)}`

    expect(secretOutcome(body({ note: code.toLowerCase() }), code).caught).toBe(false)
    expect(secretOutcome(body({ note: code }), code).caught).toBe(true)
  })

  it('serialises an object body rather than reading "[object Object]"', () => {
    const code = lowerCaseCode(24)

    expect(secretOutcome({ data: { invitationCode: code } }, code).caught).toBe(true)
  })

  it('refuses an empty or missing secret, which every payload would pass', () => {
    expect(() => expectNoSecret(expect, body(), '')).toThrow(TypeError)
    expect(() => expectNoSecret(expect, body(), undefined)).toThrow(TypeError)
  })
})
