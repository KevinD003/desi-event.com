/**
 * Promo codes, in the words a buyer and an organiser read.
 *
 * The API stores a percentage as basis points (1000 is 10%) and a fixed amount
 * in minor units of its currency. Nobody types either: an organiser types
 * "10" or "5.00", and a buyer reads "10% off" or "$5.00 off". The conversions
 * live here, once, so the form, the table and the checkout say the same thing.
 *
 * Pure: safe in a browser bundle. A code is never put in a URL or in storage
 * by anything here.
 *
 * @module lib/promo
 */

import { currencyMinorDigits, parseMoneyInput } from './money.js'
import { formatPrice } from './pricing.js'
import { formatNightTime } from './sessions.js'
import { zoneAbbreviation } from './zoned-time.js'

/** The longest code the API accepts. */
export const PROMO_CODE_MAX_LENGTH = 32

/** The shortest code the API accepts. */
export const PROMO_CODE_MIN_LENGTH = 3

/** The largest fixed amount off the API accepts, in minor units: 100,000.00. */
export const MAX_FIXED_PROMO_CENTS = 10_000_000

/**
 * A code as the API stores it: trimmed and upper-cased.
 *
 * @param {string} text What was typed.
 * @returns {string} The normalised code.
 */
export function normalisePromoCode(text) {
  return String(text ?? '')
    .trim()
    .toUpperCase()
}

/**
 * Whether a typed code has the shape the API accepts: 3 to 32 of A–Z, 0–9, `_`
 * and `-`, after upper-casing.
 *
 * @param {string} text What was typed.
 * @returns {boolean} True when the API would take it.
 */
export function isPromoCodeShape(text) {
  return /^[A-Z0-9_-]{3,32}$/u.test(normalisePromoCode(text))
}

/**
 * A percentage typed by a person, as basis points.
 *
 * Up to two decimals ("12.5" is 1250); anything else, or outside (0, 100], is
 * refused rather than rounded into a different discount.
 *
 * @param {string|number} text The percentage.
 * @returns {number|null} Basis points, or null when it is not a usable percentage.
 */
export function percentToBps(text) {
  const value = String(text ?? '')
    .trim()
    .replace(/%$/u, '')
    .trim()

  if (!/^\d{1,3}(\.\d{1,2})?$/u.test(value)) return null

  const [whole, fraction = ''] = value.split('.')
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))

  return bps > 0 && bps <= 10_000 ? bps : null
}

/**
 * Basis points as a person reads them: `10%`, `12.5%`.
 *
 * @param {number} bps Basis points.
 * @returns {string} The percentage.
 */
