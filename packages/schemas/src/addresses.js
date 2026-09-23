/**
 * Email addresses, as people who are not entitled to them see them.
 *
 * There are three representations. The rule for choosing is the smallest one
 * the screen can work with:
 *
 * - **No field at all.** The default. A team list for a colleague who cannot
 *   manage the team, an operations queue, anything that does not need to know
 *   whose address a row holds.
 * - **`Hidden email`.** For a screen that has to say an address exists without
 *   showing any of it.
 * - **`••••@example.com`.** Only where the domain is genuinely needed: the
 *   sender of a ticket transfer, who typed the address and has to tell their
 *   offers apart. Always four bullets.
 *
 * None of them reveals the local part's length, its first or last character,
 * an alias or a plus-suffix. Because every local part becomes the same four
 * bullets, none reveals whether two addresses at one domain are the same.
 *
 * The form this replaces, `p**********a@example.com`, kept the first and last
 * character and one star per hidden character. The Phase 3 closure audit
 * recorded that, and the owner asked for it to go.
 *
 * Browser-safe: no Node APIs, nothing beyond zod.
 *
 * @module @desi-event/schemas/addresses
 */

import { z } from 'zod'

/** What a screen shows in place of an address it may not show. */
export const HIDDEN_EMAIL = 'Hidden email'

/** The stand-in for any local part: four bullets, whatever its length. */
export const MASKED_LOCAL_PART = '••••'

/**
 * One run of address characters: no whitespace, no `@`, and none of the
 * brackets and punctuation that surround an address in running text. An
 * apostrophe is allowed, because `o'brien@example.com` is a real address and
 * stopping at the apostrophe would leave `o'` behind.
 */
const ADDRESS_ATOM = String.raw`[^\s@<>()\[\]{}",;:]+`

/**
 * An address inside free text.
 *
 * Deliberately broader than a validator. What it guards is text that was never
 * meant to hold an address, such as a display name somebody typed theirs into,
 * or a provider error quoting `<someone@example.com>`. So anything with a run of
 * characters either side of an `@`, and a dot in the domain, counts.
 */
const ADDRESS_IN_TEXT = `${ADDRESS_ATOM}@${ADDRESS_ATOM}\\.${ADDRESS_ATOM}`

/** A domain as the stand-in carries it: a dot, and nothing that ends it early. */
const DOMAIN = new RegExp(`^${ADDRESS_ATOM}\\.${ADDRESS_ATOM}$`, 'u')

/**
 * Whether a piece of text carries anything shaped like an address.
 *
 * @param {unknown} text The text.
 * @returns {boolean} True when an address appears anywhere in it.
 */
export function containsAddress(text) {
  return typeof text === 'string' && new RegExp(ADDRESS_IN_TEXT, 'u').test(text)
}

/**
 * Free text with every address in it replaced.
 *
 * For text shown next to hidden addresses: a display name that is an address
 * would otherwise put back exactly what the list withholds. The worker uses it
 * with its own marker for provider errors.
 *
 * @param {string|null|undefined} text The text.
 * @param {string} [replacement] What stands in for each address; {@link HIDDEN_EMAIL} by default.
 * @returns {string|null|undefined} The text without addresses; anything that is not a string, unchanged.
 */
export function withoutAddresses(text, replacement = HIDDEN_EMAIL) {
  if (typeof text !== 'string') return text

  return text.replace(new RegExp(ADDRESS_IN_TEXT, 'gu'), replacement)
}

/**
 * An address reduced to its domain: `••••@example.com`.
 *
 * `priya.sharma+tickets@example.com` and `p@example.com` both become
 * `••••@example.com`. The domain is lower-cased, so its case gives nothing away
 * either.
 *
 * @param {string|null|undefined} address The stored address.
 * @returns {string|null} The stand-in, or null when there is no usable domain.
 */
export function domainOnlyAddress(address) {
  if (typeof address !== 'string') return null

  const at = address.lastIndexOf('@')

  if (at < 1) return null

  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase()

  return DOMAIN.test(domain) ? `${MASKED_LOCAL_PART}@${domain}` : null
}

/**
 * `••••@example.com`, and nothing more.
 *
 * Four bullets, one `@`, a domain. The pattern allows no other local part, so a
 * presenter that dropped its masking call would fail this schema rather than
 * put an address in a response.
 */
export const domainOnlyAddressSchema = z
  .string()
  .max(260)
  .regex(/^••••@[^\s@•]+\.[^\s@•]+$/u, 'Expected ••••@ followed by a domain')

/** What a response carries in place of an address: `••••@domain` or `Hidden email`. */
export const addressStandInSchema = z.union([domainOnlyAddressSchema, z.literal(HIDDEN_EMAIL)])

/**
 * Refuse text that carries an address.
 *
 * For fields next to hidden addresses. The presenter replaces any address it
 * finds, and this is the second, structural check behind it: a presenter that
 * stopped doing so makes the response fail rather than leak.
 *
 * @param {object} schema A string schema.
 * @returns {object} The same schema, refusing any value with an address in it.
 */
export function addressFree(schema) {
  return schema.refine((text) => !containsAddress(text), 'Carries an email address')
}
