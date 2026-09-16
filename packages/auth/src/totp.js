/**
 * Time-based one-time passwords, RFC 6238, and the recovery codes that go with
 * them.
 *
 * Written here rather than taken from a package because it is about eighty lines
 * of HMAC and a base32 alphabet, it sits in the authentication path where an
 * unreviewed transitive dependency is worth avoiding, and the specification is
 * fixed — there is no version of RFC 6238 to keep up with.
 *
 * What this module does *not* do, stated because the gap matters:
 *
 *   - It does not store anything. The caller persists the sealed secret and
 *     decides when a factor is confirmed.
 *   - It does not prevent replay. A TOTP code is valid for its whole window, so
 *     the same code works twice unless somebody records that it was used;
 *     {@link verifyTotp} returns the counter it matched precisely so the caller
 *     can store it and refuse a repeat. Verification alone is not enough.
 *   - It is not WebAuthn. The schema has a `WEBAUTHN` factor type because the
 *     boundary is worth having; there is no implementation, here or anywhere in
 *     this repository, and nothing claims otherwise.
 *
 * @module @desi-event/auth/totp
 */

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/** RFC 4648 base32, which is what every authenticator app reads. */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/**
 * TOTP parameters.
 *
 * SHA-1 and six digits over thirty seconds is what RFC 6238 specifies and what
 * every authenticator app implements. Choosing SHA-256 here would be
 * cryptographically tidier and would not work in Google Authenticator, which is
 * the wrong trade for a second factor people have to be able to enrol.
 *
 * `window` is how many steps either side of now are accepted: one step, so a
 * code entered up to thirty seconds late still works, and a clock thirty seconds
 * fast still works. Wider than that starts extending how long a phished code
 * stays useful.
 *
 * @type {Readonly<{digits: number, stepSeconds: number, window: number, algorithm: string, secretBytes: number}>}
 */
export const TOTP_PARAMETERS = Object.freeze({
  digits: 6,
  stepSeconds: 30,
  window: 1,
  algorithm: 'sha1',
  secretBytes: 20,
})

/**
 * Encode bytes as base32, unpadded.
 *
 * @param {Buffer} bytes The bytes to encode.
 * @returns {string} Base32, no padding.
 */
export function base32Encode(bytes) {
  let bits = 0
  let value = 0
  let output = ''

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]

  return output
}

/**
 * Decode base32 back to bytes.
 *
 * Tolerant of the things people do when they type a secret by hand: lower case,
 * spaces, and the `=` padding some apps show.
 *
 * @param {string} encoded Base32 text.
 * @returns {Buffer} The bytes.
 * @throws {TypeError} When the text contains something that is not base32.
 */
export function base32Decode(encoded) {
  const cleaned = String(encoded ?? '')
    .toUpperCase()
    .replace(/[\s=]/g, '')

  let bits = 0
  let value = 0
  const bytes = []

  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character)
    if (index === -1) throw new TypeError(`"${character}" is not a base32 character.`)

    value = (value << 5) | index
    bits += 5

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }

  return Buffer.from(bytes)
}

/**
 * A new TOTP secret.
 *
 * @param {number} [bytes] Secret length in bytes. RFC 4226 requires at least 16; the default is 20, which is what SHA-1 HMAC uses as a block-sized key.
 * @returns {{secret: string, bytes: Buffer}} The base32 secret to show once, and its bytes.
 */
export function generateTotpSecret(bytes = TOTP_PARAMETERS.secretBytes) {
  const raw = randomBytes(bytes)

  return { secret: base32Encode(raw), bytes: raw }
}

/**
 * The counter value for a moment in time.
 *
 * @param {Date|number} at The moment.
 * @param {number} [stepSeconds] The step length.
 * @returns {number} The RFC 6238 time counter.
 */
export function counterAt(at, stepSeconds = TOTP_PARAMETERS.stepSeconds) {
  const milliseconds = at instanceof Date ? at.getTime() : Number(at)

  return Math.floor(milliseconds / 1000 / stepSeconds)
}

/**
 * The code for one counter value.
 *
 * @param {string|Buffer} secret The shared secret, base32 or bytes.
 * @param {number} counter The counter.
 * @param {object} [parameters] Override the TOTP parameters.
 * @returns {string} The code, zero-padded to the configured digit count.
 */
