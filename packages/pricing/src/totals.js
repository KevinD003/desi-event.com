/**
 * Order total calculation — the single place where the order of operations for
 * money is defined.
 *
 * ## Order of operations (a business decision, not an implementation detail)
 *
 * ```
 * subtotal            = Σ (quantity × unitPrice)          per ticket type
 * discount            = promo applied to the subtotal, clamped to [0, subtotal]
 * discountedSubtotal  = subtotal − discount
 * fees                = platform fee on the DISCOUNTED subtotal
 * tax                 = taxRateBps applied to (discountedSubtotal + fees)
 * total               = discountedSubtotal + fees + tax
 * ```
 *
 * Three choices are deliberate:
 *
 * 1. **Fees are charged on the discounted subtotal.** The organiser's promo is a
 *    genuine price reduction, so the platform takes its percentage of what the
 *    buyer actually pays rather than of the pre-discount list price.
 * 2. **Tax is charged on the fee as well as on the tickets.** Indian GST applies
 *    to the service fee, so the taxable base is `discountedSubtotal + fees`.
 * 3. **The discount is clamped to the subtotal.** A 100 % (or oversized) promo
 *    makes the tickets free; it never turns fees or tax negative, and it never
 *    produces a negative total.
 *
 * Every step rounds half up and every value stays an integer number of minor
 * units, so `subtotalCents − discountCents + feesCents + taxCents === totalCents`
 * holds exactly, and `Σ lineItems[].subtotalCents === subtotalCents` holds
 * exactly as well.
 *
 * @module @desi-event/pricing/totals
 */

import { PricingError } from './errors.js'
import { computeDiscount } from './discount.js'
import { DEFAULT_FEE_CONFIG, computePlatformFee, normaliseFeeConfig } from './fees.js'
import {
  applyBps,
  assertBps,
  assertCents,
  assertQuantity,
  multiplyExact,
  normaliseCurrency,
} from './money.js'

/**
 * @typedef {object} OrderItemInput
 * @property {string} ticketTypeId Ticket type identifier.
 * @property {number} quantity Number of tickets, a non-negative integer.
 * @property {number} unitPriceCents Price per ticket in minor units.
 * @property {string} [name] Display name for receipts.
 */

/**
 * @typedef {object} OrderLineItem
 * @property {string} ticketTypeId Ticket type identifier.
 * @property {string|null} name Display name, or `null` when the caller supplied none.
 * @property {number} quantity Number of tickets.
 * @property {number} unitPriceCents Price per ticket in minor units.
 * @property {number} subtotalCents `quantity × unitPriceCents`.
 * @property {number} discountCents Share of the order discount allocated to this line; the shares sum exactly to the order discount.
 */

/**
 * @typedef {object} OrderTotals
 * @property {string} currency ISO 4217 code every amount is denominated in.
 * @property {number} subtotalCents Sum of the line subtotals before any discount.
 * @property {number} discountCents Discount applied, in `[0, subtotalCents]`.
 * @property {number} feesCents Platform fee charged on the discounted subtotal.
 * @property {number} taxCents Tax charged on the discounted subtotal plus fees.
 * @property {number} totalCents Amount payable: `subtotal − discount + fees + tax`.
 * @property {OrderLineItem[]} lineItems Per-ticket-type breakdown, in input order.
 */

/**
 * Split an integer amount across weighted buckets so that the parts sum exactly
 * to the amount.
 *
 * Uses the largest-remainder method: every bucket gets its floored share, then
 * the leftover minor units go one each to the buckets with the largest
 * remainders, ties broken by input order. This is what stops a receipt from
 * showing line discounts that add up to one paisa less than the order discount.
 *
 * @param {number} totalCents Amount to distribute, a non-negative integer.
 * @param {number[]} weights Non-negative integer weight per bucket.
 * @returns {number[]} One integer per bucket, summing exactly to `totalCents`.
 * @throws {PricingError} If the amount or any weight is invalid.
 */
export function allocateProportionally(totalCents, weights) {
  const total = assertCents(totalCents, 'totalCents')

  if (!Array.isArray(weights)) {
    throw new PricingError('weights must be an array', { code: 'INVALID_ALLOCATION' })
  }

  const safeWeights = weights.map((weight, index) => assertCents(weight, `weights[${index}]`))
  const weightSum = safeWeights.reduce((sum, weight) => sum + weight, 0)

  if (total === 0) return safeWeights.map(() => 0)

  // Allocating a non-zero amount across buckets that carry no weight has no
  // defined answer, and returning zeros would silently discard money: a
  // discount would vanish from the breakdown while still reducing the total.
  // Callers must not reach this state, so say so loudly rather than lose it.
  if (weightSum === 0) {
    throw new PricingError('cannot allocate a non-zero amount across zero total weight', {
      code: 'INVALID_ALLOCATION',
      details: { totalCents: total, weights: safeWeights },
    })
  }

  // The intermediate `total * weight` is computed in BigInt.
  //
  // Both operands are individually valid up to MAX_CENTS (1e12), but their
  // product reaches 1e24 — far past Number.MAX_SAFE_INTEGER. Doing this in
  // doubles put the real ceiling at about 9.4e7 minor units, so allocating a
  // ₹1,000,000 discount across a line of the same size threw
  // AMOUNT_OUT_OF_RANGE and refused a perfectly legitimate order. BigInt makes
  // the division exact at any size the surrounding guards permit; every
  // quotient is bounded by `total`, so converting back to Number is safe.
  const bigTotal = BigInt(total)
  const bigWeightSum = BigInt(weightSum)

  const shares = []
  const remainders = []
  let allocated = 0

  for (let index = 0; index < safeWeights.length; index += 1) {
    const numerator = bigTotal * BigInt(safeWeights[index])
    const quotient = Number(numerator / bigWeightSum)
    const remainder = Number(numerator % bigWeightSum)

    shares.push(quotient)
    remainders.push(remainder)
    allocated += quotient
  }

  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)

  let leftover = total - allocated
  for (let position = 0; position < order.length && leftover > 0; position += 1) {
    shares[order[position].index] += 1
    leftover -= 1
  }

  return shares
}