export function bpsToPercentText(bps) {
  const value = Number(bps) / 100

  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))}%`
}

/**
 * An amount typed by a person, in minor units of a currency.
 *
 * @param {string} text The amount, e.g. `5` or `$5.00`.
 * @param {string} currency ISO 4217 code.
 * @returns {number|null} Minor units, or null when it is not a usable amount.
 */
export function amountToCents(text, currency) {
  const parsed = parseMoneyInput(text, currency)

  return Number.isInteger(parsed.cents) && parsed.cents > 0 && parsed.cents <= MAX_FIXED_PROMO_CENTS
    ? parsed.cents
    : null
}

/**
 * What a code takes off, in a phrase: `10% off`, `$5.00 off`.
 *
 * @param {{type: string, value: number, currency?: string|null}} code A promo code.
 * @returns {string} The phrase.
 */
export function describeDiscount(code) {
  if (code?.type === 'PERCENTAGE') return `${bpsToPercentText(code.value)} off`

  if (code?.type === 'FIXED_AMOUNT' && code.currency) {
    return `${formatPrice(code.value, code.currency)} off`
  }

  return 'Discount'
}

/** A code's status, in a word. */
const STATUS_WORDS = Object.freeze({
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  SCHEDULED: 'Scheduled',
  ENDED: 'Ended',
  USED_UP: 'Used up',
})

/**
 * A code's status as an organiser reads it, with the badge colour that goes
 * beside the word (never instead of it).
 *
 * @param {string} status A `PROMO_STATUSES` member.
 * @returns {{text: string, variant: string}} The word and its badge variant.
 */
export function promoStatusLabel(status) {
  const text = STATUS_WORDS[status] ?? 'Unknown'
  const variant =
    status === 'ACTIVE'
      ? 'success'
      : status === 'SCHEDULED'
        ? 'info'
        : status === 'USED_UP' || status === 'ENDED'
          ? 'neutral'
          : 'warning'

  return { text, variant }
}

/**
 * How many times a code has been used, against its cap: `3 of 50`, `3, no limit`.
 *
 * @param {{redemptionCount: number, maxRedemptions: number|null}} code A promo code.
 * @returns {string} The phrase.
 */
export function usesText(code) {
  const used = code?.redemptionCount ?? 0

  return Number.isInteger(code?.maxRedemptions)
    ? `${used} of ${code.maxRedemptions}`
    : `${used}, no limit`
}

/** Why a quote gave no discount, in a sentence a buyer can act on. */
const REASON_COPY = Object.freeze({
  UNKNOWN: 'That code is not valid for this event.',
  INACTIVE: 'The organiser has paused that code.',
  NOT_STARTED: 'That code has not started.',
  EXPIRED: 'That code has ended.',
  EXHAUSTED: 'That code has been used as many times as the organiser allowed.',
  CURRENCY_MISMATCH: 'That code cannot be used with this currency.',
  CURRENCY_MISSING: 'That code cannot be used with this currency.',
})

/**
 * The sentence for a quote's `promo.reason`.
 *
 * @param {string|null} reason A `PROMO_QUOTE_REASONS` member.
 * @returns {string} The sentence.
 */
export function reasonCopy(reason) {
  return REASON_COPY[reason] ?? 'That code gives no discount on this order.'
}

/**
 * What an applied code does, from the quote: `SAVE10 applied: 10% off.`
 *
 * @param {object} promo The quote's `promo`.
 * @param {string} currency The order's currency.
 * @returns {string} The sentence.
 */
export function appliedCopy(promo, currency) {
  if (Number.isInteger(promo?.percentBps)) {
    return `${promo.code} applied: ${bpsToPercentText(promo.percentBps)} off.`
  }

  if (Number.isInteger(promo?.amountCents)) {
    return `${promo.code} applied: ${formatPrice(promo.amountCents, currency)} off.`
  }

  return `${promo?.code ?? 'Code'} applied.`
}

/**
 * The value an organiser typed, in the unit the API stores.
 *
 * @param {object} form The form's values.
 * @param {'PERCENTAGE'|'FIXED_AMOUNT'} form.type What kind of discount.
 * @param {string} form.value What was typed.
 * @param {string} form.currency The fixed amount's currency.
 * @returns {number|null} Basis points or minor units, or null when unusable.
 */
export function promoValueFromForm({ type, value, currency }) {
  return type === 'PERCENTAGE' ? percentToBps(value) : amountToCents(value, currency)
}

/**
 * Whether a currency has minor units at all, for the amount box's hint.
 *
 * @param {string} currency ISO 4217 code.
 * @returns {boolean} True for a currency with cents.
 */
export function hasMinorUnits(currency) {
  return currencyMinorDigits(currency) > 0
}

/** The zone an organisation-wide code's window is read in when its events do not agree on one. */
export const FALLBACK_PROMO_ZONE = 'America/New_York'

/**
 * The zone an organisation-wide code's window is read in: the one its events
 * share, or a stated default when they do not share one.
 *
 * @param {Array<{timezone?: string}>} events The organisation's events.
 * @returns {string} An IANA zone.
 */
export function organisationZone(events = []) {
  const zones = new Set(events.map((event) => event.timezone).filter(Boolean))

  return zones.size === 1 ? [...zones][0] : FALLBACK_PROMO_ZONE
}

/**
 * A code's window, in words, in a stated zone.
 *
 * @param {{startsAt: string|null, endsAt: string|null}} code The code.
 * @param {string} zone The zone to read it in.
 * @returns {string} The window.
 */
export function promoWindowText(code, zone) {
  const at = new Date(code?.startsAt ?? code?.endsAt ?? Date.now())
  const abbreviation = zoneAbbreviation(zone, at)
  const start = code?.startsAt ? formatNightTime(code.startsAt, zone) : null
  const end = code?.endsAt ? formatNightTime(code.endsAt, zone) : null

  if (start && end) return `${start} to ${end} (${abbreviation})`
  if (start) return `From ${start} (${abbreviation}), no end`
  if (end) return `Until ${end} (${abbreviation})`

  return 'No window: live until paused or used up'
}
