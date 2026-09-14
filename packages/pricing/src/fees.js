/**
 * Platform fee calculation.
 *
 * A fee has two components: a percentage of the amount being charged and a flat
 * amount per ticket. Both are integers; the percentage is expressed in basis
 * points so that "2.5 %" is the exact integer 250 rather than the inexact float
 * 0.025.
 *
 * @module @desi-event/pricing/fees
 */

import { PricingError } from './errors.js'
import { applyBps, assertBps, assertCents, assertQuantity, normaliseCurrency } from './money.js'

/**
 * @typedef {object} FeeConfig
 * @property {number} percentageBps Percentage of the charged amount, in basis points (250 = 2.5 %).
 * @property {number} flatCents Flat amount in minor units charged once per ticket.
 * @property {string} currency ISO 4217 code the `flatCents` amount is denominated in.
 */

/**
 * Platform default: 2.5 % of the discounted subtotal plus ₹5 per ticket.
 *
 * Frozen because it is shared process-wide; callers that need different terms
 * pass their own {@link FeeConfig} rather than mutating this one.
 *
 * @type {Readonly<FeeConfig>}
 */
export const DEFAULT_FEE_CONFIG = Object.freeze({
  percentageBps: 250,
  flatCents: 500,
  currency: 'INR',
})

/**
 * Validate a fee configuration and return a normalised copy.
 *
 * @param {FeeConfig} [feeConfig] Configuration to validate. Defaults to {@link DEFAULT_FEE_CONFIG}.
 * @returns {FeeConfig} A validated copy with an upper-cased currency code.
 * @throws {PricingError} If the configuration is missing fields or holds invalid values.
 */
export function normaliseFeeConfig(feeConfig = DEFAULT_FEE_CONFIG) {
  if (feeConfig === null || typeof feeConfig !== 'object') {
    throw new PricingError('feeConfig must be an object', {
      code: 'INVALID_FEE_CONFIG',
      details: { value: feeConfig },
    })
  }

  return {
    percentageBps: assertBps(feeConfig.percentageBps, 'feeConfig.percentageBps'),
    flatCents: assertCents(feeConfig.flatCents, 'feeConfig.flatCents'),
    currency: normaliseCurrency(feeConfig.currency, 'feeConfig.currency'),
  }
}

/**
 * Compute the platform fee for an amount.
 *
 * The percentage component is rounded half up (see `money.js`); the flat
 * component is multiplied by the ticket count, because it represents per-ticket
 * issuance cost rather than a per-order charge.
 *
 * A zero `subtotalCents` produces a zero fee: free tickets, and orders whose
 * subtotal has been fully discounted, cost the buyer nothing. This is why the
 * caller must pass the *discounted* subtotal.
 *
 * @param {object} params Fee inputs.
 * @param {number} params.subtotalCents Amount the fee is charged on, in minor units — normally the discounted subtotal.
 * @param {number} [params.quantity] Number of tickets in the order. Defaults to `1`.
 * @param {FeeConfig} [params.feeConfig] Fee terms. Defaults to {@link DEFAULT_FEE_CONFIG}.
 * @returns {number} The fee in minor units, as a non-negative integer.
 * @throws {PricingError} If any input is not a non-negative integer, or the fee configuration is invalid.
 */
export function computePlatformFee({
  subtotalCents,
  quantity = 1,
  feeConfig = DEFAULT_FEE_CONFIG,
}) {
  const amount = assertCents(subtotalCents, 'subtotalCents')
  const tickets = assertQuantity(quantity, 'quantity')
  const config = normaliseFeeConfig(feeConfig)

  if (amount === 0) return 0

  const percentageComponent = applyBps(amount, config.percentageBps)
  const flatComponent = assertCents(config.flatCents * tickets, 'feeConfig.flatCents * quantity')

  return percentageComponent + flatComponent
}
