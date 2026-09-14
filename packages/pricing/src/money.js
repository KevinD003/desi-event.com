/**
 * Integer-cent arithmetic primitives shared by the whole pricing engine.
 *
 * ## Rounding rule (applies everywhere in this package)
 *
 * Every division rounds **half up**: the exact quotient is taken when it is an
 * integer, otherwise the result is the nearest integer and an exact tie (`.5`)
 * goes towards positive infinity. Because every arithmetic input is validated
 * as non-negative, half up is indistinguishable from half away from zero here;
 * the implementation still handles negatives correctly so the helper can be
 * reused for refund deltas. One rule, applied to percentage fees, percentage
 * discounts and tax alike, is what keeps `subtotal - discount + fees + tax`
 * reconciling exactly with the stored order columns.
 *
 * All values are integers. No floating point value ever reaches an output: the
 * only division is exact integer division with an explicit remainder test, and
 * `formatMoney` renders a decimal string rather than dividing by 100.
 *
 * @module @desi-event/pricing/money
 */

import { PricingError } from './errors.js'

/** Basis-point denominator: 10 000 bps = 100 %. */
export const BPS_DENOMINATOR = 10_000

/**
 * Largest amount the engine accepts, in minor units.
 *
 * Deliberately PostgreSQL's `integer` maximum, because that is the type every
 * money column uses. The ceiling used to be 1e12, which meant a line total the
 * engine happily computed — a ticket priced near the per-value limit, times a
 * permitted quantity — was larger than the column it was about to be written
 * to. Validation passed and the insert failed, turning a bad request into a
 * 500 from the database.
 *
 * Anything beyond this is a data error rather than a real order. Raising it
 * requires widening the money columns to `bigint` first, in the same change.
 */
export const MAX_CENTS = 2_147_483_647

/** Largest basis-point value accepted (10 000 % — generous, but bounded). */
export const MAX_BPS = 1_000_000

/** Well-formed ISO 4217 alphabetic currency code. */
const CURRENCY_PATTERN = /^[A-Z]{3}$/

/**
 * Floor division of two integers, corrected for float division error.
 *
 * `n / d` is a float division, so for values near the safe-integer ceiling the
 * quotient can land one ulp on the wrong side of an integer boundary. The
 * remainder test afterwards makes the result exact.
 *
 * @param {number} numerator Integer numerator.
 * @param {number} denominator Positive integer denominator.
 * @returns {{quotient: number, remainder: number}} Quotient floored towards negative infinity and a remainder in `[0, denominator)`.
 */
export function floorDivide(numerator, denominator) {
  let quotient = Math.floor(numerator / denominator)
  let remainder = numerator - quotient * denominator

  while (remainder < 0) {
    quotient -= 1
    remainder += denominator
  }
  while (remainder >= denominator) {
    quotient += 1
    remainder -= denominator
  }

  return { quotient, remainder }
}

/**
 * Assert that a value is a safe integer, throwing {@link PricingError} otherwise.
 *
 * @param {unknown} value Value to check.
 * @param {string} label Field name used in the error message.
 * @param {string} [code] Machine-readable error code.
 * @returns {number} The value, narrowed to a number.
 * @throws {PricingError} If the value is not a finite safe integer.
 */
export function assertInteger(value, label, code = 'INVALID_AMOUNT') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PricingError(`${label} must be a number, received ${describe(value)}`, {
      code,
      details: { field: label, value },
    })
  }
  if (!Number.isInteger(value)) {
    throw new PricingError(
      `${label} must be an integer number of minor units (cents), received ${value}`,
      { code, details: { field: label, value } },
    )
  }
  if (!Number.isSafeInteger(value)) {
    throw new PricingError(`${label} exceeds the safe integer range`, {
      code: 'AMOUNT_OUT_OF_RANGE',
      details: { field: label, value },
    })
  }

  return value
}

/**
 * Assert that a value is a non-negative integer amount within {@link MAX_CENTS}.
 *
 * @param {unknown} value Amount in minor units.
 * @param {string} label Field name used in the error message.
 * @returns {number} The validated amount.
 * @throws {PricingError} If the value is not an integer, is negative, or is out of range.
 */
export function assertCents(value, label) {
  const cents = assertInteger(value, label, 'INVALID_AMOUNT')

  if (cents < 0) {
    throw new PricingError(`${label} must not be negative, received ${cents}`, {
      code: 'NEGATIVE_AMOUNT',
      details: { field: label, value: cents },
    })
  }
  if (cents > MAX_CENTS) {
    throw new PricingError(`${label} exceeds the maximum supported amount (${MAX_CENTS})`, {
      code: 'AMOUNT_OUT_OF_RANGE',
      details: { field: label, value: cents, max: MAX_CENTS },
    })
  }

  return cents
}

/**
 * Assert that a value is a non-negative integer quantity.
 *
 * @param {unknown} value Quantity of tickets.
 * @param {string} label Field name used in the error message.
 * @returns {number} The validated quantity.
 * @throws {PricingError} If the value is not a non-negative integer.
 */
export function assertQuantity(value, label) {
  const quantity = assertInteger(value, label, 'INVALID_QUANTITY')

  if (quantity < 0) {
    throw new PricingError(`${label} must not be negative, received ${quantity}`, {
      code: 'INVALID_QUANTITY',
      details: { field: label, value: quantity },
    })
  }

  return quantity
}

/**
 * Assert that a value is a basis-point rate in `[0, MAX_BPS]`.
 *
 * @param {unknown} value Rate in basis points (1000 = 10 %).
 * @param {string} label Field name used in the error message.
 * @returns {number} The validated rate.
 * @throws {PricingError} If the value is not an integer in range.
 */
