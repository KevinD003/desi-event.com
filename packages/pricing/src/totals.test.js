import { describe, expect, it } from 'vitest'

import {
  AT_VENUE_TAXES_BOOKING_FEE,
  PAYMENT_METHODS,
  allocateProportionally,
  computeOrderTotals,
  splitAcrossTickets,
  unitsWithShare,
} from './totals.js'
import { DEFAULT_FEE_CONFIG } from './fees.js'
import { PROMO_TYPES } from './discount.js'
import { PricingError } from './errors.js'
import { MAX_CENTS, applyBps } from './money.js'
import { resolveTaxPolicy } from './tax.js'

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
  currency: 'INR',
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

  it('returns zeros when there is nothing to split', () => {
    expect(allocateProportionally(0, [5, 5])).toEqual([0, 0])
  })

  it('refuses to split a non-zero amount across nothing', () => {
    // Previously returned zeros, which silently discarded the amount. An
    // allocation that does not sum to its input is a lost-money bug, so these
    // now throw instead.
    expect(() => allocateProportionally(100, [0, 0])).toThrow(PricingError)
    expect(() => allocateProportionally(100, [])).toThrow(PricingError)
    expect(allocateProportionally(0, [])).toEqual([])
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

describe('allocateProportionally at scale', () => {
  // Regression guard for a real defect. The intermediate `total * weight` was
  // computed in doubles, so although each operand is valid up to MAX_CENTS
  // (1e12) their product overflowed Number.MAX_SAFE_INTEGER. The effective
  // ceiling was about 9.4e7 minor units: allocating a ₹1,000,000 discount
  // across a line of the same size threw AMOUNT_OUT_OF_RANGE and refused a
  // legitimate order.
  const scales = [
    ['a hundred rupees', 10_000, [50_000, 30_000]],
    ['ten lakh rupees', 100_000_000, [100_000_000, 50_000_000]],
    ['one crore rupees', 1_000_000_000, [1_000_000_000, 500_000_000]],
    ['the documented maximum', MAX_CENTS, [MAX_CENTS, 1]],
  ]

  for (const [name, total, weights] of scales) {
    it(`allocates ${name} exactly`, () => {
      const shares = allocateProportionally(total, weights)

      expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total)
      for (const share of shares) expect(Number.isSafeInteger(share)).toBe(true)
    })
  }

  it('never loses or invents a minor unit, whatever the weights', () => {
    // Exhaustive over awkward remainders: three-way splits of every total from
    // 0 to 200 must still sum exactly.
    for (let total = 0; total <= 200; total += 1) {
      const shares = allocateProportionally(total, [1, 1, 1])
      expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total)
    }
  })

  it('refuses to allocate a non-zero amount across zero total weight', () => {
    // Returning zeros here would silently discard money: the discount would
    // vanish from the breakdown while still reducing the order total.
    expect(() => allocateProportionally(500, [0, 0])).toThrow(PricingError)
    expect(allocateProportionally(0, [0, 0])).toEqual([0, 0])
  })

  it('rejects non-integer and adversarial inputs', () => {
    expect(() => allocateProportionally(10.5, [1])).toThrow(PricingError)
    expect(() => allocateProportionally(100, [1.5])).toThrow(PricingError)
    expect(() => allocateProportionally(-1, [1])).toThrow(PricingError)
    expect(() => allocateProportionally(100, [-1])).toThrow(PricingError)
    expect(() => allocateProportionally(MAX_CENTS + 1, [1])).toThrow(PricingError)
    expect(() => allocateProportionally(Number.NaN, [1])).toThrow(PricingError)
    expect(() => allocateProportionally(Number.POSITIVE_INFINITY, [1])).toThrow(PricingError)
    expect(() => allocateProportionally(100, 'nope')).toThrow(PricingError)
  })
})

// ---------------------------------------------------------------------------
// SPEC3 §6: the booking fee's waiver and paying at the venue
// ---------------------------------------------------------------------------

