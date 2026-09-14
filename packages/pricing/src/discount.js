/**
 * Promo code evaluation and discount calculation.
 *
 * `PromoCode.value` follows the database convention: basis points for
 * `PERCENTAGE` (1000 = 10 %) and minor units for `FIXED_AMOUNT`.
 *
 * Validity is always evaluated against an injected `now`. Nothing in this module
 * reads the clock, so a test can pin any instant and the API can evaluate a
 * promo against the same timestamp it stamps on the order.
 *
 * @module @desi-event/pricing/discount
 */

import { PricingError } from './errors.js'
import { applyBps, assertCents, assertInteger } from './money.js'

/**
 * Promo types, mirroring the `PromoType` enum in `@desi-event/db`. Duplicated as
 * plain strings so that this pure package needs no database dependency.
 *
 * @type {Readonly<{PERCENTAGE: 'PERCENTAGE', FIXED_AMOUNT: 'FIXED_AMOUNT'}>}
 */
export const PROMO_TYPES = Object.freeze({
  PERCENTAGE: 'PERCENTAGE',
  FIXED_AMOUNT: 'FIXED_AMOUNT',
})

/**
 * Why a structurally valid promo code cannot be applied right now.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PROMO_REJECTION_REASONS = Object.freeze({
  INACTIVE: 'INACTIVE',
  NOT_STARTED: 'NOT_STARTED',
  EXPIRED: 'EXPIRED',
  EXHAUSTED: 'EXHAUSTED',
  /** A FIXED_AMOUNT promo denominated in a different currency than the order. */
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  /** A FIXED_AMOUNT promo with no currency recorded at all. */
  CURRENCY_MISSING: 'CURRENCY_MISSING',
})

/**
 * @typedef {object} PromoCodeInput
 * @property {string} type Either `PERCENTAGE` or `FIXED_AMOUNT`.
 * @property {number} value Basis points for `PERCENTAGE`, minor units for `FIXED_AMOUNT`.
 * @property {string} [code] The human-facing code; carried through for error messages only.
 * @property {boolean} [active] Whether the code is switched on. Defaults to `true`.
 * @property {Date|string|number|null} [startsAt] Inclusive start of the validity window; `null` means "already started".
 * @property {Date|string|number|null} [endsAt] Exclusive end of the validity window; `null` means "never expires".
 * @property {number|null} [maxRedemptions] Redemption cap; `null` means unlimited.
 * @property {number} [redemptionCount] Redemptions used so far. Defaults to `0`.
 */

/**
 * @typedef {object} PromoEvaluation
 * @property {boolean} applicable Whether the code may be applied at `now`.
 * @property {string|null} reason One of {@link PROMO_REJECTION_REASONS}, or `null` when applicable.
 */

/**
 * Coerce a `Date`, ISO string or epoch milliseconds value into a `Date`.
 *
 * @param {Date|string|number} value Value to coerce.
 * @param {string} label Field name used in the error message.
 * @returns {Date} A valid `Date`.
 * @throws {PricingError} If the value cannot be interpreted as an instant.
 */
export function toDate(value, label) {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : null

  if (date === null || Number.isNaN(date.getTime())) {
    throw new PricingError(`${label} must be a Date, ISO 8601 string or epoch milliseconds`, {
      code: 'INVALID_DATE',
      details: { field: label, value },
    })
  }

  return date
}

/**
 * Validate a promo code record and return a normalised copy.
 *
 * Structural problems (unknown type, fractional or negative value, malformed
 * dates) throw, because they mean the stored record is wrong. Being expired or
 * exhausted is not a structural problem — see {@link evaluatePromoCode}.
 *
 * @param {PromoCodeInput} promoCode Promo code record, typically straight from Prisma.
 * @returns {{type: string, value: number, active: boolean, startsAt: Date|null, endsAt: Date|null, maxRedemptions: number|null, redemptionCount: number}} Normalised record.
 * @throws {PricingError} If the record is not a usable promo code.
 */
export function normalisePromoCode(promoCode) {
  if (promoCode === null || typeof promoCode !== 'object') {
    throw new PricingError('promoCode must be an object', {
      code: 'INVALID_PROMO_CODE',
      details: { value: promoCode },
    })
  }

  const { type, value } = promoCode

  if (type !== PROMO_TYPES.PERCENTAGE && type !== PROMO_TYPES.FIXED_AMOUNT) {
    throw new PricingError(
      `promoCode.type must be PERCENTAGE or FIXED_AMOUNT, received ${JSON.stringify(type)}`,
      { code: 'INVALID_PROMO_CODE', details: { field: 'type', value: type } },
    )
  }

  // Both variants are non-negative integers; the unit differs, not the shape.
  const amount = assertInteger(value, 'promoCode.value', 'INVALID_PROMO_CODE')
  if (amount < 0) {
    throw new PricingError(`promoCode.value must not be negative, received ${amount}`, {
      code: 'INVALID_PROMO_CODE',
      details: { field: 'value', value: amount },
    })
  }

  const redemptionCount = promoCode.redemptionCount ?? 0
  assertInteger(redemptionCount, 'promoCode.redemptionCount', 'INVALID_PROMO_CODE')
  if (redemptionCount < 0) {
    throw new PricingError('promoCode.redemptionCount must not be negative', {
      code: 'INVALID_PROMO_CODE',
      details: { field: 'redemptionCount', value: redemptionCount },
    })
  }

  const maxRedemptions = promoCode.maxRedemptions ?? null
  if (maxRedemptions !== null) {
    assertInteger(maxRedemptions, 'promoCode.maxRedemptions', 'INVALID_PROMO_CODE')
    if (maxRedemptions < 0) {
      throw new PricingError('promoCode.maxRedemptions must not be negative', {
        code: 'INVALID_PROMO_CODE',
        details: { field: 'maxRedemptions', value: maxRedemptions },
      })
    }
  }

  return {
    type,
    value: amount,
    // Upper-cased so a mismatch is decided on the code, not on its casing.
    currency: promoCode.currency ? String(promoCode.currency).toUpperCase() : null,
    active: promoCode.active ?? true,
    startsAt: promoCode.startsAt == null ? null : toDate(promoCode.startsAt, 'promoCode.startsAt'),
    endsAt: promoCode.endsAt == null ? null : toDate(promoCode.endsAt, 'promoCode.endsAt'),
    maxRedemptions,
    redemptionCount,
  }
}

