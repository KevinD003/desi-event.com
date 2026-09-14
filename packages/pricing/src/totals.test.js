import { describe, expect, it } from 'vitest'

import { allocateProportionally, computeOrderTotals } from './totals.js'
import { DEFAULT_FEE_CONFIG } from './fees.js'
import { PROMO_TYPES } from './discount.js'
import { PricingError } from './errors.js'

const NOW = new Date('2026-06-15T12:00:00.000Z')
const NO_FEES = { percentageBps: 0, flatCents: 0, currency: 'INR' }

const percentagePromo = (value, overrides = {}) => ({
  code: 'DANDIYA',
  type: PROMO_TYPES.PERCENTAGE,
  value,
  active: true,
  ...overrides,
})

const fixedPromo = (value, overrides = {}) => ({
  code: 'FLAT500',
  type: PROMO_TYPES.FIXED_AMOUNT,
  value,
  active: true,
  ...overrides,
})

/** Every result must satisfy the accounting identity the Order columns rely on. */
function expectReconciled(totals) {
  const lineSum = totals.lineItems.reduce((sum, line) => sum + line.subtotalCents, 0)
  const lineDiscountSum = totals.lineItems.reduce((sum, line) => sum + line.discountCents, 0)

  expect(lineSum).toBe(totals.subtotalCents)
  expect(lineDiscountSum).toBe(totals.discountCents)
  expect(totals.subtotalCents - totals.discountCents + totals.feesCents + totals.taxCents).toBe(
    totals.totalCents,
  )
  for (const value of [
    totals.subtotalCents,
    totals.discountCents,
    totals.feesCents,
    totals.taxCents,
    totals.totalCents,
  ]) {
    expect(Number.isInteger(value)).toBe(true)
    expect(value).toBeGreaterThanOrEqual(0)
  }
  expect(totals.discountCents).toBeLessThanOrEqual(totals.subtotalCents)
}

describe('computeOrderTotals order of operations', () => {
  it('applies the discount before the fee, and taxes the fee as well as the tickets', () => {
    const totals = computeOrderTotals({
      items: [{ ticketTypeId: 'tt_ga', name: 'General', quantity: 1, unitPriceCents: 100_000 }],
      promoCode: percentagePromo(1_000),
      taxRateBps: 1_800,
      now: NOW,
    })

    expect(totals.subtotalCents).toBe(100_000)
    expect(totals.discountCents).toBe(10_000)
    // 2.5 % of the DISCOUNTED 90 000 (2250), not of 100 000 (2500), plus ₹5 flat.
    expect(totals.feesCents).toBe(2_750)
    // 18 % of (90 000 + 2 750).
    expect(totals.taxCents).toBe(16_695)
    expect(totals.totalCents).toBe(109_445)
    expectReconciled(totals)
  })

  it('charges no tax when no rate is given', () => {
    const totals = computeOrderTotals({
      items: [{ ticketTypeId: 'tt_ga', quantity: 2, unitPriceCents: 50_000 }],
      now: NOW,
    })

    expect(totals.taxCents).toBe(0)
    expect(totals.totalCents).toBe(100_000 + totals.feesCents)
    expectReconciled(totals)
  })

  it('rounds the tax half up', () => {
    // 12 345 × 10 % = 1234.5 exactly -> 1235.
    const totals = computeOrderTotals({
      items: [{ ticketTypeId: 'tt_ga', quantity: 1, unitPriceCents: 12_345 }],
      feeConfig: NO_FEES,
      taxRateBps: 1_000,
      now: NOW,
    })

    expect(totals.taxCents).toBe(1_235)
    expect(totals.totalCents).toBe(13_580)
    expectReconciled(totals)
  })
})

