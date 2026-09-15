/**
 * Password hashing, and the reason it is not bcrypt any more.
 *
 * Phase 1 used bcrypt at cost 10. bcrypt's work factor is time only: it uses a
 * fixed 4 KiB of memory whatever the cost, which is precisely the shape of
 * problem a GPU or an ASIC is good at. A memory-hard function makes each guess
 * cost memory as well as time, and memory is the expensive thing to parallelise.
 *
 * This module uses **scrypt**, from Node's own `crypto`. The alternative worth
 * considering was Argon2id, which is the current recommendation; it is not used
 * here because every Node implementation of it is a native addon, and a native
 * addon in the login path is a build dependency, a prebuild matrix and a supply
 * chain for the one function that must never stop working. scrypt is memory-hard,
 * standardised (RFC 7914), and already in the runtime. The parameters below are
 * the tunable part, and the encoding records them per hash so raising them later
 * does not invalidate anybody's password.
 *
 * Nothing here is reversible and nothing here is logged. The only values that
 * leave this module are the encoded hash — which is safe to store — and a
 * boolean.
 *
 * @module @desi-event/auth/password
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

/**
 * scrypt parameters.
 *
 * `N` (cost) is the memory/time knob: memory used is roughly
 * `128 * N * r` bytes, so N=2^15 with r=8 is about 32 MiB per hash. That is
 * ~100ms on a modern server core and 32 MiB an attacker must find for every
 * guess in flight, which is the property bcrypt does not have.
 *
 * `maxmem` has to be raised from Node's 32 MiB default, because the default is
 * *exactly* the amount this costs and the check is `>`, not `>=`.
 *
 * @type {Readonly<{N: number, r: number, p: number, keyLength: number, saltLength: number, maxmem: number}>}
 */
export const SCRYPT_PARAMETERS = Object.freeze({
  N: 32_768,
  r: 8,
  p: 1,
  keyLength: 32,
  saltLength: 16,
  maxmem: 96 * 1024 * 1024,
})

/**
 * The identifier at the front of every hash this module writes.
 *
 * Versioned so that a future change of algorithm or parameters is a new prefix
 * rather than an ambiguous string, and so {@link needsRehash} can recognise an
 * older one.
 *
 * @type {string}
 */
export const HASH_PREFIX = 'scrypt$1'

/**
 * Prefix of the bcrypt hashes Phase 1 wrote.
 *
 * Recognised so that {@link verifyPassword} can tell a caller "this password is
 * correct, and its hash is out of date" rather than failing. Verifying one needs
 * bcrypt, which this module does not depend on, so the API layer supplies a
 * verifier — see {@link verifyPassword}.
 *
 * @type {RegExp}
 */
export const LEGACY_BCRYPT = /^\$2[aby]\$/

/**
 * A hash of a password nobody has.
 *
 * Sign-in verifies against this when the email is unknown, so an unregistered
 * address costs the same ~100ms as a registered one. Generated once at module
 * load from random bytes: there is no password that matches it, and there is no
 * constant in the source for somebody to recognise.
 *
 * @type {Promise<string>}
 */
let decoyPromise = null

/**
 * Encode a hash and the parameters that produced it.
 *
 * @param {Buffer} salt The salt.
 * @param {Buffer} derived The derived key.
 * @param {object} parameters The scrypt parameters used.
 * @returns {string} `scrypt$1$N$r$p$salt$hash`, base64url throughout.
 */
