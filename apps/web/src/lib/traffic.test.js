import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ANALYTICS_PERIOD,
  DEFAULT_PLATFORM_PERIOD,
  DEMONSTRATION_NOTICE,
  PERIODS,
  REFUNDED_ORDERS_NOTE,
  VISIT_COUNTING_NOTES,
  formatCount,
  formatDay,
  formatShare,
  freshness,
  periodFor,
  periodFrom,
  trafficExclusion,
} from './traffic.js'

const HONEST = /\b(soon|yet|planned|coming)\b/iu

describe('trafficExclusion', () => {
  it('counts a signed-out visitor and an attendee', () => {
    expect(trafficExclusion(null)).toEqual({ excludeAll: false, excludedOrganizationIds: [] })
    expect(trafficExclusion({ role: 'ATTENDEE', capabilities: [], memberships: [] })).toEqual({
      excludeAll: false,
      excludedOrganizationIds: [],
    })
  })

  it('leaves out an owner’s own organisations, and nothing else', () => {
    expect(
      trafficExclusion({
        role: 'ORGANIZER',
        capabilities: [],
        memberships: [
          { organizationId: 'corga000000000000000001', role: 'OWNER' },
          { organizationId: 'corgb000000000000000002', role: 'SCANNER' },
        ],
      }),
    ).toEqual({
      excludeAll: false,
      excludedOrganizationIds: ['corga000000000000000001', 'corgb000000000000000002'],
    })
  })

  it.each([
    ['a moderator', ['moderation:review']],
    ['a super administrator', ['platform:admin', 'report:view']],
  ])('leaves out %s everywhere', (_name, capabilities) => {
    expect(trafficExclusion({ capabilities, memberships: [] }).excludeAll).toBe(true)
  })
})

describe('periods', () => {
  it('offers the last 7, 30 and 90 days and everything, and defaults per screen', () => {
    expect(PERIODS.map((period) => period.key)).toEqual(['7', '30', '90', 'all'])
    expect(DEFAULT_ANALYTICS_PERIOD).toBe('all')
    expect(DEFAULT_PLATFORM_PERIOD).toBe('30')
    expect(periodFor('nonsense').key).toBe('all')
    expect(periodFor('nonsense', '30').key).toBe('30')
    expect(periodFor('7').label).toBe('Last 7 days')
  })

  it('starts a period at UTC midnight, counting today as one of its days', () => {
    const now = new Date('2026-10-01T15:30:00.000Z')

    expect(periodFrom('7', now)).toBe('2026-09-25T00:00:00.000Z')
    expect(periodFrom('30', now)).toBe('2026-09-02T00:00:00.000Z')
    expect(periodFrom('all', now)).toBeNull()
    expect(periodFrom('x', now)).toBeNull()
  })
})

describe('formatting', () => {
  it('formats counts, shares and days', () => {
    expect(formatCount(12345)).toBe('12,345')
    expect(formatCount(undefined)).toBe('0')
    expect(formatShare(1, 3)).toBe('33.3%')
    expect(formatShare(0, 0)).toBe('—')
    expect(formatDay('2026-10-01')).toBe('Oct 1')
  })
})

describe('freshness', () => {
  it('says plainly when nothing has ever been added up', () => {
    expect(freshness({ updatedAt: null })).toEqual({
      tone: 'never',
      sentence: 'No visits have been added up on this site: the job that adds them up has not run.',
    })
  })

  it('says what time the figures run to, in UTC', () => {
    expect(freshness({ updatedAt: '2026-10-01T09:05:00.000Z', stale: false })).toEqual({
      tone: 'fresh',
      sentence: 'These figures run to 09:05 UTC on Oct 1.',
    })
  })

  it('says later visits are missing when the figures are stale', () => {
    const { tone, sentence } = freshness({ updatedAt: '2026-10-01T09:05:00.000Z', stale: true })

    expect(tone).toBe('stale')
    expect(sentence).toBe(
      'These figures run to 09:05 UTC on Oct 1. The job that adds visits up has not finished since, so later visits are missing.',
    )
  })

  it('never names a cadence or promises anything', () => {
    for (const state of [
      { updatedAt: null },
      { updatedAt: '2026-10-01T09:05:00Z' },
      { updatedAt: '2026-10-01T09:05:00Z', stale: true },
    ]) {
      const { sentence } = freshness(state)

      expect(sentence).not.toMatch(HONEST)
      expect(sentence).not.toMatch(/every \w+ minutes/iu)
    }
  })
})

describe('the counting notes', () => {
  it('say who is not counted, how a visitor is recognised, and when records go', () => {
    const text = VISIT_COUNTING_NOTES.join(' ')

    expect(text).toMatch(/Robots/u)
    expect(text).toMatch(/Global Privacy Control or Do Not Track/u)
    expect(text).toMatch(/deleted from the live database when the day ends/u)
    expect(text).toMatch(/Backups taken during the day keep that secret/u)
    expect(text).toMatch(
      /deleted two days after the day it happened, by the job that adds visits up/u,
    )
    expect(text).toMatch(/a guide to interest, not an audit/u)
  })

  it('make no promise and say the demonstration figures are not counted visits', () => {
    for (const sentence of [
      ...VISIT_COUNTING_NOTES,
      DEMONSTRATION_NOTICE.body,
      REFUNDED_ORDERS_NOTE,
    ]) {
      expect(sentence).not.toMatch(HONEST)
    }

    expect(DEMONSTRATION_NOTICE).toEqual({
      title: 'Demonstration figures',
      body: 'Some of these figures were written by the development seed to show how this page looks. They are not counted visits.',
    })
    expect(REFUNDED_ORDERS_NOTE).toBe('An order refunded later is not counted as paid.')
  })
})
