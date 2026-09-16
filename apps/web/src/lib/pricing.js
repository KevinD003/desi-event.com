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

import {
  computeOrderTotals,
  feeConfigForCurrency,
  formatMoney,
  resolveTaxPolicy,
} from '@desi-event/pricing'

// Re-exported so existing callers keep working, but the tables themselves now
// live in @desi-event/pricing. They used to be defined here, and the API used
// its own: checkout quoted a per-currency fee plus GST, the server charged a
// flat fee and no tax at all, and the buyer was billed a number they were
// never shown. Both sides now read the same source.
export { feeConfigForCurrency, resolveTaxPolicy }

/**
 * The tax's display name, so the summary line says "GST" in Mumbai and "VAT" in
 * London rather than a generic "Tax".
 *
 * @param {object} [place] Where the event is held: `{ country, region }`.
 * @returns {string} A short label such as `GST (18%)`.
 */
export function taxLabelForPlace(place = {}) {
  const policy = resolveTaxPolicy({ country: place.country, region: place.region })

  if (!policy.resolved || policy.rateBps === 0) return 'Tax'

  return `${policy.name} (${policy.rateBps / 100}%)`
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
 * @param {object} [params.place] Where the event is held: `{ country, region }`.
 * @returns {object} The broken-down totals plus the tax policy they were computed under.
 * @throws {PricingError} If a line carries a non-integer quantity or price.
 */
export function priceSelection({ lines, currency, place = {} }) {
  const items = (lines ?? [])
    .filter((line) => line.quantity > 0)
    .map((line) => ({
      ticketTypeId: line.ticketTypeId,
      name: line.name,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
    }))

  // Tax follows where the event is held, not the currency it is priced in —
  // the same resolution the server performs, from the same table, so the quote
  // the buyer sees and the total they are charged cannot disagree.
  const taxPolicy = resolveTaxPolicy({ country: place.country, region: place.region })

  const totals = computeOrderTotals({
    items,
    feeConfig: feeConfigForCurrency(currency),
    taxRateBps: taxPolicy.rateBps,
    currency,
  })

  return { ...totals, taxPolicy }
}
