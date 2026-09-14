/**
 * Hold ownership: who is allowed to release a reservation.
 *
 * A hold takes inventory out of circulation, so releasing one is a privileged
 * act even though taking one is not. Anyone may take a hold — checkout has to
 * work for a buyer who has not signed in — which means anonymous holds need an
 * owner too, or any caller who learns an id can free somebody else's seats.
 *
 * Two ownership paths, exactly one per hold (the `ticket_hold_single_owner`
 * check constraint enforces that in PostgreSQL, not just here):
 *
 *   * an authenticated buyer, recorded as `userId` from the verified server
 *     actor — never from anything in the request body;
 *   * a guest, recorded as the SHA-256 of a 256-bit token returned once at
 *     creation. The plaintext is never stored, so reading the table does not
 *     let you release or claim anyone's holds.
 *
 * @module @desi-event/inventory/ownership
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { InventoryError } from './errors.js'

/** How a release was authorised. */
export const HOLD_RELEASE_MODES = Object.freeze({
  OWNER: 'OWNER',
  GUEST: 'GUEST',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
})

/** Bytes of entropy in a guest hold token. */
const GUEST_TOKEN_BYTES = 32

/**
 * Mint a guest ownership token and the digest to store against the hold.
 *
 * @returns {{token: string, tokenHash: string}} The token to hand the caller once, and the digest to persist.
 */
export function createGuestHoldToken() {
  const token = randomBytes(GUEST_TOKEN_BYTES).toString('base64url')

  return { token, tokenHash: hashGuestHoldToken(token) }
}

/**
 * Hash a guest ownership token.
 *
 * @param {string} token The plaintext token.
 * @returns {string} Lower-case hex SHA-256 digest.
 * @throws {InventoryError} When the token is not a non-empty string.
 */
export function hashGuestHoldToken(token) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new InventoryError('A guest hold token is required', {
      code: 'INVALID_HOLD_TOKEN',
      statusCode: 400,
    })
  }

  return createHash('sha256').update(token).digest('hex')
}

/**
 * Compare two digests without leaking their contents through timing.
 *
 * @param {string|null|undefined} a First hex digest.
 * @param {string|null|undefined} b Second hex digest.
 * @returns {boolean} True when both are present and equal.
 */
export function digestsMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false

  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

/**
 * Decide the ownership columns for a hold being created.
 *
 * Identity comes from the verified actor or from a freshly minted guest token.
 * Nothing in the request body reaches these columns, so a caller cannot create
 * a hold owned by somebody else.
 *
 * @param {object} options Options.
 * @param {{id: string}|null} [options.actor] The verified server actor, if authenticated.
 * @returns {{ownership: {userId: string|null, guestTokenHash: string|null}, guestToken: string|null}} Columns to persist and the one-time token to return.
 */
export function resolveHoldOwnership({ actor } = {}) {
  if (actor?.id) {
    return { ownership: { userId: actor.id, guestTokenHash: null }, guestToken: null }
  }

  const { token, tokenHash } = createGuestHoldToken()

  return { ownership: { userId: null, guestTokenHash: tokenHash }, guestToken: token }
}

/**
 * Decide whether a caller may release a hold.
 *
 * Deliberately returns a decision rather than throwing, so the caller can give
 * the same answer for "no such hold" and "not yours". Distinguishing them turns
 * the endpoint into an oracle for which hold ids exist.
 *
 * @param {object} options Options.
 * @param {{userId: string|null, guestTokenHash: string|null}} options.hold The hold row.
 * @param {{id: string}|null} [options.actor] The verified server actor.
 * @param {string|null} [options.guestToken] A guest token supplied by the caller.
 * @param {boolean} [options.canOverride] Whether the actor holds the override capability.
 * @returns {{allowed: boolean, mode: string|null}} The decision and how it was reached.
 */
export function authorizeHoldRelease({ hold, actor, guestToken, canOverride = false } = {}) {
  if (!hold) return { allowed: false, mode: null }

  if (hold.userId && actor?.id && hold.userId === actor.id) {
    return { allowed: true, mode: HOLD_RELEASE_MODES.OWNER }
  }

  if (hold.guestTokenHash && typeof guestToken === 'string' && guestToken.length > 0) {
    let candidate = null
    try {
      candidate = hashGuestHoldToken(guestToken)
    } catch {
      candidate = null
    }

    if (candidate && digestsMatch(candidate, hold.guestTokenHash)) {
      return { allowed: true, mode: HOLD_RELEASE_MODES.GUEST }
    }
  }

  // The override is checked last so that an administrator releasing their own
  // hold is still recorded as the owner rather than as an override.
  if (canOverride) return { allowed: true, mode: HOLD_RELEASE_MODES.ADMIN }

  return { allowed: false, mode: null }
}
