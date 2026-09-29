import { describe, expect, it } from 'vitest'

import {
  MAX_SEATS_PER_ORDER,
  NOT_TO_SCALE,
  companionGroup,
  effectiveSeatPrice,
  expandCompanions,
  flattenSeats,
  groupSelectionIntoItems,
  limitingTier,
  nextCell,
  seatAccessibleName,
  sectionRows,
  selectionAnnouncement,
  selectionLimit,
  selectionLines,
  selectionShortfalls,
  toggleSeat,
} from './seat-map.js'

/**
 * A public seat.
 *
 * @param {string} label The seat's label; its ids derive from it.
 * @param {object} [overrides] Fields to change.
 * @returns {object} The seat.
 */
function seat(label, overrides = {}) {
  return {
    id: `es${label.toLowerCase()}xxxxxx`,
    seatId: `st${label.toLowerCase()}xxxxxx`,
    label,
    available: true,
    accessible: false,
    obstructedView: false,
    restricted: false,
    companionOfSeatId: null,
    ticketTypeId: 'ttfrontxxxxxx',
    priceCents: null,
    ...overrides,
  }
}

const A1 = seat('A1', { accessible: true })
const A2 = seat('A2', { companionOfSeatId: A1.seatId })
const A3 = seat('A3')
const B1 = seat('B1', { ticketTypeId: 'ttbackxxxxxxx' })
const B2 = seat('B2', { ticketTypeId: 'ttbackxxxxxxx', available: false })
const T1 = seat('T1', { priceCents: 9_900 })
const SEATS = [A1, A2, A3, B1, B2, T1]

const TIERS = new Map([
  ['ttfrontxxxxxx', { id: 'ttfrontxxxxxx', name: 'Front stalls', priceCents: 4_500 }],
  ['ttbackxxxxxxx', { id: 'ttbackxxxxxxx', name: 'Back stalls', priceCents: 2_500 }],
])

const SECTION = {
  id: 'scstallsxxxxx',
  name: 'Stalls',
  rows: [
    { id: 'rwaxxxxxxxxxx', label: 'A', seats: [A1, A2, A3] },
    { id: 'rwbxxxxxxxxxx', label: 'B', seats: [B1, B2] },
    { id: 'rwcxxxxxxxxxx', label: 'C', seats: [] },
  ],
  seats: [T1],
}

describe('the grid of a section', () => {
  it('keeps rows in order, drops empty ones and puts loose seats last as their own row', () => {
    const rows = sectionRows(SECTION)

    expect(rows.map((row) => row.label)).toEqual(['A', 'B', null])
    expect(rows.at(-1)).toMatchObject({ key: 'scstallsxxxxx-loose', seats: [T1] })
  })

  it('names each seat’s section and row when flattened', () => {
    const flat = flattenSeats({ sections: [SECTION] })

    expect(flat).toHaveLength(6)
    expect(flat[0]).toMatchObject({ label: 'A1', sectionName: 'Stalls', rowLabel: 'A' })
    expect(flat.at(-1)).toMatchObject({ label: 'T1', sectionName: 'Stalls', rowLabel: null })
    expect(flattenSeats(null)).toEqual([])
  })

  it('says it is not drawn to scale', () => {
    expect(NOT_TO_SCALE).toMatch(/not to scale/u)
  })
})

describe('what a seat costs', () => {
  it('is its own price when it has one, else its tier’s, else nothing', () => {
    expect(effectiveSeatPrice(T1, TIERS)).toBe(9_900)
    expect(effectiveSeatPrice(A3, TIERS)).toBe(4_500)
    expect(effectiveSeatPrice(seat('Z9', { ticketTypeId: null }), TIERS)).toBeNull()
  })
})

