/**
 * Ticket code generation.
 *
 * The alphabet matches the one the API uses for order references: `0/O` and
 * `1/I` are omitted because these strings are read aloud at a box office and
 * typed into a phone by someone standing in a queue. A code that cannot be
 * mis-transcribed is worth more than a few extra bits of entropy.
 *
 * Randomness comes from `node:crypto`, not `Math.random`. A ticket code is a
 * bearer token — anyone holding it can walk through the door — so a guessable
 * sequence is a free-entry bug, not a cosmetic one.
 *
 * @module @desi-event/worker/ticket-codes
 */

import { randomInt } from 'node:crypto'

/** Unambiguous upper-case alphabet, 32 symbols so each character is 5 bits. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** Marks the string as a Desi-Event *ticket*, as opposed to an order reference. */
export const TICKET_CODE_PREFIX = 'DET-'

/** Random characters per code. 32^14 ≈ 2^70, so collisions stay theoretical. */
export const TICKET_CODE_LENGTH = 14

/**
 * Generate one ticket code, e.g. `DET-9K2QRT8F3K2QRT`.
 *
 * @param {object} [options] Overrides.
 * @param {function(number): number} [options.random] Source of randomness taking an exclusive upper bound; injected by tests.
 * @returns {string} A code matching `ticketCodeSchema`.
 */
export function generateTicketCode(options = {}) {
  const { random = randomInt } = options

  let body = ''
  for (let index = 0; index < TICKET_CODE_LENGTH; index += 1) {
    body += CODE_ALPHABET[random(CODE_ALPHABET.length)]
  }

  return `${TICKET_CODE_PREFIX}${body}`
}

/**
 * Generate a batch of distinct ticket codes.
 *
 * Duplicates within a batch are rejected and retried rather than written and
 * left for the database's unique index to reject, because a `createMany` that
 * fails halfway is far more expensive to reason about than one extra draw.
 *
 * @param {number} count How many codes to produce.
 * @param {object} [options] Overrides forwarded to {@link generateTicketCode}.
 * @returns {string[]} `count` distinct codes.
 * @throws {RangeError} When `count` is not a non-negative integer.
 * @throws {Error} When distinct codes cannot be drawn, which indicates a broken randomness source.
 */
export function generateTicketCodes(count, options = {}) {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`generateTicketCodes expects a non-negative integer, received ${count}`)
  }

  /** @type {Set<string>} */
  const codes = new Set()
  const maxDraws = count * 10 + 10

  for (let draws = 0; codes.size < count && draws < maxDraws; draws += 1) {
    codes.add(generateTicketCode(options))
  }

  if (codes.size < count) {
    throw new Error(
      `Could not generate ${count} distinct ticket codes; the randomness source is degenerate`,
    )
  }

  return [...codes]
}
