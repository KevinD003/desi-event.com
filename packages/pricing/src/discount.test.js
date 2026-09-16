import { describe, expect, it } from 'vitest'

import {
  PROMO_REJECTION_REASONS,
  PROMO_TYPES,
  computeDiscount,
  evaluatePromoCode,
  normalisePromoCode,
  toDate,
} from './discount.js'
import { PricingError } from './errors.js'

const NOW = new Date('2026-06-15T12:00:00.000Z')

/**
 * Build a promo code record with sensible defaults, mirroring the shape Prisma
 * returns for the `PromoCode` model.
 */
function promo(overrides = {}) {
  return {
    code: 'GARBA10',
    type: PROMO_TYPES.PERCENTAGE,
    value: 1_000,
    active: true,
    startsAt: null,
    endsAt: null,
    maxRedemptions: null,
    redemptionCount: 0,
    ...overrides,
  }
}

describe('computeDiscount without a promo code', () => {
  it('returns zero when no promo code is supplied', () => {
    expect(computeDiscount({ subtotalCents: 100_000, now: NOW })).toBe(0)
    expect(computeDiscount({ subtotalCents: 100_000, promoCode: null, now: NOW })).toBe(0)
  })

  it('does not require a clock when there is no promo code', () => {
    expect(computeDiscount({ subtotalCents: 100_000 })).toBe(0)
  })
})

describe('computeDiscount for PERCENTAGE promos', () => {
  it('treats the value as basis points', () => {
    // 1000 bps = 10 % of ₹1000.
    expect(computeDiscount({ subtotalCents: 100_000, promoCode: promo(), now: NOW })).toBe(10_000)
    expect(
      computeDiscount({ subtotalCents: 100_000, promoCode: promo({ value: 250 }), now: NOW }),
    ).toBe(2_500)
  })

  it('rounds half up', () => {
    // 1005 × 10 % = 100.5 exactly -> 101.
    expect(computeDiscount({ subtotalCents: 1_005, promoCode: promo(), now: NOW })).toBe(101)
    // 1004 × 10 % = 100.4 -> 100.
    expect(computeDiscount({ subtotalCents: 1_004, promoCode: promo(), now: NOW })).toBe(100)
    // 1999 × 2.5 % = 49.975 -> 50.
    expect(
      computeDiscount({ subtotalCents: 1_999, promoCode: promo({ value: 250 }), now: NOW }),
    ).toBe(50)
  })

  it('handles a 100 per cent promo', () => {
    expect(
      computeDiscount({ subtotalCents: 123_457, promoCode: promo({ value: 10_000 }), now: NOW }),
    ).toBe(123_457)
  })

  it('clamps a promo above 100 per cent to the subtotal', () => {
    expect(
      computeDiscount({ subtotalCents: 50_000, promoCode: promo({ value: 25_000 }), now: NOW }),
    ).toBe(50_000)
  })

  it('returns zero on a zero subtotal', () => {
    expect(
      computeDiscount({ subtotalCents: 0, promoCode: promo({ value: 10_000 }), now: NOW }),
    ).toBe(0)
  })
})

describe('computeDiscount for FIXED_AMOUNT promos', () => {
  // A flat discount is denominated, so every fixture names its currency.
  const fixed = (value) => promo({ type: PROMO_TYPES.FIXED_AMOUNT, value, currency: 'INR' })

  it('treats the value as minor units', () => {
    expect(computeDiscount({ subtotalCents: 100_000, promoCode: fixed(25_000), now: NOW })).toBe(
      25_000,
    )
  })

  it('never discounts more than the subtotal', () => {
    expect(computeDiscount({ subtotalCents: 10_000, promoCode: fixed(50_000), now: NOW })).toBe(
      10_000,
    )
    expect(computeDiscount({ subtotalCents: 0, promoCode: fixed(50_000), now: NOW })).toBe(0)
  })

  it('allows a discount exactly equal to the subtotal', () => {
    expect(computeDiscount({ subtotalCents: 50_000, promoCode: fixed(50_000), now: NOW })).toBe(
      50_000,
    )
  })
})

