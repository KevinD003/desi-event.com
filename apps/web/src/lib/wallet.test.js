/**
 * Where each ticket lands, and why.
 *
 * Each case below fails against a plausible wrong implementation: bucketing on
 * `startsAt` rather than `endsAt`, treating a handed-on ticket as past, reading
 * `admits` a second time in the browser, or rendering an event's time in the
 * reader's timezone rather than the venue's.
 */

import { describe, expect, it } from 'vitest'

import {
  REACHABLE_STATUSES,
  TICKET_STATUS_WORDS,
  eventIsOver,
  groupTickets,
  seatText,
  sectionFor,
  usableCount,
  whenText,
  whereText,
} from './wallet.js'

/** The instant every case is judged against. */
const NOW = new Date('2026-10-01T12:00:00.000Z')

/**
 * A wallet row, with only what a case cares about spelled out.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The row.
 */
function ticket(overrides = {}) {
  return {
    id: 'tkt_1',
    code: 'DE-ABCD-1234',
    status: 'VALID',
    admits: true,
    admissionRefusal: null,
    holderRelationship: 'PURCHASED',
    isOnline: false,
    venue: { name: 'Balgandharva Rangmandir', city: 'Pune', region: 'MH', country: 'IN' },
    tier: { id: 'tt_1', name: 'General admission' },
    seat: null,
    pendingTransfer: null,
    event: {
      id: 'evt_1',
      slug: 'garba-night',
      title: 'Garba Night',
      startsAt: '2026-10-02T14:00:00.000Z',
      endsAt: '2026-10-02T19:00:00.000Z',
      timezone: 'Asia/Kolkata',
      status: 'ON_SALE',
      cancelledAt: null,
    },
    ...overrides,
  }
}

describe('eventIsOver', () => {
  it('is false while the event is still running', () => {
    // Started two hours ago, ends in two. Somebody arriving late still needs to
    // find this, so bucketing on `startsAt` would file it away mid-event.
    const running = ticket({
      event: {
        ...ticket().event,
        startsAt: '2026-10-01T10:00:00.000Z',
        endsAt: '2026-10-01T14:00:00.000Z',
      },
    })

    expect(eventIsOver(running, NOW)).toBe(false)
  })

  it('is true once it has ended', () => {
    const finished = ticket({
      event: {
        ...ticket().event,
        startsAt: '2026-09-30T10:00:00.000Z',
        endsAt: '2026-09-30T14:00:00.000Z',
      },
    })

    expect(eventIsOver(finished, NOW)).toBe(true)
  })

  it('does not call an unparseable date past', () => {
    // A missing or broken timestamp must not quietly file a live ticket under
    // "finished", which is the one direction of this mistake that loses
    // somebody their evening.
    expect(eventIsOver(ticket({ event: { ...ticket().event, endsAt: null } }), NOW)).toBe(false)
  })
})

describe('sectionFor', () => {
  it('puts a live bought ticket under coming up', () => {
    expect(sectionFor(ticket(), NOW)).toBe('upcoming')
  })

  it('puts a live given ticket under given, not coming up', () => {
    expect(sectionFor(ticket({ holderRelationship: 'RECEIVED' }), NOW)).toBe('given')
  })

  it('puts a handed-on ticket in its own section, not in the past', () => {
    // The event has not happened. What changed is who holds it, and telling
    // somebody the night is over because they gave their ticket away is a
    // different and worse statement.
    const handedOn = ticket({ status: 'TRANSFERRED', admits: false })

    expect(sectionFor(handedOn, NOW)).toBe('handedOn')
  })

  it('keeps a handed-on ticket out of the past even after the event', () => {
    const handedOn = ticket({
      status: 'TRANSFERRED',
      admits: false,
      event: {
        ...ticket().event,
        startsAt: '2026-09-01T10:00:00.000Z',
        endsAt: '2026-09-01T14:00:00.000Z',
      },
    })

    expect(sectionFor(handedOn, NOW)).toBe('handedOn')
  })

  it('trusts the server about whether a ticket admits anybody', () => {
    // `admits: false` with a status this module has never heard of. A browser
    // that recomputed admissibility from the status would call this upcoming
    // and put a dead ticket at the top of the page.
    const refused = ticket({ status: 'SOME_FUTURE_STATE', admits: false })

    expect(sectionFor(refused, NOW)).toBe('past')
  })

  it('files a used ticket under past even though its event has not happened', () => {
    expect(sectionFor(ticket({ status: 'CHECKED_IN', admits: false }), NOW)).toBe('past')
  })
})

