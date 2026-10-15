import { describe, expect, it } from 'vitest'

import * as imports from './imports.js'

const { ESTIMATED_END_LABEL, endIsEstimate, endTimeListed, importedPricesSentence, listedOnWords } =
  imports

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
const cad = (name, priceCents) => ({ name, priceCents, currency: 'CAD' })

describe('a card’s price for an imported event', () => {
  it('is no longer worked out from the listing: the card reads the ticket types, as for any event', () => {
    // The imported event is sold here (ADR 0015, addendum 2026-10-15 (2)), so
    // its card's "From" price comes from `minPriceCents`, like every card's.
    expect(imports).not.toHaveProperty('importedCardPrice')
  })
})

describe('importedPricesSentence', () => {
  it('says the prices are as the organiser listed them on that day', () => {
    expect(importedPricesSentence(listed([usd('Adult', 2500), usd('Child', 0)]))).toBe(
      'Prices are as the organiser listed them on 30 September 2026.',
    )
  })

  it('says the same, without a day, when the day cannot be read', () => {
    expect(importedPricesSentence(listed([usd('Adult', 2500)], { listedOn: null }))).toBe(
      'Prices are as the organiser listed them.',
    )
  })

  it('invents no count, deadline or urgency, whatever the listing gave', () => {
    for (const importedFrom of [
      listed([usd('Adult', 2500)]),
      listed([]),
      listed([cad('Adult', 2500)]),
    ]) {
      expect(importedPricesSentence(importedFrom)).not.toMatch(
        /\bleft\b|remaining|selling fast|hurry|only \d/iu,
      )
    }
  })
})

describe('a listing in Canada, priced in Canadian dollars', () => {
  it('reads the same sentence: its prices are on its ticket types, in CA$', () => {
    expect(importedPricesSentence(listed([cad('Adult', 2500), cad('Child', 0)]))).toBe(
      'Prices are as the organiser listed them on 30 September 2026.',
    )
  })
})

describe('the words never name the source site', () => {
  it('prints neither the API’s source name nor any other site name or host', () => {
    const cases = [
      listed([usd('VIP', 7500), usd('General', 2500)]),
      listed([usd('RSVP', 0)]),
      listed([]),
      listed([usd('Adult', 1500)], { priceListed: false }),
    ]

    for (const importedFrom of cases) {
      expect(importedPricesSentence(importedFrom)).not.toMatch(/sulekha|https?:|\.com\b|\.io\b/iu)
    }
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
  it('is labelled as an estimate the listing did not give, without naming the source', () => {
    expect(ESTIMATED_END_LABEL).toBe('Not given by the listing (estimate for scheduling)')
  })

  it('is an estimate only when the API says the end was not listed', () => {
    expect(endIsEstimate({ endTimeListed: false })).toBe(true)
    expect(endIsEstimate({ endTimeListed: true })).toBe(false)
    expect(endIsEstimate({})).toBe(false)
    expect(endIsEstimate(null)).toBe(false)
  })
})

describe('reservableOnWhatsApp', () => {
  const now = new Date('2026-10-15T12:00:00.000Z')
  const ahead = { startsAt: '2026-11-07T00:30:00.000Z' }

  it('offers the chat for an announced, on-sale, paused or sold-out event not yet started', () => {
    for (const status of ['PUBLISHED', 'ON_SALE', 'SALES_PAUSED', 'SOLD_OUT']) {
      expect(imports.reservableOnWhatsApp({ ...ahead, status }, now)).toBe(true)
    }
  })

  it('offers none for a cancelled, postponed or finished event', () => {
    for (const status of ['CANCELLED', 'POSTPONED', 'COMPLETED', 'DRAFT', 'DELETED']) {
      expect(imports.reservableOnWhatsApp({ ...ahead, status }, now)).toBe(false)
    }
  })

  it('offers none once the event has started, or when its start cannot be read', () => {
    expect(
      imports.reservableOnWhatsApp(
        { status: 'ON_SALE', startsAt: '2026-10-15T11:59:00.000Z' },
        now,
      ),
    ).toBe(false)
    expect(imports.reservableOnWhatsApp({ status: 'ON_SALE', startsAt: 'soon' }, now)).toBe(false)
    expect(imports.reservableOnWhatsApp({ status: 'ON_SALE' }, now)).toBe(false)
  })
})