describe('promo validity', () => {
  it('rejects an inactive code', () => {
    const code = promo({ active: false })

    expect(evaluatePromoCode({ promoCode: code, now: NOW })).toEqual({
      applicable: false,
      reason: PROMO_REJECTION_REASONS.INACTIVE,
    })
    expect(computeDiscount({ subtotalCents: 100_000, promoCode: code, now: NOW })).toBe(0)
  })

  it('treats startsAt as inclusive', () => {
    const code = promo({ startsAt: NOW })

    expect(evaluatePromoCode({ promoCode: code, now: NOW }).applicable).toBe(true)
    expect(computeDiscount({ subtotalCents: 100_000, promoCode: code, now: NOW })).toBe(10_000)

    const oneMsEarlier = new Date(NOW.getTime() - 1)
    expect(evaluatePromoCode({ promoCode: code, now: oneMsEarlier })).toEqual({
      applicable: false,
      reason: PROMO_REJECTION_REASONS.NOT_STARTED,
    })
    expect(computeDiscount({ subtotalCents: 100_000, promoCode: code, now: oneMsEarlier })).toBe(0)
  })

  it('treats endsAt as exclusive', () => {
    const code = promo({ endsAt: NOW })

    expect(evaluatePromoCode({ promoCode: code, now: NOW })).toEqual({
      applicable: false,
      reason: PROMO_REJECTION_REASONS.EXPIRED,
    })
    expect(computeDiscount({ subtotalCents: 100_000, promoCode: code, now: NOW })).toBe(0)

    const oneMsEarlier = new Date(NOW.getTime() - 1)
    expect(evaluatePromoCode({ promoCode: code, now: oneMsEarlier }).applicable).toBe(true)
  })

  it('honours a closed window', () => {
    const code = promo({ startsAt: '2026-06-01T00:00:00.000Z', endsAt: '2026-07-01T00:00:00.000Z' })

    expect(evaluatePromoCode({ promoCode: code, now: NOW }).applicable).toBe(true)
    expect(evaluatePromoCode({ promoCode: code, now: '2026-05-31T23:59:59.999Z' }).reason).toBe(
      'NOT_STARTED',
    )
    expect(evaluatePromoCode({ promoCode: code, now: '2026-07-01T00:00:00.000Z' }).reason).toBe(
      'EXPIRED',
    )
  })

  it('rejects an exhausted code and accepts one with redemptions left', () => {
    const exhausted = promo({ maxRedemptions: 100, redemptionCount: 100 })
    const overshot = promo({ maxRedemptions: 100, redemptionCount: 101 })
    const remaining = promo({ maxRedemptions: 100, redemptionCount: 99 })

    expect(evaluatePromoCode({ promoCode: exhausted, now: NOW })).toEqual({
      applicable: false,
      reason: PROMO_REJECTION_REASONS.EXHAUSTED,
    })
    expect(evaluatePromoCode({ promoCode: overshot, now: NOW }).reason).toBe('EXHAUSTED')
    expect(evaluatePromoCode({ promoCode: remaining, now: NOW }).applicable).toBe(true)
    expect(computeDiscount({ subtotalCents: 100_000, promoCode: exhausted, now: NOW })).toBe(0)
    expect(computeDiscount({ subtotalCents: 100_000, promoCode: remaining, now: NOW })).toBe(10_000)
  })

  it('treats a null maxRedemptions as unlimited and zero as immediately exhausted', () => {
    expect(
      evaluatePromoCode({ promoCode: promo({ redemptionCount: 9_999 }), now: NOW }).applicable,
    ).toBe(true)
    expect(evaluatePromoCode({ promoCode: promo({ maxRedemptions: 0 }), now: NOW }).reason).toBe(
      'EXHAUSTED',
    )
  })

  it('defaults active to true and redemptionCount to zero for partial records', () => {
    const minimal = { type: PROMO_TYPES.FIXED_AMOUNT, value: 5_000, currency: 'INR' }

    expect(evaluatePromoCode({ promoCode: minimal, now: NOW }).applicable).toBe(true)
    expect(computeDiscount({ subtotalCents: 100_000, promoCode: minimal, now: NOW })).toBe(5_000)
  })

  it('reports inactivity before expiry, so the reason is the most fundamental one', () => {
    const code = promo({ active: false, endsAt: '2020-01-01T00:00:00.000Z' })
    expect(evaluatePromoCode({ promoCode: code, now: NOW }).reason).toBe('INACTIVE')
  })
})

