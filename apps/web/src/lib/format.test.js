import { describe, expect, it } from 'vitest'

import {
  formatDateIn,
  formatEventDate,
  formatEventLocation,
  formatEventStart,
  formatEventTime,
  formatEventWhen,
  formatInstantIn,
  formatTimeZoneLabel,
  formatVenueAddress,
  toDateTimeAttribute,
  toParagraphs,
} from './format.js'

describe('formatEventDate', () => {
  it('formats in the event timezone, not the machine timezone', () => {
    // 03:30 UTC on the 18th is still the evening of the 17th in New York
    // (−04:00 in October) and in Los Angeles (−07:00).
    expect(formatEventDate('2026-10-18T03:30:00.000Z', 'America/New_York')).toBe(
      'Sat, Oct 17, 2026',
    )
    expect(formatEventDate('2026-10-18T03:30:00.000Z', 'America/Los_Angeles')).toBe(
      'Sat, Oct 17, 2026',
    )
    expect(formatEventDate('2026-10-18T03:30:00.000Z', 'Europe/London')).toBe('Sun, Oct 18, 2026')
  })

  it('still formats an event outside the US in its own zone', () => {
    // 18:45 UTC is already the next day in Kolkata (+05:30).
    expect(formatEventDate('2026-10-11T18:45:00.000Z', 'Asia/Kolkata')).toBe('Mon, Oct 12, 2026')
  })

  it('returns an empty string for an unparseable value rather than "Invalid Date"', () => {
    expect(formatEventDate('not a date', 'America/New_York')).toBe('')
    expect(formatEventDate(null)).toBe('')
    expect(formatEventDate(undefined)).toBe('')
  })
})

describe('formatEventTime', () => {
  it('converts into the event timezone, in US twelve-hour form', () => {
    expect(formatEventTime('2026-10-17T23:30:00.000Z', 'America/New_York')).toBe('7:30 PM')
    expect(formatEventTime('2026-10-18T00:30:00.000Z', 'America/Chicago')).toBe('7:30 PM')
    expect(formatEventTime('2026-10-18T02:30:00.000Z', 'America/Los_Angeles')).toBe('7:30 PM')
  })

  it('follows the zone across a daylight-saving change', () => {
    // The same 7:30 PM wall-clock start is 23:30 UTC in October and 00:30 UTC
    // the next day in December.
    expect(formatEventTime('2026-12-12T00:30:00.000Z', 'America/New_York')).toBe('7:30 PM')
  })

  it('formats a zone outside the US too', () => {
    expect(formatEventTime('2026-10-11T13:30:00.000Z', 'Asia/Kolkata')).toBe('7:00 PM')
  })
})

describe('formatEventWhen', () => {
  it('collapses a same-day event to one date and a time range', () => {
    const when = formatEventWhen({
      startsAt: '2026-10-10T23:00:00.000Z',
      endsAt: '2026-10-11T01:00:00.000Z',
      timezone: 'America/New_York',
    })

    expect(when).toBe('Sat, Oct 10, 2026 · 7:00 PM – 9:00 PM')
  })

  it('reads an evening that runs past midnight as one evening', () => {
    const when = formatEventWhen({
      startsAt: '2026-10-17T23:30:00.000Z',
      endsAt: '2026-10-18T04:30:00.000Z',
      timezone: 'America/New_York',
    })

    expect(when).toBe('Sat, Oct 17, 2026 · 7:30 PM – 12:30 AM')
  })

  it('spells out both dates once the end is past the small hours', () => {
    const when = formatEventWhen({
      startsAt: '2026-10-17T23:30:00.000Z',
      endsAt: '2026-10-18T14:00:00.000Z',
      timezone: 'America/New_York',
    })

    expect(when).toBe('Sat, Oct 17, 2026, 7:30 PM – Sun, Oct 18, 2026, 10:00 AM')
  })

  it('spells out both dates when an event runs across several days', () => {
    const when = formatEventWhen({
      startsAt: '2026-10-11T23:30:00.000Z',
      endsAt: '2026-10-20T04:30:00.000Z',
      timezone: 'America/New_York',
    })

    expect(when).toBe('Sun, Oct 11, 2026, 7:30 PM – Tue, Oct 20, 2026, 12:30 AM')
  })

  it('falls back to the start alone when there is no end', () => {
    const when = formatEventWhen({
      startsAt: '2026-10-18T00:30:00.000Z',
      timezone: 'America/Chicago',
    })

    expect(when).toBe('Sat, Oct 17, 2026 · 7:30 PM')
  })

  it('returns an empty string when the event has no start', () => {
    expect(formatEventWhen({})).toBe('')
    expect(formatEventWhen(null)).toBe('')
  })
})

