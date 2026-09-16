import { describe, expect, it } from 'vitest'

import { InventoryError } from './errors.js'
import {
  MAX_SEATS_PER_ORDER,
  SEAT_STATUS,
  SEAT_TRANSITIONS,
  canTransition,
  groupSeatMap,
  seatCounts,
  toPublicSeat,
  validateSeatSelection,
  withCompanions,
  wouldStrandCompanion,
} from './seating.js'

/**
 * A row of seats, with an accessible seat and its companion at one end.
 *
 * @param {number} [count] How many seats.
 * @returns {object[]} `Seat`-shaped rows.
 */
function makeRow(count = 6) {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index + 1}`,
    label: `A${index + 1}`,
    sectionId: 'stalls',
    rowId: 'rowA',
    sortOrder: index + 1,
    accessible: index === 0,
    companionOfSeatId: index === 1 ? 's1' : null,
    obstructedView: index === count - 1,
    restricted: false,
    restrictionNote: null,
    priceZoneId: 'zoneA',
  }))
}

/**
 * `EventSeat` rows for a set of seats.
 *
 * @param {object[]} seats The seats.
 * @param {Record<string, string>} [statuses] Seat id to status, defaulting to AVAILABLE.
 * @returns {object[]} `EventSeat`-shaped rows joined to their seat.
 */
function makeEventSeats(seats, statuses = {}) {
  return seats.map((seat) => ({
    id: `e-${seat.id}`,
    seatId: seat.id,
    status: statuses[seat.id] ?? SEAT_STATUS.AVAILABLE,
    holdId: statuses[seat.id] === SEAT_STATUS.HELD ? 'hold-1' : null,
    orderItemId: null,
    priceCentsOverride: null,
    ticketTypeId: 'tier-1',
    blockedReason: statuses[seat.id] === SEAT_STATUS.BLOCKED ? 'production hold' : null,
    seat,
  }))
}

describe('withCompanions', () => {
  const seats = makeRow()

  it('pulls in the companion when the accessible seat is chosen', () => {
    expect(withCompanions(['s1'], seats)).toEqual(['s1', 's2'])
  })

  it('pulls in the accessible seat when the companion is chosen', () => {
    // Both directions, because selling the companion alone strands the
    // accessible space just as surely as the other way round.
    expect(withCompanions(['s2'], seats)).toEqual(['s2', 's1'])
  })

  it('does not duplicate when both are chosen', () => {
    expect(withCompanions(['s1', 's2'], seats)).toEqual(['s1', 's2'])
  })

  it('leaves ordinary seats alone', () => {
    expect(withCompanions(['s3', 's4'], seats)).toEqual(['s3', 's4'])
  })

  it('keeps the order the buyer chose', () => {
    expect(withCompanions(['s4', 's3'], seats)).toEqual(['s4', 's3'])
  })

  it('terminates on a seat that names itself as its own companion', () => {
    // Nothing should create this, and a cycle in a recursive walk is a hang
    // rather than a wrong answer, which is worse.
    const broken = [{ id: 'x', companionOfSeatId: 'x' }]

    expect(withCompanions(['x'], broken)).toEqual(['x'])
  })

  it('terminates on a pair that name each other', () => {
    const cycle = [
      { id: 'a', companionOfSeatId: 'b' },
      { id: 'b', companionOfSeatId: 'a' },
    ]

    expect(withCompanions(['a'], cycle).sort()).toEqual(['a', 'b'])
  })

  it('handles a seat id that is not in the plan', () => {
    expect(withCompanions(['nope'], seats)).toEqual(['nope'])
  })
})

describe('validateSeatSelection', () => {
  const seats = makeRow()

  it('accepts an available seat', () => {
    const result = validateSeatSelection({
      seatIds: ['s3'],
      seats,
      eventSeats: makeEventSeats(seats),
    })

    expect(result).toEqual({ seatIds: ['s3'], eventSeatIds: ['e-s3'] })
  })

  it('returns the companion alongside the accessible seat', () => {
    const result = validateSeatSelection({
      seatIds: ['s1'],
      seats,
      eventSeats: makeEventSeats(seats),
    })

    expect(result.seatIds).toEqual(['s1', 's2'])
    expect(result.eventSeatIds).toEqual(['e-s1', 'e-s2'])
  })

  it.each([
    ['an empty selection', []],
    ['null', null],
    ['undefined', undefined],
    ['a non-array', 's1'],
  ])('refuses %s', (_label, seatIds) => {
    expect(() =>
      validateSeatSelection({ seatIds, seats, eventSeats: makeEventSeats(seats) }),
    ).toThrow(InventoryError)
  })

  it('refuses the same seat twice', () => {
    expect(() =>
      validateSeatSelection({ seatIds: ['s3', 's3'], seats, eventSeats: makeEventSeats(seats) }),
    ).toThrow(/chosen twice/)
  })

  it.each([
    ['held by somebody else', SEAT_STATUS.HELD],
    ['sold', SEAT_STATUS.SOLD],
    ['blocked by production', SEAT_STATUS.BLOCKED],
    ['killed', SEAT_STATUS.KILLED],
    ['given away', SEAT_STATUS.COMPLIMENTARY],
  ])('refuses a seat that is %s', (_label, status) => {
    const eventSeats = makeEventSeats(seats, { s3: status })

    expect(() => validateSeatSelection({ seatIds: ['s3'], seats, eventSeats })).toThrow(
      /no longer available/,
    )
  })

  it('says the same thing whatever the seat is unavailable for', () => {
    // "Held by another buyer" tells a buyer to keep refreshing; "blocked" tells
    // them about the production. Neither is their business, and the remedy is the
    // same.
    const messages = [SEAT_STATUS.HELD, SEAT_STATUS.BLOCKED, SEAT_STATUS.SOLD].map((status) => {
      try {
        validateSeatSelection({
          seatIds: ['s3'],
          seats,
          eventSeats: makeEventSeats(seats, { s3: status }),
        })
      } catch (error) {
        return error.message
      }

      return null
    })

    expect(new Set(messages).size).toBe(1)
  })

  it('names the seat, so a buyer knows which one to replace', () => {
    try {
      validateSeatSelection({
        seatIds: ['s3'],
        seats,
        eventSeats: makeEventSeats(seats, { s3: SEAT_STATUS.HELD }),
      })
    } catch (error) {
      expect(error.message).toContain('A3')
    }
  })

  it('refuses a seat that is not in the plan', () => {
    expect(() =>
      validateSeatSelection({ seatIds: ['nope'], seats, eventSeats: makeEventSeats(seats) }),
    ).toThrow(/not part of this seating plan/)
  })

  it('refuses a seat in the plan but not on sale at this session', () => {
    const eventSeats = makeEventSeats(seats).filter((eventSeat) => eventSeat.seatId !== 's4')

    expect(() => validateSeatSelection({ seatIds: ['s4'], seats, eventSeats })).toThrow(
      /not on sale for this session/,
    )
  })

  it('refuses more seats than the global ceiling', () => {
    // Skipping the first two so the accessible pair does not add a companion and
    // make the arithmetic about something else.
    const many = makeRow(MAX_SEATS_PER_ORDER + 3)
    const ids = many.slice(2).map((seat) => seat.id)

    expect(ids).toHaveLength(MAX_SEATS_PER_ORDER + 1)

    expect(() =>
      validateSeatSelection({ seatIds: ids, seats: many, eventSeats: makeEventSeats(many) }),
    ).toThrow(/at most/)
  })

  it("refuses more than the tier's own limit, when that is lower", () => {
    expect(() =>
      validateSeatSelection({
        seatIds: ['s3', 's4', 's5'],
        seats,
        eventSeats: makeEventSeats(seats),
        maxPerOrder: 2,
      }),
    ).toThrow(/at most 2/)
  })

  it('never lets a tier raise the ceiling', () => {
    // A misconfigured maxPerOrder must not become a way to reserve a section.
    const many = makeRow(30)
    const ids = many.slice(2, 2 + MAX_SEATS_PER_ORDER + 1).map((seat) => seat.id)

    expect(() =>
      validateSeatSelection({
        seatIds: ids,
        seats: many,
        eventSeats: makeEventSeats(many),
        maxPerOrder: 1000,
      }),
    ).toThrow(new RegExp(`at most ${MAX_SEATS_PER_ORDER}`))
  })

  it('counts companion seats against the limit, and says so', () => {
    const many = makeRow(12)
    // Two seats chosen, but one drags in its companion, making three.
    const result = validateSeatSelection({
      seatIds: ['s1', 's4'],
      seats: many,
      eventSeats: makeEventSeats(many),
      maxPerOrder: 3,
    })

    expect(result.seatIds).toHaveLength(3)

    try {
      validateSeatSelection({
        seatIds: ['s1', 's4'],
        seats: many,
        eventSeats: makeEventSeats(many),
        maxPerOrder: 2,
      })
    } catch (error) {
      expect(error.message).toContain('companion')
    }
  })

  it('refuses the whole selection when the companion is unavailable', () => {
    // Not a partial booking: taking the accessible seat without its companion is
    // the failure this rule exists to prevent.
    const eventSeats = makeEventSeats(seats, { s2: SEAT_STATUS.SOLD })

    expect(() => validateSeatSelection({ seatIds: ['s1'], seats, eventSeats })).toThrow(
      /no longer available/,
    )
  })
})

describe('wouldStrandCompanion', () => {
  const seats = makeRow()

  it('is true when the accessible seat goes and the companion stays', () => {
    expect(wouldStrandCompanion(['s1'], ['s2'], seats)).toBe(true)
  })

  it('is true when the companion goes and the accessible seat stays', () => {
    expect(wouldStrandCompanion(['s2'], ['s1'], seats)).toBe(true)
  })

  it('is false when both go', () => {
    expect(wouldStrandCompanion(['s1', 's2'], ['s3'], seats)).toBe(false)
  })

  it('is false for ordinary seats', () => {
    expect(wouldStrandCompanion(['s3'], ['s4'], seats)).toBe(false)
  })

  it('is false when nothing is kept', () => {
    expect(wouldStrandCompanion(['s1', 's2', 's3'], [], seats)).toBe(false)
  })
})

describe('toPublicSeat', () => {
  const seats = makeRow()
  const [accessible, companion, ordinary] = makeEventSeats(seats, { s3: SEAT_STATUS.HELD })

  it('tells a buyer whether a seat is available, and not why not', () => {
    const view = toPublicSeat(ordinary)

    expect(view.available).toBe(false)
    expect(view).not.toHaveProperty('status')
    expect(view).not.toHaveProperty('blockedReason')
    expect(view).not.toHaveProperty('holdId')
    expect(view).not.toHaveProperty('orderItemId')
  })

  it('tells an organiser the real status', () => {
    const view = toPublicSeat(ordinary, { organiser: true })

    expect(view.status).toBe(SEAT_STATUS.HELD)
  })

  it.each([
    ['blocked', SEAT_STATUS.BLOCKED],
    ['killed', SEAT_STATUS.KILLED],
    ['sold', SEAT_STATUS.SOLD],
  ])('never leaks who holds a %s seat', (_label, status) => {
    const [seat] = makeEventSeats(seats, { s1: status })
    const view = toPublicSeat(seat)

    expect(JSON.stringify(view)).not.toContain('hold-1')
    expect(view.available).toBe(false)
  })

  it('publishes the accessibility attributes to everybody', () => {
    // Somebody who needs an accessible seat has to be able to find one.
    expect(toPublicSeat(accessible).accessible).toBe(true)
    expect(toPublicSeat(companion).companionOfSeatId).toBe('s1')
  })

  it('publishes an obstructed view, because it changes what is being sold', () => {
    const [last] = makeEventSeats([seats.at(-1)])

    expect(toPublicSeat(last).obstructedView).toBe(true)
  })

  it('works on a row that is not joined to its seat', () => {
    const flat = { id: 'e1', seatId: 's1', status: SEAT_STATUS.AVAILABLE, ...seats[0] }

    expect(toPublicSeat(flat).label).toBe('A1')
  })
})

describe('seatCounts', () => {
  const seats = makeRow(6)

  it('counts each status into the right bucket', () => {
    const counts = seatCounts(
      makeEventSeats(seats, {
        s1: SEAT_STATUS.HELD,
        s2: SEAT_STATUS.SOLD,
        s3: SEAT_STATUS.COMPLIMENTARY,
        s4: SEAT_STATUS.BLOCKED,
        s5: SEAT_STATUS.KILLED,
      }),
    )

    expect(counts).toEqual({ total: 6, available: 1, held: 1, sold: 2, unavailable: 2 })
  })

  it('counts a complimentary seat as sold, because it is gone either way', () => {
    const counts = seatCounts(makeEventSeats(seats, { s1: SEAT_STATUS.COMPLIMENTARY }))

    expect(counts.sold).toBe(1)
    expect(counts.available).toBe(5)
  })

  it('handles an empty session', () => {
    expect(seatCounts([])).toEqual({ total: 0, available: 0, held: 0, sold: 0, unavailable: 0 })
  })
})

describe('SEAT_TRANSITIONS', () => {
  it('has no path from KILLED to anything', () => {
    // A seat that physically cannot be used does not become usable because a job
    // ran.
    expect(SEAT_TRANSITIONS.KILLED).toEqual([])
    for (const to of Object.keys(SEAT_TRANSITIONS)) {
      expect(canTransition('KILLED', to)).toBe(false)
    }
  })

  it('lets a hold end only as a sale or a release', () => {
    expect([...SEAT_TRANSITIONS.HELD].sort()).toEqual(['AVAILABLE', 'SOLD'])
  })

  it('does not let a seat go straight from available to sold', () => {
    // Every sale passes through a hold, which is what ties a sold seat to the
    // checkout that sold it.
    expect(canTransition('AVAILABLE', 'SOLD')).toBe(false)
  })

  it('lets a sold seat return only to available, which is the refund path', () => {
    expect([...SEAT_TRANSITIONS.SOLD]).toEqual(['AVAILABLE'])
  })

  it('names only statuses that exist', () => {
    const known = new Set(Object.values(SEAT_STATUS))

    for (const [from, tos] of Object.entries(SEAT_TRANSITIONS)) {
      expect(known.has(from)).toBe(true)
      for (const to of tos) expect(known.has(to)).toBe(true)
    }
  })

  it('covers every status', () => {
    expect(Object.keys(SEAT_TRANSITIONS).sort()).toEqual(Object.values(SEAT_STATUS).sort())
  })

  it('is false for a status it has never heard of', () => {
    expect(canTransition('NONSENSE', 'AVAILABLE')).toBe(false)
    expect(canTransition('AVAILABLE', 'NONSENSE')).toBe(false)
  })
})

describe('groupSeatMap', () => {
  const sections = [
    { id: 'balcony', name: 'Balcony', kind: 'SEATED', sortOrder: 2 },
    { id: 'stalls', name: 'Stalls', kind: 'SEATED', sortOrder: 1 },
    { id: 'standing', name: 'Standing', kind: 'STANDING', sortOrder: 3, standingCapacity: 400 },
  ]
  const rows = [
    { id: 'rowB', sectionId: 'stalls', label: 'B', sortOrder: 2 },
    { id: 'rowA', sectionId: 'stalls', label: 'A', sortOrder: 1 },
  ]
  const seats = [
    { id: 'e1', label: 'B1', sectionId: 'stalls', rowId: 'rowB', sortOrder: 1 },
    { id: 'e2', label: 'A2', sectionId: 'stalls', rowId: 'rowA', sortOrder: 2 },
    { id: 'e3', label: 'A1', sectionId: 'stalls', rowId: 'rowA', sortOrder: 1 },
    { id: 'e4', label: 'Box 1', sectionId: 'balcony', rowId: null, sortOrder: 1 },
  ]

  it('orders sections, rows and seats by their configured order', () => {
    const grouped = groupSeatMap({ sections, rows, seats })

    expect(grouped.map((section) => section.name)).toEqual(['Stalls', 'Balcony', 'Standing'])
    expect(grouped[0].rows.map((row) => row.label)).toEqual(['A', 'B'])
    expect(grouped[0].rows[0].seats.map((seat) => seat.label)).toEqual(['A1', 'A2'])
  })

  it('hangs seats with no row off their section', () => {
    const grouped = groupSeatMap({ sections, rows, seats })
    const balcony = grouped.find((section) => section.id === 'balcony')

    expect(balcony.rows).toEqual([])
    expect(balcony.seats.map((seat) => seat.label)).toEqual(['Box 1'])
  })

  it('carries a standing section with its capacity and no seats', () => {
    const grouped = groupSeatMap({ sections, rows, seats })
    const standing = grouped.find((section) => section.id === 'standing')

    expect(standing.standingCapacity).toBe(400)
    expect(standing.seats).toEqual([])
  })

  it('breaks a sortOrder tie by label, rather than by query order', () => {
    const tied = [
      { id: 'x', label: 'A2', sectionId: 'stalls', rowId: 'rowA', sortOrder: 1 },
      { id: 'y', label: 'A1', sectionId: 'stalls', rowId: 'rowA', sortOrder: 1 },
    ]
    const grouped = groupSeatMap({ sections, rows, seats: tied })

    expect(grouped[0].rows[0].seats.map((seat) => seat.label)).toEqual(['A1', 'A2'])
  })

  it('handles a map with no seats at all', () => {
    const grouped = groupSeatMap({ sections, rows, seats: [] })

    expect(grouped).toHaveLength(3)
    expect(grouped.every((section) => section.seats.length === 0)).toBe(true)
  })
})
