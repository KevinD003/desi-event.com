/**
 * `@desi-event/pricing` — the money engine.
 *
 * Every amount crossing this package's boundary is an integer number of minor
 * units ("cents"; paise for INR). There is no floating point arithmetic
 * anywhere: percentages are basis points, divisions are exact integer divisions
 * with an explicit half-up remainder test, and even `formatMoney` builds a
 * decimal string instead of dividing by 100.
 *
 * The canonical order of operations for an order is documented in `totals.js`:
 * subtotal → discount → fees on the discounted subtotal → tax → total.
 *
 * @module @desi-event/pricing
 */

export { PricingError } from './errors.js'

export {
  BPS_DENOMINATOR,
  MAX_BPS,
  MAX_CENTS,
  applyBps,
  assertBps,
  assertCents,
  assertInteger,
  assertQuantity,
  divideRoundHalfUp,
  floorDivide,
  formatMoney,
  multiplyExact,
  normaliseCurrency,
} from './money.js'

export { DEFAULT_FEE_CONFIG, computePlatformFee, normaliseFeeConfig } from './fees.js'

export {
  PROMO_REJECTION_REASONS,
  PROMO_TYPES,
  computeDiscount,
  evaluatePromoCode,
  normalisePromoCode,
  toDate,
} from './discount.js'

export { allocateProportionally, computeOrderTotals } from './totals.js'
