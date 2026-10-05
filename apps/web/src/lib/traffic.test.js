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
  excludesEvent,
  trafficExclusion,
  trafficStatusLabel,
  websiteLinkLine,
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

describe('excludesEvent', () => {
  const ORG = 'corga000000000000000001'

  it('leaves staff out of every event, and a member out of their own organisation’s', () => {
    expect(excludesEvent({ excludeAll: true, excludedOrganizationIds: [] }, ORG)).toBe(true)
    expect(excludesEvent({ excludeAll: false, excludedOrganizationIds: [ORG] }, ORG)).toBe(true)
  })

  it('counts everybody else, and an event whose organisation is not known', () => {
    expect(
      excludesEvent({ excludeAll: false, excludedOrganizationIds: [ORG] }, 'corgb0000000000000002'),
    ).toBe(false)
    expect(excludesEvent({ excludeAll: false, excludedOrganizationIds: [ORG] }, null)).toBe(false)
    expect(excludesEvent(trafficExclusion(null), ORG)).toBe(false)
  })
})

describe('trafficStatusLabel', () => {
  it('says Deleted for a deleted event, whatever its status reads', () => {
    expect(trafficStatusLabel({ status: 'DELETED', deleted: true })).toBe('Deleted')
    expect(trafficStatusLabel({ status: 'ON_SALE', deleted: true })).toBe('Deleted')
    expect(trafficStatusLabel({ status: 'DELETED' })).toBe('Deleted')
  })

  it('uses the organiser’s word for every other status', () => {
    expect(trafficStatusLabel({ status: 'ON_SALE', deleted: false })).toBe('On sale')
    expect(trafficStatusLabel({ status: 'CANCELLED', deleted: false })).toBe('Cancelled')
  })
})

describe('websiteLinkLine', () => {
  const when = () => 'Oct 1, 2026, 9:00 AM UTC'
  const state = (overrides = {}) => ({
    enabled: false,
    pending: false,
    decidedUrl: null,
    submittedAt: null,
    changedAt: null,
    reason: null,
    changedByName: null,
    websiteProblem: null,
    ...overrides,
  })

  it('says on or off from the summary row when the switch state is not known', () => {
    expect(websiteLinkLine({ websiteLinkOn: true, websiteRedirect: null })).toBe(
      'Website link: On. Only the Desi-Event team can turn it on or off.',
    )
    expect(websiteLinkLine({ websiteLinkOn: false, websiteRedirect: null })).toBe(
      'Website link: Off. Only the Desi-Event team can turn it on or off.',
    )
  })

  it('uses the organiser’s sentence for a link that is on, naming who turned it on', () => {
    const line = websiteLinkLine(
      {
        websiteLinkOn: true,
        websiteRedirect: state({
          enabled: true,
          decidedUrl: 'https://mirrorwork.example/',
          changedAt: '2026-10-01T09:00:00.000Z',
          changedByName: 'Anil Administrator',
        }),
      },
      { formatInstant: when },
    )

    expect(line).toMatch(
      /^Website link: On since Oct 1, 2026, 9:00 AM UTC\. Anil Administrator of the Desi-Event team turned it on\./u,
    )
    expect(line).toMatch(/goes to mirrorwork\.example/u)
    expect(line).toMatch(/Only the Desi-Event team can turn this link on or off\.$/u)
  })

  it('does not guess whether a waiting change while on was a new address or a cleared one', () => {
    const line = websiteLinkLine(
      {
        websiteLinkOn: true,
        websiteRedirect: state({
          enabled: true,
          pending: true,
          decidedUrl: 'https://mirrorwork.example/',
          changedAt: '2026-10-01T09:00:00.000Z',
        }),
      },
      { formatInstant: when },
    )

    expect(line).toMatch(/keeps going to mirrorwork\.example/u)
    expect(line).not.toMatch(/You removed your address|Your new address/u)
  })

  it('does not point at a field that is not on this page', () => {
    const never = websiteLinkLine({ websiteLinkOn: false, websiteRedirect: state() })
    const problem = websiteLinkLine({
      websiteLinkOn: false,
      websiteRedirect: state({ pending: true, websiteProblem: 'It has a password in it.' }),
    })

    expect(never).toBe(
      'Website link: Off. This event has no website address for the Desi-Event team to link to; one can be added in the event’s editor. Only the Desi-Event team can turn this link on or off.',
    )
    expect(`${never} ${problem}`).not.toMatch(/above/u)
    expect(problem).toMatch(/^Website link: Off\. Your address is on the Desi-Event team’s list/u)
  })

  it('keeps the waiting sentence when a decided-off link has a new address', () => {
    const line = websiteLinkLine(
      {
        websiteLinkOn: false,
        websiteRedirect: state({
          pending: true,
          decidedUrl: 'https://old.example/',
          changedAt: '2026-10-01T09:00:00.000Z',
          changedByName: 'Anil Administrator',
          reason: 'Not the organiser’s site.',
        }),
      },
      { formatInstant: when },
    )

    expect(line).toMatch(
      /Off since Oct 1, 2026, 9:00 AM UTC\. Anil Administrator of the Desi-Event team turned it off, with this note: “Not the organiser’s site\.”/u,
    )
    expect(line).toMatch(/Your new address is on the Desi-Event team’s list to look at\./u)
    expect(line.match(/Only the Desi-Event team/gu)).toHaveLength(1)
  })

  it('tells a platform administrator from outside the organisation in the administrators’ words', () => {
    const on = {
      websiteLinkOn: true,
      websiteRedirect: state({
        enabled: true,
        decidedUrl: 'https://mirrorwork.example/',
        changedAt: '2026-10-01T09:00:00.000Z',
        changedByName: 'Anil Administrator',
        reason: 'Checked with the organiser.',
      }),
    }
    const off = {
      websiteLinkOn: false,
      websiteRedirect: state({
        pending: true,
        submittedAt: '2026-10-01T09:00:00.000Z',
        decidedUrl: 'https://old.example/',
        changedAt: '2026-10-01T09:00:00.000Z',
        changedByName: 'Anil Administrator',
      }),
    }
    const lines = [on, off].map((event) =>
      websiteLinkLine(event, { formatInstant: when, reader: 'administrator' }),
    )

    expect(lines[0]).toBe(
      'Website link: On since Oct 1, 2026, 9:00 AM UTC, going to mirrorwork.example. Turned on by Anil Administrator. Reason: Checked with the organiser. Only the Desi-Event team can turn this link on or off.',
    )
    expect(lines[1]).toBe(
      'Website link: Off since Oct 1, 2026, 9:00 AM UTC. Turned off by Anil Administrator. Waiting since Oct 1, 2026, 9:00 AM UTC. Only the Desi-Event team can turn this link on or off.',
    )
    for (const line of lines) expect(line).not.toMatch(/\b[Yy]our?\b/u)
    // The organiser still reads their own sentence.
    expect(websiteLinkLine(on, { formatInstant: when })).toMatch(/Your event page shows/u)
  })

  it('never uses a word that promises what this build does not do', () => {
    const line = websiteLinkLine({ websiteLinkOn: false, websiteRedirect: state() })

    expect(line).not.toMatch(HONEST)
  })
})