describe('groupTickets', () => {
  it('drops the sections with nothing in them', () => {
    const groups = groupTickets([ticket()], NOW)

    expect(groups.map((group) => group.id)).toEqual(['upcoming'])
  })

  it('puts every ticket in exactly one section', () => {
    // The property the four-section layout lives or dies on. A transferred-in
    // ticket is both "coming up" and "given to you" by description, and if it
    // appeared under both the page would overstate what somebody holds.
    const rows = [
      ticket({ id: 'bought' }),
      ticket({ id: 'given', holderRelationship: 'RECEIVED' }),
      ticket({ id: 'gone', status: 'TRANSFERRED', admits: false }),
      ticket({ id: 'used', status: 'CHECKED_IN', admits: false }),
    ]

    const groups = groupTickets(rows, NOW)
    const placed = groups.flatMap((group) => group.tickets.map((row) => row.id))

    expect(placed).toHaveLength(rows.length)
    expect(new Set(placed).size).toBe(rows.length)
    expect(groups.map((group) => group.id)).toEqual(['upcoming', 'given', 'handedOn', 'past'])
  })

  it('separates a bought ticket from a given one', () => {
    const groups = groupTickets(
      [ticket({ id: 'bought' }), ticket({ id: 'given', holderRelationship: 'RECEIVED' })],
      NOW,
    )
    const byId = Object.fromEntries(groups.map((group) => [group.id, group]))

    expect(byId.upcoming.tickets.map((row) => row.id)).toEqual(['bought'])
    expect(byId.given.tickets.map((row) => row.id)).toEqual(['given'])
  })

  it('files a given ticket that is already used under past, not under given', () => {
    // "Given to you" is for tickets somebody can still use. A used one belongs
    // with the other used ones, whoever it came from.
    const groups = groupTickets(
      [ticket({ id: 'x', holderRelationship: 'RECEIVED', status: 'CHECKED_IN', admits: false })],
      NOW,
    )

    expect(groups.map((group) => group.id)).toEqual(['past'])
  })

  it('puts the soonest first under coming up and the latest first under past', () => {
    const soon = ticket({
      id: 'soon',
      event: {
        ...ticket().event,
        startsAt: '2026-10-02T10:00:00.000Z',
        endsAt: '2026-10-02T12:00:00.000Z',
      },
    })
    const later = ticket({
      id: 'later',
      event: {
        ...ticket().event,
        startsAt: '2026-11-02T10:00:00.000Z',
        endsAt: '2026-11-02T12:00:00.000Z',
      },
    })
    const old = ticket({
      id: 'old',
      admits: false,
      status: 'CHECKED_IN',
      event: {
        ...ticket().event,
        startsAt: '2026-08-02T10:00:00.000Z',
        endsAt: '2026-08-02T12:00:00.000Z',
      },
    })
    const recent = ticket({
      id: 'recent',
      admits: false,
      status: 'CHECKED_IN',
      event: {
        ...ticket().event,
        startsAt: '2026-09-25T10:00:00.000Z',
        endsAt: '2026-09-25T12:00:00.000Z',
      },
    })

    const groups = groupTickets([later, old, soon, recent], NOW)
    const byId = Object.fromEntries(groups.map((group) => [group.id, group]))

    expect(byId.upcoming.tickets.map((row) => row.id)).toEqual(['soon', 'later'])
    expect(byId.past.tickets.map((row) => row.id)).toEqual(['recent', 'old'])
  })

  it('does not mutate what it was handed', () => {
    const rows = [ticket({ id: 'b' }), ticket({ id: 'a' })]
    const before = rows.map((row) => row.id)

    groupTickets(rows, NOW)

    expect(rows.map((row) => row.id)).toEqual(before)
  })
})

