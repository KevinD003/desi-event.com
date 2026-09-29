import { describe, expect, it } from 'vitest'

import {
  FALLBACK_PROMO_ZONE,
  MAX_FIXED_PROMO_CENTS,
  PROMO_CODE_MAX_LENGTH,
  PROMO_CODE_MIN_LENGTH,
  amountToCents,
  appliedCopy,
  bpsToPercentText,
  describeDiscount,
  hasMinorUnits,
  isPromoCodeShape,
  normalisePromoCode,
  organisationZone,
  percentToBps,
  promoStatusLabel,
  promoValueFromForm,
  promoWindowText,
  reasonCopy,
  usesText,
} from './promo.js'

describe('a code as it is typed', () => {
  it('is trimmed and upper-cased, as the API stores it', () => {
    expect(normalisePromoCode('  save10 ')).toBe('SAVE10')
    expect(normalisePromoCode(null)).toBe('')
  })

  it('has the API’s shape: 3 to 32 letters, digits, hyphens or underscores', () => {
    expect(PROMO_CODE_MIN_LENGTH).toBe(3)
    expect(PROMO_CODE_MAX_LENGTH).toBe(32)
    expect(isPromoCodeShape('save10')).toBe(true)
    expect(isPromoCodeShape('EARLY_BIRD-2')).toBe(true)
    expect(isPromoCodeShape('AB')).toBe(false)
    expect(isPromoCodeShape('A'.repeat(33))).toBe(false)
    expect(isPromoCodeShape('SAVE 10')).toBe(false)
    expect(isPromoCodeShape('SAVE10!')).toBe(false)
  })
})

describe('a percentage, in basis points', () => {
  it('takes up to two decimals and a trailing percent sign', () => {
    expect(percentToBps('10')).toBe(1000)
    expect(percentToBps('12.5')).toBe(1250)
    expect(percentToBps('12.55')).toBe(1255)
    expect(percentToBps('10%')).toBe(1000)
    expect(percentToBps(' 7 ')).toBe(700)
    expect(percentToBps('100')).toBe(10_000)
  })

  it('refuses what it would have to round, and anything outside (0, 100]', () => {
    expect(percentToBps('12.555')).toBeNull()
    expect(percentToBps('0')).toBeNull()
    expect(percentToBps('100.01')).toBeNull()
    expect(percentToBps('101')).toBeNull()
    expect(percentToBps('ten')).toBeNull()
    expect(percentToBps('')).toBeNull()
  })

  it('reads back as a person writes it', () => {
    expect(bpsToPercentText(1000)).toBe('10%')
    expect(bpsToPercentText(1250)).toBe('12.5%')
    expect(bpsToPercentText(1255)).toBe('12.55%')
    expect(bpsToPercentText(10_000)).toBe('100%')
  })
})

describe('a fixed amount, in minor units of its currency', () => {
  it('reads what people type', () => {
    expect(amountToCents('5', 'USD')).toBe(500)
    expect(amountToCents('5.5', 'USD')).toBe(550)
    expect(amountToCents('$5.00', 'USD')).toBe(500)
    expect(amountToCents('1,000.50', 'USD')).toBe(100_050)
    expect(amountToCents('500', 'JPY')).toBe(500)
  })

  it('refuses zero, too much, too many decimals and words', () => {
    expect(MAX_FIXED_PROMO_CENTS).toBe(10_000_000)
    expect(amountToCents('100000', 'USD')).toBe(MAX_FIXED_PROMO_CENTS)
    expect(amountToCents('100000.01', 'USD')).toBeNull()
    expect(amountToCents('0', 'USD')).toBeNull()
    expect(amountToCents('5.001', 'USD')).toBeNull()
    expect(amountToCents('5.5', 'JPY')).toBeNull()
    expect(amountToCents('abc', 'USD')).toBeNull()
  })

  it('knows which currencies have cents', () => {
    expect(hasMinorUnits('USD')).toBe(true)
    expect(hasMinorUnits('JPY')).toBe(false)
  })

  it('is what the form sends, per kind of discount', () => {
    expect(promoValueFromForm({ type: 'PERCENTAGE', value: '15', currency: 'USD' })).toBe(1500)
    expect(promoValueFromForm({ type: 'FIXED_AMOUNT', value: '5', currency: 'USD' })).toBe(500)
    expect(promoValueFromForm({ type: 'FIXED_AMOUNT', value: '', currency: 'USD' })).toBeNull()
  })
})