describe('formatEventStart', () => {
  const now = new Date('2026-09-23T12:00:00.000Z')

  it('states day, date, time and zone the way a card does', () => {
    const start = formatEventStart(
      { startsAt: '2026-10-17T23:30:00.000Z', timezone: 'America/New_York' },
      { now },
    )

    expect(start).toBe('Sat, Oct 17 · 7:30 PM EDT')
  })

  it('names the zone of the event, not of the reader', () => {
    expect(
      formatEventStart(
        { startsAt: '2026-10-18T02:30:00.000Z', timezone: 'America/Los_Angeles' },
        { now },
      ),
    ).toBe('Sat, Oct 17 · 7:30 PM PDT')
    expect(
      formatEventStart(
        { startsAt: '2026-10-18T00:30:00.000Z', timezone: 'America/Chicago' },
        { now },
      ),
    ).toBe('Sat, Oct 17 · 7:30 PM CDT')
  })

  it('uses the abbreviation in force on the day, not today’s', () => {
    expect(
      formatEventStart(
        { startsAt: '2026-12-12T00:30:00.000Z', timezone: 'America/New_York' },
        { now },
      ),
    ).toBe('Fri, Dec 11 · 7:30 PM EST')
  })

  it('reads British Columbia at -07:00 after 1 November 2026, which needs tzdata 2026b or later', () => {
    // The server renders this page: on older time-zone data it would print 6:00 PM.
    expect(
      formatEventStart(
        { startsAt: '2026-11-29T02:00:00.000Z', timezone: 'America/Vancouver' },
        { now },
      ),
    ).toMatch(/^Sat, Nov 28 · 7:00 PM /u)
    expect(
      formatEventStart(
        { startsAt: '2026-11-29T02:00:00.000Z', timezone: 'America/Los_Angeles' },
        { now },
      ),
    ).toBe('Sat, Nov 28 · 6:00 PM PST')
  })

  it('adds the year only when it is not the current one', () => {
    expect(
      formatEventStart(
        { startsAt: '2027-01-09T00:30:00.000Z', timezone: 'America/Chicago' },
        { now },
      ),
    ).toBe('Fri, Jan 8, 2027 · 6:30 PM CST')
  })

  it('is empty when there is no start', () => {
    expect(formatEventStart({})).toBe('')
    expect(formatEventStart(null)).toBe('')
  })
})

describe('formatTimeZoneLabel', () => {
  it('names the zone the event happens in', () => {
    const label = formatTimeZoneLabel({
      startsAt: '2026-10-17T23:30:00.000Z',
      timezone: 'America/New_York',
    })

    expect(label).toBe('EDT')
  })

  it('still labels a zone with no US abbreviation, by its offset', () => {
    const label = formatTimeZoneLabel({
      startsAt: '2026-10-11T13:30:00.000Z',
      timezone: 'Asia/Kolkata',
    })

    expect(label).toBe('GMT+5:30')
  })

  it('is empty when there is nothing to label', () => {
    expect(formatTimeZoneLabel({})).toBe('')
  })
})

describe('formatInstantIn', () => {
  it('writes an instant in the zone named, and says which', () => {
    // 02:30 UTC on 10 October is 9:30 PM the evening before in Chicago.
    expect(formatInstantIn('2026-10-10T02:30:00.000Z', 'America/Chicago')).toBe(
      'Oct 9, 2026, 9:30 PM CDT',
    )
    expect(formatInstantIn('2026-12-10T02:30:00.000Z', 'America/Chicago')).toBe(
      'Dec 9, 2026, 8:30 PM CST',
    )
  })

  it('is in UTC, saying so, when no zone is named', () => {
    expect(formatInstantIn('2026-10-10T02:30:00.000Z')).toBe('Oct 10, 2026, 2:30 AM UTC')
  })

  it('falls back to UTC, saying so, for a zone it does not know, and is null for no instant', () => {
    expect(formatInstantIn('2026-10-10T02:30:00.000Z', 'Mars/Olympus')).toBe(
      'Oct 10, 2026, 2:30 AM UTC',
    )
    expect(formatInstantIn(null, 'America/Chicago')).toBeNull()
    expect(formatInstantIn('not a date', 'America/Chicago')).toBeNull()
  })
})