describe('usableCount', () => {
  it('counts what admits across every section, not just the first', () => {
    // The figure a four-section layout makes easy to get wrong: a bought ticket
    // and a given one are in different sections and both get somebody in.
    const groups = groupTickets(
      [
        ticket({ id: 'bought' }),
        ticket({ id: 'given', holderRelationship: 'RECEIVED' }),
        ticket({ id: 'used', status: 'CHECKED_IN', admits: false }),
      ],
      NOW,
    )

    expect(groups.map((group) => group.id)).toEqual(['upcoming', 'given', 'past'])
    expect(usableCount(groups)).toBe(2)
  })

  it('counts nothing when nothing admits', () => {
    const groups = groupTickets([ticket({ status: 'REFUNDED', admits: false })], NOW)

    expect(usableCount(groups)).toBe(0)
  })
})

describe('REACHABLE_STATUSES', () => {
  it('names the six states the application can actually produce', () => {
    // Audited against every writer in apps/api/src, apps/worker/src and
    // packages/*. VOID, SUPERSEDED and CANCELLED have no writer at all: two are
    // declared as legal transition targets and never used, one is not even
    // that. A wallet label for any of them would describe a product that does
    // not exist.
    expect([...REACHABLE_STATUSES].sort()).toEqual([
      'CHECKED_IN',
      'REFUNDED',
      'REVOKED',
      'TRANSFERRED',
      'TRANSFER_PENDING',
      'VALID',
    ])
  })

  it('has words for exactly those six, and no others', () => {
    expect(Object.keys(TICKET_STATUS_WORDS).sort()).toEqual([...REACHABLE_STATUSES].sort())
  })

  it('excludes the three the database declares and nothing writes', () => {
    for (const unreachable of ['VOID', 'SUPERSEDED', 'CANCELLED']) {
      expect(REACHABLE_STATUSES, `${unreachable} is not reachable`).not.toContain(unreachable)
    }
  })
})

describe('whenText', () => {
  it('renders the time at the venue, not the reader', () => {
    // 14:00 UTC is 7:30 PM in Asia/Kolkata. A browser in New York rendering its
    // own local time would print 10:00 AM and send somebody to the wrong hour.
    const text = whenText(ticket())

    expect(text).toContain('7:30 PM')
    expect(text).toContain('Oct 2, 2026')
  })

  it('names a US zone by its letters, as the rest of the site does', () => {
    const text = whenText(
      ticket({
        event: {
          ...ticket().event,
          startsAt: '2026-10-17T23:30:00.000Z',
          timezone: 'America/New_York',
        },
      }),
    )

    expect(text).toBe('Sat, Oct 17, 2026, 7:30 PM EDT')
  })

  it('says nothing rather than something wrong for an unparseable date', () => {
    expect(whenText(ticket({ event: { ...ticket().event, startsAt: 'not a date' } }))).toBe('')
  })
})

describe('whereText', () => {
  it('names the venue and its city', () => {
    expect(whereText(ticket())).toBe('Balgandharva Rangmandir, Pune')
  })

  it('says Online for an online event, whatever venue is attached', () => {
    expect(whereText(ticket({ isOnline: true }))).toBe('Online')
  })

  it('says nothing when there is no venue', () => {
    expect(whereText(ticket({ venue: null }))).toBe('')
  })
})

describe('seatText', () => {
  it('says nothing for general admission', () => {
    expect(seatText(ticket())).toBe('')
  })

  it('reads as a steward would say it', () => {
    const reserved = ticket({
      seat: { section: 'Stalls', row: 'G', label: '12', accessible: false },
    })

    expect(seatText(reserved)).toBe('Stalls, row G, seat 12')
  })

  it('leaves the row out when a section has none', () => {
    const reserved = ticket({
      seat: { section: 'Standing', row: null, label: '12', accessible: false },
    })

    expect(seatText(reserved)).toBe('Standing, seat 12')
  })
})
