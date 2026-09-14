import { describe, expect, it } from 'vitest'

import {
  formatEventDate,
  formatEventLocation,
  formatEventTime,
  formatEventWhen,
  formatTimeZoneLabel,
  formatVenueAddress,
  toDateTimeAttribute,
  toParagraphs,
} from './format.js'

describe('formatEventDate', () => {
  it('formats in the event timezone, not the machine timezone', () => {
    // 18:45 UTC is already the next day in Kolkata (+05:30).
    expect(formatEventDate('2026-10-11T18:45:00.000Z', 'Asia/Kolkata')).toBe('Mon, 12 Oct, 2026')
    expect(formatEventDate('2026-10-11T18:45:00.000Z', 'America/Toronto')).toBe('Sun, 11 Oct, 2026')
  })

  it('returns an empty string for an unparseable value rather than "Invalid Date"', () => {
    expect(formatEventDate('not a date', 'Asia/Kolkata')).toBe('')
    expect(formatEventDate(null)).toBe('')
    expect(formatEventDate(undefined)).toBe('')
  })
})

describe('formatEventTime', () => {
  it('converts into the event timezone', () => {
    expect(formatEventTime('2026-10-11T13:30:00.000Z', 'Asia/Kolkata')).toBe('7:00 pm')
    expect(formatEventTime('2026-10-11T13:30:00.000Z', 'Europe/London')).toBe('2:30 pm')
  })
})

describe('formatEventWhen', () => {
  it('collapses a same-day event to one date and a time range', () => {
    const when = formatEventWhen({
      startsAt: '2026-10-11T13:30:00.000Z',
      endsAt: '2026-10-11T16:30:00.000Z',
      timezone: 'Asia/Kolkata',
    })

    expect(when).toBe('Sun, 11 Oct, 2026 · 7:00 pm – 10:00 pm')
  })

  it('spells out both dates when an event runs across days', () => {
    const when = formatEventWhen({
      startsAt: '2026-10-11T04:00:00.000Z',
      endsAt: '2026-10-12T13:00:00.000Z',
      timezone: 'Europe/London',
    })

    expect(when).toBe('Sun, 11 Oct, 2026, 5:00 am – Mon, 12 Oct, 2026, 2:00 pm')
  })

  it('falls back to the start alone when there is no end', () => {
    const when = formatEventWhen({
      startsAt: '2026-10-11T04:00:00.000Z',
      timezone: 'Europe/London',
    })

    expect(when).toBe('Sun, 11 Oct, 2026 · 5:00 am')
  })

  it('returns an empty string when the event has no start', () => {
    expect(formatEventWhen({})).toBe('')
    expect(formatEventWhen(null)).toBe('')
  })
})

describe('formatTimeZoneLabel', () => {
  it('names the zone the event happens in', () => {
    const label = formatTimeZoneLabel({
      startsAt: '2026-10-11T13:30:00.000Z',
      timezone: 'Asia/Kolkata',
    })

    expect(label).toBe('IST')
  })

  it('is empty when there is nothing to label', () => {
    expect(formatTimeZoneLabel({})).toBe('')
  })
})

describe('toDateTimeAttribute', () => {
  it('emits a machine-readable UTC timestamp', () => {
    expect(toDateTimeAttribute('2026-10-11T13:30:00+05:30')).toBe('2026-10-11T08:00:00.000Z')
  })

  it('is undefined for junk, so the attribute is omitted entirely', () => {
    expect(toDateTimeAttribute('nonsense')).toBeUndefined()
  })
})

describe('formatEventLocation', () => {
  it('prefers the full venue relation when it is present', () => {
    expect(formatEventLocation({ venue: { name: 'Troxy', city: 'London' } })).toBe('Troxy, London')
  })

  it('falls back to the denormalised summary fields', () => {
    expect(formatEventLocation({ venueName: 'GMDC Ground', city: 'Ahmedabad' })).toBe(
      'GMDC Ground, Ahmedabad',
    )
  })

  it('says Online for a streamed event even when a venue is attached', () => {
    expect(formatEventLocation({ isOnline: true, venueName: 'Troxy', city: 'London' })).toBe(
      'Online',
    )
  })

  it('never renders an empty location', () => {
    expect(formatEventLocation({})).toBe('Venue to be announced')
  })
})

describe('formatVenueAddress', () => {
  it('omits the parts the venue does not have', () => {
    expect(
      formatVenueAddress({
        addressLine1: '490 Commercial Road',
        addressLine2: null,
        city: 'London',
        region: 'Greater London',
        postalCode: 'E1 0HX',
      }),
    ).toEqual(['490 Commercial Road', 'London, Greater London', 'E1 0HX'])
  })

  it('returns nothing for a missing venue', () => {
    expect(formatVenueAddress(null)).toEqual([])
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
