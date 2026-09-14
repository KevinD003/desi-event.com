import { describe, expect, it } from 'vitest'

import {
  BPS_DENOMINATOR,
  MAX_CENTS,
  applyBps,
  assertBps,
  assertCents,
  assertInteger,
  assertQuantity,
  divideRoundHalfUp,
  floorDivide,
  formatMoney,
  multiplyExact,
  normaliseCurrency,
} from './money.js'
import { PricingError } from './errors.js'
import { computeOrderTotals } from './totals.js'

/**
 * Run `fn` and return the error it threw, or `null` if it did not throw.
 * Avoids the vacuously-passing `try/catch` assertion pattern.
 */
function caught(fn) {
  try {
    fn()
    return null
  } catch (error) {
    return error
  }
}

describe('divideRoundHalfUp', () => {
  it('returns the exact quotient when the division is exact', () => {
    expect(divideRoundHalfUp(1000, 10)).toBe(100)
    expect(divideRoundHalfUp(0, 7)).toBe(0)
  })

  it('rounds ties up, towards positive infinity', () => {
    expect(divideRoundHalfUp(1, 2)).toBe(1)
    expect(divideRoundHalfUp(3, 2)).toBe(2)
    expect(divideRoundHalfUp(5, 2)).toBe(3)
    expect(divideRoundHalfUp(-1, 2)).toBe(0)
    expect(divideRoundHalfUp(-3, 2)).toBe(-1)
  })

  it('rounds non-ties to the nearest integer', () => {
    expect(divideRoundHalfUp(4, 3)).toBe(1)
    expect(divideRoundHalfUp(5, 3)).toBe(2)
    expect(divideRoundHalfUp(-4, 3)).toBe(-1)
    expect(divideRoundHalfUp(-5, 3)).toBe(-2)
  })

  it('is unaffected by the sign of the denominator', () => {
    expect(divideRoundHalfUp(1, -2)).toBe(divideRoundHalfUp(-1, 2))
    expect(divideRoundHalfUp(-3, -2)).toBe(divideRoundHalfUp(3, 2))
  })

  it('stays exact near the safe integer ceiling', () => {
    expect(divideRoundHalfUp(Number.MAX_SAFE_INTEGER, 1)).toBe(Number.MAX_SAFE_INTEGER)
    expect(divideRoundHalfUp(9_007_199_254_740_990, 2)).toBe(4_503_599_627_370_495)
  })

  it('rejects a zero denominator and non-integer arguments', () => {
    expect(() => divideRoundHalfUp(10, 0)).toThrow(PricingError)
    expect(() => divideRoundHalfUp(1.5, 2)).toThrow(/integer/)
    expect(() => divideRoundHalfUp(10, 2.5)).toThrow(/integer/)
  })
})

describe('floorDivide', () => {
  it('floors towards negative infinity and keeps a non-negative remainder', () => {
    expect(floorDivide(7, 2)).toEqual({ quotient: 3, remainder: 1 })
    expect(floorDivide(-7, 2)).toEqual({ quotient: -4, remainder: 1 })
    expect(floorDivide(8, 4)).toEqual({ quotient: 2, remainder: 0 })
  })
})

describe('applyBps', () => {
  it('treats 10 000 basis points as 100 per cent', () => {
    expect(BPS_DENOMINATOR).toBe(10_000)
    expect(applyBps(123_456, BPS_DENOMINATOR)).toBe(123_456)
    expect(applyBps(123_456, 0)).toBe(0)
    expect(applyBps(0, 2_500)).toBe(0)
  })

  it('rounds half up at the boundary', () => {
    // 5 * 10 % = 0.5 exactly -> 1, not 0.
    expect(applyBps(5, 1_000)).toBe(1)
    // 15 * 10 % = 1.5 exactly -> 2, not 1.
    expect(applyBps(15, 1_000)).toBe(2)
    // 25 * 10 % = 2.5 exactly -> 3 (banker's rounding would give 2).
    expect(applyBps(25, 1_000)).toBe(3)
    // 1999 * 2.5 % = 49.975 -> 50.
    expect(applyBps(1_999, 250)).toBe(50)
    // 1998 * 2.5 % = 49.95 -> 50; 1990 * 2.5 % = 49.75 -> 50; 1960 -> 49.
    expect(applyBps(1_960, 250)).toBe(49)
  })

  it('rounds down below the halfway point', () => {
    // 4 * 10 % = 0.4 -> 0.
    expect(applyBps(4, 1_000)).toBe(0)
    expect(applyBps(14, 1_000)).toBe(1)
  })

  it('rejects negative, fractional and oversized inputs', () => {
    expect(() => applyBps(-1, 250)).toThrow(PricingError)
    expect(() => applyBps(10.5, 250)).toThrow(/integer/)
    expect(() => applyBps(100, -1)).toThrow(/basis points/)
    expect(() => applyBps(100, 2_000_000)).toThrow(/basis points/)
  })
})

