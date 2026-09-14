/**
 * Customer-facing identifiers: order references and ticket codes.
 *
 * Both are generated from a deliberately reduced alphabet. `0/O` and `1/I` are
 * omitted because these strings get read aloud at a box office and typed into
 * a phone by someone standing in a queue; a code that cannot be mis-transcribed
 * is worth more than four extra bits of entropy.
 *
 * @module @desi-event/api/lib/identifiers
 */

import { customAlphabet } from 'nanoid'

/** Unambiguous upper-case alphabet shared by every generated code. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** Prefix that marks a string as a Desi-Event identifier. */
export const CODE_PREFIX = 'DE'

/** Random characters in an order reference. */
const REFERENCE_LENGTH = 8

/** Random characters in a ticket code. 32^14 keeps collisions theoretical. */
const TICKET_CODE_LENGTH = 14

const referenceBody = customAlphabet(CODE_ALPHABET, REFERENCE_LENGTH)
const ticketCodeBody = customAlphabet(CODE_ALPHABET, TICKET_CODE_LENGTH)

/**
 * Generate a customer-facing order reference, e.g. `DE-8F3K2QRT`.
 *
 * @returns {string} A reference matching `orderReferenceSchema`.
 */
export function generateOrderReference() {
  return `${CODE_PREFIX}-${referenceBody()}`
}

/**
 * Generate a ticket code, e.g. `DET-9K2QRT8F3K2QRT`.
 *
 * The `T` distinguishes a ticket code from an order reference at a glance, so
 * a buyer who reads the wrong one to the door staff is told why immediately.
 *
 * @returns {string} A code matching `ticketCodeSchema`.
 */
export function generateTicketCode() {
  return `${CODE_PREFIX}T-${ticketCodeBody()}`
}

/**
 * Derive a URL slug from a title.
 *
 * Diacritics are folded rather than dropped so that `Café Night` becomes
 * `cafe-night` instead of `caf-night`.
 *
 * @param {string} title The human-readable title.
 * @returns {string} A slug matching `slugSchema`, truncated to 140 characters.
 * @throws {Error} When the title contains no slug-able characters at all.
 */
export function slugify(title) {
  const slug = String(title)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140)
    .replace(/-+$/g, '')

  if (slug === '') {
    throw new Error('Cannot derive a slug from the supplied title; supply "slug" explicitly.')
  }

  return slug
}

/**
 * Append a short random suffix to a slug so a retry can avoid a collision.
 *
 * @param {string} slug The slug that collided.
 * @returns {string} The slug with a four-character suffix, still within 140 characters.
 */
export function disambiguateSlug(slug) {
  const suffix = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 4)()
  return `${slug.slice(0, 135)}-${suffix}`
}
