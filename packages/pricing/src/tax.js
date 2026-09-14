/**
 * Tax policy resolution.
 *
 * Two things this module refuses to do, both of which the previous
 * implementation did:
 *
 * **It does not key tax off currency.** An event priced in CAD is not
 * necessarily taxed in Ontario, and an event priced in INR is not necessarily
 * taxed in India. Tax follows the jurisdiction the supply happens in — where
 * the event is held — so that is what the lookup takes. Keying off currency
 * meant a Toronto event that happened to be priced in rupees would have had
 * Indian GST applied to it.
 *
 * **It does not pretend these rates are verified.** Every rate below is marked
 * `DEMO`. They were carried over from seed data and a checkout mock-up, not
 * from a tax determination, and nobody has confirmed the registration status,
 * the place-of-supply rules, or whether the organiser is even registered. A
 * DEMO rate is fine for a development database and a screenshot; it is not fine
 * for money that a real buyer pays and a real organiser has to remit.
 *
 * So production fails closed. {@link assertTaxPolicyUsable} throws unless the
 * policy is `CONFIGURED`, which means a deployment has supplied a real one. A
 * deployment that wants to run on demo rates has to say so explicitly.
 *
 * @module @desi-event/pricing/tax
 */

import { PricingError } from './errors.js'

/**
 * Bumped whenever any rate or rule below changes.
 *
 * Stamped onto every order so a receipt, a refund and the ledger all recompute
 * from the same policy the buyer was quoted under, rather than from whatever
 * the table happens to say later.
 */
export const TAX_POLICY_VERSION = '2026-09-14.demo.1'

/** Whether a rate has been confirmed by somebody accountable for it. */
export const TAX_POLICY_STATUS = Object.freeze({
  /** Illustrative. Carried from seed data; not a tax determination. */
  DEMO: 'DEMO',
  /** Supplied by the deployment and owned by whoever configured it. */
  CONFIGURED: 'CONFIGURED',
})

/** How the rate relates to the displayed price. */
export const TAX_TREATMENT = Object.freeze({
  /** Tax is added on top of the ticket price and the fee. */
  EXCLUSIVE: 'EXCLUSIVE',
  /** The displayed price already contains the tax. */
  INCLUSIVE: 'INCLUSIVE',
})

/**
 * Illustrative rates, keyed by jurisdiction.
 *
 * `region` narrows a country: Canadian sales tax differs by province, so
 * `CA-ON` is a different jurisdiction from `CA-BC` and neither is "CAD".
 *
 * @type {ReadonlyArray<object>}
 */
export const DEMO_TAX_POLICIES = Object.freeze([
  Object.freeze({
    jurisdiction: 'IN',
    country: 'IN',
    region: null,
    name: 'GST',
    rateBps: 1_800,
    treatment: TAX_TREATMENT.EXCLUSIVE,
    effectiveFrom: '2017-07-01',
    status: TAX_POLICY_STATUS.DEMO,
    note: 'Illustrative single rate. Real Indian GST on event admission depends on registration, place of supply and ticket price bands.',
  }),
  Object.freeze({
    jurisdiction: 'CA-ON',
    country: 'CA',
    region: 'ON',
    name: 'HST',
    rateBps: 1_300,
    treatment: TAX_TREATMENT.EXCLUSIVE,
    effectiveFrom: '2010-07-01',
    status: TAX_POLICY_STATUS.DEMO,
    note: 'Illustrative. Ontario HST only; other provinces differ and GST/PST splits are not modelled.',
  }),
  Object.freeze({
    jurisdiction: 'GB',
    country: 'GB',
    region: null,
    name: 'VAT',
    rateBps: 2_000,
    treatment: TAX_TREATMENT.EXCLUSIVE,
    effectiveFrom: '2011-01-04',
    status: TAX_POLICY_STATUS.DEMO,
    note: 'Illustrative standard rate. Cultural exemptions that often apply to live events are not modelled.',
  }),
  Object.freeze({
    jurisdiction: 'US',
    country: 'US',
    region: null,
    name: 'Sales tax',
    rateBps: 0,
    treatment: TAX_TREATMENT.EXCLUSIVE,
    effectiveFrom: '1970-01-01',
    status: TAX_POLICY_STATUS.DEMO,
    note: 'Deliberately zero. US sales tax on admissions varies by state, county and city, and cannot be represented as one national rate. A US deployment must configure a real determination.',
  }),
])