describe('assertion helpers', () => {
  it('rejects non-numeric, fractional and negative amounts with codes', () => {
    expect(() => assertCents('100', 'amount')).toThrow(PricingError)
    expect(() => assertCents(1.01, 'amount')).toThrow(PricingError)

    const error = caught(() => assertCents(-5, 'amount'))
    expect(error).toBeInstanceOf(PricingError)
    expect(error.name).toBe('PricingError')
    expect(error.code).toBe('NEGATIVE_AMOUNT')
    expect(error.statusCode).toBe(422)
    expect(error.details).toEqual({ field: 'amount', value: -5 })
  })

  it('rejects amounts beyond the supported range', () => {
    expect(assertCents(MAX_CENTS, 'amount')).toBe(MAX_CENTS)
    expect(caught(() => assertCents(MAX_CENTS + 1, 'amount')).code).toBe('AMOUNT_OUT_OF_RANGE')
  })

  it('rejects integers beyond the exact range of a double', () => {
    // 2^53 is an integer but no longer uniquely representable, so arithmetic on
    // it would silently lose paise.
    const error = caught(() => assertInteger(2 ** 53, 'amount'))
    expect(error).toBeInstanceOf(PricingError)
    expect(error.code).toBe('AMOUNT_OUT_OF_RANGE')
  })

  it('rejects NaN and Infinity', () => {
    expect(() => assertCents(Number.NaN, 'amount')).toThrow(/must be a number/)
    expect(() => assertCents(Number.POSITIVE_INFINITY, 'amount')).toThrow(/must be a number/)
  })

  it('validates quantities and basis points', () => {
    expect(assertQuantity(0, 'quantity')).toBe(0)
    expect(() => assertQuantity(-1, 'quantity')).toThrow(/must not be negative/)
    expect(() => assertQuantity(2.5, 'quantity')).toThrow(PricingError)
    expect(assertBps(1_800, 'taxRateBps')).toBe(1_800)
  })

  it('normalises currency codes and rejects malformed ones', () => {
    expect(normaliseCurrency('inr')).toBe('INR')
    expect(normaliseCurrency('UsD')).toBe('USD')
    expect(() => normaliseCurrency('RUPEE')).toThrow(/ISO 4217/)
    expect(() => normaliseCurrency(null)).toThrow(PricingError)
  })

  it('refuses products that would lose precision', () => {
    expect(multiplyExact(1_000, 1_000)).toBe(1_000_000)
    expect(caught(() => multiplyExact(Number.MAX_SAFE_INTEGER, 2)).code).toBe('AMOUNT_OUT_OF_RANGE')
  })
})

describe('formatMoney', () => {
  it('formats INR in the Indian numbering system by default', () => {
    expect(formatMoney(123_450)).toBe('₹1,234.50')
    expect(formatMoney(0)).toBe('₹0.00')
    expect(formatMoney(1_000_000_000)).toBe('₹1,00,00,000.00')
  })

  it('stays exact for very large amounts', () => {
    expect(formatMoney(999_999_999_999)).toBe('₹9,99,99,99,999.99')
  })

  it('formats negative amounts, for refunds and adjustments', () => {
    expect(formatMoney(-12_505)).toBe('-₹125.05')
  })

  it('honours the minor units of the currency rather than assuming two', () => {
    const yen = formatMoney(100, 'JPY', 'ja-JP')
    expect(yen).not.toContain('.')
    expect(yen).toContain('100')

    // The Kuwaiti dinar has three minor digits: 1234 fils is 1.234 KWD.
    expect(formatMoney(1_234, 'KWD', 'en-US')).toContain('1.234')
  })

  it('accepts a lower-case currency code and a different locale', () => {
    expect(formatMoney(5, 'usd', 'en-US')).toBe('$0.05')
  })

  it('rejects fractional cents, bad currencies and bad locales', () => {
    expect(() => formatMoney(1.5)).toThrow(/integer/)
    expect(() => formatMoney(100, 'RUPEE')).toThrow(PricingError)

    const error = caught(() => formatMoney(100, 'INR', 'not a locale'))
    expect(error).toBeInstanceOf(PricingError)
    expect(error.code).toBe('INVALID_LOCALE')
    expect(error.cause).toBeInstanceOf(RangeError)
  })
})

describe('the money ceiling matches the database column', () => {
  /** PostgreSQL `integer`, which is what every money column in the schema is. */
  const INT4_MAX = 2_147_483_647

  it('accepts the largest value the column can hold', () => {
    expect(assertCents(INT4_MAX, 'amount')).toBe(INT4_MAX)
  })

  it('rejects anything the column could not store', () => {
    // Regression guard. The ceiling was 1e12, so the engine would compute a
    // line total larger than the column it was about to be written to:
    // validation passed and the INSERT failed, turning a bad request into a
    // 500 from the database.
    expect(() => assertCents(INT4_MAX + 1, 'amount')).toThrow(PricingError)
    expect(() => assertCents(10_000_000_000, 'amount')).toThrow(PricingError)
  })

  it('rejects a line total that would overflow, not just a single price', () => {
    // A price and a quantity that are each individually acceptable must not
    // multiply into something unstorable.
    expect(() =>
      computeOrderTotals({
        items: [{ ticketTypeId: 'tt', quantity: 10, unitPriceCents: 500_000_000 }],
        now: new Date('2026-06-15T12:00:00.000Z'),
      }),
    ).toThrow(PricingError)
  })
})
