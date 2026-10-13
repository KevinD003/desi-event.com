/**
 * Where each ticket lands, and why.
 *
 * Each case below fails against a plausible wrong implementation: bucketing on
 * `startsAt` rather than `endsAt`, treating a handed-on ticket as past, reading
 * `admits` a second time in the browser, or rendering an event's time in the
 * reader's timezone rather than the venue's.
 */

import {
  GROUP_PASS_MAX_TICKETS as SCHEMA_GROUP_PASS_MAX_TICKETS,
  GROUP_PASS_MIN_TICKETS as SCHEMA_GROUP_PASS_MIN_TICKETS,
} from '@desi-event/schemas'
import { describe, expect, it } from 'vitest'

import {
  GROUP_PASS_MAX_TICKETS,
  GROUP_PASS_MIN_TICKETS,
  REACHABLE_STATUSES,
  groupPassSummaries,
  TICKET_STATUS_WORDS,
  eventIsOver,
  groupTickets,
  owesAtDoor,
  seatText,
  sectionFor,
  ticketChip,
  usableCount,
  venuePaymentChip,
  venuePaymentNotes,
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

  it('orders tickets of a run by the night each is for, not by the run’s first night', () => {
    // One event over three nights: every ticket shares the event's start, so
    // only the night tells them apart.
    const nightOf = (day) => ({
      id: `sn_${day}`,
      label: `Night ${day}`,
      startsAt: `2026-10-0${day + 1}T14:00:00.000Z`,
      endsAt: `2026-10-0${day + 1}T19:00:00.000Z`,
      doorsOpenAt: null,
      timezone: 'Asia/Kolkata',
    })
    const groups = groupTickets(
      [
        ticket({ id: 'third', session: nightOf(3) }),
        ticket({ id: 'every-night', session: null }),
        ticket({ id: 'second', session: nightOf(2) }),
      ],
      NOW,
    )

    expect(groups[0].tickets.map((row) => row.id)).toEqual(['every-night', 'second', 'third'])
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
  it('names the seven states the application can actually produce', () => {
    // Audited against every writer in apps/api/src, apps/worker/src and
    // packages/*. CANCELLED is written by withdrawTickets when a night is
    // cancelled or an event deleted (apps/api/src/lib/tickets.js). VOID and
    // SUPERSEDED have no writer at all: a wallet label for either would
    // describe a product that does not exist.
    expect([...REACHABLE_STATUSES].sort()).toEqual([
      'CANCELLED',
      'CHECKED_IN',
      'REFUNDED',
      'REVOKED',
      'TRANSFERRED',
      'TRANSFER_PENDING',
      'VALID',
    ])
  })

  it('has words for exactly those seven, and no others', () => {
    expect(Object.keys(TICKET_STATUS_WORDS).sort()).toEqual([...REACHABLE_STATUSES].sort())
  })

  it('excludes the two the database declares and nothing writes', () => {
    for (const unreachable of ['VOID', 'SUPERSEDED']) {
      expect(REACHABLE_STATUSES, `${unreachable} is not reachable`).not.toContain(unreachable)
    }
  })

  it('reads a withdrawn ticket in words, never as the raw CANCELLED', () => {
    expect(ticketChip(ticket({ status: 'CANCELLED', admits: false }))).toEqual({
      label: 'Withdrawn — this ticket no longer works at the door',
      tone: 'danger',
    })
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

describe('groupPassSummaries', () => {
  /**
   * A row on an order.
   *
   * @param {string} reference The order.
   * @param {object} [overrides] Fields to change.
   * @returns {object} The row.
   */
  function onOrder(reference, overrides = {}) {
    return ticket({ id: `${reference}-${Math.random()}`, orderReference: reference, ...overrides })
  }

  it('mirrors the bounds the server enforces', () => {
    expect(GROUP_PASS_MIN_TICKETS).toBe(SCHEMA_GROUP_PASS_MIN_TICKETS)
    expect(GROUP_PASS_MAX_TICKETS).toBe(SCHEMA_GROUP_PASS_MAX_TICKETS)
  })

  it('counts the tickets this account bought that still admit, per order', () => {
    const summaries = groupPassSummaries([
      onOrder('DE-AAAA'),
      onOrder('DE-AAAA'),
      onOrder('DE-AAAA', { admits: false, status: 'CHECKED_IN' }),
      onOrder('DE-AAAA', { holderRelationship: 'RECEIVED' }),
    ])

    expect(summaries).toEqual([expect.objectContaining({ orderReference: 'DE-AAAA', admits: 2 })])
  })

  it('leaves out an order with fewer than two, or more than fifty, such tickets', () => {
    const many = Array.from({ length: 51 }, () => onOrder('DE-MANY'))

    expect(groupPassSummaries([onOrder('DE-ONE')])).toEqual([])
    expect(groupPassSummaries(many)).toEqual([])
    expect(groupPassSummaries(many.slice(0, 50))).toEqual([
      expect.objectContaining({ orderReference: 'DE-MANY', admits: 50 }),
    ])
  })

  it('ignores a ticket somebody gave this account, and one with no order reference', () => {
    expect(
      groupPassSummaries([
        onOrder('DE-GIFT', { holderRelationship: 'RECEIVED' }),
        onOrder('DE-GIFT', { holderRelationship: 'RECEIVED' }),
        ticket({ orderReference: null }),
        ticket({ orderReference: null }),
      ]),
    ).toEqual([])
  })

  it('orders the passes by when their events start, soonest first', () => {
    const later = { ...ticket().event, id: 'evt_2', startsAt: '2026-11-01T14:00:00.000Z' }
    const summaries = groupPassSummaries([
      onOrder('DE-LATE', { event: later }),
      onOrder('DE-LATE', { event: later }),
      onOrder('DE-SOON'),
      onOrder('DE-SOON'),
    ])

    expect(summaries.map((entry) => entry.orderReference)).toEqual(['DE-SOON', 'DE-LATE'])
  })
})

describe('a ticket booked to pay at the venue (SPEC3 §12.7, SPEC3-XI §12.7)', () => {
  /**
   * A ticket that owes $40.00 at the door.
   *
   * @param {object} [venue] Fields of `venuePayment` to change.
   * @param {object} [overrides] Fields of the ticket to change.
   * @returns {object} The ticket.
   */
  function owing(venue = {}, overrides = {}) {
    return ticket({
      status: 'VALID',
      venuePayment: {
        dueCents: 4_000,
        paid: false,
        currency: 'USD',
        cancelled: null,
        paidAtDoorByYou: false,
        ...venue,
      },
      ...overrides,
    })
  }

  it('reads "Pay at the door" instead of "Ready to use" while it owes', () => {
    expect(owesAtDoor(owing())).toBe(true)
    expect(venuePaymentChip(owing())).toEqual({
      label: 'Pay at the door: $40.00',
      tone: 'pending',
    })
    expect(ticketChip(owing())).toEqual({ label: 'Pay at the door: $40.00', tone: 'pending' })
    expect(venuePaymentNotes(owing())).toEqual([
      'Pay this at the door. The steward records it before letting you in.',
    ])
  })

  it('still owes while an offer to pass it on is open', () => {
    expect(owesAtDoor(owing({}, { status: 'TRANSFER_PENDING' }))).toBe(true)
  })

  it('reads a paid one as paid at the door, with its usual status', () => {
    const paid = owing({ paid: true })

    expect(owesAtDoor(paid)).toBe(false)
    expect(ticketChip(paid)).toEqual(TICKET_STATUS_WORDS.VALID)
    expect(venuePaymentNotes(paid)).toEqual(['Paid at the door.'])
  })

  it('reads a cancelled one as not paid, saying who cancelled it, when and why', () => {
    const reason = 'Not paid for at the door by the end of the night.'
    const cancelled = owing(
      { cancelled: { at: '2026-10-08T15:00:00.000Z', by: 'ORGANISER', reason } },
      { status: 'REVOKED' },
    )

    expect(ticketChip(cancelled)).toEqual({ label: 'Cancelled — not paid', tone: 'neutral' })
    // Whoever holds it reads the reason here: somebody it was passed to has no
    // order page to read it on (SPEC3-XI XU10).
    expect(venuePaymentNotes(cancelled, 'UTC')).toEqual([
      'The organiser cancelled this ticket on Thu, Oct 8, 2026 because it had not been paid for. You no longer owe $40.00 for it.',
      `Reason given: “${reason}”`,
    ])
    expect(
      venuePaymentNotes(
        owing({ cancelled: { at: '2026-10-08T15:00:00.000Z', by: 'DESI_EVENT', reason } }),
        'UTC',
      )[0],
    ).toMatch(/^The Desi-Event team cancelled this ticket/u)
  })

  it('says money paid at the door by this holder is the organiser’s to return once the ticket ended', () => {
    expect(
      venuePaymentNotes(owing({ paid: true, paidAtDoorByYou: true }, { status: 'REFUNDED' })),
    ).toEqual([
      'The $40.00 you paid at the door for this ticket is with the organiser, not with Desi-Event. Ask the organiser to return it.',
    ])
    // Withdrawn by the organiser, and withdrawn because its night was
    // cancelled or its event deleted (the API writes CANCELLED there, and
    // keeps it while no refund settles it — a fee waived with a referral code
    // leaves nothing to refund online): the money is still the organiser's.
    for (const status of ['REVOKED', 'CANCELLED']) {
      expect(venuePaymentNotes(owing({ paid: true, paidAtDoorByYou: true }, { status }))).toEqual([
        'The $40.00 you paid at the door for this ticket is with the organiser, not with Desi-Event. Ask the organiser to return it.',
      ])
    }
    // Somebody else paid for it: this holder is not told to ask for it back.
    expect(
      venuePaymentNotes(owing({ paid: true, paidAtDoorByYou: false }, { status: 'REFUNDED' })),
    ).toEqual(['Paid at the door.'])
  })

  it('says nothing for a ticket that owes nothing', () => {
    const card = ticket({ venuePayment: null })

    expect(owesAtDoor(card)).toBe(false)
    expect(venuePaymentChip(card)).toBeNull()
    expect(venuePaymentNotes(card)).toEqual([])
  })

  it('adds up what the buyer’s own tickets on a group pass owe at the door', () => {
    const summaries = groupPassSummaries([
      owing({}, { id: 'a', orderReference: 'DE-VENUE' }),
      owing({ paid: true }, { id: 'b', orderReference: 'DE-VENUE' }),
      owing({}, { id: 'c', orderReference: 'DE-VENUE' }),
    ])

    expect(summaries).toEqual([
      expect.objectContaining({
        orderReference: 'DE-VENUE',
        admits: 3,
        unpaidCents: 8_000,
        currency: 'USD',
      }),
    ])
  })
})