export function assertBps(value, label) {
  const bps = assertInteger(value, label, 'INVALID_BPS')

  if (bps < 0 || bps > MAX_BPS) {
    throw new PricingError(
      `${label} must be between 0 and ${MAX_BPS} basis points, received ${bps}`,
      {
        code: 'INVALID_BPS',
        details: { field: label, value: bps, max: MAX_BPS },
      },
    )
  }

  return bps
}

/**
 * Normalise and validate an ISO 4217 alphabetic currency code.
 *
 * @param {unknown} currency Currency code, case-insensitive (e.g. `inr`).
 * @param {string} [label] Field name used in the error message.
 * @returns {string} The upper-cased three-letter code.
 * @throws {PricingError} If the code is not three ASCII letters.
 */
export function normaliseCurrency(currency, label = 'currency') {
  if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency.toUpperCase())) {
    throw new PricingError(
      `${label} must be a three-letter ISO 4217 code, received ${describe(currency)}`,
      { code: 'INVALID_CURRENCY', details: { field: label, value: currency } },
    )
  }

  return currency.toUpperCase()
}

/**
 * Divide two integers, rounding half up (ties towards positive infinity).
 *
 * @param {number} numerator Integer numerator.
 * @param {number} denominator Non-zero integer denominator.
 * @returns {number} The quotient as an integer.
 * @throws {PricingError} If either argument is not a safe integer, or the denominator is zero.
 */
export function divideRoundHalfUp(numerator, denominator) {
  assertInteger(numerator, 'numerator')
  assertInteger(denominator, 'denominator')

  if (denominator === 0) {
    throw new PricingError('Cannot divide by zero', { code: 'INVALID_DENOMINATOR' })
  }

  // Move the sign onto the numerator so that "half up" always means the same
  // direction regardless of how the caller signed the denominator.
  const n = denominator < 0 ? -numerator : numerator
  const d = Math.abs(denominator)
  const { quotient, remainder } = floorDivide(n, d)

  return remainder * 2 >= d ? quotient + 1 : quotient
}

/**
 * Multiply two integers, rejecting results that leave the safe integer range.
 *
 * @param {number} a First integer factor.
 * @param {number} b Second integer factor.
 * @param {string} [label] Field name used in the error message.
 * @returns {number} The exact product.
 * @throws {PricingError} If the product cannot be represented exactly.
 */
export function multiplyExact(a, b, label = 'amount') {
  const product = a * b

  if (!Number.isSafeInteger(product)) {
    throw new PricingError(`${label} overflows the safe integer range`, {
      code: 'AMOUNT_OUT_OF_RANGE',
      details: { field: label, a, b },
    })
  }

  return product
}

/**
 * Apply a basis-point rate to an amount, rounding half up.
 *
 * `applyBps(1999, 250)` = 2.5 % of 1999 = 49.975 → `50`.
 *
 * @param {number} cents Amount in minor units (non-negative integer).
 * @param {number} bps Rate in basis points (1000 = 10 %).
 * @returns {number} The resulting amount in minor units, rounded half up.
 * @throws {PricingError} If either input is invalid or out of range.
 */
export function applyBps(cents, bps) {
  const amount = assertCents(cents, 'cents')
  const rate = assertBps(bps, 'bps')

  return divideRoundHalfUp(multiplyExact(amount, rate, 'cents * bps'), BPS_DENOMINATOR)
}

/**
 * Render an integer amount as a plain decimal string with the given number of
 * fraction digits, using only integer arithmetic.
 *
 * @param {number} cents Amount in minor units; may be negative.
 * @param {number} minorUnits Number of fraction digits for the currency.
 * @returns {string} A decimal string such as `-1234.05`.
 */
function toDecimalString(cents, minorUnits) {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)

  if (minorUnits === 0) return `${sign}${absolute}`

  const scale = 10 ** minorUnits
  const { quotient, remainder } = floorDivide(absolute, scale)

  return `${sign}${quotient}.${String(remainder).padStart(minorUnits, '0')}`
}

/**
 * Format an integer amount of minor units for display.
 *
 * The number of minor units is taken from `Intl` rather than assumed to be two,
 * so JPY (0 digits) and KWD (3 digits) format correctly. The amount is handed to
 * `Intl.NumberFormat` as a decimal *string* built with integer arithmetic, so no
 * floating point division is involved at any point.
 *
 * Negative amounts are allowed here — refunds and adjustments are displayed as
 * negative money even though the arithmetic functions reject negative inputs.
 *
 * @param {number} cents Amount in minor units (integer, may be negative).
 * @param {string} [currency] ISO 4217 code. Defaults to `INR`.
 * @param {string} [locale] BCP 47 locale tag. Defaults to `en-IN`.
 * @returns {string} A localised currency string, e.g. `₹1,234.50`.
 * @throws {PricingError} If `cents` is not an integer, or the currency or locale is invalid.
 */
export function formatMoney(cents, currency = 'INR', locale = 'en-IN') {
  const amount = assertInteger(cents, 'cents')
  const code = normaliseCurrency(currency)

  let formatter
  try {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: code })
  } catch (error) {
    throw new PricingError(`Cannot format money for locale ${describe(locale)}`, {
      code: 'INVALID_LOCALE',
      details: { locale, currency: code },
      cause: error,
    })
  }

  const { maximumFractionDigits } = formatter.resolvedOptions()

  return formatter.format(toDecimalString(amount, maximumFractionDigits))
}

/**
 * Describe an arbitrary value for an error message without throwing on symbols
 * or circular structures.
 *
 * @param {unknown} value Value to describe.
 * @returns {string} A short printable description.
 */
function describe(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'symbol') return value.toString()
  if (value === null) return 'null'
  if (typeof value === 'object') return Array.isArray(value) ? 'an array' : 'an object'

  return String(value)
}
