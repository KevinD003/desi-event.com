/**
 * Pricing a reserved-seat order, and refusing an incoherent one.
 *
 * @file lib/seated-checkout.test
 */

import { describe, expect, it } from 'vitest'

import { assertSeatsCoherent, lineKey, priceLines, seatUnitPrice } from './seated-checkout.js'

/** A tier priced at ₹10.00. */
const TIER = Object.freeze({ id: 'tier-stalls', name: 'Stalls', priceCents: 1000 })

/** A second tier, so a mixed order has something to be mixed with. */
const BALCONY = Object.freeze({ id: 'tier-balcony', name: 'Balcony', priceCents: 600 })

const TYPES = new Map([
  [TIER.id, TIER],
  [BALCONY.id, BALCONY],
])

/**
 * A hold item naming one seat.
 *
 * @param {object} options Options.
 * @param {string} options.id The `HoldItem.id`.
 * @param {string} options.holdId Which hold it belongs to.
 * @param {string} [options.ticketTypeId] The tier the hold recorded.
 * @param {string} [options.sessionId] The session the seat belongs to.
 * @param {number|null} [options.override] The seat's zone price, if any.
 * @param {string} [options.status] The seat's status.
 * @param {string} [options.seatTicketTypeId] The tier the *seat* says it is, to force a mismatch.
 * @returns {object} A `HoldItem` with `eventSeat` joined.
 */
function heldSeat({
  id,
  holdId,
  ticketTypeId = TIER.id,
  sessionId = 'session-1',
  override = null,
  status = 'HELD',
  seatTicketTypeId = ticketTypeId,
}) {
  return {
    id,
    holdId,
    ticketTypeId,
    eventSeatId: `seat-${id}`,
    eventSeat: {
      id: `seat-${id}`,
      eventSessionId: sessionId,
      ticketTypeId: seatTicketTypeId,
      status,
      holdId: status === 'HELD' ? holdId : null,
      priceCentsOverride: override,
    },
  }
}

/** One hold, on one session. */
const HOLDS = new Map([['hold-1', { id: 'hold-1', eventSessionId: 'session-1' }]])

describe('what one seat costs', () => {
  it('is the zone override when the seat has one', () => {
    expect(seatUnitPrice({ priceCentsOverride: 2500 }, TIER)).toBe(2500)
  })

  it('is the tier price when it does not', () => {
    expect(seatUnitPrice({ priceCentsOverride: null }, TIER)).toBe(1000)
  })

  it('honours a genuinely free seat rather than falling back to the tier', () => {
    // `?? tier.priceCents` would charge ₹10 for a seat the organiser marked
    // free, because zero is falsy. The check is on integer-ness, not truth.
    expect(seatUnitPrice({ priceCentsOverride: 0 }, TIER)).toBe(0)
  })
})