/**
 * Decide whether a promo code may be applied at a given instant.
 *
 * Window semantics: `startsAt` is **inclusive** (a code starting at 09:00 works
 * at exactly 09:00) and `endsAt` is **exclusive** (a code ending at 17:00 is
 * already expired at exactly 17:00). `maxRedemptions` is a hard cap, so a code
 * with `redemptionCount === maxRedemptions` is exhausted.
 *
 * @param {object} params Evaluation inputs.
 * @param {PromoCodeInput} params.promoCode Promo code record.
 * @param {Date|string|number} params.now Instant to evaluate against; never read from the clock internally.
 * @param {string|null} [params.currency] Order currency. A FIXED_AMOUNT promo denominated in another currency is not applicable.
 * @returns {PromoEvaluation} Whether the code applies, and why not if it does not.
 * @throws {PricingError} If the promo record or `now` is structurally invalid.
 */
export function evaluatePromoCode({ promoCode, now, currency = null }) {
  const promo = normalisePromoCode(promoCode)
  const at = toDate(now, 'now')

  // A flat discount is denominated: "500 off" only means anything alongside a
  // currency. Applying a ₹500 campaign to a CAD order at face value would hand
  // out roughly a hundred times the intended discount, so a mismatch makes the
  // promo inapplicable rather than being silently converted. There is no
  // exchange-rate policy here, and inventing one would be worse than refusing.
  if (promo.type === PROMO_TYPES.FIXED_AMOUNT) {
    if (!promo.currency) {
      return { applicable: false, reason: PROMO_REJECTION_REASONS.CURRENCY_MISSING }
    }
    if (currency && promo.currency !== String(currency).toUpperCase()) {
      return { applicable: false, reason: PROMO_REJECTION_REASONS.CURRENCY_MISMATCH }
    }
  }

  if (!promo.active) {
    return { applicable: false, reason: PROMO_REJECTION_REASONS.INACTIVE }
  }
  if (promo.startsAt !== null && at.getTime() < promo.startsAt.getTime()) {
    return { applicable: false, reason: PROMO_REJECTION_REASONS.NOT_STARTED }
  }
  if (promo.endsAt !== null && at.getTime() >= promo.endsAt.getTime()) {
    return { applicable: false, reason: PROMO_REJECTION_REASONS.EXPIRED }
  }
  if (promo.maxRedemptions !== null && promo.redemptionCount >= promo.maxRedemptions) {
    return { applicable: false, reason: PROMO_REJECTION_REASONS.EXHAUSTED }
  }

  return { applicable: true, reason: null }
}

/**
 * Compute the discount for a subtotal.
 *
 * Returns `0` — never a negative number and never more than `subtotalCents` —
 * when there is no promo code, or when the code is inactive, outside its window
 * or exhausted. Percentage discounts are rounded half up; a percentage above
 * 100 % and a fixed amount larger than the subtotal are both clamped to the
 * subtotal, so a discount can never create a negative order total.
 *
 * @param {object} params Discount inputs.
 * @param {number} params.subtotalCents Order subtotal in minor units.
 * @param {PromoCodeInput|null} [params.promoCode] Promo code record, or `null`/`undefined` for no promo.
 * @param {Date|string|number} [params.now] Instant used for validity checks; required whenever a promo code is given.
 * @param {string|null} [params.currency] Order currency. A FIXED_AMOUNT promo denominated in another currency yields no discount.
 * @returns {number} The discount in minor units: an integer in `[0, subtotalCents]`.
 * @throws {PricingError} If the subtotal, promo record or `now` is structurally invalid.
 */
export function computeDiscount({ subtotalCents, promoCode = null, now, currency = null }) {
  const subtotal = assertCents(subtotalCents, 'subtotalCents')

  if (promoCode == null) return 0

  const evaluation = evaluatePromoCode({ promoCode, now, currency })
  if (!evaluation.applicable) return 0

  const promo = normalisePromoCode(promoCode)
  const raw =
    promo.type === PROMO_TYPES.PERCENTAGE
      ? applyBps(subtotal, Math.min(promo.value, 10_000))
      : promo.value

  return Math.min(raw, subtotal)
}
