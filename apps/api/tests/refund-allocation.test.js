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
  isUnreservedLegacyRefund,
  orderParts,
  partsLeft,
  refundPartsFor,
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

  it('asks a line for no more than it has left, when an older refund gave it more', () => {
    // Line a: one ticket gone, and 500 more than its price put on the line
    // beside it. Its other two tickets are worth 40,000; the line has 39,500.
    const { allocation, amountCents } = allocateNamedLines({
      items: [
        line({ ...items[0], refundedQuantity: 1, refundedCents: 20_500 }),
        line({ ...items[1] }),
      ],
      lines: [
        { orderItemId: 'a', quantity: 2 },
        { orderItemId: 'b', quantity: 1 },
      ],
      roomByLine: new Map([
        ['a', 39_500],
        ['b', 45_000],
      ]),
    })

    expect(allocation).toEqual([
      { orderItemId: 'a', amountCents: 39_500, quantity: 2 },
      { orderItemId: 'b', amountCents: 45_000, quantity: 1 },
    ])
    expect(amountCents).toBe(84_500)
  })
})

describe('allocateNamedLines on a discounted order', () => {
  // 3 × 200.00 and 1 × 450.00, bought with a 50% code: 525.00 off 1,050.00,
  // spread over the lines in proportion to their subtotals, as checkout does.
  const items = [
    line({ id: 'a', quantity: 3, unitPriceCents: 20_000, subtotalCents: 60_000 }),
    line({ id: 'b', quantity: 1, unitPriceCents: 45_000, subtotalCents: 45_000 }),
  ]
  const discountCents = 52_500

  it('gives back what was paid for the tickets, not their face value', () => {
    const { allocation, amountCents } = allocateNamedLines({
      items,
      lines: [{ orderItemId: 'a', quantity: 2 }],
      discountCents,
    })

    // Line a carries 300.00 of the discount; two of its three tickets, 200.00.
    expect(amountCents).toBe(20_000)
    expect(allocation).toEqual([{ orderItemId: 'a', amountCents: 20_000, quantity: 2 }])

    expect(
      allocateNamedLines({ items, lines: [{ orderItemId: 'b', quantity: 1 }], discountCents })
        .amountCents,
    ).toBe(22_500)
  })

  it('adds partial refunds of a line up to exactly what the line was paid', () => {
    const odd = [line({ id: 'c', quantity: 3, unitPriceCents: 10_000, subtotalCents: 30_000 })]
    // An awkward discount whose share does not divide by three.
    const discount = 10_001
    let refunded = 0
    let total = 0

    for (const quantity of [1, 1, 1]) {
      const { amountCents } = allocateNamedLines({
        items: odd,
        lines: [{ orderItemId: 'c', quantity }],
        pendingByLine: new Map([['c', refunded]]),
        discountCents: discount,
      })

      refunded += quantity
      total += amountCents
    }

    expect(total).toBe(30_000 - discount)
  })

  it('leaves an order with no discount priced at face value', () => {
    expect(
      allocateNamedLines({ items, lines: [{ orderItemId: 'a', quantity: 2 }], discountCents: 0 })
        .amountCents,
    ).toBe(40_000)
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

/**
 * The fee order every refund suite uses: 2 × $50 Floor and 1 × $20 Balcony,
 * 50 % off, 5.9 % + 99¢ a ticket of fee and 8.25 % tax — $72.00
 * (`helpers/fee-orders.js`).
 */
const FEE_ORDER = Object.freeze({
  id: 'fee-order',
  subtotalCents: 12_000,
  discountCents: 6_000,
  feesCents: 651,
  taxCents: 549,
  totalCents: 7_200,
})

/** Its two lines, with the discount shared 5,000 and 1,000. */
const FEE_LINES = Object.freeze([
  line({ id: 'floor', quantity: 2, unitPriceCents: 5_000, subtotalCents: 10_000 }),
  line({ id: 'balcony', quantity: 1, unitPriceCents: 2_000, subtotalCents: 2_000 }),
])

describe('orderParts', () => {
  it('splits an order into face value net of the discount, fee and tax', () => {
    expect(orderParts(FEE_ORDER)).toEqual({ faceValueCents: 6_000, feeCents: 651, taxCents: 549 })
  })

  it('refuses an order whose parts do not add up to its total', () => {
    expect(() => orderParts({ ...FEE_ORDER, totalCents: 7_201 })).toThrowError(
      expect.objectContaining({ statusCode: 409, code: 'ORDER_TOTALS_INCONSISTENT' }),
    )
  })
})

describe('refundPartsFor', () => {
  const parts = orderParts(FEE_ORDER)

  it('gives back everything left on a whole refund', () => {
    const left = { faceValueCents: 5_000, feeCents: 543, taxCents: 458 }

    expect(refundPartsFor({ parts, left, form: 'whole', amountCents: 6_001 })).toEqual(left)
  })

  it('splits a partial amount in proportion, the parts adding up to it', () => {
    // Half the order: half of 651 and of 549, each rounded (325.5 and 274.5
    // round up), and the face value is the rest.
    const split = refundPartsFor({ parts, left: parts, form: 'amount', amountCents: 3_600 })

    expect(split).toEqual({ faceValueCents: 2_999, feeCents: 326, taxCents: 275 })
    expect(split.faceValueCents + split.feeCents + split.taxCents).toBe(3_600)
  })

  it('never makes the face value negative when fee and tax both round up', () => {
    // Face value 0, fee 1, tax 1, refunded 1 cent: each share is half a cent,
    // and rounding both up would give back 2 cents of fee and tax from 1.
    const tiny = { faceValueCents: 0, feeCents: 1, taxCents: 1 }
    const split = refundPartsFor({ parts: tiny, left: tiny, form: 'amount', amountCents: 1 })

    expect(split).toEqual({ faceValueCents: 0, feeCents: 1, taxCents: 0 })
  })

  it('moves face value it cannot take into fee and tax, within what is left of them', () => {
    const left = { faceValueCents: 100, feeCents: 651, taxCents: 549 }
    const split = refundPartsFor({ parts, left, form: 'amount', amountCents: 1_000 })

    expect(split.faceValueCents).toBe(100)
    expect(split.faceValueCents + split.feeCents + split.taxCents).toBe(1_000)
    expect(split.feeCents).toBeLessThanOrEqual(651)
    expect(split.taxCents).toBeLessThanOrEqual(549)
  })

  it('adds each line refund’s share of fee and tax up to exactly the order’s', () => {
    // Three tickets refunded one line at a time: 1,000, 2,500 and 2,500 of the
    // 6,000 of face value.
    let left = parts
    const splits = [1_000, 2_500, 2_500].map((lineFaceCents) => {
      const split = refundPartsFor({ parts, left, form: 'lines', lineFaceCents })

      left = partsLeft(left, split)

      return split
    })

    expect(splits[0]).toEqual({ faceValueCents: 1_000, feeCents: 108, taxCents: 91 })
    expect(splits.reduce((sum, split) => sum + split.feeCents, 0)).toBe(651)
    expect(splits.reduce((sum, split) => sum + split.taxCents, 0)).toBe(549)
    expect(left).toEqual({ faceValueCents: 0, feeCents: 0, taxCents: 0 })
  })
})

describe('allocateAcrossLines, face value only', () => {
  it('puts each line’s face value net of its discount share on it, and no fee or tax', () => {
    const allocation = allocateAcrossLines({
      items: FEE_LINES,
      amountCents: 6_000,
      discountCents: 6_000,
      whole: true,
    })

    expect(allocation).toEqual([
      { orderItemId: 'floor', amountCents: 5_000, quantity: 2 },
      { orderItemId: 'balcony', amountCents: 1_000, quantity: 1 },
    ])
  })

  it('withdraws every ticket on a whole refund, a free line included', () => {
    const allocation = allocateAcrossLines({
      items: [
        line({ id: 'paid', quantity: 2, unitPriceCents: 5_000, subtotalCents: 10_000 }),
        line({ id: 'free', quantity: 3, unitPriceCents: 0, subtotalCents: 0 }),
      ],
      amountCents: 10_000,
      whole: true,
    })

    expect(allocation).toEqual([
      { orderItemId: 'paid', amountCents: 10_000, quantity: 2 },
      { orderItemId: 'free', amountCents: 0, quantity: 3 },
    ])
  })

  it('counts a discounted ticket at what was paid for it, ticket by ticket', () => {
    // Floor tickets were paid $25.00 each after the discount. Face value
    // alone would say $25.00 buys back none of a $50.00 ticket.
    const [floor] = allocateAcrossLines({
      items: [FEE_LINES[0]],
      amountCents: 2_500,
      discountCents: 5_000,
    })

    expect(floor).toEqual({ orderItemId: 'floor', amountCents: 2_500, quantity: 1 })
  })

  it('withdraws nothing for a share that pays for no whole ticket', () => {
    const allocation = allocateAcrossLines({
      items: FEE_LINES,
      amountCents: 83,
      discountCents: 6_000,
    })

    expect(allocation.every((item) => item.quantity === 0)).toBe(true)
    expect(allocation.reduce((sum, item) => sum + item.amountCents, 0)).toBe(83)
  })

  it('sends the rounding remainder on to the next line when the biggest has no room', () => {
    // Three lines of 3 cents and 8 cents to place: 2 each by proportion, and
    // the 2 left over cannot both go on the first line.
    const allocation = allocateAcrossLines({
      items: ['a', 'b', 'c'].map((id) =>
        line({ id, quantity: 1, unitPriceCents: 3, subtotalCents: 3 }),
      ),
      amountCents: 8,
    })

    expect(allocation.map((item) => item.amountCents)).toEqual([3, 3, 2])
  })

  it('places no more than the lines have room for, whatever it is asked', () => {
    // Only reachable when older rows put fee or tax on a line: what does not
    // fit stays on the order rather than breaking the line CHECK.
    const allocation = allocateAcrossLines({
      items: FEE_LINES,
      amountCents: 14_078,
      whole: true,
    })

    expect(allocation).toEqual([
      { orderItemId: 'floor', amountCents: 10_000, quantity: 2 },
      { orderItemId: 'balcony', amountCents: 2_000, quantity: 1 },
    ])
  })

  it('never gives a line more than it has left, and counts what refunds already hold', () => {
    const allocation = allocateAcrossLines({
      items: FEE_LINES,
      amountCents: 1_000,
      discountCents: 6_000,
      pendingByLine: new Map([['floor', 2]]),
      pendingCentsByLine: new Map([['floor', 5_000]]),
      whole: true,
    })

    expect(allocation).toEqual([{ orderItemId: 'balcony', amountCents: 1_000, quantity: 1 }])
  })
})

describe('isUnreservedLegacyRefund', () => {
  const legacy = {
    reason: 'EVENT_CANCELLED',
    allocation: null,
    status: REFUND_STATES.REQUESTED,
  }

  it('recognises a cancellation refund written with no reservation, lines or split', () => {
    expect(isUnreservedLegacyRefund(legacy, 0)).toBe(true)
    expect(isUnreservedLegacyRefund({ ...legacy, status: REFUND_STATES.APPROVED }, 0)).toBe(true)
  })

  it.each([
    ['one with lines', { ...legacy }, 1],
    ['one with a split', { ...legacy, allocation: { faceValueCents: 1 } }, 0],
    ['one asked for by a customer', { ...legacy, reason: 'CUSTOMER_REQUEST' }, 0],
    ['one already sent', { ...legacy, status: REFUND_STATES.SUBMITTED }, 0],
  ])('does not count %s', (_name, refund, items) => {
    expect(isUnreservedLegacyRefund(refund, items)).toBe(false)
  })
})