describe('a code in the organiser’s table', () => {
  it('says what it takes off', () => {
    expect(describeDiscount({ type: 'PERCENTAGE', value: 1000 })).toBe('10% off')
    expect(describeDiscount({ type: 'FIXED_AMOUNT', value: 500, currency: 'USD' })).toBe(
      '$5.00 off',
    )
    expect(describeDiscount({ type: 'FIXED_AMOUNT', value: 500, currency: null })).toBe('Discount')
  })

  it('says how often it has been used, against its cap', () => {
    expect(usesText({ redemptionCount: 3, maxRedemptions: 50 })).toBe('3 of 50')
    expect(usesText({ redemptionCount: 3, maxRedemptions: null })).toBe('3, no limit')
    expect(usesText({})).toBe('0, no limit')
  })

  it('names every status in a word, with a variant beside it and never instead', () => {
    expect(promoStatusLabel('ACTIVE')).toEqual({ text: 'Active', variant: 'success' })
    expect(promoStatusLabel('PAUSED')).toEqual({ text: 'Paused', variant: 'warning' })
    expect(promoStatusLabel('SCHEDULED')).toEqual({ text: 'Scheduled', variant: 'info' })
    expect(promoStatusLabel('ENDED')).toEqual({ text: 'Ended', variant: 'neutral' })
    expect(promoStatusLabel('USED_UP')).toEqual({ text: 'Used up', variant: 'neutral' })
    expect(promoStatusLabel('SOMETHING_NEW').text).toBe('Unknown')
  })

  it('states its window in a named zone', () => {
    const zone = 'America/New_York'

    expect(
      promoWindowText({ startsAt: '2026-10-03T23:30:00Z', endsAt: '2026-10-10T03:59:00Z' }, zone),
    ).toBe('Sat, Oct 3 · 7:30 PM to Fri, Oct 9 · 11:59 PM (EDT)')
    expect(promoWindowText({ startsAt: '2026-10-03T23:30:00Z', endsAt: null }, zone)).toBe(
      'From Sat, Oct 3 · 7:30 PM (EDT), no end',
    )
    expect(
      promoWindowText({ startsAt: null, endsAt: '2026-12-01T05:00:00Z' }, 'America/Chicago'),
    ).toBe('Until Mon, Nov 30 · 11:00 PM (CST)')
    expect(promoWindowText({ startsAt: null, endsAt: null }, zone)).toBe(
      'No window: live until paused or used up',
    )
  })

  it('reads an organisation-wide window in the zone its events share, or a stated default', () => {
    expect(
      organisationZone([{ timezone: 'America/Chicago' }, { timezone: 'America/Chicago' }]),
    ).toBe('America/Chicago')
    expect(
      organisationZone([{ timezone: 'America/Chicago' }, { timezone: 'America/New_York' }]),
    ).toBe(FALLBACK_PROMO_ZONE)
    expect(organisationZone()).toBe(FALLBACK_PROMO_ZONE)
  })
})

describe('a code at checkout', () => {
  it('says why it gave nothing, in words a buyer can act on, and never "yet"', () => {
    const reasons = [
      'UNKNOWN',
      'INACTIVE',
      'NOT_STARTED',
      'EXPIRED',
      'EXHAUSTED',
      'CURRENCY_MISMATCH',
      'CURRENCY_MISSING',
    ]

    expect(reasonCopy('UNKNOWN')).toBe('That code is not valid for this event.')
    expect(reasonCopy('INACTIVE')).toBe('The organiser has paused that code.')
    expect(reasonCopy('EXHAUSTED')).toBe(
      'That code has been used as many times as the organiser allowed.',
    )
    expect(reasonCopy(null)).toBe('That code gives no discount on this order.')

    for (const reason of reasons) expect(reasonCopy(reason)).not.toMatch(/\b(yet|soon)\b/iu)
  })

  it('says what an applied code does', () => {
    expect(appliedCopy({ code: 'SAVE10', percentBps: 1000 }, 'USD')).toBe(
      'SAVE10 applied: 10% off.',
    )
    expect(appliedCopy({ code: 'FIVE', amountCents: 500 }, 'USD')).toBe('FIVE applied: $5.00 off.')
    expect(appliedCopy({ code: 'ODD' }, 'USD')).toBe('ODD applied.')
  })
})
