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
 * subtotal → discount → fees on the discounted subtotal → waiver of the whole
 * fee by a referral code → tax → total paid online, and what is paid at the
 * door when the order is paid at the venue.
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
  BASE_CURRENCY,
  FALLBACK_FLAT_FEE_CENTS,
  FLAT_FEE_CENTS_BY_CURRENCY,
  TAX_RATE_BPS_BY_CURRENCY,
  feeConfigForCurrency,
  taxRateBpsForCurrency,
} from './currencies.js'

export {
  PROMO_REJECTION_REASONS,
  PROMO_TYPES,
  computeDiscount,
  evaluatePromoCode,
  normalisePromoCode,
  toDate,
} from './discount.js'

export {
  AT_VENUE_TAXES_BOOKING_FEE,
  PAYMENT_METHODS,
  TAX_APPLIED_TO,
  allocateProportionally,
  computeOrderTotals,
  splitAcrossTickets,
  unitsWithShare,
} from './totals.js'

export {
  DEMO_TAX_POLICIES,
  PRICING_SNAPSHOT_VERSION,
  TAX_POLICY_STATUS,
  TAX_POLICY_VERSION,
  TAX_TREATMENT,
  assertTaxPolicyUsable,
  buildPricingSnapshot,
  resolveTaxPolicy,
} from './tax.js'