describe('computeOrderTotals: the worked examples of SPEC3 §6.2', () => {
  const US = 0
  const ONTARIO = resolveTaxPolicy({ country: 'CA', region: 'ON' }).rateBps
  const SITE_DEFAULT_USD = { percentageBps: 590, flatCents: 99, currency: 'USD' }
  const EVENT_TERMS = { percentageBps: 300, flatCents: 149, currency: 'USD' }
  const forty = (quantity = 1, id = 'tt_forty') => ({
    ticketTypeId: id,
    quantity,
    unitPriceCents: 4_000,
  })
  const quarterOff = {
    code: 'QUARTER',
    type: PROMO_TYPES.PERCENTAGE,
    value: 2_500,
    active: true,
  }

  /**
   * One row of the table: the inputs, and G, W, F, T, online and at the door.
   *
   * @type {Array<Array<*>>} Each row: a label, the inputs, and `{G, W, F, T, online, door}`.
   */
  const ROWS = [
    [
      '1 × $40, US, site default, card',
      { items: [forty()], feeConfig: SITE_DEFAULT_USD, taxRateBps: US },
      { G: 335, W: 0, F: 335, T: 0, online: 4_335, door: 0 },
    ],
    [
      '2 × $40, US, event 3.00% + $1.49, card',
      { items: [forty(2)], feeConfig: EVENT_TERMS, taxRateBps: US },
      { G: 538, W: 0, F: 538, T: 0, online: 8_538, door: 0 },
    ],
    [
      '2 × $40, US, event terms, at the venue',
      { items: [forty(2)], feeConfig: EVENT_TERMS, taxRateBps: US, paymentMethod: 'AT_VENUE' },
      { G: 538, W: 0, F: 538, T: 0, online: 538, door: 8_000 },
    ],
    [
      '2 × $40 + referral, US, event terms, at the venue',
      {
        items: [forty(2)],
        feeConfig: EVENT_TERMS,
        taxRateBps: US,
        paymentMethod: 'AT_VENUE',
        feeWaived: true,
      },
      { G: 538, W: 538, F: 0, T: 0, online: 0, door: 8_000 },
    ],
    [
      '2 × $40, 25% promo, referral, US, event terms, card',
      {
        items: [forty(2)],
        feeConfig: EVENT_TERMS,
        taxRateBps: US,
        promoCode: quarterOff,
        now: NOW,
        feeWaived: true,
      },
      { G: 478, W: 478, F: 0, T: 0, online: 6_000, door: 0 },
    ],
    [
      '$40 + $0, US, event terms, at the venue',
      {
        items: [forty(1), { ticketTypeId: 'tt_free', quantity: 1, unitPriceCents: 0 }],
        feeConfig: EVENT_TERMS,
        taxRateBps: US,
        paymentMethod: 'AT_VENUE',
      },
      { G: 418, W: 0, F: 418, T: 0, online: 418, door: 4_000 },
    ],
    [
      '2 × $0, US, any terms, card, a referral code named',
      {
        items: [{ ticketTypeId: 'tt_free', quantity: 2, unitPriceCents: 0 }],
        feeConfig: EVENT_TERMS,
        taxRateBps: US,
        feeWaived: true,
      },
      { G: 0, W: 0, F: 0, T: 0, online: 0, door: 0 },
    ],
    [
      '1 × $40, Ontario, site default, card',
      { items: [forty()], feeConfig: SITE_DEFAULT_USD, taxRateBps: ONTARIO },
      { G: 335, W: 0, F: 335, T: 564, online: 4_899, door: 0 },
    ],
    [
      '1 × $40 + referral, Ontario, site default, card',
      { items: [forty()], feeConfig: SITE_DEFAULT_USD, taxRateBps: ONTARIO, feeWaived: true },
      { G: 335, W: 335, F: 0, T: 520, online: 4_520, door: 0 },
    ],
    [
      '1 × $40, Ontario, site default, at the venue',
      {
        items: [forty()],
        feeConfig: SITE_DEFAULT_USD,
        taxRateBps: ONTARIO,
        paymentMethod: 'AT_VENUE',
      },
      { G: 335, W: 0, F: 335, T: 0, online: 335, door: 4_000 },
    ],
    [
      '1 × $40, Ontario, site default, at the venue, question 9 answered "yes"',
      {
        items: [forty()],
        feeConfig: SITE_DEFAULT_USD,
        taxRateBps: ONTARIO,
        paymentMethod: 'AT_VENUE',
        atVenueTaxesBookingFee: true,
      },
      { G: 335, W: 0, F: 335, T: 44, online: 379, door: 4_000 },
    ],
  ]

  it('takes the Ontario rate from the DEMO HST policy (13%)', () => {
    expect(ONTARIO).toBe(1_300)
  })

  it.each(ROWS)('%s', (_label, input, expected) => {
    const totals = computeOrderTotals({ currency: 'USD', ...input })

    expect({
      G: totals.feeGrossCents,
      W: totals.feeWaivedCents,
      F: totals.feesCents,
      T: totals.taxCents,
      online: totals.totalCents,
      door: totals.venueDueCents,
    }).toEqual(expected)
    // What is paid, wherever, is the ticket price after the promo, the fee
    // charged and the tax charged.
    expect(totals.totalCents + totals.venueDueCents).toBe(
      totals.subtotalCents - totals.discountCents + totals.feesCents + totals.taxCents,
    )
  })
})