/** Returned when no policy covers the supply. */
const UNKNOWN_POLICY = Object.freeze({
  jurisdiction: null,
  name: null,
  rateBps: 0,
  treatment: TAX_TREATMENT.EXCLUSIVE,
  status: TAX_POLICY_STATUS.DEMO,
  version: TAX_POLICY_VERSION,
  resolved: false,
  note: 'No tax policy matched this jurisdiction.',
})

/**
 * Resolve the tax policy for a supply.
 *
 * @param {object} params Where and when the supply happens.
 * @param {string|null} [params.country] ISO 3166-1 alpha-2 country of the venue.
 * @param {string|null} [params.region] Subdivision code, e.g. `ON`.
 * @param {Date|string|number} [params.at] Instant the supply is made; defaults to no date filtering.
 * @param {ReadonlyArray<object>} [params.policies] Policy table; defaults to the demo table.
 * @returns {object} The matching policy, stamped with the policy version.
 */
export function resolveTaxPolicy({
  country,
  region = null,
  at = null,
  policies = DEMO_TAX_POLICIES,
} = {}) {
  if (!country) return { ...UNKNOWN_POLICY }

  const code = String(country).toUpperCase()
  const sub = region ? String(region).toUpperCase() : null
  const when = at === null ? null : new Date(at)

  const candidates = policies.filter((policy) => {
    if (policy.country !== code) return false
    if (policy.region !== null && policy.region !== sub) return false
    if (when && policy.effectiveFrom && new Date(policy.effectiveFrom) > when) return false
    return true
  })

  if (candidates.length === 0) return { ...UNKNOWN_POLICY }

  // A region-specific policy beats a country-wide one.
  const match = candidates.find((policy) => policy.region !== null) ?? candidates[0]

  return {
    jurisdiction: match.jurisdiction,
    name: match.name,
    rateBps: match.rateBps,
    treatment: match.treatment,
    status: match.status,
    version: TAX_POLICY_VERSION,
    resolved: true,
    note: match.note ?? null,
  }
}

/**
 * Refuse to charge tax under an unverified policy in production.
 *
 * Fails closed on purpose. Charging a buyer a rate nobody has confirmed, and
 * telling an organiser they owe it, is worse than refusing to sell: the first
 * is a wrong number on a real receipt, the second is a loud error at startup or
 * checkout that somebody fixes.
 *
 * @param {object} policy A policy from {@link resolveTaxPolicy}.
 * @param {object} [options] Environment.
 * @param {string} [options.environment] `NODE_ENV`.
 * @param {boolean} [options.allowDemo] Explicit opt-in to demo rates in production.
 * @returns {object} The policy, unchanged, when it may be used.
 * @throws {PricingError} `TAX_POLICY_NOT_CONFIGURED` when a DEMO policy would be charged in production.
 */
export function assertTaxPolicyUsable(
  policy,
  { environment = 'development', allowDemo = false } = {},
) {
  if (environment !== 'production') return policy
  if (policy.status === TAX_POLICY_STATUS.CONFIGURED) return policy
  if (allowDemo) return policy

  throw new PricingError(
    `Tax policy for ${policy.jurisdiction ?? 'this jurisdiction'} is ${policy.status}, not CONFIGURED. ` +
      'Configure a real tax determination, or set ALLOW_DEMO_TAX_IN_PRODUCTION=true to accept illustrative rates deliberately.',
    {
      code: 'TAX_POLICY_NOT_CONFIGURED',
      details: {
        jurisdiction: policy.jurisdiction,
        status: policy.status,
        version: policy.version,
      },
    },
  )
}

/**
 * Build the pricing snapshot recorded on an order.
 *
 * The quote the buyer saw, the order that was charged, the receipt, any refund
 * and the ledger all have to agree. They do that by recomputing from this
 * snapshot rather than from the live tables, which may have moved on.
 *
 * @param {object} params Snapshot inputs.
 * @param {object} params.feeConfig The fee terms applied.
 * @param {object} params.taxPolicy The resolved tax policy.
 * @param {string} params.currency The order currency.
 * @returns {object} A plain object safe to persist as JSON.
 */
export function buildPricingSnapshot({ feeConfig, taxPolicy, currency }) {
  return {
    currency,
    feeConfig: {
      percentageBps: feeConfig.percentageBps,
      flatCents: feeConfig.flatCents,
      currency: feeConfig.currency,
    },
    tax: {
      jurisdiction: taxPolicy.jurisdiction,
      name: taxPolicy.name,
      rateBps: taxPolicy.rateBps,
      treatment: taxPolicy.treatment,
      status: taxPolicy.status,
      version: taxPolicy.version,
      resolved: taxPolicy.resolved,
    },
  }
}
