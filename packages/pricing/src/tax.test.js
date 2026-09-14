import { describe, expect, it } from 'vitest'

import {
  TAX_POLICY_STATUS,
  TAX_POLICY_VERSION,
  assertTaxPolicyUsable,
  buildPricingSnapshot,
  resolveTaxPolicy,
} from './tax.js'
import { PricingError } from './errors.js'

describe('tax follows jurisdiction, not currency', () => {
  // The defect this replaced: rates were keyed by currency, so a Canadian
  // event priced in rupees would have been charged Indian GST, and a US event
  // priced in CAD would have been charged Ontario HST.
  it('resolves India to GST', () => {
    const policy = resolveTaxPolicy({ country: 'IN' })

    expect(policy.jurisdiction).toBe('IN')
    expect(policy.name).toBe('GST')
    expect(policy.rateBps).toBe(1_800)
  })

  it('resolves Ontario specifically, not Canada generally', () => {
    expect(resolveTaxPolicy({ country: 'CA', region: 'ON' }).jurisdiction).toBe('CA-ON')
    // A province with no policy of its own must not inherit Ontario's rate.
    expect(resolveTaxPolicy({ country: 'CA', region: 'BC' }).resolved).toBe(false)
    expect(resolveTaxPolicy({ country: 'CA', region: 'BC' }).rateBps).toBe(0)
  })

  it('never applies Indian GST to a United States or Canadian event', () => {
    for (const place of [
      { country: 'US' },
      { country: 'US', region: 'NY' },
      { country: 'CA', region: 'ON' },
      { country: 'CA', region: 'QC' },
    ]) {
      expect(resolveTaxPolicy(place).rateBps).not.toBe(1_800)
      expect(resolveTaxPolicy(place).jurisdiction).not.toBe('IN')
    }
  })

  it('charges nothing for the United States rather than inventing a national rate', () => {
    const policy = resolveTaxPolicy({ country: 'US' })

    expect(policy.rateBps).toBe(0)
    expect(policy.note).toMatch(/varies by state/i)
  })

  it('returns an unresolved policy for a jurisdiction it does not know', () => {
    const policy = resolveTaxPolicy({ country: 'JP' })

    expect(policy.resolved).toBe(false)
    expect(policy.rateBps).toBe(0)
    expect(policy.jurisdiction).toBeNull()
  })

  it('returns an unresolved policy when there is no venue country at all', () => {
    // Online events have no venue. Guessing a jurisdiction would be worse than
    // charging nothing and saying so.
    expect(resolveTaxPolicy({ country: null }).resolved).toBe(false)
    expect(resolveTaxPolicy({}).resolved).toBe(false)
  })

  it('ignores a policy that is not yet in effect', () => {
    const future = [
      {
        jurisdiction: 'XX',
        country: 'XX',
        region: null,
        name: 'Future tax',
        rateBps: 500,
        treatment: 'EXCLUSIVE',
        effectiveFrom: '2099-01-01',
        status: TAX_POLICY_STATUS.CONFIGURED,
      },
    ]

    expect(resolveTaxPolicy({ country: 'XX', at: '2026-01-01', policies: future }).resolved).toBe(false)
    expect(resolveTaxPolicy({ country: 'XX', at: '2100-01-01', policies: future }).rateBps).toBe(500)
  })
})

describe('production fails closed on unverified rates', () => {
  it('refuses a DEMO policy in production', () => {
    const policy = resolveTaxPolicy({ country: 'IN' })

    expect(policy.status).toBe(TAX_POLICY_STATUS.DEMO)
    expect(() => assertTaxPolicyUsable(policy, { environment: 'production' })).toThrow(PricingError)

    try {
      assertTaxPolicyUsable(policy, { environment: 'production' })
    } catch (error) {
      expect(error.code).toBe('TAX_POLICY_NOT_CONFIGURED')
    }
  })

  it('allows a DEMO policy outside production', () => {
    const policy = resolveTaxPolicy({ country: 'IN' })

    expect(assertTaxPolicyUsable(policy, { environment: 'development' })).toBe(policy)
    expect(assertTaxPolicyUsable(policy, { environment: 'test' })).toBe(policy)
  })

  it('allows a DEMO policy in production only on an explicit opt-in', () => {
    const policy = resolveTaxPolicy({ country: 'IN' })

    expect(assertTaxPolicyUsable(policy, { environment: 'production', allowDemo: true })).toBe(policy)
  })

  it('always allows a CONFIGURED policy', () => {
    const configured = { ...resolveTaxPolicy({ country: 'IN' }), status: TAX_POLICY_STATUS.CONFIGURED }

    expect(assertTaxPolicyUsable(configured, { environment: 'production' })).toBe(configured)
  })

  it('marks every shipped rate as DEMO', () => {
    // If any of these ever reads CONFIGURED, somebody has taken responsibility
    // for it — and this test should be updated deliberately, not by accident.
    for (const country of ['IN', 'US', 'GB']) {
      expect(resolveTaxPolicy({ country }).status).toBe(TAX_POLICY_STATUS.DEMO)
    }
    expect(resolveTaxPolicy({ country: 'CA', region: 'ON' }).status).toBe(TAX_POLICY_STATUS.DEMO)
  })
})

describe('pricing snapshot', () => {
  it('captures the terms an order was priced under', () => {
    const snapshot = buildPricingSnapshot({
      feeConfig: { percentageBps: 590, flatCents: 99, currency: 'INR' },
      taxPolicy: resolveTaxPolicy({ country: 'IN' }),
      currency: 'INR',
    })

    expect(snapshot.currency).toBe('INR')
    expect(snapshot.feeConfig).toEqual({ percentageBps: 590, flatCents: 99, currency: 'INR' })
    expect(snapshot.tax).toMatchObject({
      jurisdiction: 'IN',
      rateBps: 1_800,
      status: TAX_POLICY_STATUS.DEMO,
      version: TAX_POLICY_VERSION,
    })
  })

  it('survives a JSON round trip, since it is persisted as JSONB', () => {
    const snapshot = buildPricingSnapshot({
      feeConfig: { percentageBps: 250, flatCents: 500, currency: 'CAD' },
      taxPolicy: resolveTaxPolicy({ country: 'CA', region: 'ON' }),
      currency: 'CAD',
    })

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
  })
})