describe('the companion rule, as the server applies it', () => {
  it('takes the companion with the wheelchair space, and the space with the companion', () => {
    expect(expandCompanions([A1.seatId], SEATS)).toEqual([A1.seatId, A2.seatId])
    expect(expandCompanions([A2.seatId], SEATS)).toEqual([A2.seatId, A1.seatId])
    expect(companionGroup(A3.seatId, SEATS)).toEqual([A3.seatId])
  })

  it('adds and removes a pair together', () => {
    const added = toggleSeat([], A1.seatId, SEATS)

    expect(added).toEqual({ selected: [A1.seatId, A2.seatId], refused: null })
    expect(toggleSeat(added.selected, A2.seatId, SEATS)).toEqual({ selected: [], refused: null })
  })

  it('refuses a seat that cannot be had, or a pair whose other half cannot', () => {
    expect(toggleSeat([], B2.seatId, SEATS)).toEqual({ selected: [], refused: 'unavailable' })

    const taken = SEATS.map((entry) => (entry === A2 ? { ...A2, available: false } : entry))

    expect(toggleSeat([], A1.seatId, taken)).toEqual({ selected: [], refused: 'unavailable' })
  })

  it('refuses past the per-order ceiling rather than trimming the selection', () => {
    expect(MAX_SEATS_PER_ORDER).toBe(10)
    expect(toggleSeat([A3.seatId], A1.seatId, SEATS, 2)).toEqual({
      selected: [A3.seatId],
      refused: 'limit',
    })
    expect(toggleSeat([], A3.seatId, SEATS, 1)).toEqual({ selected: [A3.seatId], refused: null })
  })
})

describe('each tier’s own limits, as the server applies them', () => {
  const byId = new Map(SEATS.map((entry) => [entry.seatId, entry]))
  const limited = new Map([
    [
      'ttfrontxxxxxx',
      { id: 'ttfrontxxxxxx', name: 'Front stalls', minPerOrder: 1, maxPerOrder: 2 },
    ],
    ['ttbackxxxxxxx', { id: 'ttbackxxxxxxx', name: 'Back stalls', minPerOrder: 2, maxPerOrder: 6 }],
  ])

  it('caps a selection at the smallest limit among the tiers it includes', () => {
    expect(selectionLimit([B1.seatId], byId, limited, 10)).toBe(6)
    expect(selectionLimit([B1.seatId, A3.seatId], byId, limited, 10)).toBe(2)
    expect(selectionLimit([], byId, limited, 4)).toBe(4)
    expect(limitingTier([B1.seatId, A3.seatId], byId, limited)).toMatchObject({
      name: 'Front stalls',
    })
    expect(limitingTier([], byId, limited)).toBeNull()
  })

  it('refuses the seat that would pass the limit of the selection it would make', () => {
    const limitOf = (next) => selectionLimit(next, byId, limited, 10)

    // Two Front seats is Front's limit; a Back seat on top is one too many.
    expect(toggleSeat([A3.seatId, T1.seatId], B1.seatId, SEATS, limitOf)).toEqual({
      selected: [A3.seatId, T1.seatId],
      refused: 'limit',
      limit: 2,
    })
    expect(toggleSeat([B1.seatId], A3.seatId, SEATS, limitOf)).toEqual({
      selected: [B1.seatId, A3.seatId],
      refused: null,
    })
  })

  it('names each tier the selection has fewer seats of than it sells at a time', () => {
    expect(selectionShortfalls([B1.seatId, A3.seatId], byId, limited)).toEqual([
      { tier: limited.get('ttbackxxxxxxx'), count: 1, minimum: 2 },
    ])
    expect(selectionShortfalls([A3.seatId], byId, limited)).toEqual([])
  })
})

describe('a seat’s accessible name', () => {
  it('reads everything the grid shows, with the state last', () => {
    expect(
      seatAccessibleName(A1, {
        section: 'Stalls',
        row: 'A',
        zone: 'Front',
        price: 4_500,
        currency: 'USD',
      }),
    ).toBe('Seat A1, row A, Stalls, Front zone, $45.00, wheelchair space, available')
  })

  it('names a companion seat, an obstructed view and a restriction', () => {
    const name = seatAccessibleName(
      { ...A2, obstructedView: true, restricted: true, available: false },
      { row: 'A' },
    )

    expect(name).toBe('Seat A2, row A, companion seat, obstructed view, restricted, unavailable')
  })

  it('says selected when it is', () => {
    expect(seatAccessibleName(A3, { selected: true })).toBe('Seat A3, selected')
  })
})

