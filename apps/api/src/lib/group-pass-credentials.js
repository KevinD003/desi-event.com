/**
 * The group pass: one QR, and one printed code, for everybody on an order.
 *
 * Built exactly like a ticket's own pass (`./ticket-credentials.js`) and kept
 * apart from it on purpose.
 *
 * ## What the QR carries
 *
 * `G1.` and 43 base64url characters: `HMAC-SHA256(key, "group:<id>:<version>")`
 * under a key derived from `AUTH_SECRET` for the purpose `group-pass-v1`. The
 * `G1.` prefix is part of the secret rather than a claim about it — it lets the
 * door's camera route a scan to the group lookup, and the `.` can never occur
 * in a ticket credential, so the two shapes cannot be confused.
 *
 * ## The printed code
 *
 * `DEG-` and twelve characters from the ticket-code alphabet (about 60 bits,
 * the same as a ticket code), taken from `HMAC-SHA256(key', "group-code:<id>:
 * <version>")` under the purpose `group-pass-code-v1`. Typed by a steward when
 * the QR will not scan, so it avoids the characters people misread.
 *
 * ## Derived, never stored
 *
 * The database keeps `sha256(credential)` and `sha256(code)` and nothing else;
 * a CHECK refuses anything that is not 64 hex characters. Both values are
 * recomputed whenever the buyer opens the pass, and a version bump — replacing
 * the pass — changes both, so neither old value matches anything.
 *
 * ## Domain separation
 *
 * Distinct HKDF purposes and a distinct input tag. No ticket credential,
 * preview reference or group code can equal a group credential, and the other
 * way round.
 *
 * @module @desi-event/api/lib/group-pass-credentials
 */

import { createHmac } from 'node:crypto'

import { deriveSealingKey } from '@desi-event/auth'

import { CODE_ALPHABET } from './identifiers.js'
import { credentialDigest, credentialMatches } from './ticket-credentials.js'

/** The HKDF purpose for the group QR. */
export const GROUP_PASS_CREDENTIAL_PURPOSE = 'group-pass-v1'

/** The HKDF purpose for the printed group code. */
export const GROUP_PASS_CODE_PURPOSE = 'group-pass-code-v1'

/** What every group QR starts with. */
export const GROUP_CREDENTIAL_PREFIX = 'G1.'

/** What every printed group code starts with. */
export const GROUP_CODE_PREFIX = 'DEG-'

/** Characters after the prefix in a printed group code. */
const GROUP_CODE_LENGTH = 12

/**
 * Refuse inputs a pass could not have been minted from.
 *
 * @param {string} groupPassId The `GroupPass.id`.
 * @param {number} version The `GroupPass.credentialVersion`.
 * @returns {void}
 * @throws {TypeError} When either is unusable.
 */
function assertInputs(groupPassId, version) {
  if (typeof groupPassId !== 'string' || groupPassId === '') {
    throw new TypeError('A group pass id is required to mint a group credential.')
  }

  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError(`A group pass version must be a positive integer; received ${version}.`)
  }
}

/**
 * Mint the group QR content for one pass at one version.
 *
 * @param {object} options Options.
 * @param {string} options.secret The deployment's `AUTH_SECRET`.
 * @param {string} options.groupPassId The `GroupPass.id`.
 * @param {number} [options.version] The `GroupPass.credentialVersion`.
 * @returns {string} `G1.` and 43 base64url characters.
 */
export function mintGroupPassCredential({ secret, groupPassId, version = 1 }) {
  assertInputs(groupPassId, version)

  const key = deriveSealingKey(secret, GROUP_PASS_CREDENTIAL_PURPOSE)
  const mac = createHmac('sha256', key)
    .update(`group:${groupPassId}:${version}`)
    .digest('base64url')

  return `${GROUP_CREDENTIAL_PREFIX}${mac}`
}

/**
 * Mint the printed group code for one pass at one version.
 *
 * Each character comes from one byte of the MAC reduced onto the 32-character
 * alphabet. 256 is a multiple of 32, so the reduction is unbiased.
 *
 * @param {object} options Options.
 * @param {string} options.secret The deployment's `AUTH_SECRET`.
 * @param {string} options.groupPassId The `GroupPass.id`.
 * @param {number} [options.version] The `GroupPass.credentialVersion`.
 * @returns {string} `DEG-` and twelve characters.
 */
export function mintGroupCode({ secret, groupPassId, version = 1 }) {
  assertInputs(groupPassId, version)

  const key = deriveSealingKey(secret, GROUP_PASS_CODE_PURPOSE)
  const bytes = createHmac('sha256', key).update(`group-code:${groupPassId}:${version}`).digest()

  let body = ''

  for (let index = 0; index < GROUP_CODE_LENGTH; index += 1) {
    body += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length]
  }

  return `${GROUP_CODE_PREFIX}${body}`
}

/**
 * The digest stored for a printed group code.
 *
 * Trimmed and upper-cased first, as the request schema does, so a code typed
 * in lower case finds the same pass.
 *
 * @param {string} code The code as typed or printed.
 * @returns {string} Its SHA-256, hex.
 * @throws {TypeError} When the code is not a non-empty string.
 */
export function groupCodeDigest(code) {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new TypeError('A group code is required.')
  }

  return credentialDigest(code.trim().toUpperCase())
}

/**
 * Mint a group pass's QR content and printed code, with the digests to store.
 *
 * @param {object} options Options.
 * @param {string} options.secret The deployment's `AUTH_SECRET`.
 * @param {string} options.groupPassId The `GroupPass.id`.
 * @param {number} [options.version] The `GroupPass.credentialVersion`.
 * @returns {{credential: string, credentialHash: string, code: string, codeHash: string}} Plaintexts and digests.
 */
export function issueGroupPass({ secret, groupPassId, version = 1 }) {
  const credential = mintGroupPassCredential({ secret, groupPassId, version })
  const code = mintGroupCode({ secret, groupPassId, version })

  return {
    credential,
    credentialHash: credentialDigest(credential),
    code,
    codeHash: groupCodeDigest(code),
  }
}

export { credentialDigest as groupCredentialDigest, credentialMatches as groupCredentialMatches }
