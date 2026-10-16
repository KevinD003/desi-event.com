import { describe, expect, it } from 'vitest'

import { localDateCondition } from '../src/lib/local-dates.js'

describe('localDateCondition', () => {
  it('gives each zone its own span, from its first midnight to the one after the last day', () => {
    expect(
      localDateCondition({ fromDate: '2026-10-17', toDate: '2026-10-18' }, ['America/Vancouver']),
    ).toEqual({
      OR: [
        {
          timezone: 'America/Vancouver',
          startsAt: {
            gte: new Date('2026-10-17T07:00:00.000Z'),
            lt: new Date('2026-10-19T07:00:00.000Z'),
          },
        },
      ],
    })
  })

  it('leaves an open end open', () => {
    expect(localDateCondition({ fromDate: '2026-10-17' }, ['UTC'])).toEqual({
      OR: [{ timezone: 'UTC', startsAt: { gte: new Date('2026-10-17T00:00:00.000Z') } }],
    })
    expect(localDateCondition({ toDate: '2026-10-17' }, ['UTC'])).toEqual({
      OR: [{ timezone: 'UTC', startsAt: { lt: new Date('2026-10-18T00:00:00.000Z') } }],
    })
  })

  it('reads "today" in each zone at the moment it is asked', () => {
    // 03:00 UTC on the 17th: the 16th in Toronto and Vancouver, the 17th in London.
    const now = new Date('2026-10-17T03:00:00.000Z')

    expect(
      localDateCondition({ when: 'today' }, ['America/Vancouver', 'Europe/London'], now),
    ).toEqual({
      OR: [
        {
          timezone: 'America/Vancouver',
          startsAt: {
            gte: new Date('2026-10-16T07:00:00.000Z'),
            lt: new Date('2026-10-17T07:00:00.000Z'),
          },
        },
        {
          timezone: 'Europe/London',
          startsAt: {
            gte: new Date('2026-10-16T23:00:00.000Z'),
            lt: new Date('2026-10-17T23:00:00.000Z'),
          },
        },
      ],
    })
  })

  it('narrows a named span by dates given beside it', () => {
    const now = new Date('2026-10-16T15:00:00.000Z')

    // This month, from the 20th: the later start and the earlier end.
    expect(localDateCondition({ when: 'month', fromDate: '2026-10-20' }, ['UTC'], now)).toEqual({
      OR: [
        {
          timezone: 'UTC',
          startsAt: {
            gte: new Date('2026-10-20T00:00:00.000Z'),
            lt: new Date('2026-11-01T00:00:00.000Z'),
          },
        },
      ],
    })
  })

  it('finds nothing when no event has a zone', () => {
    expect(localDateCondition({ fromDate: '2026-10-17' }, [])).toEqual({ id: { in: [] } })
    expect(localDateCondition({ when: 'today' }, [])).toEqual({ id: { in: [] } })
  })
})