export function hotp(secret, counter, parameters = TOTP_PARAMETERS) {
  const key = Buffer.isBuffer(secret) ? secret : base32Decode(secret)
  const message = Buffer.alloc(8)

  // Counter is a 64-bit big-endian integer. Written as two 32-bit halves
  // because a bitwise shift in JavaScript is 32-bit and would silently wrap.
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  message.writeUInt32BE(counter % 2 ** 32, 4)

  const digest = createHmac(parameters.algorithm, key).update(message).digest()
  const offset = digest[digest.length - 1] & 15
  const truncated =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3]

  return String(truncated % 10 ** parameters.digits).padStart(parameters.digits, '0')
}

/**
 * The code for a moment in time.
 *
 * @param {string|Buffer} secret The shared secret.
 * @param {object} [options] Options.
 * @param {Date} [options.at] The moment.
 * @param {object} [options.parameters] Override the TOTP parameters.
 * @returns {string} The code.
 */
export function totp(secret, { at = new Date(), parameters = TOTP_PARAMETERS } = {}) {
  return hotp(secret, counterAt(at, parameters.stepSeconds), parameters)
}

/**
 * Check a code a person typed.
 *
 * Returns the counter it matched, not just a boolean, because a TOTP code is
 * valid for its whole window and therefore replayable. The caller stores the
 * counter and refuses anything not greater than the last one; without that step
 * a code captured from a screen works again for the rest of its window.
 *
 * @param {string|Buffer} secret The shared secret.
 * @param {string} code The code the person typed.
 * @param {object} [options] Options.
 * @param {Date} [options.at] The moment to check against.
 * @param {number|null} [options.lastCounter] The highest counter already accepted for this factor.
 * @param {object} [options.parameters] Override the TOTP parameters.
 * @returns {{valid: boolean, counter: number|null, reason: string|null}} The outcome.
 */
export function verifyTotp(
  secret,
  code,
  { at = new Date(), lastCounter = null, parameters = TOTP_PARAMETERS } = {},
) {
  const typed = String(code ?? '').replace(/\s/g, '')

  if (!new RegExp(`^[0-9]{${parameters.digits}}$`).test(typed)) {
    return { valid: false, counter: null, reason: 'malformed' }
  }

  const now = counterAt(at, parameters.stepSeconds)

  for (let offset = -parameters.window; offset <= parameters.window; offset += 1) {
    const counter = now + offset
    const expected = hotp(secret, counter, parameters)

    // Fixed-length strings of digits, so this is a safe constant-time compare.
    if (!timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(typed, 'utf8'))) continue

    if (lastCounter !== null && counter <= lastCounter) {
      return { valid: false, counter, reason: 'replayed' }
    }

    return { valid: true, counter, reason: null }
  }

  return { valid: false, counter: null, reason: 'mismatch' }
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * Contains the secret, so it is shown once during enrolment over TLS and never
 * logged, stored or emailed.
 *
 * @param {object} options Options.
 * @param {string} options.secret The base32 secret.
 * @param {string} options.account What to label the entry — an email address.
 * @param {string} options.issuer The product name.
 * @param {object} [options.parameters] Override the TOTP parameters.
 * @returns {string} The provisioning URI.
 */
export function totpUri({ secret, account, issuer, parameters = TOTP_PARAMETERS }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: parameters.algorithm.toUpperCase(),
    digits: String(parameters.digits),
    period: String(parameters.stepSeconds),
  })

  return `otpauth://totp/${label}?${query.toString()}`
}

/** How many recovery codes an enrolment produces. */
export const RECOVERY_CODE_COUNT = 10

/** Characters recovery codes are drawn from: no 0/O, no 1/I/L. */
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/**
 * A set of single-use recovery codes.
 *
 * Grouped in fours with a hyphen because somebody has to read these off paper
 * and type them under stress. The alphabet excludes the character pairs people
 * mistake for each other, for the same reason.
 *
 * @param {number} [count] How many to generate.
 * @returns {string[]} The codes, to show once.
 */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT) {
  const codes = []

  for (let index = 0; index < count; index += 1) {
    let code = ''

    for (let position = 0; position < 12; position += 1) {
      if (position > 0 && position % 4 === 0) code += '-'
      code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]
    }

    codes.push(code)
  }

  return codes
}

/**
 * A recovery code as it should be compared: case and hyphens are not part of it.
 *
 * @param {string} code The code as typed.
 * @returns {string} The canonical form.
 */
export function normalizeRecoveryCode(code) {
  return String(code ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
}