describe('promo input validation', () => {
  it('throws on an unknown promo type', () => {
    expect(() =>
      computeDiscount({ subtotalCents: 1_000, promoCode: promo({ type: 'BOGO' }), now: NOW }),
    ).toThrow(/PERCENTAGE or FIXED_AMOUNT/)
  })

  it('throws on fractional or negative values', () => {
    expect(() => normalisePromoCode(promo({ value: 10.5 }))).toThrow(PricingError)
    expect(() => normalisePromoCode(promo({ value: -100 }))).toThrow(/must not be negative/)
    expect(() => normalisePromoCode(promo({ redemptionCount: -1 }))).toThrow(PricingError)
    expect(() => normalisePromoCode(promo({ maxRedemptions: -1 }))).toThrow(PricingError)
    expect(() => normalisePromoCode(null)).toThrow(/must be an object/)
  })

  it('throws when a promo code is supplied without a clock', () => {
    expect(() => computeDiscount({ subtotalCents: 1_000, promoCode: promo() })).toThrow(
      PricingError,
    )
  })

  it('throws on unparseable dates', () => {
    expect(() => normalisePromoCode(promo({ startsAt: 'yesterday' }))).toThrow(/Date, ISO 8601/)
    expect(() => evaluatePromoCode({ promoCode: promo(), now: 'soon' })).toThrow(/Date, ISO 8601/)
  })

  it('accepts Date, ISO string and epoch milliseconds alike', () => {
    expect(toDate(NOW, 'now')).toEqual(NOW)
    expect(toDate('2026-06-15T12:00:00.000Z', 'now').getTime()).toBe(NOW.getTime())
    expect(toDate(NOW.getTime(), 'now').getTime()).toBe(NOW.getTime())
    expect(() => toDate({}, 'now')).toThrow(PricingError)
  })

  it('never reads the clock itself: the same inputs always give the same answer', () => {
    const code = promo({ endsAt: '2020-01-01T00:00:00.000Z' })
    const before = evaluatePromoCode({ promoCode: code, now: '2019-12-31T23:59:59.999Z' })

    expect(before.applicable).toBe(true)
    expect(evaluatePromoCode({ promoCode: code, now: '2019-12-31T23:59:59.999Z' })).toEqual(before)
  })
})

describe('FIXED_AMOUNT promos are denominated', () => {
  // Regression guard. A flat discount carried no currency, so an
  // organisation-wide "₹500 off" campaign quoted against a CAD order took
  // CA$500 off at face value — roughly a hundred times the intended discount.
  const inr = { type: PROMO_TYPES.FIXED_AMOUNT, value: 50_000, currency: 'INR', active: true }

  it('applies when the order currency matches', () => {
    expect(
      computeDiscount({ subtotalCents: 200_000, promoCode: inr, currency: 'INR', now: NOW }),
    ).toBe(50_000)
  })

  it('is case-insensitive about the currency code', () => {
    expect(
      computeDiscount({
        subtotalCents: 200_000,
        promoCode: { ...inr, currency: 'inr' },
        currency: 'INR',
        now: NOW,
      }),
    ).toBe(50_000)
  })

  it('yields nothing against a different currency instead of converting', () => {
    expect(
      computeDiscount({ subtotalCents: 200_000, promoCode: inr, currency: 'CAD', now: NOW }),
    ).toBe(0)

    const evaluation = evaluatePromoCode({ promoCode: inr, currency: 'CAD', now: NOW })
    expect(evaluation.applicable).toBe(false)
    expect(evaluation.reason).toBe(PROMO_REJECTION_REASONS.CURRENCY_MISMATCH)
  })

  it('yields nothing when the promo records no currency at all', () => {
    const undenominated = { type: PROMO_TYPES.FIXED_AMOUNT, value: 50_000, active: true }

    expect(
      computeDiscount({
        subtotalCents: 200_000,
        promoCode: undenominated,
        currency: 'INR',
        now: NOW,
      }),
    ).toBe(0)
    expect(evaluatePromoCode({ promoCode: undenominated, currency: 'INR', now: NOW }).reason).toBe(
      PROMO_REJECTION_REASONS.CURRENCY_MISSING,
    )
  })

  it('leaves percentage promos currency-neutral', () => {
    const percentage = { type: PROMO_TYPES.PERCENTAGE, value: 1_000, active: true }

    for (const currency of ['INR', 'CAD', 'GBP']) {
      expect(
        computeDiscount({ subtotalCents: 200_000, promoCode: percentage, currency, now: NOW }),
      ).toBe(20_000)
    }
  })
})
