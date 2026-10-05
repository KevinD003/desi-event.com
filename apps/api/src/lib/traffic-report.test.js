import { describe, expect, it } from 'vitest'

import {
  SERIES_LIMIT_DAYS,
  TRAFFIC_STALE_AFTER_MS,
  percent1,
  publicListStatuses,
  trafficWindow,
  zeroFilledSeries,
} from './traffic-report.js'

const NOW = new Date('2026-10-01T15:00:00.000Z')

describe('trafficWindow', () => {
  it('starts on the day `from` falls on, and has no start without one', () => {
    expect(trafficWindow({ from: new Date('2026-09-20T23:30:00Z'), now: NOW }).firstDay).toBe(
      '2026-09-20',
    )
    expect(trafficWindow({ now: NOW })).toEqual({ firstDay: null, lastDay: '2026-10-01' })
  })

  it('treats `to` as exclusive, so a midnight `to` ends the day before', () => {
    expect(trafficWindow({ to: new Date('2026-09-25T00:00:00Z'), now: NOW }).lastDay).toBe(
      '2026-09-24',
    )
    expect(trafficWindow({ to: new Date('2026-09-25T00:00:01Z'), now: NOW }).lastDay).toBe(
      '2026-09-25',
    )
  })

  it('caps a future `to` at today', () => {
    expect(trafficWindow({ to: new Date('2027-01-01T00:00:00Z'), now: NOW }).lastDay).toBe(
      '2026-10-01',
    )
  })
})

describe('zeroFilledSeries', () => {
  const zero = () => ({ views: 0 })

  it('fills every day between the start and the end, keeping counted days', () => {
    const { byDay, seriesTruncated } = zeroFilledSeries([{ day: '2026-09-29', views: 4 }], {
      firstDay: '2026-09-27',
      lastDay: '2026-10-01',
      zero,
    })

    expect(byDay).toEqual([
      { day: '2026-09-27', views: 0 },
      { day: '2026-09-28', views: 0 },
      { day: '2026-09-29', views: 4 },
      { day: '2026-09-30', views: 0 },
      { day: '2026-10-01', views: 0 },
    ])
    expect(seriesTruncated).toBe(false)
  })

  it('starts from the earliest counted day when the window has no start', () => {
    const { byDay } = zeroFilledSeries(
      [
        { day: '2026-09-30', views: 2 },
        { day: '2026-09-29', views: 1 },
      ],
      { firstDay: null, lastDay: '2026-10-01', zero },
    )

    expect(byDay.map((day) => day.day)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01'])
  })

  it('is one empty day with nothing counted and no start', () => {
    expect(zeroFilledSeries([], { firstDay: null, lastDay: '2026-10-01', zero }).byDay).toEqual([
      { day: '2026-10-01', views: 0 },
    ])
  })

  it('draws at most 366 days, the latest, and says it was cut', () => {
    const { byDay, seriesTruncated } = zeroFilledSeries([], {
      firstDay: '2020-01-01',
      lastDay: '2026-10-01',
      zero,
    })

    expect(byDay).toHaveLength(SERIES_LIMIT_DAYS)
    expect(byDay.at(-1).day).toBe('2026-10-01')
    expect(byDay[0].day).toBe('2025-10-01')
    expect(seriesTruncated).toBe(true)
  })

  it('is empty when the window starts after it ends', () => {
    expect(
      zeroFilledSeries([], { firstDay: '2026-10-05', lastDay: '2026-10-01', zero }).byDay,
    ).toEqual([])
  })
})

describe('percent1', () => {
  it('is null with nothing to divide by, and rounds to one decimal', () => {
    expect(percent1(3, 0)).toBeNull()
    expect(percent1(1, 3)).toBe(33.3)
    expect(percent1(2, 3)).toBe(66.7)
    expect(percent1(0, 5)).toBe(0)
  })
})

describe('publicListStatuses', () => {
  it('covers the publicly visible statuses', () => {
    expect(publicListStatuses()).toEqual(
      expect.arrayContaining(['PUBLISHED', 'ON_SALE', 'COMPLETED', 'CANCELLED', 'POSTPONED']),
    )
    expect(publicListStatuses()).not.toContain('DRAFT')
    expect(publicListStatuses()).not.toContain('REVIEW_PENDING')
  })

  it('adds deleted events once the status exists, and never names one that does not', () => {
    expect(publicListStatuses(['DRAFT', 'ON_SALE'])).not.toContain('DELETED')
    expect(publicListStatuses(['DRAFT', 'ON_SALE', 'DELETED'])).toContain('DELETED')
  })
})

describe('freshness', () => {
  it('calls figures stale after two hours without a finished roll-up', () => {
    expect(TRAFFIC_STALE_AFTER_MS).toBe(2 * 60 * 60 * 1000)
  })
})
