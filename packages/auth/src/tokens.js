/**
 * Secrets that travel: session cookies, reset links, verification links, ticket
 * claim codes.
 *
 * One rule runs through all of them. **The database stores a digest, never the
 * secret.** A reset link in an email, a session cookie in a browser and a claim
 * code in a QR are all bearer secrets; a dump of the `AuthToken` or `Session`
 * table must not let the reader sign in as anybody. So the secret exists once,
 * in the response that hands it over, and what persists is SHA-256 of it.
 *
 * SHA-256 rather than a password hash, deliberately: these secrets are 256 bits
 * of `randomBytes`, so there is no dictionary to attack and no work factor worth
 * paying on every request. A password is low-entropy and needs scrypt; a
 * 256-bit random token needs only that the digest be one-way and the lookup be
 * fast enough to do on every request.
 *
 * @module @desi-event/auth/tokens
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Bytes of entropy in a generated secret.
 *
 * 32 bytes, so a token is 256 bits. Guessing one is not a threat model.
 *
 * @type {number}
 */
export const TOKEN_BYTES = 32

/**
 * How long each kind of single-use token stays usable, in milliseconds.
 *
 * Short where the secret travels through somebody's inbox, longer where a
 * person has to act on it at a venue.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const TOKEN_LIFETIMES = Object.freeze({
  EMAIL_VERIFICATION: 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 30 * 60 * 1000,
  TICKET_CLAIM: 30 * 24 * 60 * 60 * 1000,
  TICKET_TRANSFER: 7 * 24 * 60 * 60 * 1000,
  CONNECT_ONBOARDING: 10 * 60 * 1000,
})

/**
 * A new bearer secret, and the digest to store for it.
 *
 * @param {number} [bytes] Entropy in bytes.
 * @returns {{secret: string, hash: string}} The secret to hand over once, and the digest to persist.
 */
export function issueToken(bytes = TOKEN_BYTES) {
  const secret = randomBytes(bytes).toString('base64url')

  return { secret, hash: hashToken(secret) }
}

/**
 * The digest of a secret, as stored.
 *
 * @param {string} secret The bearer secret.
 * @returns {string} Lower-case hex SHA-256, 64 characters.
 */
export function hashToken(secret) {
  return createHash('sha256').update(String(secret), 'utf8').digest('hex')
}

/**
 * Whether two digests are equal, without leaking where they differ.
 *
 * Both arguments are hex digests of fixed length, so this is a fixed-length
 * comparison — which is what `timingSafeEqual` requires.
 *
 * @param {string} left One digest.
 * @param {string} right The other digest.
 * @returns {boolean} True when they match.
 */
export function tokensMatch(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  if (left.length !== right.length || left.length === 0) return false

  return timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

/**
 * When a token of this purpose issued now should stop working.
 *
 * @param {string} purpose An `AuthTokenPurpose`.
 * @param {Date} [now] The current time.
 * @returns {Date} The expiry.
 * @throws {RangeError} When the purpose has no configured lifetime, so a typo cannot silently mean "forever".
 */
export function tokenExpiry(purpose, now = new Date()) {
  const lifetime = TOKEN_LIFETIMES[purpose]

  if (lifetime === undefined) {
    throw new RangeError(
      `No lifetime is configured for the token purpose "${purpose}". ` +
        'Add one to TOKEN_LIFETIMES rather than letting the token outlive its reason to exist.',
    )
  }

  return new Date(now.getTime() + lifetime)
}

/**
 * Whether a stored token row may be redeemed.
 *
 * Every reason a token is unusable is enumerated, and the caller gets the reason
 * rather than a boolean, because "this link has expired" and "this link has
 * already been used" are different things to tell somebody — and because the
 * audit record should say which one happened.
 *
 * Single use is enforced here *and* by the caller's conditional update: this
 * function reads a row, and two requests can read the same unused row at the
 * same time. The claim that makes a token single-use is the `updateMany` with
 * `usedAt: null` in its filter, not this check.
 *
 * @param {object|null|undefined} token An `AuthToken` row.
 * @param {object} [options] Options.
 * @param {string} [options.purpose] The purpose the caller expects.
 * @param {Date} [options.now] The current time.
 * @returns {{usable: boolean, reason: string|null}} Whether it may be redeemed, and why not.
 */
export function tokenUsable(token, { purpose, now = new Date() } = {}) {
  if (!token) return { usable: false, reason: 'unknown' }
  if (purpose && token.purpose !== purpose) return { usable: false, reason: 'wrong_purpose' }
  if (token.revokedAt) return { usable: false, reason: 'revoked' }
  if (token.usedAt) return { usable: false, reason: 'already_used' }
  if (!(token.expiresAt instanceof Date)) return { usable: false, reason: 'malformed' }
  if (token.expiresAt.getTime() <= now.getTime()) return { usable: false, reason: 'expired' }

  return { usable: true, reason: null }
}

/**
 * A keyed digest of a value that identifies a person but must not be readable.
 *
 * Used for the email address and IP address on `LoginAttempt`, and for the IP on
 * `Session`. Throttling needs to recognise "the same address again"; it does not
 * need to know the address. A keyed digest gives the first without the second,
 * and the key makes the digest useless outside this deployment — a bare
 * SHA-256 of an IPv4 address is reversible by anybody with an afternoon and four
 * billion guesses.
 *
 * @param {string} value The identifying value.
 * @param {string} key The deployment's digest key.
 * @returns {string} Lower-case hex SHA-256 of key and value.
 * @throws {TypeError} When the key is missing, because an unkeyed digest here is reversible.
 */
export function pseudonymize(value, key) {
  if (typeof key !== 'string' || key.length < 16) {
    throw new TypeError(
      'A pseudonymisation key of at least 16 characters is required: an unkeyed digest of an ' +
        'email address or an IP address can be reversed by exhaustion.',
    )
  }

  // The separator keeps the key and the value from running together, so that
  // ('ab', 'c') and ('a', 'bc') cannot produce the same digest.
  return createHash('sha256')
    .update(key, 'utf8')
    .update(Buffer.from([0]))
    .update(String(value ?? ''), 'utf8')
    .digest('hex')
}
