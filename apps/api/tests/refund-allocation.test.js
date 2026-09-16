/**
 * The refund arithmetic, tested without a database.
 *
 * Six pure functions decide how much a refund is worth, which lines give it
 * back, and how many tickets that revokes. They are reached through routes in
 * `refunds.test.js` and raced against real PostgreSQL in
 * `refund-concurrency.test.js`; neither asks them the awkward arithmetic
 * questions directly, because both are busy asking about transactions.
 *
 * The awkward questions are where the money goes wrong: a rounding remainder
 * that vanishes, a proportional split whose parts do not sum to the whole, a
 * line of free tickets, a quantity floor that revokes a ticket somebody still
 * paid for.
 *
 * @module @desi-event/api/tests/refund-allocation
 */

import { describe, expect, it } from 'vitest'

import {
  REFUND_STATES,
  SEAT_POLICIES,
  allocateAcrossLines,
  allocateNamedLines,
  canTransition,
  refundableCents,
  seatPolicyFor,
  splitRefund,
} from '../src/lib/refunds.js'

/**
 * An order line.
 *
 * @param {object} overrides What this line is.
 * @returns {object} An `OrderItem`-shaped row.
 */
const line = (overrides) => ({
  id: 'line-1',
  quantity: 2,
  refundedQuantity: 0,
  unitPriceCents: 50_000,
  subtotalCents: 100_000,
  refundedCents: 0,
  ...overrides,
})

describe('refundableCents', () => {
  it('subtracts what has settled and what is promised', () => {
    expect(
      refundableCents({ totalCents: 100_000, refundedCents: 30_000, refundPendingCents: 20_000 }),
    ).toBe(50_000)
  })

  it('never goes negative, whatever the counters say', () => {
    // A negative refundable balance read as a number would let arithmetic
    // elsewhere add it to something and increase it.
    expect(
      refundableCents({ totalCents: 100_000, refundedCents: 90_000, refundPendingCents: 30_000 }),
    ).toBe(0)
  })
})

describe('seatPolicyFor', () => {
  const now = new Date('2026-09-10T12:00:00Z')

  it('resells a seat when the event is more than the cutoff away', () => {
    expect(seatPolicyFor({ eventStartsAt: new Date('2026-09-20T12:00:00Z'), now })).toBe(
      SEAT_POLICIES.RESELL,
    )
  })

  it('withholds inside the cutoff, because two people would arrive at one seat', () => {
    expect(seatPolicyFor({ eventStartsAt: new Date('2026-09-10T20:00:00Z'), now })).toBe(
      SEAT_POLICIES.WITHHOLD,
    )
  })

  it('withholds when nobody knows when the event is', () => {
    expect(seatPolicyFor({ eventStartsAt: null, now })).toBe(SEAT_POLICIES.WITHHOLD)
  })

  it('lets an organiser override either way', () => {
    const soon = new Date('2026-09-10T20:00:00Z')

    expect(seatPolicyFor({ eventStartsAt: soon, now, override: SEAT_POLICIES.RESELL })).toBe(
      SEAT_POLICIES.RESELL,
    )
    expect(
      seatPolicyFor({
        eventStartsAt: new Date('2026-12-01T12:00:00Z'),
        now,
        override: SEAT_POLICIES.WITHHOLD,
      }),
    ).toBe(SEAT_POLICIES.WITHHOLD)
  })

  it('ignores an override that is not a policy, rather than trusting it', () => {
    // The override reaches this from a request. A value the function does not
    // recognise must fall back to the rule, not become one.
    expect(
      seatPolicyFor({
        eventStartsAt: new Date('2026-12-01T12:00:00Z'),
        now,
        override: 'GIVE_IT_TO_MY_FRIEND',
      }),
    ).toBe(SEAT_POLICIES.RESELL)
  })
})

describe('allocateAcrossLines', () => {
  it('splits proportionally to what each line still has', () => {
    const allocation = allocateAcrossLines({
      items: [
        line({ id: 'a', subtotalCents: 75_000, unitPriceCents: 25_000, quantity: 3 }),
        line({ id: 'b', subtotalCents: 25_000, unitPriceCents: 25_000, quantity: 1 }),
      ],
      amountCents: 40_000,
    })

    expect(allocation).toEqual([
      { orderItemId: 'a', amountCents: 30_000, quantity: 1 },
      { orderItemId: 'b', amountCents: 10_000, quantity: 0 },
    ])
  })

  it('puts the rounding remainder on the biggest line, so the parts sum to the whole', () => {
    // Three lines and an amount that does not divide: the failure this catches
    // is an allocation one cent short, which the ledger would refuse later and
    // much less legibly.
    const allocation = allocateAcrossLines({
      items: [
        line({ id: 'a', subtotalCents: 3_333, unitPriceCents: 3_333, quantity: 1 }),
        line({ id: 'b', subtotalCents: 3_333, unitPriceCents: 3_333, quantity: 1 }),
        line({ id: 'c', subtotalCents: 3_334, unitPriceCents: 3_334, quantity: 1 }),
      ],
      amountCents: 5_000,
    })

    expect(allocation.reduce((sum, item) => sum + item.amountCents, 0)).toBe(5_000)
  })

  it('ignores a line with nothing left', () => {
    const allocation = allocateAcrossLines({
      items: [
        line({ id: 'a', subtotalCents: 50_000, refundedCents: 50_000 }),
        line({ id: 'b', subtotalCents: 50_000, unitPriceCents: 50_000, quantity: 1 }),
      ],
      amountCents: 50_000,
    })

    expect(allocation).toEqual([{ orderItemId: 'b', amountCents: 50_000, quantity: 1 }])
  })

  it('revokes whole tickets only, never a fraction rounded up', () => {
    // Half a ticket's value back does not revoke a ticket the buyer still owns.
    const allocation = allocateAcrossLines({
      items: [line({ id: 'a', subtotalCents: 100_000, unitPriceCents: 50_000, quantity: 2 })],
      amountCents: 75_000,
    })

    expect(allocation).toEqual([{ orderItemId: 'a', amountCents: 75_000, quantity: 1 }])
  })

  it('revokes nothing on a free line rather than dividing by zero', () => {
    const allocation = allocateAcrossLines({
      items: [
        line({ id: 'free', subtotalCents: 1, unitPriceCents: 0, quantity: 4 }),
        line({ id: 'paid', subtotalCents: 99_999, unitPriceCents: 99_999, quantity: 1 }),
      ],
      amountCents: 50_000,
    })

    const free = allocation.find((item) => item.orderItemId === 'free')

    expect(free === undefined || free.quantity === 0).toBe(true)
  })

  it.each([
    ['there is nothing left on any line', [line({ refundedCents: 100_000 })], 50_000],
    ['the amount is zero', [line({})], 0],
  ])('allocates nothing when %s', (_name, items, amountCents) => {
    expect(allocateAcrossLines({ items, amountCents })).toEqual([])
  })
})

