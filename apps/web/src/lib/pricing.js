/**
 * The web app's view of money.
 *
 * Arithmetic itself belongs to `@desi-event/pricing`; this module only supplies
 * the inputs that depend on where an event is being sold. The totals a visitor
 * sees during checkout are an *estimate*: the server recomputes every column
 * from the ticket type rows when the order is placed, and that result is the
 * one that is charged. Showing the estimate anyway is worth it — a checkout
 * that hides the fee until the last step is the thing everyone hates about
 * buying tickets.
 *
 * @module lib/pricing
 */

import { DEFAULT_FEE_CONFIG, computeOrderTotals, formatMoney } from '@desi-event/pricing'

/**
 * Per-ticket flat fee, in the minor units of each currency.
 *
 * A flat fee is denominated in a specific currency, so it cannot simply be
 * carried across from the INR default: ₹5 and £5 are not the same charge.
 *
 * @type {Readonly<Record<string, number>>}
 */
const FLAT_FEE_CENTS_BY_CURRENCY = Object.freeze({
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
 * India charges GST on the service fee as well as the ticket, Ontario charges
 * HST and the UK charges VAT, so the rate follows the currency the event is
 * sold in rather than being a single global constant.
 *
 * @type {Readonly<Record<string, number>>}
 */
const TAX_RATE_BPS_BY_CURRENCY = Object.freeze({
  INR: 1800,
  CAD: 1300,
  GBP: 2000,
  USD: 0,
  AUD: 1000,
  AED: 500,
})

/** Flat fee used for a currency the table has no entry for. */
const FALLBACK_FLAT_FEE_CENTS = 99

/**
 * The platform fee terms for an order in a given currency.
 *
 * @param {string} [currency] ISO 4217 code, e.g. `GBP`.
 * @returns {{percentageBps: number, flatCents: number, currency: string}} A fee config denominated in that currency.
 */
export function feeConfigForCurrency(currency = 'INR') {
  const code = String(currency || 'INR').toUpperCase()

  return {
    percentageBps: DEFAULT_FEE_CONFIG.percentageBps,
    flatCents: FLAT_FEE_CENTS_BY_CURRENCY[code] ?? FALLBACK_FLAT_FEE_CENTS,
    currency: code,
  }
}

/**
 * The sales tax rate applied to an order in a given currency.
 *
 * @param {string} [currency] ISO 4217 code.
 * @returns {number} The rate in basis points; `0` when no tax applies.
 */
export function taxRateBpsForCurrency(currency = 'INR') {
  const code = String(currency || 'INR').toUpperCase()

  return TAX_RATE_BPS_BY_CURRENCY[code] ?? 0
}

/**
 * The tax's display name, so the summary line says "GST" in Mumbai and "VAT" in
 * London rather than a generic "Tax".
 *
 * @param {string} [currency] ISO 4217 code.
 * @returns {string} A short label such as `GST (18%)`.
 */
export function taxLabelForCurrency(currency = 'INR') {
  const code = String(currency || 'INR').toUpperCase()
  const bps = taxRateBpsForCurrency(code)
  const percent = bps / 100
  const name = { INR: 'GST', CAD: 'HST', GBP: 'VAT' }[code] ?? 'Tax'

  return `${name} (${percent}%)`
}

/**
 * The locale used to render money for a currency.
 *
 * Grouping differs: Indian numbering groups in lakhs (`₹1,49,900`), so INR is
 * formatted `en-IN` while CAD and GBP use their own conventions.
 *
 * @param {string} [currency] ISO 4217 code.
 * @returns {string} A BCP 47 locale tag.
 */
export function localeForCurrency(currency = 'INR') {
  const code = String(currency || 'INR').toUpperCase()

  return { INR: 'en-IN', CAD: 'en-CA', GBP: 'en-GB', USD: 'en-US', AUD: 'en-AU' }[code] ?? 'en-IN'
}

/**
 * Format an integer amount of minor units in its own currency and locale.
 *
 * A zero amount reads as "Free", because `₹0.00` on a free community mela looks
 * like a pricing bug rather than a gift.
 *
 * @param {number} cents Amount in minor units.
 * @param {string} [currency] ISO 4217 code.
 * @returns {string} A localised amount such as `₹1,499.00`, or `Free` for zero.
 */
export function formatPrice(cents, currency = 'INR') {
  if (cents === 0) return 'Free'

  return formatMoney(cents, currency, localeForCurrency(currency))
}

/**
 * Format an amount without the "Free" shorthand, for summary rows where a
 * zero line should still read as money.
 *
 * @param {number} cents Amount in minor units.
 * @param {string} [currency] ISO 4217 code.
 * @returns {string} A localised amount such as `₹0.00`.
 */
export function formatAmount(cents, currency = 'INR') {
  return formatMoney(cents, currency, localeForCurrency(currency))
}

/**
 * @typedef {object} CartLine
 * @property {string} ticketTypeId Ticket type identifier.
 * @property {string} name Tier name, shown on the summary.
 * @property {number} quantity Tickets requested.
 * @property {number} unitPriceCents Price per ticket in minor units.
 */

/**
 * Price a basket of ticket selections.
 *
 * Lines with a zero quantity are dropped before pricing, so the per-ticket flat
 * fee is charged on tickets the buyer is actually taking.
 *
 * @param {object} params Basket inputs.
 * @param {CartLine[]} params.lines Selected tiers with their quantities.
 * @param {string} params.currency ISO 4217 code every tier is priced in.
 * @returns {object} The broken-down totals: currency, subtotalCents, discountCents, feesCents, taxCents, totalCents and lineItems.
 * @throws {PricingError} If a line carries a non-integer quantity or price.
 */
export function priceSelection({ lines, currency }) {
  const items = (lines ?? [])
    .filter((line) => line.quantity > 0)
    .map((line) => ({
      ticketTypeId: line.ticketTypeId,
      name: line.name,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
    }))

  return computeOrderTotals({
    items,
    feeConfig: feeConfigForCurrency(currency),
    taxRateBps: taxRateBpsForCurrency(currency),
    currency,
  })
}