function encode(salt, derived, parameters) {
  return [
    HASH_PREFIX,
    parameters.N,
    parameters.r,
    parameters.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$')
}

/**
 * Read back an encoded hash.
 *
 * @param {string} encoded A string produced by {@link hashPassword}.
 * @returns {{N: number, r: number, p: number, salt: Buffer, derived: Buffer}|null} The parts, or null when the string is not one of ours.
 */
export function decodePasswordHash(encoded) {
  if (typeof encoded !== 'string') return null

  const parts = encoded.split('$')
  if (parts.length !== 7) return null
  if (`${parts[0]}$${parts[1]}` !== HASH_PREFIX) return null

  const [, , rawN, rawR, rawP, rawSalt, rawDerived] = parts
  const N = Number(rawN)
  const r = Number(rawR)
  const p = Number(rawP)

  if (![N, r, p].every((value) => Number.isSafeInteger(value) && value > 0)) return null

  try {
    const salt = Buffer.from(rawSalt, 'base64url')
    const derived = Buffer.from(rawDerived, 'base64url')

    if (salt.length === 0 || derived.length === 0) return null

    return { N, r, p, salt, derived }
  } catch {
    return null
  }
}

/**
 * Hash a password.
 *
 * @param {string} password The plaintext password. Never logged, never stored.
 * @param {object} [parameters] Override the scrypt parameters, for tests.
 * @returns {Promise<string>} The encoded hash, safe to store.
 * @throws {TypeError} When the password is not a non-empty string.
 */
export async function hashPassword(password, parameters = SCRYPT_PARAMETERS) {
  if (typeof password !== 'string' || password === '') {
    throw new TypeError('A password must be a non-empty string.')
  }

  const salt = randomBytes(parameters.saltLength ?? SCRYPT_PARAMETERS.saltLength)
  const derived = await scrypt(password, salt, parameters.keyLength ?? 32, {
    N: parameters.N,
    r: parameters.r,
    p: parameters.p,
    maxmem: parameters.maxmem ?? SCRYPT_PARAMETERS.maxmem,
  })

  return encode(salt, derived, parameters)
}

/**
 * Whether a stored hash should be replaced the next time its password is known.
 *
 * True for a bcrypt hash carried over from Phase 1, and true for one of ours
 * written with weaker parameters than the current ones. A correct password with
 * an out-of-date hash is a successful sign-in *and* an upgrade, which is the only
 * moment the plaintext is available to do it.
 *
 * @param {string} encoded The stored hash.
 * @param {object} [parameters] The parameters to compare against.
 * @returns {boolean} True when the hash is not at current strength.
 */
export function needsRehash(encoded, parameters = SCRYPT_PARAMETERS) {
  if (typeof encoded !== 'string' || encoded === '') return true
  if (LEGACY_BCRYPT.test(encoded)) return true

  const decoded = decodePasswordHash(encoded)
  if (!decoded) return true

  return decoded.N < parameters.N || decoded.r < parameters.r || decoded.p < parameters.p
}

/**
 * The decoy hash, computed once.
 *
 * @returns {Promise<string>} An encoded hash of random bytes.
 */
export async function decoyHash() {
  decoyPromise ??= hashPassword(randomBytes(32).toString('base64url'))

  return decoyPromise
}

/**
 * Verify a password against a stored hash.
 *
 * Returns a result rather than a boolean, because a sign-in needs to know four
 * things and not one:
 *
 *   - `valid` — whether the password is right.
 *   - `rehash` — whether a *successful* sign-in should replace the stored hash.
 *     Strictly `false` when the password was wrong: a rehash needs the plaintext
 *     and the plaintext is only known to be right when the comparison succeeded.
 *   - `legacy` — whether the stored hash was one of Phase 1's bcrypt hashes.
 *   - `unusable` — whether the stored value could be read as a hash at all. This
 *     is about the row, not the attempt: it stays `false` for a wrong password
 *     against a good hash, and `true` for a row with no password, an empty
 *     string, or a string from some other system. Worth logging; never worth
 *     telling the caller.
 *
 * A `null`, empty or unreadable stored hash still costs a full derivation, so a
 * user row with no password does not answer faster than one with a password.
 *
 * @param {string} password The plaintext password supplied by the caller.
 * @param {string|null|undefined} encoded The stored hash.
 * @param {object} [options] Options.
 * @param {function(string, string): Promise<boolean>} [options.verifyLegacy] Verifier for a Phase 1 bcrypt hash. Without it, a bcrypt hash cannot match.
 * @returns {Promise<{valid: boolean, rehash: boolean, legacy: boolean, unusable: boolean}>} The outcome.
 */
export async function verifyPassword(password, encoded, { verifyLegacy } = {}) {
  const supplied = typeof password === 'string' ? password : ''
  const present = typeof encoded === 'string' && encoded !== ''
  const stored = present ? encoded : await decoyHash()
  const legacy = LEGACY_BCRYPT.test(stored)

  if (legacy) {
    // A carried-over bcrypt hash. Without a verifier there is nothing this
    // module can do with it, and saying "wrong password" is the safe answer —
    // but it must still cost what a real comparison costs.
    if (typeof verifyLegacy !== 'function') {
      await hashPassword(supplied === '' ? 'decoy' : supplied)

      return { valid: false, rehash: false, legacy: true, unusable: true }
    }

    const valid = await verifyLegacy(supplied, stored)

    return { valid, rehash: valid, legacy: true, unusable: false }
  }

  const decoded = decodePasswordHash(stored)

  if (!decoded) {
    // Unreadable. Spend the time anyway, then refuse.
    await hashPassword(supplied === '' ? 'decoy' : supplied)

    return { valid: false, rehash: false, legacy: false, unusable: true }
  }

  const derived = await scrypt(supplied, decoded.salt, decoded.derived.length, {
    N: decoded.N,
    r: decoded.r,
    p: decoded.p,
    maxmem: SCRYPT_PARAMETERS.maxmem,
  })

  const valid = timingSafeEqual(derived, decoded.derived)

  return {
    valid,
    rehash: valid && needsRehash(stored),
    legacy: false,
    // The decoy is a perfectly readable hash, so `decoded` says nothing about
    // whether the *row* had one. That is what `present` is for.
    unusable: !present,
  }
}
