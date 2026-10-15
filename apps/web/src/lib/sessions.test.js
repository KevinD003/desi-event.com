import { describe, expect, it } from 'vitest'

import {
  EVERY_NIGHT,
  formatNightTime,
  groupTiersBySession,
  joinLinkHost,
  sessionDisplayLabel,
  sessionForTicket,
  sessionForTier,
  sessionSellsSeats,
  sessionStatusBadge,
} from './sessions.js'

const EASTERN = 'America/New_York'

/**
 * A public night.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The night.
 */
function night(overrides = {}) {
  return {
    id: 'snnightonexxx',
    label: 'Night 1',
    startsAt: '2026-10-03T23:30:00.000Z',
    endsAt: '2026-10-04T04:30:00.000Z',
    doorsOpenAt: '2026-10-03T23:00:00.000Z',
    timezone: EASTERN,
    status: 'SCHEDULED',
    salesStartAt: null,
    salesEndAt: null,
    hasSeatMap: false,
    seatsAvailable: null,
    ...overrides,
  }
}

const ONE = night()
const TWO = night({
  id: 'snnighttwoxxx',
  label: 'Night 2',
  startsAt: '2026-10-04T23:30:00.000Z',
  endsAt: '2026-10-05T04:30:00.000Z',
})

describe('a night’s time and label', () => {
  it('reads a time in the venue’s zone, never the browser’s', () => {
    expect(formatNightTime('2026-10-03T23:30:00.000Z', EASTERN)).toBe('Sat, Oct 3 · 7:30 PM')
    expect(formatNightTime('2026-10-03T23:30:00.000Z', 'America/Los_Angeles')).toBe(
      'Sat, Oct 3 · 4:30 PM',
    )
    expect(formatNightTime('not a time', EASTERN)).toBeNull()
  })

  it('always carries the date beside the organiser’s label', () => {
    expect(sessionDisplayLabel(ONE)).toBe('Night 1 · Sat, Oct 3 · 7:30 PM')
    expect(sessionDisplayLabel({ ...ONE, label: '  ' })).toBe('Sat, Oct 3 · 7:30 PM')
    expect(sessionDisplayLabel({ ...ONE, label: null })).toBe('Sat, Oct 3 · 7:30 PM')
    expect(sessionDisplayLabel(ONE, { timeZone: 'UTC' })).toBe('Night 1 · Sat, Oct 3 · 11:30 PM')
    expect(sessionDisplayLabel(null)).toBe('')
  })
})

describe('which night a tier or ticket is for', () => {
  it('finds a tier’s night, or none for a tier good for every night', () => {
    expect(sessionForTier({ eventSessionId: TWO.id }, [ONE, TWO])).toBe(TWO)
    expect(sessionForTier({ eventSessionId: null }, [ONE, TWO])).toBeNull()
    expect(sessionForTier({ eventSessionId: 'snunknownxxxx' }, [ONE, TWO])).toBeNull()
  })

  it('reads a ticket’s night as the API named it', () => {
    expect(sessionForTicket({ session: ONE })).toBe(ONE)
    expect(sessionForTicket({ session: null })).toBeNull()
    expect(sessionForTicket(undefined)).toBeNull()
  })
})

describe('tiers grouped by night', () => {
  const general = { id: 'ttgeneral', eventSessionId: null }
  const firstNight = { id: 'ttfirst', eventSessionId: ONE.id }
  const secondNight = { id: 'ttsecond', eventSessionId: TWO.id }
  const stray = { id: 'ttstray', eventSessionId: 'snunknownxxxx' }

  it('is one untitled group when there is one night or none', () => {
    expect(groupTiersBySession([general, firstNight], [ONE])).toEqual([
      { key: 'all', session: null, heading: null, tiers: [general, firstNight] },
    ])
    expect(groupTiersBySession([], [])).toEqual([])
  })

  it('puts each night’s tiers under it, soonest first, and every-night tiers last', () => {
    const groups = groupTiersBySession([general, secondNight, firstNight, stray], [TWO, ONE])

    expect(groups.map((group) => group.heading)).toEqual([
      'Night 1 · Sat, Oct 3 · 7:30 PM',
      'Night 2 · Sun, Oct 4 · 7:30 PM',
      EVERY_NIGHT,
    ])
    expect(groups.map((group) => group.tiers.map((tier) => tier.id))).toEqual([
      ['ttfirst'],
      ['ttsecond'],
      // A tier naming a night the event does not list is shown, not dropped.
      ['ttgeneral', 'ttstray'],
    ])
  })

  it('leaves out a night with nothing on sale for it', () => {
    expect(groupTiersBySession([firstNight], [ONE, TWO]).map((group) => group.key)).toEqual([
      ONE.id,
    ])
  })
})

