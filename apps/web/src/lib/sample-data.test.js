import { describe, expect, it } from 'vitest'

import { EVENT_CATEGORIES } from './catalog.js'
import {
  SAMPLE_EVENTS,
  findSampleEvent,
  sampleCities,
  sampleEventSummaries,
  toEventSummary,
} from './sample-data.js'

/** Every category value the front end knows how to label. */
const KNOWN_CATEGORIES = new Set(EVENT_CATEGORIES.map((category) => category.value))

/** Shape the API demands of an id: a CUID-like token. */
const CUID_PATTERN = /^[a-z][a-z0-9]{7,31}$/

/** Shape the API demands of a slug. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

describe('the fallback catalogue', () => {
  it('has enough events to make the site look programmed rather than empty', () => {
    expect(SAMPLE_EVENTS.length).toBeGreaterThanOrEqual(8)
  })

  it('spans the four cities the product claims to programme', () => {
    expect(sampleCities()).toEqual(['Ahmedabad', 'London', 'Mumbai', 'Toronto'])
  })

  it('covers a broad spread of categories, not one repeated', () => {
    const categories = new Set(SAMPLE_EVENTS.map((event) => event.category))

    expect(categories.size).toBeGreaterThanOrEqual(6)
  })

  it('uses only categories the front end can label', () => {
    for (const event of SAMPLE_EVENTS) {
      expect(KNOWN_CATEGORIES.has(event.category)).toBe(true)
    }
  })

  it('gives every event a unique, well-formed id and slug', () => {
    const ids = SAMPLE_EVENTS.map((event) => event.id)
    const slugs = SAMPLE_EVENTS.map((event) => event.slug)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(slugs).size).toBe(slugs.length)

    for (const event of SAMPLE_EVENTS) {
      expect(event.id).toMatch(CUID_PATTERN)
      expect(event.slug).toMatch(SLUG_PATTERN)
    }
  })

  it('gives every ticket type a unique, well-formed id', () => {
    const tierIds = SAMPLE_EVENTS.flatMap((event) => event.ticketTypes.map((tier) => tier.id))

    expect(new Set(tierIds).size).toBe(tierIds.length)

    for (const id of tierIds) {
      expect(id).toMatch(CUID_PATTERN)
    }
  })

  it('ends every event after it starts', () => {
    for (const event of SAMPLE_EVENTS) {
      expect(Date.parse(event.endsAt)).toBeGreaterThan(Date.parse(event.startsAt))
    }
  })

  it('keeps the catalogue in the future, so the fallback never rots', () => {
    for (const event of SAMPLE_EVENTS) {
      expect(Date.parse(event.startsAt)).toBeGreaterThan(Date.now())
    }
  })

  it('prices everything in integer minor units', () => {
    for (const event of SAMPLE_EVENTS) {
      for (const tier of event.ticketTypes) {
        expect(Number.isInteger(tier.priceCents)).toBe(true)
        expect(tier.priceCents).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('prices every tier of an event in one currency', () => {
    for (const event of SAMPLE_EVENTS) {
      const currencies = new Set(event.ticketTypes.map((tier) => tier.currency))

      expect(currencies.size).toBe(1)
    }
  })

  it('never sells more than it has', () => {
    for (const event of SAMPLE_EVENTS) {
      for (const tier of event.ticketTypes) {
        expect(tier.quantitySold).toBeLessThanOrEqual(tier.quantityTotal)
      }
    }
  })

  it('marks an exhausted tier sold out with nothing available', () => {
    const exhausted = SAMPLE_EVENTS.flatMap((event) => event.ticketTypes).filter(
      (tier) => tier.quantitySold === tier.quantityTotal,
    )

    expect(exhausted.length).toBeGreaterThan(0)
    for (const tier of exhausted) {
      expect(tier.isSoldOut).toBe(true)
      expect(tier.availableQuantity).toBe(0)
      expect(tier.status).toBe('SOLD_OUT')
    }
  })

  it('attaches a venue and an organiser to every event', () => {
    for (const event of SAMPLE_EVENTS) {
      expect(event.venue?.city).toBeTruthy()
      expect(event.organization?.name).toBeTruthy()
      expect(event.venueId).toBe(event.venue.id)
      expect(event.organizationId).toBe(event.organization.id)
    }
  })

  it('gives every event a multi-paragraph description worth reading', () => {
    for (const event of SAMPLE_EVENTS) {
      expect(event.description.split('\n\n').length).toBeGreaterThanOrEqual(2)
      expect(event.description.length).toBeGreaterThan(300)
    }
  })

  it('publishes everything, since only published events are listed', () => {
    for (const event of SAMPLE_EVENTS) {
      expect(event.status).toBe('PUBLISHED')
    }
  })
})

describe('toEventSummary', () => {
  it('denormalises the fields a listing card needs', () => {
    const summary = toEventSummary(SAMPLE_EVENTS[0])

    expect(summary).toMatchObject({
      slug: SAMPLE_EVENTS[0].slug,
      city: SAMPLE_EVENTS[0].venue.city,
      venueName: SAMPLE_EVENTS[0].venue.name,
      organizationName: SAMPLE_EVENTS[0].organization.name,
    })
  })

  it('takes the "from" price from the cheapest tier still on sale', () => {
    const event = {
      ...SAMPLE_EVENTS[0],
      ticketTypes: [
        { id: 'ttcheapgone', priceCents: 100, currency: 'INR', status: 'SOLD_OUT', isSoldOut: true },
        { id: 'ttdearleft', priceCents: 5000, currency: 'INR', status: 'ON_SALE', isSoldOut: false },
      ],
    }

    expect(toEventSummary(event).minPriceCents).toBe(5000)
    expect(toEventSummary(event).soldOut).toBe(false)
  })

  it('marks an event sold out only when every tier has gone', () => {
    const event = {
      ...SAMPLE_EVENTS[0],
      ticketTypes: [
        { id: 'ttallgone1', priceCents: 100, currency: 'INR', status: 'SOLD_OUT', isSoldOut: true },
        { id: 'ttallgone2', priceCents: 5000, currency: 'INR', status: 'SOLD_OUT', isSoldOut: true },
      ],
    }

    expect(toEventSummary(event).soldOut).toBe(true)
    expect(toEventSummary(event).minPriceCents).toBe(100)
  })

  it('handles an event with no tiers without inventing a price', () => {
    const summary = toEventSummary({ ...SAMPLE_EVENTS[0], ticketTypes: [] })

    expect(summary.minPriceCents).toBeNull()
    expect(summary.soldOut).toBe(false)
  })
})

describe('sampleEventSummaries', () => {
  it('summarises the whole catalogue', () => {
    expect(sampleEventSummaries()).toHaveLength(SAMPLE_EVENTS.length)
  })
})

describe('findSampleEvent', () => {
  it('finds an event by slug', () => {
    expect(findSampleEvent('desi-comedy-uncensored').title).toBe('Desi Comedy Uncensored')
  })

  it('returns null for anything it does not have', () => {
    expect(findSampleEvent('no-such-event')).toBeNull()
    expect(findSampleEvent(undefined)).toBeNull()
  })
})