describe('computeOrderTotals: card orders with the defaults are unchanged', () => {
  const CASES = [
    {
      items: [{ ticketTypeId: 'a', quantity: 3, unitPriceCents: 1_999 }],
      taxRateBps: 1_800,
    },
    {
      items: [
        { ticketTypeId: 'a', quantity: 2, unitPriceCents: 4_000 },
        { ticketTypeId: 'b', quantity: 1, unitPriceCents: 2_500 },
      ],
      promoCode: percentagePromo(1_500),
      taxRateBps: 1_300,
      now: NOW,
    },
    { items: [{ ticketTypeId: 'a', quantity: 1, unitPriceCents: 0 }] },
    { items: [] },
  ]

  it.each(CASES.map((input, index) => [index, input]))(
    'case %i: today’s fields, a gross fee equal to the fee, nothing waived, nothing due at the door',
    (_index, input) => {
      const totals = computeOrderTotals(input)
      const explicit = computeOrderTotals({ ...input, paymentMethod: 'CARD', feeWaived: false })

      expect(explicit).toEqual(totals)
      expect(totals.feeGrossCents).toBe(totals.feesCents)
      expect(totals.feeWaivedCents).toBe(0)
      expect(totals.venueDueCents).toBe(0)
      expect(totals.taxApplied).toBe(true)
      expect(totals.taxAppliedTo).toBe('TICKETS_AND_FEE')
      expect(totals.lineItems.every((line) => !('venueDueCents' in line))).toBe(true)
      expectReconciled(totals)
    },
  )

  it('still charges the fee and its tax on the discounted subtotal (today’s numbers)', () => {
    const totals = computeOrderTotals({
      items: [{ ticketTypeId: 'tt_ga', name: 'General', quantity: 1, unitPriceCents: 100_000 }],
      promoCode: percentagePromo(1_000),
      taxRateBps: 1_800,
      now: NOW,
    })

    // 90,000 after the promo; 2.5% + ₹5 = 2,750; 18% of 92,750 = 16,695.
    expect(totals).toMatchObject({
      subtotalCents: 100_000,
      discountCents: 10_000,
      feesCents: 2_750,
      taxCents: 16_695,
      totalCents: 109_445,
    })
  })
})

