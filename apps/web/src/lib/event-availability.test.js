/**
 * The words a card uses about buying, and the price it quotes.
 *
 * @file lib/event-availability.test
 */

import { describe, expect, it } from 'vitest'

import { eventAvailability, startingPrice } from './event-availability.js'

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
