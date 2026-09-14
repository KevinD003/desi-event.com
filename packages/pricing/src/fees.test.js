import { describe, expect, it } from 'vitest'

import { DEFAULT_FEE_CONFIG, computePlatformFee, normaliseFeeConfig } from './fees.js'
import { PricingError } from './errors.js'

const NO_FLAT = { percentageBps: 250, flatCents: 0, currency: 'INR' }

describe('DEFAULT_FEE_CONFIG', () => {
  it('is 2.5 per cent plus a flat per-ticket amount, in INR', () => {
    expect(DEFAULT_FEE_CONFIG).toEqual({ percentageBps: 250, flatCents: 500, currency: 'INR' })
  })

  it('is frozen so that a caller cannot mutate platform terms process-wide', () => {
    expect(Object.isFrozen(DEFAULT_FEE_CONFIG)).toBe(true)
  })
})

describe('computePlatformFee', () => {
  it('charges the percentage plus a flat amount per ticket', () => {
    // ₹1000 subtotal, two tickets: 2.5 % = 2500 paise, plus 2 × 500 paise.
    expect(computePlatformFee({ subtotalCents: 100_000, quantity: 2 })).toBe(3_500)
  })

  it('defaults to a single ticket when no quantity is given', () => {
    expect(computePlatformFee({ subtotalCents: 100_000 })).toBe(2_500 + 500)
  })

  it('charges no flat component for a zero quantity', () => {
    expect(computePlatformFee({ subtotalCents: 100_000, quantity: 0 })).toBe(2_500)
  })

  it('rounds the percentage component half up', () => {
    // 1999 × 2.5 % = 49.975 -> 50.
    expect(computePlatformFee({ subtotalCents: 1_999, quantity: 1, feeConfig: NO_FLAT })).toBe(50)
    // 20 × 2.5 % = 0.5 exactly -> 1.
    expect(computePlatformFee({ subtotalCents: 20, quantity: 1, feeConfig: NO_FLAT })).toBe(1)
    // 19 × 2.5 % = 0.475 -> 0.
    expect(computePlatformFee({ subtotalCents: 19, quantity: 1, feeConfig: NO_FLAT })).toBe(0)
  })

  it('charges nothing at all on a zero subtotal, however many tickets', () => {
    // Free tickets, and orders fully covered by a promo, cost the buyer nothing.
    expect(computePlatformFee({ subtotalCents: 0, quantity: 10 })).toBe(0)
  })

  it('supports a fee-free configuration', () => {
    const free = { percentageBps: 0, flatCents: 0, currency: 'INR' }
    expect(computePlatformFee({ subtotalCents: 999_999, quantity: 4, feeConfig: free })).toBe(0)
  })

  it('scales the flat component linearly with the ticket count', () => {
    const flatOnly = { percentageBps: 0, flatCents: 250, currency: 'INR' }
    expect(computePlatformFee({ subtotalCents: 50_000, quantity: 7, feeConfig: flatOnly })).toBe(1_750)
  })

  it('rejects invalid subtotals and quantities', () => {
    expect(() => computePlatformFee({ subtotalCents: -1 })).toThrow(PricingError)
    expect(() => computePlatformFee({ subtotalCents: 10.5 })).toThrow(PricingError)
    expect(() => computePlatformFee({ subtotalCents: 100, quantity: -2 })).toThrow(PricingError)
  })

  it('rejects malformed fee configurations', () => {
    expect(() => computePlatformFee({ subtotalCents: 100, feeConfig: null })).toThrow(/object/)
    expect(() =>
      computePlatformFee({ subtotalCents: 100, feeConfig: { percentageBps: 2.5, flatCents: 0, currency: 'INR' } }),
    ).toThrow(/integer/)
    expect(() =>
      computePlatformFee({ subtotalCents: 100, feeConfig: { percentageBps: 250, flatCents: -1, currency: 'INR' } }),
    ).toThrow(PricingError)
    expect(() =>
      computePlatformFee({ subtotalCents: 100, feeConfig: { percentageBps: 250, flatCents: 0, currency: 'RUPEE' } }),
    ).toThrow(/ISO 4217/)
  })
})

describe('normaliseFeeConfig', () => {
  it('upper-cases the currency and returns a copy', () => {
    const input = { percentageBps: 100, flatCents: 200, currency: 'usd' }
    const normalised = normaliseFeeConfig(input)

    expect(normalised).toEqual({ percentageBps: 100, flatCents: 200, currency: 'USD' })
    expect(normalised).not.toBe(input)
    expect(input.currency).toBe('usd')
  })

  it('falls back to the platform default', () => {
    expect(normaliseFeeConfig()).toEqual({ ...DEFAULT_FEE_CONFIG })
  })
})
