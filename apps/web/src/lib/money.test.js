import { describe, expect, it } from 'vitest'

import { MAX_CENTS, currencyMinorDigits, parseMoneyInput, toMoneyInput } from './money.js'

describe('reading a typed price', () => {
  it.each([
    ['35', 3500],
    ['35.5', 3550],
    ['35.00', 3500],
    ['$1,234.50', 123450],
    [' USD 12 ', 1200],
    ['0', 0],
    ['.5', 50],
    ['35 USD', 3500],
    ['usd 35', 3500],
    ['35$', 3500],
    ['1 234.50', 123450],
  ])('reads %j as %d cents', (text, cents) => {
    expect(parseMoneyInput(text, 'USD')).toEqual({ cents })
  })

  it.each([
    ['35.505', /at most 2 decimal places/],
    ['-1', /negative/],
    ['1e3', /plain number/],
    ['abc', /plain number/],
    ['1,23', /plain number/],
    ['', /Enter a price/],
    ['1.2.3', /plain number/],
    // A typo is refused, never read as a different price.
    ['12x5', /plain number/],
    ['1o0', /plain number/],
    ['3S.00', /plain number/],
    ['12 5', /plain number/],
    ['$ 3 5', /plain number/],
  ])('refuses %j', (text, message) => {
    expect(parseMoneyInput(text, 'USD').error).toMatch(message)
  })

  it('takes the currency’s own decimals', () => {
    expect(currencyMinorDigits('USD')).toBe(2)
    expect(currencyMinorDigits('JPY')).toBe(0)
    expect(parseMoneyInput('500', 'JPY')).toEqual({ cents: 500 })
    expect(parseMoneyInput('500.5', 'JPY').error).toMatch(/no decimal places/)
    expect(currencyMinorDigits('NOT-A-CODE')).toBe(2)
  })

  it('refuses a price above what the API accepts', () => {
    expect(parseMoneyInput(String(MAX_CENTS / 100 + 1), 'USD').error).toMatch(/too large/)
    expect(parseMoneyInput(String(MAX_CENTS / 100), 'USD')).toEqual({ cents: MAX_CENTS })
  })
})

describe('showing a stored price in the box', () => {
  it('writes plain digits with the currency’s decimals', () => {
    expect(toMoneyInput(3500, 'USD')).toBe('35.00')
    expect(toMoneyInput(3505, 'USD')).toBe('35.05')
    expect(toMoneyInput(0, 'USD')).toBe('0.00')
    expect(toMoneyInput(500, 'JPY')).toBe('500')
    expect(toMoneyInput(null, 'USD')).toBe('')
  })

  it('reads back exactly what it wrote', () => {
    for (const cents of [0, 1, 99, 3500, 123450]) {
      expect(parseMoneyInput(toMoneyInput(cents, 'USD'), 'USD')).toEqual({ cents })
    }
  })
})
