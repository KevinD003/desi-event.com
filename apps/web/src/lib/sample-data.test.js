import { INDEXABLE_STATUSES, PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'
import { describe, expect, it } from 'vitest'

import { EVENT_CATEGORIES } from './catalog.js'
import { eventAvailability } from './event-availability.js'
import { formatTimeZoneLabel, toParagraphs } from './format.js'
import { formatPrice } from './pricing.js'
import {
  SAMPLE_EVENTS,
  findSampleEvent,
  findSampleOrganizer,
  findSampleVenue,
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

/** The only zones a US catalogue has any business using. */
const US_ZONES = new Set(['America/New_York', 'America/Chicago', 'America/Los_Angeles'])

/** Which zone each state in the catalogue keeps its clocks in. */
const ZONE_BY_STATE = {
  NJ: 'America/New_York',
  NY: 'America/New_York',
  PA: 'America/New_York',
  GA: 'America/New_York',
  TX: 'America/Chicago',
  IL: 'America/Chicago',
  CA: 'America/Los_Angeles',
  WA: 'America/Los_Angeles',
}

/**
 * The local wall-clock hour and minute of an instant in a zone.
 *
 * @param {string} iso A UTC timestamp.
 * @param {string} timeZone An IANA zone.
 * @returns {{hour: number, minute: number}} The local time.
 */
function localClock(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(new Date(iso))
  const read = (type) => Number(parts.find((part) => part.type === type)?.value)

  return { hour: read('hour'), minute: read('minute') }
}

/**
 * A sample event by slug, failing loudly when the catalogue lost it.
 *
 * @param {string} slug The event's slug.
 * @returns {object} The event.
 */
function event(slug) {
  const found = findSampleEvent(slug)
  if (!found) throw new Error(`the sample catalogue has no ${slug}`)

  return found
}

describe('the fallback catalogue', () => {
  it('has enough events to make the site look programmed rather than empty', () => {
    expect(SAMPLE_EVENTS.length).toBe(20)
    expect(sampleEventSummaries().length).toBeGreaterThanOrEqual(12)
  })

  it('lists the eleven US cities the catalogue programmes, and nowhere else', () => {
    expect(sampleCities()).toEqual([
      'Atlanta',
      'Bellevue',
      'Cerritos',
      'Edison',
      'Houston',
      'Irving',
      'Jersey City',
      'Philadelphia',
      'Queens',
      'Santa Clara',
      'Schaumburg',
    ])
  })

  it('is garba season: mostly garba and dandiya, with workshops, melas and a concert', () => {
    const categories = SAMPLE_EVENTS.map((event) => event.category)

    expect(new Set(categories)).toEqual(
      new Set(['GARBA_DANDIYA', 'WORKSHOP', 'CULTURAL_FESTIVAL', 'MUSIC_CONCERT']),
    )
    expect(categories.filter((category) => category === 'GARBA_DANDIYA').length).toBeGreaterThan(
      categories.length / 2,
    )
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

  it('keeps everything but the finished event in the future, so the fallback never rots', () => {
    for (const event of SAMPLE_EVENTS) {
      if (event.status === 'COMPLETED') {
        expect(Date.parse(event.endsAt)).toBeLessThan(Date.now())
      } else {
        expect(Date.parse(event.startsAt)).toBeGreaterThan(Date.now())
      }
    }
  })

  it('prices everything in US dollars, and in integer cents', () => {
    for (const event of SAMPLE_EVENTS) {
      for (const tier of event.ticketTypes) {
        expect(tier.currency).toBe('USD')
      }
      expect(event.feeTerms).toEqual([{ currency: 'USD', percentageBps: 590, flatCents: 99 }])
    }
  })

  it('puts every venue in the US, in the zone its state keeps', () => {
    for (const event of SAMPLE_EVENTS) {
      expect(event.venue.country).toBe('US')
      expect(US_ZONES.has(event.timezone)).toBe(true)
      expect(event.venue.timezone).toBe(ZONE_BY_STATE[event.venue.region])
      expect(event.timezone).toBe(event.venue.timezone)
      expect(event.venue.postalCode).toMatch(/^\d{5}$/)
    }
  })

  it('starts every event on a local evening, whatever the offset that day', () => {
    for (const event of SAMPLE_EVENTS) {
      const { hour, minute } = localClock(event.startsAt, event.timezone)

      expect(hour).toBeGreaterThanOrEqual(19)
      expect(hour).toBeLessThanOrEqual(20)
      expect([0, 30]).toContain(minute)
      // And the label beside it is a US zone's own letters, e.g. EDT or PDT.
      expect(formatTimeZoneLabel(event)).toMatch(/^[CEP][DS]T$/)
    }
  })

  it('invents its organisers, so every website is on a reserved domain', () => {
    for (const event of SAMPLE_EVENTS) {
      expect(new URL(event.organization.websiteUrl).hostname).toMatch(/\.example$/)
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
    // Seated tiers are sold by seat, so their zero quantity is not exhaustion.
    const exhausted = SAMPLE_EVENTS.flatMap((event) => event.ticketTypes).filter(
      (tier) => !tier.reserved && tier.quantitySold === tier.quantityTotal,
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
      const paragraphs = toParagraphs(event.description)

      expect(paragraphs.length).toBeGreaterThanOrEqual(2)
      expect(paragraphs.length).toBeLessThanOrEqual(3)
      expect(event.description.length).toBeGreaterThan(300)
    }
  })

  it('never invents urgency or popularity in its copy', () => {
    const banned =
      /selling fast|sells out|almost gone|hurry|limited time|coming soon|best-selling|most popular/i

    for (const event of SAMPLE_EVENTS) {
      expect(`${event.title} ${event.summary} ${event.description}`).not.toMatch(banned)
    }
  })

  it('uses only statuses a stranger may open', () => {
    for (const event of SAMPLE_EVENTS) {
      expect(PUBLICLY_VISIBLE_STATUSES.has(event.status)).toBe(true)
    }
  })
})

describe('the states the catalogue exercises', () => {
  it('has a tier that has sold out beside tiers that have not', () => {
    const opening = event('bay-lights-garba-opening')
    const early = opening.ticketTypes.find((tier) => tier.name === 'Early Bird')

    expect(early).toMatchObject({ status: 'SOLD_OUT', isSoldOut: true, availableQuantity: 0 })
    expect(opening.ticketTypes.some((tier) => !tier.isSoldOut)).toBe(true)
    expect(toEventSummary(opening).soldOut).toBe(false)
  })

  it('has an event that has sold out entirely', () => {
    const marathon = event('five-boroughs-garba-marathon')

    expect(marathon.status).toBe('SOLD_OUT')
    expect(marathon.ticketTypes.every((tier) => tier.isSoldOut)).toBe(true)
    expect(eventAvailability(toEventSummary(marathon))).toEqual({
      tone: 'closed',
      label: 'Sold out',
    })
  })

  it('has a free event, which a card calls free', () => {
    const summary = toEventSummary(event('dandiya-kids-hour-houston'))

    expect(summary.minPriceCents).toBe(0)
    expect(summary.minTotalCents).toBe(0)
    expect(formatPrice(summary.minTotalCents, summary.currency)).toBe('Free')
  })

  it('has tiers with only a few left, and says how few from real numbers', () => {
    const few = SAMPLE_EVENTS.flatMap((event) => event.ticketTypes).filter(
      (tier) => !tier.isSoldOut && tier.availableQuantity <= 25,
    )

    expect(few.map((tier) => tier.name)).toEqual(
      expect.arrayContaining(['VIP Circle', 'Season Pass — All Nine Nights']),
    )
    for (const tier of few) {
      expect(tier.availableQuantity).toBe(tier.quantityTotal - tier.quantitySold)
    }
  })

  it('leaves the same few on those tiers as the seeded database does', () => {
    // packages/db/scripts/seed.mjs allocates 12 and 19 and sells none, so the
    // page says the same "Only N left" whichever source answered.
    const tier = (slug, name) => event(slug).ticketTypes.find((type) => type.name === name)

    expect(tier('navratri-night-one-edison', 'VIP Circle').availableQuantity).toBe(12)
    expect(
      tier('mirrorwork-nine-nights-pass', 'Season Pass — All Nine Nights').availableQuantity,
    ).toBe(19)
  })

  it('has an event whose sales are paused, which is not on sale', () => {
    const glow = event('garba-glow-night-santa-clara')

    expect(glow.status).toBe('SALES_PAUSED')
    expect(toEventSummary(glow).salesOpen).toBe(false)
    expect(eventAvailability(toEventSummary(glow)).label).toBe('Sales paused')
  })

  it('has a postponed event that remembers the date it was going to be on', () => {
    const postponed = event('garba-for-good-philadelphia')

    expect(postponed.status).toBe('POSTPONED')
    expect(postponed.previousStartsAt).toBe(postponed.startsAt)
    expect(toEventSummary(postponed).salesOpen).toBe(false)
  })

  it('has a cancelled event and a finished one, both still resolvable', () => {
    expect(event('collegiate-raas-showcase-irving').status).toBe('CANCELLED')
    expect(event('garba-warm-up-night-atlanta').status).toBe('COMPLETED')
  })

  it('has a seated tier that is shown and not sold here', () => {
    const concert = event('mirrorwork-live-band-night')
    const balcony = concert.ticketTypes.find((tier) => tier.reserved)

    expect(concert.category).toBe('MUSIC_CONCERT')
    expect(balcony).toMatchObject({ reserved: true, availableQuantity: 0, status: 'ON_SALE' })
    // The standing floor is still on sale, and the "from" price is its price.
    expect(toEventSummary(concert)).toMatchObject({
      minPriceCents: 4500,
      soldOut: false,
      salesOpen: true,
    })
  })

  it('has an organiser who is not verified, and shows no badge for them', () => {
    const delaware = event('garba-and-aarti-on-the-delaware')

    expect(delaware.organization.verified).toBe(false)
    expect(SAMPLE_EVENTS.filter((event) => !event.organization.verified).length).toBeLessThan(
      SAMPLE_EVENTS.length / 2,
    )
  })

  it('has an event that runs across nine nights', () => {
    const pass = event('mirrorwork-nine-nights-pass')
    const nights = (Date.parse(pass.endsAt) - Date.parse(pass.startsAt)) / 86_400_000

    expect(nights).toBeGreaterThan(8)
    expect(nights).toBeLessThan(9)
  })

  it('puts the Saturday night on a Saturday', () => {
    const saturday = event('peachtree-garba-saturday')
    const weekday = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      timeZone: saturday.timezone,
    }).format(new Date(saturday.startsAt))

    expect(weekday).toBe('Saturday')
  })
})

describe('what the fallback lists', () => {
  it('lists exactly the statuses the API lists', () => {
    const listed = sampleEventSummaries()

    for (const summary of listed) expect(INDEXABLE_STATUSES.has(summary.status)).toBe(true)
    expect(listed.map((summary) => summary.slug)).not.toEqual(
      expect.arrayContaining(['garba-for-good-philadelphia']),
    )
    expect(listed).toHaveLength(
      SAMPLE_EVENTS.filter((event) => INDEXABLE_STATUSES.has(event.status)).length,
    )
  })

  it('quotes the all-in price a card shows, fees included and US tax at zero', () => {
    const summary = sampleEventSummaries().find(
      (event) => event.slug === 'navratri-night-one-edison',
    )

    // $35.00 face value + 5.9% ($2.07, rounded) + $0.99 per ticket; the US demo
    // tax policy is deliberately zero.
    expect(summary).toMatchObject({ minPriceCents: 3500, minTotalCents: 3806, currency: 'USD' })
    expect(formatPrice(summary.minTotalCents, summary.currency)).toBe('$38.06')
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
        {
          id: 'ttcheapgone',
          priceCents: 100,
          currency: 'INR',
          status: 'SOLD_OUT',
          isSoldOut: true,
        },
        {
          id: 'ttdearleft',
          priceCents: 5000,
          currency: 'INR',
          status: 'ON_SALE',
          isSoldOut: false,
        },
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
        {
          id: 'ttallgone2',
          priceCents: 5000,
          currency: 'INR',
          status: 'SOLD_OUT',
          isSoldOut: true,
        },
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
  it('summarises every listed event, in start-date order', () => {
    const summaries = sampleEventSummaries()
    const starts = summaries.map((summary) => Date.parse(summary.startsAt))

    // Twenty events, of which the postponed, cancelled and finished three are
    // not listed — exactly as the API leaves them out of "what is on".
    expect(summaries).toHaveLength(SAMPLE_EVENTS.length - 3)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })
})

describe('findSampleEvent', () => {
  it('finds an event by slug', () => {
    expect(findSampleEvent('navratri-night-one-edison').title).toBe(
      'Navratri Night One: Garba Under the Lights',
    )
  })

  it('resolves an event the listing leaves out, as the live page does', () => {
    expect(findSampleEvent('collegiate-raas-showcase-irving').status).toBe('CANCELLED')
  })

  it('returns null for anything it does not have', () => {
    expect(findSampleEvent('no-such-event')).toBeNull()
    expect(findSampleEvent(undefined)).toBeNull()
  })
})

describe('findSampleVenue', () => {
  it('lists only upcoming events in a listed status', () => {
    const delaware = findSampleVenue('delaware-river-pavilion')

    expect(delaware).toMatchObject({ city: 'Philadelphia', region: 'PA', country: 'US' })
    expect(delaware.timezone).toBe('America/New_York')
    // Garba & Aarti is listed; Garba for Good is postponed, and is not.
    expect(delaware.upcomingEvents.map((entry) => entry.slug)).toEqual([
      'garba-and-aarti-on-the-delaware',
    ])
  })

  it('claims no coordinates for an invented address', () => {
    expect(findSampleVenue('lamplight-expo-hall')).toMatchObject({
      latitude: null,
      longitude: null,
    })
  })

  it('returns null for a venue it does not have', () => {
    expect(findSampleVenue('no-such-venue')).toBeNull()
  })
})

describe('findSampleOrganizer', () => {
  it('shows a finished event as the organiser’s track record', () => {
    const peachtree = findSampleOrganizer('peachtree-raas-club')

    expect(peachtree.verified).toBe(true)
    expect(peachtree.pastEvents.map((entry) => entry.slug)).toEqual(['garba-warm-up-night-atlanta'])
    expect(peachtree.upcomingEvents.map((entry) => entry.slug)).toEqual([
      'peachtree-garba-saturday',
    ])
  })

  it('leaves a cancelled event off both lists', () => {
    const loneStar = findSampleOrganizer('lone-star-navratri')
    const slugs = [...loneStar.upcomingEvents, ...loneStar.pastEvents].map((entry) => entry.slug)

    expect(slugs).toEqual(['lone-star-sharad-poonam-garba'])
  })

  it('carries no badge for an unverified organiser', () => {
    expect(findSampleOrganizer('liberty-bell-navratri').verified).toBe(false)
  })
})
