/**
 * The bearer credential encoded into a ticket's QR pass.
 *
 * ## What is stored, and what is not
 *
 * A QR pass is a bearer token: whoever shows it gets in. So the plaintext must
 * not sit in the database, where a leaked backup would become a set of working
 * admissions. `Ticket.credentialHash` holds a SHA-256 of it and nothing else.
 *
 * That alone would make the pass unshowable a second time — you cannot recover
 * a preimage from a digest, so a buyer who closed the tab would have lost their
 * ticket. The usual answers are both bad: store the plaintext (defeats the
 * point) or store it encrypted (the same key unlocks every pass at once, and
 * now there is a ciphertext blob to leak as well).
 *
 * Instead the credential is *derived*, not generated:
 *
 *   credential = base64url(HMAC-SHA256(key, ticketId + ':' + version))
 *   key        = HKDF(AUTH_SECRET, purpose "ticket-pass")
 *
 * The server can recompute any pass for an authorised holder at any time. The
 * database holds only digests. Rotation is a version bump, which changes the
 * credential and therefore the digest, so an old screenshot stops working the
 * moment a ticket is transferred or re-issued.
 *
 * The honest limit, stated rather than implied: this protects passes against
 * somebody who obtains the database *without* the application's environment. It
 * does not protect them against somebody who has both. That is the same
 * boundary {@link module:@desi-event/auth/sealing} draws, and for the same
 * reason — it is the difference between a leaked backup and a compromised
 * server, and only the first is in scope.
 *
 * ## What the QR carries
 *
 * The credential and nothing else. No name, no price, no order reference, no
 * ticket id, no claim about what the holder is entitled to. A scanner sends the
 * string; the server hashes it, finds the ticket by digest, and decides. A pass
 * that carried its own authorisation would be a pass a determined holder could
 * rewrite.
 *
 * @module @desi-event/api/lib/ticket-credentials
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { deriveSealingKey } from '@desi-event/auth'

/**
 * The HKDF purpose label.
 *
 * Distinct from every other use of `AUTH_SECRET`, so a value derived for one
 * purpose cannot be produced by code deriving another. Changing this string
 * invalidates every outstanding pass, which is why it carries a version.
 *
 * @type {string}
 */
export const TICKET_CREDENTIAL_PURPOSE = 'ticket-pass-v1'

/**
 * Mint the credential for one ticket at one credential version.
 *
 * Deterministic on purpose: the same ticket and version always yield the same
 * string, which is what lets a buyer reopen their pass on a new device without
 * anything having been stored that a thief could use.
 *
 * @param {object} options Options.
 * @param {string} options.secret The deployment's `AUTH_SECRET`.
 * @param {string} options.ticketId The `Ticket.id`.
 * @param {number} [options.version] The `Ticket.credentialVersion`. Defaults to 1.
 * @returns {string} The credential, 43 base64url characters.
 * @throws {TypeError} When the secret is missing or too short, or the ticket id is empty.
 */
export function mintTicketCredential({ secret, ticketId, version = 1 }) {
  if (typeof ticketId !== 'string' || ticketId === '') {
    throw new TypeError('A ticket id is required to mint a credential.')
  }

  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError(`A credential version must be a positive integer; received ${version}.`)
  }

  const key = deriveSealingKey(secret, TICKET_CREDENTIAL_PURPOSE)

  return createHmac('sha256', key).update(`${ticketId}:${version}`).digest('base64url')
}

/**
 * The digest stored on the ticket.
 *
 * @param {string} credential The plaintext credential.
 * @returns {string} Its SHA-256, hex, 64 characters.
 * @throws {TypeError} When the credential is not a non-empty string.
 */
export function credentialDigest(credential) {
  if (typeof credential !== 'string' || credential === '') {
    throw new TypeError('A credential is required.')
  }

  return createHash('sha256').update(credential).digest('hex')
}

/**
 * Mint a credential and its digest together.
 *
 * Callers issuing a ticket want both — the digest to store, the plaintext to
 * hand to the buyer exactly once per view — and pairing them here stops a
 * caller storing the plaintext by mistake.
 *
 * @param {object} options Options, as {@link mintTicketCredential}.
 * @param {string} options.secret The deployment's `AUTH_SECRET`.
 * @param {string} options.ticketId The `Ticket.id`.
 * @param {number} [options.version] The `Ticket.credentialVersion`.
 * @returns {{credential: string, credentialHash: string}} Plaintext and digest.
 */
export function issueTicketCredential({ secret, ticketId, version = 1 }) {
  const credential = mintTicketCredential({ secret, ticketId, version })

  return { credential, credentialHash: credentialDigest(credential) }
}

/**
 * Whether a presented credential is the one this ticket's digest was made from.
 *
 * Compared in constant time. A scanner that could time the comparison could
 * otherwise recover a digest character by character, and a digest is enough to
 * find the ticket even though it is not enough to open the door.
 *
 * @param {string} presented The credential a scanner sent.
 * @param {string|null|undefined} storedHash The ticket's `credentialHash`.
 * @returns {boolean} True when they match. False for anything malformed.
 */
export function credentialMatches(presented, storedHash) {
  if (typeof presented !== 'string' || presented === '') return false
  if (typeof storedHash !== 'string' || storedHash.length !== 64) return false

  const computed = Buffer.from(credentialDigest(presented), 'utf8')
  const stored = Buffer.from(storedHash, 'utf8')

  if (computed.length !== stored.length) return false

  return timingSafeEqual(computed, stored)
}