describe('formatDateIn', () => {
  it('writes the day an instant falls on in the zone named', () => {
    expect(formatDateIn('2026-10-10T02:30:00.000Z', 'America/Chicago')).toBe('Oct 9, 2026')
    expect(formatDateIn('2026-10-10T02:30:00.000Z')).toBe('Oct 10, 2026')
    expect(formatDateIn(null, 'America/Chicago')).toBeNull()
  })
})

describe('toDateTimeAttribute', () => {
  it('emits a machine-readable UTC timestamp', () => {
    expect(toDateTimeAttribute('2026-10-17T19:30:00-04:00')).toBe('2026-10-17T23:30:00.000Z')
  })

  it('is undefined for junk, so the attribute is omitted entirely', () => {
    expect(toDateTimeAttribute('nonsense')).toBeUndefined()
  })
})

describe('formatEventLocation', () => {
  it('prefers the full venue relation when it is present', () => {
    expect(formatEventLocation({ venue: { name: 'Lamplight Expo Hall', city: 'Edison' } })).toBe(
      'Lamplight Expo Hall, Edison',
    )
  })

  it('falls back to the denormalised summary fields', () => {
    expect(formatEventLocation({ venueName: 'Lakeshore Pavilion', city: 'Schaumburg' })).toBe(
      'Lakeshore Pavilion, Schaumburg',
    )
  })

  it('says Online for a streamed event even when a venue is attached', () => {
    expect(
      formatEventLocation({ isOnline: true, venueName: 'Lamplight Expo Hall', city: 'Edison' }),
    ).toBe('Online')
  })

  it('never renders an empty location', () => {
    expect(formatEventLocation({})).toBe('Venue to be announced')
  })
})

describe('formatVenueAddress', () => {
  it('writes a US address the way it is posted, with the ZIP beside the state', () => {
    expect(
      formatVenueAddress({
        addressLine1: '450 Festival Plaza',
        addressLine2: null,
        city: 'Edison',
        region: 'NJ',
        postalCode: '08837',
      }),
    ).toEqual(['450 Festival Plaza', 'Edison, NJ 08837'])
  })

  it('omits the parts the venue does not have', () => {
    expect(
      formatVenueAddress({
        addressLine1: '92-10 Utsav Plaza',
        addressLine2: 'Upper concourse',
        city: 'Queens',
        region: null,
        postalCode: null,
      }),
    ).toEqual(['92-10 Utsav Plaza', 'Upper concourse', 'Queens'])
  })

  it('returns nothing for a missing venue', () => {
    expect(formatVenueAddress(null)).toEqual([])
  })

  it('writes a Canadian address with its province and postal code, then names the country', () => {
    expect(
      formatVenueAddress({
        addressLine1: '255 Front St W',
        addressLine2: null,
        city: 'Toronto',
        region: 'ON',
        postalCode: 'M5V 2T6',
        country: 'CA',
      }),
    ).toEqual(['255 Front St W', 'Toronto, ON M5V 2T6', 'Canada'])
  })

  it('does not add the country to a US address, and leaves out a code it cannot name', () => {
    expect(
      formatVenueAddress({
        addressLine1: '500 W Las Colinas Blvd',
        city: 'Irving',
        region: 'TX',
        postalCode: '75039',
        country: 'US',
      }),
    ).toEqual(['500 W Las Colinas Blvd', 'Irving, TX 75039'])
    expect(
      formatVenueAddress({ addressLine1: '1 Main St', city: 'Somewhere', country: 'USA' }),
    ).toEqual(['1 Main St', 'Somewhere'])
  })
})

describe('toParagraphs', () => {
  it('splits on blank lines and trims each paragraph', () => {
    expect(toParagraphs('One.\n\n  Two.  \n\n\nThree.')).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('keeps single newlines inside a paragraph', () => {
    expect(toParagraphs('One.\nStill one.')).toEqual(['One.\nStill one.'])
  })

  it('returns nothing for a missing description', () => {
    expect(toParagraphs(null)).toEqual([])
    expect(toParagraphs('')).toEqual([])
  })
})