describe('whether a night sells seats now', () => {
  const now = new Date('2026-10-01T12:00:00.000Z')
  const seated = night({ hasSeatMap: true, seatsAvailable: 40 })

  it('is true for a seated night on sale, inside its window, with a seat free', () => {
    expect(sessionSellsSeats(seated, now)).toBe(true)
    expect(sessionSellsSeats({ ...seated, status: 'ON_SALE' }, now)).toBe(true)
  })

  it('is false without a map, a free seat, the right status, or inside the window', () => {
    expect(sessionSellsSeats(ONE, now)).toBe(false)
    expect(sessionSellsSeats({ ...seated, seatsAvailable: 0 }, now)).toBe(false)
    expect(sessionSellsSeats({ ...seated, status: 'SALES_PAUSED' }, now)).toBe(false)
    expect(sessionSellsSeats({ ...seated, salesStartAt: '2026-10-02T00:00:00.000Z' }, now)).toBe(
      false,
    )
    expect(sessionSellsSeats({ ...seated, salesEndAt: '2026-09-30T00:00:00.000Z' }, now)).toBe(
      false,
    )
    expect(sessionSellsSeats(seated, new Date('2026-10-04T05:00:00.000Z'))).toBe(false)
    expect(sessionSellsSeats(null, now)).toBe(false)
  })
})

describe('a night’s state, in words', () => {
  const now = new Date('2026-10-01T12:00:00.000Z')

  it('says what the night’s status says', () => {
    expect(sessionStatusBadge(night({ status: 'CANCELLED' }), now)).toEqual({
      text: 'Cancelled',
      variant: 'danger',
    })
    expect(sessionStatusBadge(night({ status: 'SOLD_OUT' }), now).text).toBe('Sold out')
    expect(sessionStatusBadge(night({ status: 'SALES_PAUSED' }), now).text).toBe('Sales paused')
    expect(sessionStatusBadge(night({ status: 'COMPLETED' }), now).text).toBe('Finished')
  })

  it('says sold out for a seated night whose tiers have no seat left', () => {
    const full = night({ hasSeatMap: true, seatsAvailable: 0 })
    const tiers = [
      {
        id: 'ttfront',
        reserved: true,
        eventSessionId: full.id,
        status: 'ON_SALE',
        availableQuantity: 0,
      },
      {
        id: 'ttback',
        reserved: true,
        eventSessionId: full.id,
        status: 'SOLD_OUT',
        availableQuantity: 0,
      },
    ]

    expect(sessionStatusBadge(full, now, tiers)).toEqual({ text: 'Sold out', variant: 'danger' })
  })

  it('does not call a seated night sold out when nothing is on sale now but seats are left', () => {
    const quiet = night({ hasSeatMap: true, seatsAvailable: 0 })
    // The Back tier has seats; it is paused, so none can be taken now.
    const tiers = [
      {
        id: 'ttfront',
        reserved: true,
        eventSessionId: quiet.id,
        status: 'ON_SALE',
        availableQuantity: 0,
      },
      {
        id: 'ttback',
        reserved: true,
        eventSessionId: quiet.id,
        status: 'PAUSED',
        availableQuantity: 0,
      },
    ]

    expect(sessionStatusBadge(quiet, now, tiers)).toEqual({
      text: 'Not on sale now',
      variant: 'neutral',
    })
    // With nothing known about its tiers, it says the same rather than guess.
    expect(sessionStatusBadge(quiet, now).text).toBe('Not on sale now')
  })

  it('reads the sales window, and never promises when a sale opens', () => {
    expect(sessionStatusBadge(night({ salesStartAt: '2026-10-02T00:00:00.000Z' }), now)).toEqual({
      text: 'Not on sale now',
      variant: 'neutral',
    })
    expect(sessionStatusBadge(night({ salesEndAt: '2026-09-30T00:00:00.000Z' }), now).text).toBe(
      'Sales closed',
    )
    expect(sessionStatusBadge(night(), now)).toEqual({ text: 'On sale', variant: 'success' })
  })
})

describe('a joining link’s host', () => {
  it('names the host of a web link and nothing else', () => {
    expect(joinLinkHost('https://stream.example.com/room/1?pass=abc')).toBe('stream.example.com')
    expect(joinLinkHost('http://example.org:8080/x')).toBe('example.org:8080')
    expect(joinLinkHost('javascript:alert(1)')).toBeNull()
    expect(joinLinkHost('not a url')).toBeNull()
  })
})
