/**
 * Encryption at rest for the few secrets that cannot be hashed.
 *
 * Almost everything this system stores about a credential is a one-way digest:
 * passwords, session tokens, reset links. A TOTP secret is the exception. It is a
 * *shared* secret — the server has to reproduce the same codes the phone
 * produces, so it has to be able to read it back. Hashing is not available, and
 * storing it in plaintext means a database dump is a set of working second
 * factors.
 *
 * So it is sealed: AES-256-GCM with a key derived from the deployment's sealing
 * secret, and the nonce and authentication tag stored alongside the ciphertext.
 * The honest description of what this buys is narrow and worth stating: it
 * protects the secret against somebody who obtains the database *without* the
 * application's environment. It does not protect it against somebody who has
 * both. That is the difference between a leaked backup and a compromised server,
 * and only the first one is in scope here.
 *
 * The key is derived rather than used directly, so the deployment's sealing
 * secret can be any sufficiently long string rather than exactly 32 bytes, and
 * so the same secret used for a different purpose yields a different key.
 *
 * @module @desi-event/auth/sealing
 */

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

/** The sealed-value format, so a future change is a new version rather than a guess. */
export const SEAL_PREFIX = 'aesgcm$1'

/** Bytes in the GCM nonce. Twelve is what GCM is specified for. */
const NONCE_BYTES = 12

/** Minimum length of a deployment's sealing secret. */
export const MINIMUM_SEALING_SECRET_LENGTH = 32

/**
 * Derive the 256-bit key for one purpose from the deployment's sealing secret.
 *
 * @param {string} secret The deployment's sealing secret.
 * @param {string} purpose What the key is for, so two purposes cannot share a key.
 * @returns {Buffer} A 32-byte key.
 * @throws {TypeError} When the secret is missing or too short to be a secret.
 */
export function deriveSealingKey(secret, purpose) {
  if (typeof secret !== 'string' || secret.length < MINIMUM_SEALING_SECRET_LENGTH) {
    throw new TypeError(
      `A sealing secret of at least ${MINIMUM_SEALING_SECRET_LENGTH} characters is required. ` +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
    )
  }

  if (typeof purpose !== 'string' || purpose === '') {
    throw new TypeError('A sealing purpose is required, so that two uses cannot share a key.')
  }

  return Buffer.from(hkdfSync('sha256', secret, 'desi-event/seal', purpose, 32))
}

/**
 * Seal a value.
 *
 * @param {string} plaintext The value to protect. Never logged.
 * @param {object} options Options.
 * @param {string} options.secret The deployment's sealing secret.
 * @param {string} options.purpose What this value is, e.g. `mfa-totp`.
 * @returns {string} `aesgcm$1$nonce$tag$ciphertext`, base64url throughout. Safe to store.
 */
export function seal(plaintext, { secret, purpose }) {
  const key = deriveSealingKey(secret, purpose)
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])

  return [
    SEAL_PREFIX,
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('$')
}

/**
 * Open a sealed value.
 *
 * A wrong key, a truncated value or a tampered ciphertext all fail the GCM tag
 * check and all raise the same error. There is no path that returns a partially
 * decrypted value.
 *
 * @param {string} sealed A string produced by {@link seal}.
 * @param {object} options Options.
 * @param {string} options.secret The deployment's sealing secret.
 * @param {string} options.purpose The purpose it was sealed for.
 * @returns {string} The plaintext.
 * @throws {Error} When the value is not ours, or does not authenticate.
 */
export function unseal(sealed, { secret, purpose }) {
  const parts = String(sealed ?? '').split('$')

  if (parts.length !== 5 || `${parts[0]}$${parts[1]}` !== SEAL_PREFIX) {
    throw new Error('This value was not sealed by this module.')
  }

  const key = deriveSealingKey(secret, purpose)
  const nonce = Buffer.from(parts[2], 'base64url')
  const tag = Buffer.from(parts[3], 'base64url')
  const ciphertext = Buffer.from(parts[4], 'base64url')

  if (nonce.length !== NONCE_BYTES || tag.length !== 16) {
    throw new Error('This sealed value is malformed.')
  }

  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(tag)

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    // Deliberately uniform: a wrong key and a tampered ciphertext are the same
    // answer, and neither says which byte failed.
    throw new Error('This sealed value did not authenticate.')
  }
}

/**
 * Whether two sealed values protect the same plaintext.
 *
 * Not answerable by comparing ciphertexts — a fresh nonce each time means the
 * same plaintext seals differently every time, which is the point. So both are
 * opened. Used to stop the same TOTP secret being enrolled twice.
 *
 * @param {string} left One sealed value.
 * @param {string} right The other.
 * @param {object} options Options, as {@link unseal}.
 * @param {string} options.secret The deployment's sealing secret.
 * @param {string} options.purpose The purpose both were sealed for.
 * @returns {boolean} True when the plaintexts match.
 */
export function sealsMatch(left, right, options) {
  try {
    const a = Buffer.from(unseal(left, options), 'utf8')
    const b = Buffer.from(unseal(right, options), 'utf8')

    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}