describe('allocateNamedLines', () => {
  const items = [
    line({ id: 'a', quantity: 3, unitPriceCents: 20_000, subtotalCents: 60_000 }),
    line({ id: 'b', quantity: 1, unitPriceCents: 45_000, subtotalCents: 45_000 }),
  ]

  it('prices named lines from the order, never from the request', () => {
    const { allocation, amountCents } = allocateNamedLines({
      items,
      lines: [{ orderItemId: 'a', quantity: 2 }],
    })

    expect(amountCents).toBe(40_000)
    expect(allocation).toEqual([{ orderItemId: 'a', amountCents: 40_000, quantity: 2 }])
  })

  it('adds up two mentions of the same line before checking what it can cover', () => {
    // Otherwise the same line named twice passes two separate checks and
    // together exceeds what it has.
    expect(() =>
      allocateNamedLines({
        items,
        lines: [
          { orderItemId: 'a', quantity: 2 },
          { orderItemId: 'a', quantity: 2 },
        ],
      }),
    ).toThrowError(/3 ticket\(s\) left/u)
  })

  it('counts what unresolved refunds have already spoken for', () => {
    expect(() =>
      allocateNamedLines({
        items,
        lines: [{ orderItemId: 'a', quantity: 2 }],
        pendingByLine: new Map([['a', 2]]),
      }),
    ).toThrowError(/1 ticket\(s\) left/u)
  })

  it('says so plainly when a line is entirely spoken for', () => {
    expect(() =>
      allocateNamedLines({
        items,
        lines: [{ orderItemId: 'b', quantity: 1 }],
        pendingByLine: new Map([['b', 1]]),
      }),
    ).toThrowError(/already been refunded or is being refunded/u)
  })

  it('refuses a line that is not on this order', () => {
    expect(() =>
      allocateNamedLines({ items, lines: [{ orderItemId: 'somebody-else', quantity: 1 }] }),
    ).toThrowError(/not on this order/u)
  })

  it('refuses a refund worth nothing, rather than asking a processor for zero', () => {
    expect(() =>
      allocateNamedLines({
        items: [line({ id: 'free', quantity: 2, unitPriceCents: 0, subtotalCents: 0 })],
        lines: [{ orderItemId: 'free', quantity: 2 }],
      }),
    ).toThrowError(/worth nothing/u)
  })
})

describe('splitRefund', () => {
  const order = {
    totalCents: 120_000,
    subtotalCents: 100_000,
    discountCents: 10_000,
    feesCents: 12_000,
    taxCents: 18_000,
  }

  it('gives back every part on a full refund', () => {
    expect(splitRefund(order, 120_000)).toEqual({
      faceValueCents: 90_000,
      feeCents: 12_000,
      taxCents: 18_000,
    })
  })

  it('treats an amount above the total as a full refund', () => {
    expect(splitRefund(order, 200_000)).toEqual(splitRefund(order, 120_000))
  })

  it('returns a proportional share of the fee and the tax on a partial', () => {
    const half = splitRefund(order, 60_000)

    expect(half.feeCents).toBe(6_000)
    expect(half.taxCents).toBe(9_000)
    // The parts sum to what is being refunded, which is what the ledger batch
    // is built from.
    expect(half.faceValueCents + half.feeCents + half.taxCents).toBe(60_000)
  })

  it('still sums to the amount when the share rounds', () => {
    const odd = splitRefund(order, 33_333)

    expect(odd.faceValueCents + odd.feeCents + odd.taxCents).toBe(33_333)
  })

  it('copes with an order that had no fee, tax or discount', () => {
    const plain = { totalCents: 50_000, subtotalCents: 50_000 }

    expect(splitRefund(plain, 50_000)).toEqual({
      faceValueCents: 50_000,
      feeCents: 0,
      taxCents: 0,
    })
    expect(splitRefund(plain, 20_000)).toEqual({
      faceValueCents: 20_000,
      feeCents: 0,
      taxCents: 0,
    })
  })
})

describe('canTransition', () => {
  it('lets a declined refund be approved again', () => {
    expect(canTransition(REFUND_STATES.DECLINED, REFUND_STATES.APPROVED)).toBe(true)
  })

  it('refuses to reopen a settled refund', () => {
    expect(canTransition(REFUND_STATES.SUCCEEDED, REFUND_STATES.APPROVED)).toBe(false)
  })

  it('treats a state it has never heard of as going nowhere', () => {
    expect(canTransition('MADE_UP', REFUND_STATES.APPROVED)).toBe(false)
  })
})
