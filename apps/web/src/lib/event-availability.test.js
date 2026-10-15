/**
 * The words a card uses about buying, and the price it quotes.
 *
 * @file lib/event-availability.test
 */

import { describe, expect, it } from 'vitest'

import {
  allTiersSoldOut,
  eventAvailability,
  startingPrice,
  tierOnSaleNow,
  tierSalesWindow,
} from './event-availability.js'

const money = (cents, currency) => `${currency} ${cents}`

describe('eventAvailability', () => {
  it.each([
    [{ status: 'CANCELLED', salesOpen: true }, 'Cancelled', 'closed'],
    [{ status: 'POSTPONED' }, 'Postponed', 'closed'],
    [{ status: 'COMPLETED' }, 'Finished', 'closed'],
    [{ status: 'SOLD_OUT' }, 'Sold out', 'closed'],
    [{ status: 'ON_SALE', soldOut: true, salesOpen: false }, 'Sold out', 'closed'],
    [{ status: 'SALES_PAUSED', salesOpen: false }, 'Sales paused', 'closed'],
    [{ status: 'ON_SALE', salesOpen: true }, 'On sale', 'open'],
    [{ status: 'PUBLISHED', salesOpen: true }, 'On sale', 'open'],
    [{ status: 'PUBLISHED', salesOpen: false }, 'Not on sale now', 'neutral'],
  ])('reads %j as %s', (event, label, tone) => {
    expect(eventAvailability(event)).toEqual({ label, tone })
  })

  it('says nothing when the summary says nothing', () => {
    expect(eventAvailability({ status: 'PUBLISHED' })).toBeNull()
  })

  it('never says "on sale" for a status that stops selling, whatever salesOpen says', () => {
    for (const status of ['CANCELLED', 'POSTPONED', 'COMPLETED', 'SOLD_OUT', 'SALES_PAUSED']) {
      expect(eventAvailability({ status, salesOpen: true }).label).not.toBe('On sale')
    }
  })
})

describe('startingPrice', () => {
  it('prefers the all-in figure and says what it includes', () => {
    expect(
      startingPrice({ minTotalCents: 1788, minPriceCents: 1499, currency: 'INR' }, money),
    ).toEqual({ amount: 'INR 1788', qualifier: 'including any fees and tax', allIn: true })
  })

  it('says a face value is before fees', () => {
    expect(startingPrice({ minPriceCents: 1499, currency: 'CAD' }, money)).toEqual({
      amount: 'CAD 1499',
      qualifier: 'before fees and tax',
      allIn: false,
    })
  })

  it('does not qualify a free ticket', () => {
    expect(startingPrice({ minTotalCents: 0, currency: 'INR' }, money).qualifier).toBeNull()
  })

  it('invents no price', () => {
    expect(startingPrice({ minPriceCents: null }, money)).toEqual({
      amount: 'Price to be announced',
      qualifier: null,
      allIn: false,
    })
  })
})

describe('tierSalesWindow', () => {
  const now = new Date('2026-10-01T12:00:00.000Z')

  it.each([
    [{ salesStartAt: null, salesEndAt: null }, 'open'],
    [{}, 'open'],
    [{ salesStartAt: '2026-10-01T12:00:00.000Z' }, 'open'],
    [{ salesStartAt: '2026-10-01T12:00:00.001Z' }, 'not-started'],
    [{ salesEndAt: '2026-10-01T12:00:00.000Z' }, 'ended'],
    [{ salesEndAt: '2026-10-01T12:00:00.001Z' }, 'open'],
    [{ salesStartAt: new Date('2026-09-01T00:00:00.000Z') }, 'open'],
    [{ salesStartAt: 'not a date' }, 'unreadable'],
    [
      { salesStartAt: '2026-10-02T00:00:00.000Z', salesEndAt: '2026-10-01T00:00:00.000Z' },
      'unreadable',
    ],
  ])('reads %j as %s, starting inclusive and ending exclusive', (tier, state) => {
    expect(tierSalesWindow(tier, now)).toBe(state)
  })
})

describe('tierOnSaleNow', () => {
  const now = new Date('2026-10-01T12:00:00.000Z')
  const open = {
    status: 'ON_SALE',
    quantityTotal: 100,
    quantitySold: 10,
    availableQuantity: 90,
    isSoldOut: false,
    salesStartAt: null,
    salesEndAt: null,
  }

  it('is true for a general-admission tier on sale, in stock and inside its window', () => {
    expect(tierOnSaleNow(open, now)).toBe(true)
  })

  it.each([
    ['seated', { reserved: true }],
    ['paused', { status: 'PAUSED' }],
    ['closed', { status: 'CLOSED' }],
    ['a draft', { status: 'DRAFT' }],
    ['missing its status', { status: undefined }],
    ['flagged sold out', { isSoldOut: true }],
    ['out of stock', { availableQuantity: 0 }],
    ['not open yet', { salesStartAt: '2026-10-02T00:00:00.000Z' }],
    ['past its window', { salesEndAt: '2026-10-01T00:00:00.000Z' }],
    ['in an unreadable window', { salesEndAt: 'soon' }],
  ])('is false for a tier that is %s', (_why, change) => {
    expect(tierOnSaleNow({ ...open, ...change }, now)).toBe(false)
  })

  it('counts stock from the quantity columns when no availability was folded in', () => {
    const { availableQuantity: _folded, ...row } = open

    expect(tierOnSaleNow(row, now)).toBe(true)
    expect(tierOnSaleNow({ ...row, quantitySold: 100 }, now)).toBe(false)
  })

  it('is false for nothing at all', () => {
    expect(tierOnSaleNow(null, now)).toBe(false)
  })
})

describe('allTiersSoldOut', () => {
  const tier = (change) => ({ status: 'ON_SALE', quantityTotal: 10, quantitySold: 0, ...change })

  it('is true when every general-admission tier has no stock left', () => {
    expect(allTiersSoldOut([tier({ quantitySold: 10 }), tier({ status: 'SOLD_OUT' })])).toBe(true)
  })

  it('is false while any general-admission tier has stock, whatever its status', () => {
    // A paused tier, or one whose sales have not opened, has not sold out.
    expect(allTiersSoldOut([tier({ quantitySold: 10 }), tier({ status: 'PAUSED' })])).toBe(false)
  })

  it('leaves seated tiers out, so a seated-only event never reads as sold out', () => {
    expect(allTiersSoldOut([tier({ reserved: true, quantityTotal: 0 })])).toBe(false)
    expect(
      allTiersSoldOut([tier({ quantitySold: 10 }), tier({ reserved: true, quantityTotal: 0 })]),
    ).toBe(true)
  })

  it('is false when there are no tiers at all', () => {
    expect(allTiersSoldOut([])).toBe(false)
    expect(allTiersSoldOut(undefined)).toBe(false)
  })
})