describe('computeOrderTotals: paying at the venue', () => {
  const items = [
    { ticketTypeId: 'a', quantity: 2, unitPriceCents: 3_333 },
    { ticketTypeId: 'b', quantity: 1, unitPriceCents: 1_000 },
  ]

  it.each([0, 1_300, 1_800, 2_000])(
    'adds no tax at %i basis points, and charges online only the fee and its tax',
    (taxRateBps) => {
      const totals = computeOrderTotals({
        items,
        promoCode: percentagePromo(1_000),
        now: NOW,
        taxRateBps,
        paymentMethod: 'AT_VENUE',
      })

      expect(totals.taxCents).toBe(0)
      expect(totals.taxApplied).toBe(false)
      expect(totals.taxAppliedTo).toBe('NOTHING')
      expect(totals.totalCents).toBe(totals.feesCents + totals.taxCents)
      expect(totals.venueDueCents).toBe(totals.subtotalCents - totals.discountCents)
    },
  )

  it('gives each line its ticket price after its share of the promo, summing to the order', () => {
    const totals = computeOrderTotals({
      items,
      promoCode: percentagePromo(1_000),
      now: NOW,
      paymentMethod: 'AT_VENUE',
    })

    for (const line of totals.lineItems) {
      expect(line.venueDueCents).toBe(line.subtotalCents - line.discountCents)
    }
    expect(totals.lineItems.reduce((sum, line) => sum + line.venueDueCents, 0)).toBe(
      totals.venueDueCents,
    )
  })

  it('charges the same booking fee as a card order would', () => {
    const card = computeOrderTotals({ items, taxRateBps: 1_300 })
    const venue = computeOrderTotals({ items, taxRateBps: 1_300, paymentMethod: 'AT_VENUE' })

    expect(venue.feeGrossCents).toBe(card.feeGrossCents)
    expect(venue.feesCents).toBe(card.feesCents)
  })

  it('owes nothing at the door, and has no fee, when the ticket price is 0', () => {
    const totals = computeOrderTotals({
      items: [{ ticketTypeId: 'free', quantity: 2, unitPriceCents: 0 }],
      paymentMethod: 'AT_VENUE',
    })

    expect(totals).toMatchObject({
      feeGrossCents: 0,
      feesCents: 0,
      venueDueCents: 0,
      totalCents: 0,
    })
  })

  it('refuses a payment method it does not know', () => {
    expect(() => computeOrderTotals({ items, paymentMethod: 'CASH' })).toThrow(PricingError)
    expect(() => computeOrderTotals({ items, paymentMethod: 'CASH' })).toThrow(
      expect.objectContaining({ code: 'INVALID_PAYMENT_METHOD' }),
    )
  })
})

describe('computeOrderTotals: a referral code waives the whole booking fee', () => {
  const items = [{ ticketTypeId: 'a', quantity: 2, unitPriceCents: 4_000 }]

  it('keeps the gross fee, charges none, and takes the waived fee out of a card order’s tax base', () => {
    const plain = computeOrderTotals({ items, taxRateBps: 1_300 })
    const waived = computeOrderTotals({ items, taxRateBps: 1_300, feeWaived: true })

    expect(waived.feeGrossCents).toBe(plain.feesCents)
    expect(waived.feeWaivedCents).toBe(plain.feesCents)
    expect(waived.feesCents).toBe(0)
    expect(waived.taxCents).toBe(applyBps(waived.subtotalCents, 1_300))
    expect(waived.totalCents).toBe(waived.subtotalCents + waived.taxCents)
    expectReconciled(waived)
  })

  it('never touches the ticket price or the promo', () => {
    const plain = computeOrderTotals({
      items,
      promoCode: percentagePromo(2_500),
      now: NOW,
    })
    const waived = computeOrderTotals({
      items,
      promoCode: percentagePromo(2_500),
      now: NOW,
      feeWaived: true,
    })

    expect(waived.subtotalCents).toBe(plain.subtotalCents)
    expect(waived.discountCents).toBe(plain.discountCents)
    expect(waived.lineItems.map((line) => line.discountCents)).toEqual(
      plain.lineItems.map((line) => line.discountCents),
    )
  })

  it('waives nothing when the basket is free (the gross fee is 0)', () => {
    const totals = computeOrderTotals({
      items: [{ ticketTypeId: 'free', quantity: 3, unitPriceCents: 0 }],
      feeWaived: true,
    })

    expect(totals).toMatchObject({ feeGrossCents: 0, feeWaivedCents: 0, feesCents: 0 })
  })

  it('waives nothing when a 100% promo makes the tickets free', () => {
    const totals = computeOrderTotals({
      items,
      promoCode: percentagePromo(10_000),
      now: NOW,
      feeWaived: true,
    })

    expect(totals).toMatchObject({ feeGrossCents: 0, feeWaivedCents: 0, totalCents: 0 })
  })

  it('refuses a waiver that is not a boolean', () => {
    expect(() => computeOrderTotals({ items, feeWaived: 'yes' })).toThrow(
      expect.objectContaining({ code: 'INVALID_FEE_WAIVER' }),
    )
    expect(() => computeOrderTotals({ items, atVenueTaxesBookingFee: 1 })).toThrow(
      expect.objectContaining({ code: 'INVALID_TAX_OPTION' }),
    )
  })
})