describe('computeOrderTotals with discounts', () => {
  it('makes a 100 per cent promo free, fees and tax included', () => {
    const totals = computeOrderTotals({
      items: [{ ticketTypeId: 'tt_ga', quantity: 3, unitPriceCents: 75_000 }],
      promoCode: percentagePromo(10_000),
      taxRateBps: 1_800,
      now: NOW,
    })

    expect(totals.subtotalCents).toBe(225_000)
    expect(totals.discountCents).toBe(225_000)
    expect(totals.feesCents).toBe(0)
    expect(totals.taxCents).toBe(0)
    expect(totals.totalCents).toBe(0)
    expectReconciled(totals)
  })

  it('clamps a fixed discount larger than the subtotal', () => {
    const totals = computeOrderTotals({
      items: [{ ticketTypeId: 'tt_ga', quantity: 1, unitPriceCents: 40_000 }],
      promoCode: fixedPromo(500_000),
      taxRateBps: 1_800,
      now: NOW,
    })

    expect(totals.discountCents).toBe(40_000)
    expect(totals.totalCents).toBe(0)
    expectReconciled(totals)
  })

  it('ignores an expired promo and charges the full price', () => {
    const items = [{ ticketTypeId: 'tt_ga', quantity: 1, unitPriceCents: 100_000 }]
    const expired = percentagePromo(1_000, { endsAt: '2026-01-01T00:00:00.000Z' })

    const totals = computeOrderTotals({ items, promoCode: expired, taxRateBps: 1_800, now: NOW })
    const undiscounted = computeOrderTotals({ items, taxRateBps: 1_800, now: NOW })

    expect(totals.discountCents).toBe(0)
    expect(totals).toEqual(undiscounted)
  })

  it('ignores an exhausted promo', () => {
    const totals = computeOrderTotals({
      items: [{ ticketTypeId: 'tt_ga', quantity: 1, unitPriceCents: 100_000 }],
      promoCode: percentagePromo(1_000, { maxRedemptions: 50, redemptionCount: 50 }),
      now: NOW,
    })

    expect(totals.discountCents).toBe(0)
    expectReconciled(totals)
  })

  it('spreads the discount across lines so the shares sum to the order discount', () => {
    const totals = computeOrderTotals({
      items: [
        { ticketTypeId: 'tt_a', quantity: 1, unitPriceCents: 3_333 },
        { ticketTypeId: 'tt_b', quantity: 1, unitPriceCents: 3_333 },
        { ticketTypeId: 'tt_c', quantity: 1, unitPriceCents: 3_334 },
      ],
      promoCode: percentagePromo(3_333),
      now: NOW,
    })

    expect(totals.subtotalCents).toBe(10_000)
    // 10 000 × 33.33 % = 3333 exactly.
    expect(totals.discountCents).toBe(3_333)
    expect(totals.lineItems.map((line) => line.discountCents)).toEqual([1_111, 1_111, 1_111])
    expectReconciled(totals)
  })
})

describe('computeOrderTotals line items', () => {
  it('returns a receipt-ready breakdown in input order', () => {
    const totals = computeOrderTotals({
      items: [
        { ticketTypeId: 'tt_vip', name: 'VIP', quantity: 2, unitPriceCents: 250_000 },
        { ticketTypeId: 'tt_ga', quantity: 3, unitPriceCents: 100_000 },
      ],
      taxRateBps: 1_800,
      now: NOW,
    })

    expect(totals.lineItems).toEqual([
      {
        ticketTypeId: 'tt_vip',
        name: 'VIP',
        quantity: 2,
        unitPriceCents: 250_000,
        subtotalCents: 500_000,
        discountCents: 0,
      },
      {
        ticketTypeId: 'tt_ga',
        name: null,
        quantity: 3,
        unitPriceCents: 100_000,
        subtotalCents: 300_000,
        discountCents: 0,
      },
    ])
    expect(totals.subtotalCents).toBe(800_000)
    // Five tickets: 2.5 % of 800 000 = 20 000, plus 5 × 500.
    expect(totals.feesCents).toBe(22_500)
    expectReconciled(totals)
  })

  it('reconciles across many awkward lines', () => {
    const items = Array.from({ length: 9 }, (_, index) => ({
      ticketTypeId: `tt_${index}`,
      quantity: index + 1,
      unitPriceCents: 1_111 * (index + 1) + 7,
    }))

    const totals = computeOrderTotals({
      items,
      promoCode: percentagePromo(1_733),
      taxRateBps: 1_800,
      now: NOW,
    })

    expectReconciled(totals)
    expect(totals.lineItems).toHaveLength(9)
  })

  it('handles zero-quantity lines and an empty order', () => {
    const zeroQuantity = computeOrderTotals({
      items: [
        { ticketTypeId: 'tt_ga', quantity: 0, unitPriceCents: 150_000 },
        { ticketTypeId: 'tt_vip', quantity: 0, unitPriceCents: 500_000 },
      ],
      promoCode: percentagePromo(1_000),
      taxRateBps: 1_800,
      now: NOW,
    })

    expect(zeroQuantity.subtotalCents).toBe(0)
    expect(zeroQuantity.discountCents).toBe(0)
    expect(zeroQuantity.feesCents).toBe(0)
    expect(zeroQuantity.taxCents).toBe(0)
    expect(zeroQuantity.totalCents).toBe(0)
    expect(zeroQuantity.lineItems).toHaveLength(2)
    expectReconciled(zeroQuantity)

    const empty = computeOrderTotals({ items: [], taxRateBps: 1_800, now: NOW })
    expect(empty.totalCents).toBe(0)
    expect(empty.lineItems).toEqual([])
  })

  it('prices free tickets at zero without charging a flat fee', () => {
    const totals = computeOrderTotals({
      items: [{ ticketTypeId: 'tt_free', quantity: 4, unitPriceCents: 0 }],
      taxRateBps: 1_800,
      now: NOW,
    })

    expect(totals.totalCents).toBe(0)
    expectReconciled(totals)
  })

  it('does not mutate its inputs', () => {
    const items = [{ ticketTypeId: 'tt_ga', quantity: 2, unitPriceCents: 100_000 }]
    const snapshot = structuredClone(items)

    computeOrderTotals({ items, promoCode: percentagePromo(1_000), now: NOW })

    expect(items).toEqual(snapshot)
  })
})

