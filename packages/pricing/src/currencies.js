/**
 * Currency-dependent commercial terms.
 *
 * These tables are the single source of truth for what a buyer is charged on
 * top of the ticket face value. They live here, in the shared package, for one
 * specific reason: the checkout page quotes a total before the order exists,
 * and the API computes the total it actually charges. When those two read from
 * different tables they disagree, and the buyer is shown one number and billed
 * another. Keeping both on these functions makes that class of bug structural
 * rather than a thing to remember.
 *
 * @module @desi-event/pricing/currencies
 */

import { DEFAULT_FEE_CONFIG } from './fees.js'

/** The currency the platform's own configuration is denominated in. */
export const BASE_CURRENCY = 'INR'

/**
 * Per-ticket flat fee, in the minor units of each currency.
 *
 * A flat fee cannot be carried across currencies: ₹5 and £5 are not the same
 * charge, so each currency needs its own figure.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const FLAT_FEE_CENTS_BY_CURRENCY = Object.freeze({
  INR: DEFAULT_FEE_CONFIG.flatCents,
  CAD: 99,
  GBP: 79,
  USD: 99,
  AUD: 99,
  AED: 300,
})

/**
 * Sales tax applied at the point of sale, in basis points.
 *
 * India charges GST, Ontario HST and the UK VAT, so the rate follows the
 * currency an event is sold in rather than being one global constant. A
 * currency with no entry is treated as untaxed.
 *
 * These are the platform's configured rates, not tax advice: a deployment
 * selling into a new jurisdiction has to set its own figure here.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const TAX_RATE_BPS_BY_CURRENCY = Object.freeze({
  INR: 1800,
  CAD: 1300,
  GBP: 2000,
  USD: 0,
  AUD: 1000,
  AED: 500,
})

/** Flat fee used for a currency the table has no entry for. */
export const FALLBACK_FLAT_FEE_CENTS = 99

/**
 * Normalise a currency code to the form these tables are keyed by.
 *
 * @param {string} [currency] ISO 4217 code, in any case.
 * @returns {string} The upper-cased code, defaulting to the base currency.
 */
function normaliseCurrency(currency) {
  return String(currency || BASE_CURRENCY).toUpperCase()
}

/**
 * The platform fee terms for an order in a given currency.
 *
 * The percentage is currency-independent, so a deployment can override it
 * globally. The flat fee is not: an override only applies to the base
 * currency, and every other currency takes its figure from the table.
 *
 * @param {string} [currency] ISO 4217 code, e.g. `GBP`.
 * @param {object} [overrides] Deployment configuration.
 * @param {number} [overrides.percentageBps] Percentage fee in basis points, applied to every currency.
 * @param {number} [overrides.flatCents] Flat per-ticket fee, applied to the base currency only.
 * @returns {{percentageBps: number, flatCents: number, currency: string}} A fee config denominated in that currency.
 */
export function feeConfigForCurrency(currency = BASE_CURRENCY, overrides = {}) {
  const code = normaliseCurrency(currency)
  const usesOverride = code === BASE_CURRENCY && Number.isInteger(overrides.flatCents)

  return {
    percentageBps: overrides.percentageBps ?? DEFAULT_FEE_CONFIG.percentageBps,
    flatCents: usesOverride
      ? overrides.flatCents
      : (FLAT_FEE_CENTS_BY_CURRENCY[code] ?? FALLBACK_FLAT_FEE_CENTS),
    currency: code,
  }
}

/**
 * The sales tax rate applied to an order in a given currency.
 *
 * @param {string} [currency] ISO 4217 code.
 * @returns {number} The rate in basis points; `0` when no tax applies.
 */
export function taxRateBpsForCurrency(currency = BASE_CURRENCY) {
  return TAX_RATE_BPS_BY_CURRENCY[normaliseCurrency(currency)] ?? 0
}