describe('pricing a selection', () => {
  it('prices a general-admission line at the tier price', () => {
    const { lines } = priceLines({
      items: [{ ticketTypeId: TIER.id, quantity: 3 }],
      ticketTypesById: TYPES,
      seatedItems: [],
    })

    expect(lines).toEqual([
      { ticketTypeId: TIER.id, quantity: 3, unitPriceCents: 1000, name: 'Stalls' },
    ])
  })

  it('prices seats at the tier price when no zone overrides them', () => {
    const { lines } = priceLines({
      items: [{ ticketTypeId: TIER.id, quantity: 2 }],
      ticketTypesById: TYPES,
      seatedItems: [
        heldSeat({ id: 'a', holdId: 'hold-1' }),
        heldSeat({ id: 'b', holdId: 'hold-1' }),
      ],
    })

    expect(lines).toEqual([
      { ticketTypeId: TIER.id, quantity: 2, unitPriceCents: 1000, name: 'Stalls' },
    ])
  })

  it('splits one tier into two lines when the seats sit in two zones', () => {
    // The case the old code could not express: an order line carries one unit
    // price, and these two seats did not cost the same.
    const { lines } = priceLines({
      items: [{ ticketTypeId: TIER.id, quantity: 2 }],
      ticketTypesById: TYPES,
      seatedItems: [
        heldSeat({ id: 'a', holdId: 'hold-1', override: 2500 }),
        heldSeat({ id: 'b', holdId: 'hold-1', override: 1500 }),
      ],
    })

    expect(lines).toEqual([
      { ticketTypeId: TIER.id, quantity: 1, unitPriceCents: 1500, name: 'Stalls' },
      { ticketTypeId: TIER.id, quantity: 1, unitPriceCents: 2500, name: 'Stalls' },
    ])
  })

  it('groups seats that share a price into one line', () => {
    const { lines } = priceLines({
      items: [{ ticketTypeId: TIER.id, quantity: 3 }],
      ticketTypesById: TYPES,
      seatedItems: [
        heldSeat({ id: 'a', holdId: 'hold-1', override: 2500 }),
        heldSeat({ id: 'b', holdId: 'hold-1', override: 1500 }),
        heldSeat({ id: 'c', holdId: 'hold-1', override: 2500 }),
      ],
    })

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ quantity: 1, unitPriceCents: 1500 })
    expect(lines[1]).toMatchObject({ quantity: 2, unitPriceCents: 2500 })
  })

  it('orders the lines the same way every time', () => {
    const selection = [
      heldSeat({ id: 'a', holdId: 'hold-1', override: 2500 }),
      heldSeat({ id: 'b', holdId: 'hold-1', override: 900 }),
      heldSeat({ id: 'c', holdId: 'hold-1', override: 1500 }),
    ]

    const forwards = priceLines({
      items: [{ ticketTypeId: TIER.id, quantity: 3 }],
      ticketTypesById: TYPES,
      seatedItems: selection,
    })
    const backwards = priceLines({
      items: [{ ticketTypeId: TIER.id, quantity: 3 }],
      ticketTypesById: TYPES,
      seatedItems: [...selection].reverse(),
    })

    expect(backwards.lines).toEqual(forwards.lines)
    expect(forwards.lines.map((line) => line.unitPriceCents)).toEqual([900, 1500, 2500])
  })

  it('keeps a seated tier and a general-admission tier apart in one order', () => {
    const { lines } = priceLines({
      items: [
        { ticketTypeId: TIER.id, quantity: 1 },
        { ticketTypeId: BALCONY.id, quantity: 4 },
      ],
      ticketTypesById: TYPES,
      seatedItems: [heldSeat({ id: 'a', holdId: 'hold-1', override: 2500 })],
    })

    expect(lines).toEqual([
      { ticketTypeId: TIER.id, quantity: 1, unitPriceCents: 2500, name: 'Stalls' },
      { ticketTypeId: BALCONY.id, quantity: 4, unitPriceCents: 600, name: 'Balcony' },
    ])
  })

  it('refuses a seated line that asks for more than it holds', () => {
    expect(() =>
      priceLines({
        items: [{ ticketTypeId: TIER.id, quantity: 3 }],
        ticketTypesById: TYPES,
        seatedItems: [heldSeat({ id: 'a', holdId: 'hold-1' })],
      }),
    ).toThrow(/you hold 1 seat\(s\)/)
  })

  it('refuses a seated line that asks for fewer than it holds', () => {
    // Buying fewer would leave a seat reserved against a paid order and nobody
    // paying for it — and the expiry sweep would eventually release it.
    expect(() =>
      priceLines({
        items: [{ ticketTypeId: TIER.id, quantity: 1 }],
        ticketTypesById: TYPES,
        seatedItems: [
          heldSeat({ id: 'a', holdId: 'hold-1' }),
          heldSeat({ id: 'b', holdId: 'hold-1' }),
        ],
      }),
    ).toThrow(/must be for 2/)
  })

  it('hands back the seats behind each line, keyed so they can be stamped', () => {
    const { seatsByLineKey } = priceLines({
      items: [{ ticketTypeId: TIER.id, quantity: 2 }],
      ticketTypesById: TYPES,
      seatedItems: [
        heldSeat({ id: 'a', holdId: 'hold-1', override: 2500 }),
        heldSeat({ id: 'b', holdId: 'hold-1', override: 1500 }),
      ],
    })

    expect([...seatsByLineKey.keys()].sort()).toEqual([
      lineKey(TIER.id, 1500),
      lineKey(TIER.id, 2500),
    ])
    expect(seatsByLineKey.get(lineKey(TIER.id, 2500))).toHaveLength(1)
  })
})

describe('refusing an incoherent selection', () => {
  it('accepts a selection whose seats are all held by their own holds', () => {
    expect(() =>
      assertSeatsCoherent(
        [heldSeat({ id: 'a', holdId: 'hold-1' }), heldSeat({ id: 'b', holdId: 'hold-1' })],
        HOLDS,
      ),
    ).not.toThrow()
  })

  it('refuses a seat whose row has gone', () => {
    const orphan = heldSeat({ id: 'a', holdId: 'hold-1' })
    orphan.eventSeat = null

    expect(() => assertSeatsCoherent([orphan], HOLDS)).toThrow(/no longer available/)
  })

  it('refuses a seat the hold no longer holds', () => {
    expect(() =>
      assertSeatsCoherent([heldSeat({ id: 'a', holdId: 'hold-1', status: 'AVAILABLE' })], HOLDS),
    ).toThrow(/reservation has lapsed/)
  })

  it('refuses a seat another hold took', () => {
    const stolen = heldSeat({ id: 'a', holdId: 'hold-1' })
    stolen.eventSeat.holdId = 'hold-2'

    expect(() => assertSeatsCoherent([stolen], HOLDS)).toThrow(/reservation has lapsed/)
  })

  it('refuses a seat from another session', () => {
    expect(() =>
      assertSeatsCoherent([heldSeat({ id: 'a', holdId: 'hold-1', sessionId: 'session-9' })], HOLDS),
    ).toThrow(/not on sale at this session/)
  })

  it('refuses a seat from another session even when the order names none', () => {
    const wandering = heldSeat({ id: 'a', holdId: 'hold-1', sessionId: 'session-9' })

    expect(() => assertSeatsCoherent([wandering], HOLDS, null)).toThrow(
      /not on sale at this session/,
    )
  })

  it('refuses a seat whose ticket type moved after the hold was taken', () => {
    expect(() =>
      assertSeatsCoherent(
        [heldSeat({ id: 'a', holdId: 'hold-1', seatTicketTypeId: 'tier-balcony' })],
        HOLDS,
      ),
    ).toThrow(/no longer sold at that ticket type/)
  })

  it('checks every seat, not just the first', () => {
    expect(() =>
      assertSeatsCoherent(
        [
          heldSeat({ id: 'a', holdId: 'hold-1' }),
          heldSeat({ id: 'b', holdId: 'hold-1', status: 'SOLD' }),
        ],
        HOLDS,
      ),
    ).toThrow(/reservation has lapsed/)
  })
})
