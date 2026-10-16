import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  WHEN_PRESETS,
  addDays,
  isCalendarDay,
  isKnownZone,
  localDay,
  nextDay,
  presetDays,
  startOfDayIn,
} from './calendar-days.js'

describe('startOfDayIn', () => {
  it('finds midnight where the event happens', () => {
    expect(startOfDayIn('2026-10-17', 'America/Toronto').toISOString()).toBe(
      '2026-10-17T04:00:00.000Z',
    )
    expect(startOfDayIn('2026-10-17', 'America/Vancouver').toISOString()).toBe(
      '2026-10-17T07:00:00.000Z',
    )
    expect(startOfDayIn('2026-10-17', 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-16T18:30:00.000Z',
    )
  })

  it('reads the offset of the day itself either side of a clock change', () => {
    // Daylight saving ends on 1 November 2026 in North America.
    expect(startOfDayIn('2026-11-01', 'America/Chicago').toISOString()).toBe(
      '2026-11-01T05:00:00.000Z',
    )
    expect(startOfDayIn('2026-11-02', 'America/Chicago').toISOString()).toBe(
      '2026-11-02T06:00:00.000Z',
    )
    // And starts on 8 March 2026.
    expect(startOfDayIn('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    )
    expect(startOfDayIn('2026-03-09', 'America/New_York').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    )
  })

  it('reads a zone the runtime does not know as UTC', () => {
    expect(isKnownZone('Mars/Olympus_Mons')).toBe(false)
    expect(isKnownZone('')).toBe(false)
    expect(isKnownZone('America/Toronto')).toBe(true)
    expect(startOfDayIn('2026-10-17', 'Mars/Olympus_Mons').toISOString()).toBe(
      '2026-10-17T00:00:00.000Z',
    )
  })
})

describe('localDay', () => {
  it('is the day a card states for the event', () => {
    // 22:00 in Vancouver on the 17th is 05:00 UTC on the 18th.
    const instant = new Date('2026-10-18T05:00:00.000Z')

    expect(localDay(instant, 'America/Vancouver')).toBe('2026-10-17')
    expect(localDay(instant, 'America/Toronto')).toBe('2026-10-18')
    expect(localDay(instant.getTime(), 'Not/AZone')).toBe('2026-10-18')
  })
})

describe('day arithmetic', () => {
  it('crosses the end of a month and of a leap February', () => {
    expect(nextDay('2026-10-31')).toBe('2026-11-01')
    expect(nextDay('2028-02-28')).toBe('2028-02-29')
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('knows which written dates exist', () => {
    expect(isCalendarDay('2028-02-29')).toBe(true)
    for (const value of [
      '2026-02-30',
      '2026-13-01',
      '17/10/2026',
      '1969-12-31',
      '',
      null,
      20261017,
    ]) {
      expect(isCalendarDay(value)).toBe(false)
    }
  })
})

describe('presetDays', () => {
  // Friday 16 October 2026, 15:00 UTC: Friday in every North American zone.
  const friday = new Date('2026-10-16T15:00:00.000Z')

  it('names the four spans, and nothing else', () => {
    expect(WHEN_PRESETS).toEqual(['today', 'weekend', 'week', 'month'])
    expect(presetDays('fortnight', 'UTC', friday)).toBeNull()
  })

  it('reads today, this weekend, this week and this month on a Friday', () => {
    const zone = 'America/Chicago'

    expect(presetDays('today', zone, friday)).toEqual({
      fromDate: '2026-10-16',
      toDate: '2026-10-16',
    })
    expect(presetDays('weekend', zone, friday)).toEqual({
      fromDate: '2026-10-16',
      toDate: '2026-10-18',
    })
    expect(presetDays('week', zone, friday)).toEqual({
      fromDate: '2026-10-16',
      toDate: '2026-10-18',
    })
    expect(presetDays('month', zone, friday)).toEqual({
      fromDate: '2026-10-16',
      toDate: '2026-10-31',
    })
  })

  it('looks ahead to the next weekend from a weekday, and keeps what is left of one under way', () => {
    const tuesday = new Date('2026-10-13T15:00:00.000Z')
    const saturday = new Date('2026-10-17T15:00:00.000Z')
    const sunday = new Date('2026-10-18T15:00:00.000Z')

    expect(presetDays('weekend', 'UTC', tuesday)).toEqual({
      fromDate: '2026-10-16',
      toDate: '2026-10-18',
    })
    expect(presetDays('week', 'UTC', tuesday)).toEqual({
      fromDate: '2026-10-13',
      toDate: '2026-10-18',
    })
    expect(presetDays('weekend', 'UTC', saturday)).toEqual({
      fromDate: '2026-10-17',
      toDate: '2026-10-18',
    })
    expect(presetDays('weekend', 'UTC', sunday)).toEqual({
      fromDate: '2026-10-18',
      toDate: '2026-10-18',
    })
    expect(presetDays('week', 'UTC', sunday)).toEqual({
      fromDate: '2026-10-18',
      toDate: '2026-10-18',
    })
  })

  it('reads today where the event is, which can be a different day', () => {
    // 03:00 UTC on Saturday the 17th: still Friday evening in Vancouver.
    const late = new Date('2026-10-17T03:00:00.000Z')

    expect(presetDays('today', 'America/Vancouver', late).fromDate).toBe('2026-10-16')
    expect(presetDays('today', 'America/Toronto', late).fromDate).toBe('2026-10-16')
    expect(presetDays('today', 'Europe/London', late).fromDate).toBe('2026-10-17')
  })

  it('ends a February month on its last day, in a leap year too', () => {
    expect(presetDays('month', 'UTC', new Date('2028-02-10T12:00:00.000Z')).toDate).toBe(
      '2028-02-29',
    )
  })
})

describe('the module', () => {
  it('has its own subpath, so the browser can take it alone', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

    expect(manifest.exports['./calendar-days']).toBe('./src/calendar-days.js')
  })
})