describe('AT_VENUE_TAXES_BOOKING_FEE and PAYMENT_METHODS', () => {
  it('adds no tax to the online fee of a pay-at-the-venue order by default (open question 9)', () => {
    expect(AT_VENUE_TAXES_BOOKING_FEE).toBe(false)
  })

  it('names the two payment methods the database knows', () => {
    expect(PAYMENT_METHODS).toEqual({ CARD: 'CARD', AT_VENUE: 'AT_VENUE' })
    expect(Object.isFrozen(PAYMENT_METHODS)).toBe(true)
  })
})

describe('splitAcrossTickets', () => {
  it('sums exactly to the amount, the first tickets taking the extra cents', () => {
    expect(splitAcrossTickets(1_000, 3)).toEqual([334, 333, 333])
    expect(splitAcrossTickets(1_001, 3)).toEqual([334, 334, 333])
    expect(splitAcrossTickets(8_000, 2)).toEqual([4_000, 4_000])
  })

  it('gives one ticket the whole amount', () => {
    expect(splitAcrossTickets(4_000, 1)).toEqual([4_000])
  })

  it('gives some tickets 0 when the amount is smaller than the quantity in cents', () => {
    expect(splitAcrossTickets(2, 5)).toEqual([1, 1, 0, 0, 0])
    expect(splitAcrossTickets(0, 2)).toEqual([0, 0])
  })

  it.each([
    [1, 1],
    [7, 3],
    [99_999, 7],
    [12_345, 100],
  ])('splits %i across %i tickets into parts summing exactly', (amount, quantity) => {
    const parts = splitAcrossTickets(amount, quantity)

    expect(parts).toHaveLength(quantity)
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(amount)
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1)
    expect([...parts].sort((a, b) => b - a)).toEqual(parts)
  })

  it('refuses a quantity of 0, a negative amount and a fraction', () => {
    expect(() => splitAcrossTickets(100, 0)).toThrow(PricingError)
    expect(() => splitAcrossTickets(-1, 2)).toThrow(PricingError)
    expect(() => splitAcrossTickets(1.5, 2)).toThrow(PricingError)
  })
})

describe('unitsWithShare', () => {
  it('is min(quantity, due): the tickets of a line whose share is above 0', () => {
    expect(unitsWithShare(8_000, 2)).toBe(2)
    expect(unitsWithShare(2, 5)).toBe(2)
    expect(unitsWithShare(0, 3)).toBe(0)
  })

  it('agrees with splitAcrossTickets for every small line', () => {
    for (let quantity = 1; quantity <= 6; quantity += 1) {
      for (let due = 0; due <= 8; due += 1) {
        const above = splitAcrossTickets(due, quantity).filter((share) => share > 0).length

        expect(unitsWithShare(due, quantity)).toBe(above)
      }
    }
  })

  it('refuses a negative amount or quantity', () => {
    expect(() => unitsWithShare(-1, 2)).toThrow(PricingError)
    expect(() => unitsWithShare(1, -2)).toThrow(PricingError)
  })
})