describe('computeOrderTotals currency handling', () => {
  it('defaults to the fee configuration currency', () => {
    const totals = computeOrderTotals({ items: [], now: NOW })
    expect(totals.currency).toBe(DEFAULT_FEE_CONFIG.currency)
  })

  it('normalises an explicit currency code', () => {
    const totals = computeOrderTotals({
      items: [{ ticketTypeId: 'tt_ga', quantity: 1, unitPriceCents: 1_000 }],
      currency: 'usd',
      feeConfig: { percentageBps: 250, flatCents: 30, currency: 'usd' },
      now: NOW,
    })

    expect(totals.currency).toBe('USD')
  })

  it('refuses a fee configuration denominated in another currency', () => {
    expect(() =>
      computeOrderTotals({
        items: [{ ticketTypeId: 'tt_ga', quantity: 1, unitPriceCents: 1_000 }],
        currency: 'INR',
        feeConfig: { percentageBps: 250, flatCents: 30, currency: 'USD' },
        now: NOW,
      }),
    ).toThrow(/does not match the order currency/)
  })
})

describe('computeOrderTotals input validation', () => {
  it('rejects a non-array items value', () => {
    expect(() => computeOrderTotals({ items: null, now: NOW })).toThrow(/items must be an array/)
  })

  it('rejects malformed items', () => {
    const bad = [
      [{ ticketTypeId: '', quantity: 1, unitPriceCents: 100 }, /ticketTypeId/],
      [{ quantity: 1, unitPriceCents: 100 }, /ticketTypeId/],
      [{ ticketTypeId: 'tt', quantity: -1, unitPriceCents: 100 }, /quantity/],
      [{ ticketTypeId: 'tt', quantity: 1.5, unitPriceCents: 100 }, /quantity/],
      [{ ticketTypeId: 'tt', quantity: 1, unitPriceCents: 10.5 }, /unitPriceCents/],
      [{ ticketTypeId: 'tt', quantity: 1, unitPriceCents: -10 }, /unitPriceCents/],
      [{ ticketTypeId: 'tt', quantity: 1, unitPriceCents: 100, name: 42 }, /name/],
    ]

    for (const [item, pattern] of bad) {
      expect(() => computeOrderTotals({ items: [item], now: NOW })).toThrow(pattern)
    }
    expect(() => computeOrderTotals({ items: [null], now: NOW })).toThrow(PricingError)
  })

  it('rejects an invalid tax rate', () => {
    expect(() =>
      computeOrderTotals({
        items: [{ ticketTypeId: 'tt', quantity: 1, unitPriceCents: 100 }],
        taxRateBps: -1,
        now: NOW,
      }),
    ).toThrow(/taxRateBps/)
  })

  it('names the offending item index in the error', () => {
    const error = (() => {
      try {
        computeOrderTotals({
          items: [
            { ticketTypeId: 'tt_a', quantity: 1, unitPriceCents: 100 },
            { ticketTypeId: 'tt_b', quantity: 1, unitPriceCents: -1 },
          ],
          now: NOW,
        })
        return null
      } catch (thrown) {
        return thrown
      }
    })()

    expect(error).toBeInstanceOf(PricingError)
    expect(error.message).toContain('items[1].unitPriceCents')
  })
})

describe('allocateProportionally', () => {
  it('distributes leftovers by largest remainder, ties by input order', () => {
    expect(allocateProportionally(10, [1, 1, 1])).toEqual([4, 3, 3])
    expect(allocateProportionally(100, [1, 3])).toEqual([25, 75])
    expect(allocateProportionally(7, [1, 1, 1, 1])).toEqual([2, 2, 2, 1])
  })

  it('always sums exactly to the amount', () => {
    const weights = [1_111, 2_222, 3_333, 4_447]
    for (const total of [0, 1, 2, 3, 97, 12_345]) {
      const shares = allocateProportionally(total, weights)
      expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total)
    }
  })

  it('returns zeros when there is nothing to split or nothing to split across', () => {
    expect(allocateProportionally(0, [5, 5])).toEqual([0, 0])
    expect(allocateProportionally(100, [0, 0])).toEqual([0, 0])
    expect(allocateProportionally(100, [])).toEqual([])
  })

  it('gives everything to a single bucket', () => {
    expect(allocateProportionally(999, [42])).toEqual([999])
  })

  it('rejects invalid inputs', () => {
    expect(() => allocateProportionally(-1, [1])).toThrow(PricingError)
    expect(() => allocateProportionally(10, 'nope')).toThrow(/weights must be an array/)
    expect(() => allocateProportionally(10, [-1])).toThrow(PricingError)
  })
})