describe('the grid’s keyboard', () => {
  const grid = sectionRows(SECTION)

  it('moves along a row and stops at its ends', () => {
    expect(nextCell(grid, { row: 0, column: 0 }, 'ArrowRight')).toEqual({ row: 0, column: 1 })
    expect(nextCell(grid, { row: 0, column: 2 }, 'ArrowRight')).toEqual({ row: 0, column: 2 })
    expect(nextCell(grid, { row: 0, column: 0 }, 'ArrowLeft')).toEqual({ row: 0, column: 0 })
    expect(nextCell(grid, { row: 0, column: 1 }, 'Home')).toEqual({ row: 0, column: 0 })
    expect(nextCell(grid, { row: 0, column: 0 }, 'End')).toEqual({ row: 0, column: 2 })
  })

  it('moves between rows, to the same place or the end of a shorter row', () => {
    expect(nextCell(grid, { row: 0, column: 2 }, 'ArrowDown')).toEqual({ row: 1, column: 1 })
    expect(nextCell(grid, { row: 1, column: 1 }, 'ArrowUp')).toEqual({ row: 0, column: 1 })
    expect(nextCell(grid, { row: 0, column: 0 }, 'ArrowUp')).toEqual({ row: 0, column: 0 })
    expect(nextCell(grid, { row: 2, column: 0 }, 'ArrowDown')).toEqual({ row: 2, column: 0 })
  })

  it('jumps to the first and last rows with PageUp and PageDown', () => {
    expect(nextCell(grid, { row: 1, column: 1 }, 'PageUp')).toEqual({ row: 0, column: 1 })
    expect(nextCell(grid, { row: 0, column: 2 }, 'PageDown')).toEqual({ row: 2, column: 0 })
  })

  it('leaves every other key alone', () => {
    expect(nextCell(grid, { row: 0, column: 0 }, 'Enter')).toBeNull()
    expect(nextCell([], { row: 0, column: 0 }, 'ArrowRight')).toBeNull()
  })
})

describe('what a hold becomes', () => {
  it('is one order line per tier, counting its seats, companions included', () => {
    expect(
      groupSelectionIntoItems([
        { ticketTypeId: 'ttfrontxxxxxx' },
        { ticketTypeId: 'ttbackxxxxxxx' },
        { ticketTypeId: 'ttfrontxxxxxx' },
        { ticketTypeId: null },
      ]),
    ).toEqual([
      { ticketTypeId: 'ttfrontxxxxxx', quantity: 2 },
      { ticketTypeId: 'ttbackxxxxxxx', quantity: 1 },
    ])
    expect(groupSelectionIntoItems()).toEqual([])
  })

  it('prices a selection per tier and per seat price, as the server will', () => {
    const bySeat = new Map(SEATS.map((entry) => [entry.seatId, entry]))
    const tiers = new Map([...TIERS])
    // T1 is sold under the front tier at its own price.
    const lines = selectionLines([A1.seatId, A3.seatId, B1.seatId, T1.seatId], bySeat, tiers)

    expect(lines).toEqual([
      {
        ticketTypeId: 'ttfrontxxxxxx:4500',
        name: 'Front stalls',
        quantity: 2,
        unitPriceCents: 4_500,
      },
      {
        ticketTypeId: 'ttbackxxxxxxx:2500',
        name: 'Back stalls',
        quantity: 1,
        unitPriceCents: 2_500,
      },
      {
        ticketTypeId: 'ttfrontxxxxxx:9900',
        name: 'Front stalls',
        quantity: 1,
        unitPriceCents: 9_900,
      },
    ])
  })
})

describe('what the status says about a change', () => {
  const bySeat = new Map(SEATS.map((entry) => [entry.seatId, entry]))

  it('names a seat added alone, and one added with its companion', () => {
    expect(selectionAnnouncement([], [A3.seatId], bySeat)).toBe('Seat A3 added. 1 seat selected.')
    expect(selectionAnnouncement([], [A1.seatId, A2.seatId], bySeat)).toBe(
      'Seat A1 added, with companion seat A2. 2 seats selected.',
    )
  })

  it('names seats removed, together when they went together', () => {
    expect(selectionAnnouncement([A3.seatId], [], bySeat)).toBe(
      'Seat A3 removed. 0 seats selected.',
    )
    expect(selectionAnnouncement([A1.seatId, A2.seatId], [], bySeat)).toBe(
      'Seats A1 and A2 removed together. 0 seats selected.',
    )
  })

  it('says nothing when nothing changed', () => {
    expect(selectionAnnouncement([A3.seatId], [A3.seatId], bySeat)).toBe('')
  })
})
