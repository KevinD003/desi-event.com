import { describe, expect, it } from 'vitest'

import {
  ESTIMATED_END_LABEL,
  endIsEstimate,
  endTimeListed,
  importedCardPrice,
  importedPricesSentence,
  listedOnWords,
} from './imports.js'

const listed = (prices, extra = {}) => ({
  sourceName: 'Sulekha',
  presentedBy: 'Raga Nights Houston',
  listedOn: '2026-09-30',
  prices,
  priceListed: prices.length > 0,
  ticketsOnSource: true,
  ...extra,
})

const usd = (name, priceCents) => ({ name, priceCents, currency: 'USD' })

describe('importedCardPrice', () => {
  it('names the lowest price above zero', () => {
    expect(importedCardPrice(listed([usd('VIP', 7500), usd('General', 2500)]))).toBe(
      'On Sulekha from $25.00',
    )
  })

  it('never says "from" a free child’s ticket beside paid ones', () => {
    expect(importedCardPrice(listed([usd('Child', 0), usd('Adult', 1500)]))).toBe(
      'On Sulekha from $15.00',
    )
  })

  it('says free when every listed price is zero', () => {
    expect(importedCardPrice(listed([usd('RSVP', 0), usd('RSVP for two', 0)]))).toBe(
      'Free, on Sulekha',
    )
  })

  it('says only where when the listing gives no price', () => {
    expect(importedCardPrice(listed([]))).toBe('On Sulekha')
    expect(importedCardPrice(listed([usd('Adult', 1500)], { priceListed: false }))).toBe(
      'On Sulekha',
    )
  })
})

describe('importedPricesSentence', () => {
  it('lists the prices as listed on that day', () => {
    expect(importedPricesSentence(listed([usd('Adult', 2500), usd('Child', 0)]))).toBe(
      'As listed on Sulekha on 30 September 2026: Adult $25.00, Child Free.',
    )
  })

  it('says the listing gives no price', () => {
    expect(importedPricesSentence(listed([]))).toBe('Sulekha does not list a price for this event.')
  })
})

describe('listedOnWords', () => {
  it('reads a UTC day and refuses anything else', () => {
    expect(listedOnWords('2026-09-29')).toBe('29 September 2026')
    expect(listedOnWords('29/09/2026')).toBeNull()
    expect(listedOnWords(null)).toBeNull()
  })
})

describe('endTimeListed', () => {
  it('is false when any night’s end was not listed', () => {
    expect(endTimeListed({ sessions: [{ endTimeListed: false }] })).toBe(false)
    expect(endTimeListed({ sessions: [{ endTimeListed: true }] })).toBe(true)
    expect(endTimeListed({ sessions: [{}] })).toBe(true)
    expect(endTimeListed({})).toBe(true)
  })
})

describe('an end the listing did not give, on an editor’s screen', () => {
  it('is labelled in SPEC2-XI §0 rule 9’s words', () => {
    expect(ESTIMATED_END_LABEL).toBe('Not listed by Sulekha (estimate for scheduling)')
  })

  it('is an estimate only when the API says the end was not listed', () => {
    expect(endIsEstimate({ endTimeListed: false })).toBe(true)
    expect(endIsEstimate({ endTimeListed: true })).toBe(false)
    expect(endIsEstimate({})).toBe(false)
    expect(endIsEstimate(null)).toBe(false)
  })
})