/**
 * Validate a single order item and expand it into a line item.
 *
 * @param {OrderItemInput} item Raw item.
 * @param {number} index Position in the input array, used in error messages.
 * @returns {OrderLineItem} The validated line, with `discountCents` still zero.
 * @throws {PricingError} If the item is malformed.
 */
function toLineItem(item, index) {
  if (item === null || typeof item !== 'object') {
    throw new PricingError(`items[${index}] must be an object`, {
      code: 'INVALID_ITEM',
      details: { index, value: item },
    })
  }
  if (typeof item.ticketTypeId !== 'string' || item.ticketTypeId.trim() === '') {
    throw new PricingError(`items[${index}].ticketTypeId must be a non-empty string`, {
      code: 'INVALID_ITEM',
      details: { index, value: item.ticketTypeId },
    })
  }
  if (item.name != null && typeof item.name !== 'string') {
    throw new PricingError(`items[${index}].name must be a string when provided`, {
      code: 'INVALID_ITEM',
      details: { index, value: item.name },
    })
  }

  const quantity = assertQuantity(item.quantity, `items[${index}].quantity`)
  const unitPriceCents = assertCents(item.unitPriceCents, `items[${index}].unitPriceCents`)
  const subtotalCents = assertCents(
    multiplyExact(quantity, unitPriceCents, `items[${index}] subtotal`),
    `items[${index}] subtotal`,
  )

  return {
    ticketTypeId: item.ticketTypeId,
    name: item.name ?? null,
    quantity,
    unitPriceCents,
    subtotalCents,
    discountCents: 0,
  }
}

/**
 * Compute every monetary column of an order.
 *
 * See the module comment for the order of operations and the reasoning behind
 * it. All arithmetic is integer; percentage steps round half up.
 *
 * @param {object} params Order inputs.
 * @param {OrderItemInput[]} params.items Requested ticket types; an empty array yields an all-zero result.
 * @param {PromoCodeInput|null} [params.promoCode] Promo code record (see `discount.js`), or `null` for none.
 * @param {FeeConfig} [params.feeConfig] Platform fee terms (see `fees.js`). Defaults to {@link DEFAULT_FEE_CONFIG}.
 * @param {number} [params.taxRateBps] Tax rate in basis points (1800 = 18 % GST). Defaults to `0`.
 * @param {string} [params.currency] ISO 4217 code for the order. Defaults to the fee config currency.
 * @param {Date|string|number} [params.now] Instant used to evaluate promo validity; required whenever a promo code is given.
 * @returns {OrderTotals} The fully broken-down order totals.
 * @throws {PricingError} If any input is invalid, or an explicit fee config is denominated in another currency.
 */
export function computeOrderTotals({
  items,
  promoCode = null,
  feeConfig = DEFAULT_FEE_CONFIG,
  taxRateBps = 0,
  currency,
  now,
}) {
  if (!Array.isArray(items)) {
    throw new PricingError('items must be an array', {
      code: 'INVALID_ITEMS',
      details: { value: items },
    })
  }

  const config = normaliseFeeConfig(feeConfig)
  const orderCurrency = currency === undefined ? config.currency : normaliseCurrency(currency)

  // A flat fee is denominated in a specific currency, so quietly charging an INR
  // flat fee on a USD order would silently mis-price it.
  if (feeConfig !== DEFAULT_FEE_CONFIG && config.currency !== orderCurrency) {
    throw new PricingError(
      `feeConfig.currency ${config.currency} does not match the order currency ${orderCurrency}`,
      { code: 'CURRENCY_MISMATCH', details: { feeCurrency: config.currency, orderCurrency } },
    )
  }

  const taxRate = assertBps(taxRateBps, 'taxRateBps')
  const lineItems = items.map(toLineItem)

  const subtotalCents = assertCents(
    lineItems.reduce((sum, line) => sum + line.subtotalCents, 0),
    'subtotalCents',
  )
  const quantity = lineItems.reduce((sum, line) => sum + line.quantity, 0)

  const discountCents = computeDiscount({ subtotalCents, promoCode, now, currency: orderCurrency })
  const discountedSubtotalCents = subtotalCents - discountCents

  const feesCents = computePlatformFee({
    subtotalCents: discountedSubtotalCents,
    quantity,
    feeConfig: config,
  })
  const taxCents = applyBps(discountedSubtotalCents + feesCents, taxRate)
  const totalCents = discountedSubtotalCents + feesCents + taxCents

  const allocation = allocateProportionally(
    discountCents,
    lineItems.map((line) => line.subtotalCents),
  )
  const pricedLines = lineItems.map((line, index) => ({
    ...line,
    discountCents: allocation[index],
  }))

  return {
    currency: orderCurrency,
    subtotalCents,
    discountCents,
    feesCents,
    taxCents,
    totalCents,
    lineItems: pricedLines,
  }
}
