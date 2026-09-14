import { describe, expect, it } from 'vitest'
import { computeOrderTotals } from '@desi-event/pricing'

import {
  feeConfigForCurrency,
  formatAmount,
  formatPrice,
  localeForCurrency,
  priceSelection,
  resolveTaxPolicy,
  taxLabelForPlace,
} from './pricing.js'

describe('feeConfigForCurrency', () => {
  it('denominates the flat fee in the order currency', () => {
    expect(feeConfigForCurrency('GBP')).toEqual({ percentageBps: 250, flatCents: 79, currency: 'GBP' })
  })

  it('upper-cases the code so a lower-case env value still matches', () => {
    expect(feeConfigForCurrency('cad').currency).toBe('CAD')
  })

  it('falls back to a sane flat fee for a currency it has never seen', () => {
    expect(feeConfigForCurrency('SGD')).toEqual({ percentageBps: 250, flatCents: 99, currency: 'SGD' })
  })
})

describe('tax follows where the event is held', () => {
  it('applies the rate of the jurisdiction the event is in', () => {
    expect(resolveTaxPolicy({ country: 'IN' }).rateBps).toBe(1800)
    expect(resolveTaxPolicy({ country: 'GB' }).rateBps).toBe(2000)
    expect(resolveTaxPolicy({ country: 'CA', region: 'ON' }).rateBps).toBe(1300)
  })

  it('does not decide tax from the currency', () => {
    // A Toronto event priced in rupees is taxed in Ontario, not in India. The
    // previous currency-keyed lookup got this exactly backwards.
    expect(resolveTaxPolicy({ country: 'CA', region: 'ON' }).jurisdiction).toBe('CA-ON')
    expect(resolveTaxPolicy({ country: 'US' }).rateBps).toBe(0)
  })

  it('charges nothing where it has no policy', () => {
    expect(resolveTaxPolicy({ country: 'SG' }).rateBps).toBe(0)
    expect(resolveTaxPolicy({ country: null }).resolved).toBe(false)
  })
})

describe('taxLabelForPlace', () => {
  it('names the tax the way the buyer knows it', () => {
    expect(taxLabelForPlace({ country: 'IN' })).toBe('GST (18%)')
    expect(taxLabelForPlace({ country: 'GB' })).toBe('VAT (20%)')
  })

  it('falls back to a plain label where no rate applies', () => {
    expect(taxLabelForPlace({ country: 'SG' })).toBe('Tax')
    expect(taxLabelForPlace({})).toBe('Tax')
  })
})

describe('localeForCurrency', () => {
  it('uses Indian digit grouping for rupees', () => {
    expect(localeForCurrency('INR')).toBe('en-IN')
    expect(localeForCurrency('GBP')).toBe('en-GB')
  })
})

describe('formatPrice', () => {
  it('groups rupees in lakhs', () => {
    expect(formatPrice(899_900, 'INR')).toBe('₹8,999.00')
  })

  it('formats other currencies in their own convention', () => {
    expect(formatPrice(4500, 'GBP')).toBe('£45.00')
  })

  it('says Free rather than showing a zero amount', () => {
    expect(formatPrice(0, 'CAD')).toBe('Free')
  })
})

describe('formatAmount', () => {
  it('keeps zero as money, because a summary row is a column of figures', () => {
    expect(formatAmount(0, 'INR')).toBe('₹0.00')
  })
})

describe('priceSelection', () => {
  const lines = [
    { ticketTypeId: 'ttqawwaligarden', name: 'Garden Seating', quantity: 2, unitPriceCents: 249_900 },
    { ticketTypeId: 'ttqawwalilawn', name: 'Lawn Entry', quantity: 1, unitPriceCents: 99_900 },
  ]

  it('matches computeOrderTotals called with the same fee and tax terms', () => {
    const { taxPolicy, ...totals } = priceSelection({
      lines,
      currency: 'INR',
      place: { country: 'IN' },
    })

    expect(taxPolicy.jurisdiction).toBe('IN')
    expect(totals).toEqual(
      computeOrderTotals({
        items: lines.map(({ ticketTypeId, name, quantity, unitPriceCents }) => ({
          ticketTypeId,
          name,
          quantity,
          unitPriceCents,
        })),
        feeConfig: feeConfigForCurrency('INR'),
        taxRateBps: 1800,
        currency: 'INR',
      }),
    )
  })

  it('reconciles exactly: subtotal - discount + fees + tax === total', () => {
    const totals = priceSelection({ lines, currency: 'INR', place: { country: 'IN' } })

    expect(totals.subtotalCents).toBe(599_700)
    expect(
      totals.subtotalCents - totals.discountCents + totals.feesCents + totals.taxCents,
    ).toBe(totals.totalCents)
  })

  it('keeps every column an integer number of minor units', () => {
    const totals = priceSelection({ lines, currency: 'GBP' })

    for (const amount of [
      totals.subtotalCents,
      totals.feesCents,
      totals.taxCents,
      totals.totalCents,
    ]) {
      expect(Number.isInteger(amount)).toBe(true)
    }
  })

  it('drops zero-quantity lines so the per-ticket fee is not charged on them', () => {
    const withZero = priceSelection({
      lines: [...lines, { ticketTypeId: 'ttqawwalimehfil', name: 'Mehfil', quantity: 0, unitPriceCents: 449_900 }],
      currency: 'INR',
    })

    expect(withZero).toEqual(priceSelection({ lines, currency: 'INR' }))
    expect(withZero.lineItems).toHaveLength(2)
  })

  it('prices an empty basket as zero rather than throwing', () => {
    const totals = priceSelection({ lines: [], currency: 'INR' })

    expect(totals.totalCents).toBe(0)
    expect(totals.lineItems).toEqual([])
  })

  it('prices a free tier as a genuinely free order', () => {
    const totals = priceSelection({
      lines: [{ ticketTypeId: 'ttdiwalisquareentry', name: 'Square Entry', quantity: 4, unitPriceCents: 0 }],
      currency: 'CAD',
    })

    expect(totals.subtotalCents).toBe(0)
    expect(totals.totalCents).toBe(0)
  })
})
