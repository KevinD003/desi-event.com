import { describe, expect, it } from 'vitest'

import {
  COMMON_ZONES,
  fromLocalInputValue,
  isKnownTimeZone,
  toLocalInputValue,
  zoneAbbreviation,
  zoneOffsetMs,
} from './zoned-time.js'

describe('reading an instant as a zone reads it', () => {
  it('shows a Mumbai evening as a Mumbai evening', () => {
    // 14:30 UTC is 20:00 in Kolkata, which is +05:30 all year.
    expect(toLocalInputValue('2026-11-01T14:30:00.000Z', 'Asia/Kolkata')).toBe('2026-11-01T20:00')
  })

  it('shows the same instant differently in two zones', () => {
    const instant = '2026-11-01T14:30:00.000Z'

    expect(toLocalInputValue(instant, 'Asia/Kolkata')).toBe('2026-11-01T20:00')
    expect(toLocalInputValue(instant, 'Europe/London')).toBe('2026-11-01T14:30')
    expect(toLocalInputValue(instant, 'UTC')).toBe('2026-11-01T14:30')
  })

  it('follows a zone across its own daylight-saving change', () => {
    // London is +01:00 in July and +00:00 in January. A form that ignored this
    // would show a July evening an hour early.
    expect(toLocalInputValue('2026-07-01T18:00:00.000Z', 'Europe/London')).toBe('2026-07-01T19:00')
    expect(toLocalInputValue('2026-01-01T18:00:00.000Z', 'Europe/London')).toBe('2026-01-01T18:00')
  })

  it('has nothing to show for a missing or unusable instant', () => {
    expect(toLocalInputValue(null, 'Asia/Kolkata')).toBe('')
    expect(toLocalInputValue('', 'Asia/Kolkata')).toBe('')
    expect(toLocalInputValue('not a date', 'Asia/Kolkata')).toBe('')
    expect(toLocalInputValue('2026-11-01T14:30:00.000Z', 'Mars/Olympus')).toBe('')
  })
})

describe('reading a typed wall clock as an instant', () => {
  it("interprets what was typed in the event's zone, not the browser's", () => {
    // This is the whole point. `new Date('2026-11-01T20:00')` would read it in
    // whatever zone the machine happens to be set to.
    expect(fromLocalInputValue('2026-11-01T20:00', 'Asia/Kolkata')).toBe('2026-11-01T14:30:00.000Z')
  })

  it('round-trips every common zone without drift', () => {
    const instant = '2026-06-15T09:45:00.000Z'

    for (const zone of COMMON_ZONES) {
      const wall = toLocalInputValue(instant, zone)

      expect(fromLocalInputValue(wall, zone), zone).toBe(instant)
    }
  })

  it('round-trips across a spring-forward and an autumn-back', () => {
    // The two weekends a naive implementation is an hour out.
    for (const instant of ['2026-03-29T10:00:00.000Z', '2026-10-25T10:00:00.000Z']) {
      const wall = toLocalInputValue(instant, 'Europe/London')

      expect(fromLocalInputValue(wall, 'Europe/London'), instant).toBe(instant)
    }
  })

  it('refuses rather than guessing when the zone is unknown', () => {
    expect(fromLocalInputValue('2026-11-01T20:00', 'Mars/Olympus')).toBeNull()
    expect(fromLocalInputValue('2026-11-01T20:00', '')).toBeNull()
  })

  it('has nothing to return for an empty or malformed input', () => {
    expect(fromLocalInputValue('', 'Asia/Kolkata')).toBeNull()
    expect(fromLocalInputValue('tomorrow evening', 'Asia/Kolkata')).toBeNull()
  })
})

describe('the zone itself', () => {
  it('measures an offset rather than tabulating it', () => {
    const july = new Date('2026-07-01T12:00:00.000Z')

    expect(zoneOffsetMs(july, 'Asia/Kolkata')).toBe(5.5 * 3600 * 1000)
    expect(zoneOffsetMs(july, 'UTC')).toBe(0)
    expect(zoneOffsetMs(july, 'Europe/London')).toBe(3600 * 1000)
  })

  it('asks the platform whether a zone exists rather than matching a list', () => {
    expect(isKnownTimeZone('Asia/Kolkata')).toBe(true)
    expect(isKnownTimeZone('Europe/London')).toBe(true)
    expect(isKnownTimeZone('Mars/Olympus')).toBe(false)
    expect(isKnownTimeZone('')).toBe(false)
    expect(isKnownTimeZone(undefined)).toBe(false)
  })

  it('has an abbreviation to put beside the input', () => {
    expect(zoneAbbreviation('Asia/Kolkata')).toBeTruthy()
    expect(zoneAbbreviation('Mars/Olympus')).toBe('')
  })

  it('offers the zones an organiser here actually wants first', () => {
    expect(COMMON_ZONES[0]).toBe('Asia/Kolkata')
    expect(COMMON_ZONES.every(isKnownTimeZone)).toBe(true)
  })
})
