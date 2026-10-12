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
  capNamedFace,
  feeRefundQuote,
  isUnreservedLegacyRefund,
  lineQuantityLeft,
  orderBasis,
  orderParts,
  partsLeft,
  partsSpokenFor,
  priceNamedLines,
  quoteNamedLines,
  refundPartsFor,
  refundableCents,
  seatPolicyFor,
  shareBasisOf,
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

describe('capNamedFace', () => {
  const named = {
    allocation: [
      { orderItemId: 'a', amountCents: 3_000, quantity: 1 },
      { orderItemId: 'b', amountCents: 1_000, quantity: 2 },
    ],
    amountCents: 4_000,
  }

  it('scales each line down to what is left, keeping every ticket', () => {
    expect(capNamedFace(named, 2_000)).toEqual({
      allocation: [
        { orderItemId: 'a', amountCents: 1_500, quantity: 1 },
        { orderItemId: 'b', amountCents: 500, quantity: 2 },
      ],
      amountCents: 2_000,
    })
  })

  it('leaves tickets that fit what is left as they are', () => {
    expect(capNamedFace(named, 4_000)).toBe(named)
    expect(capNamedFace(named, 9_999)).toBe(named)
  })

  it('asks for nothing when nothing is left, and never for less than nothing', () => {
    for (const cap of [0, -5]) {
      const capped = capNamedFace(named, cap)

      expect(capped.amountCents).toBe(0)
      expect(capped.allocation.map((line) => [line.amountCents, line.quantity])).toEqual([
        [0, 1],
        [0, 2],
      ])
    }
  })
})

describe('quoteNamedLines after a sum refunded without tickets', () => {
  // 2 × 50.00 for one night and 1 × 30.00 for another, with a 50 % code: the
  // order's face value is 65.00, its fee 6.81 and its tax 5.92. A goodwill
  // sum of 60.00 gave back 50.17 of face value and withdrew one 25.00 ticket,
  // so the other night's ticket, 15.00 after the discount, costs more face
  // value than the 14.83 the order has left.
  const items = [
    line({
      id: 'floor',
      quantity: 2,
      unitPriceCents: 5_000,
      subtotalCents: 10_000,
      refundedQuantity: 1,
      refundedCents: 2_500,
    }),
    line({ id: 'night', quantity: 1, unitPriceCents: 3_000, subtotalCents: 3_000 }),
  ]
  const parts = { faceValueCents: 6_500, feeCents: 681, taxCents: 592 }
  const left = { faceValueCents: 1_483, feeCents: 155, taxCents: 135 }
  const pending = { quantities: new Map(), cents: new Map() }
  const ask = (capFaceToLeft) =>
    quoteNamedLines({
      items,
      lines: [{ orderItemId: 'night', quantity: 1 }],
      pending,
      discountCents: 6_500,
      parts,
      left,
      capFaceToLeft,
    })

  it('prices the ticket at what it cost, which is more than the order has left', () => {
    const quoted = ask(false)

    expect(quoted.priced.amountCents).toBe(1_500)
    expect(quoted.named.amountCents).toBe(1_500)
    expect(quoted.named.amountCents).toBeGreaterThan(left.faceValueCents)
  })

  it('asks for what is left when told to, with the fee and tax that remain', () => {
    const quoted = ask(true)

    expect(quoted.priced.amountCents).toBe(1_500)
    expect(quoted.named).toEqual({
      allocation: [{ orderItemId: 'night', amountCents: 1_483, quantity: 1 }],
      amountCents: 1_483,
    })
    expect(quoted.split).toEqual({ faceValueCents: 1_483, feeCents: 155, taxCents: 135 })
    expect(quoted.amountCents).toBe(1_773)
  })

  it('prices free lines at nothing rather than refusing them', () => {
    const free = [line({ id: 'kids', quantity: 1, unitPriceCents: 0, subtotalCents: 0 })]

    expect(priceNamedLines({ items: free, lines: [{ orderItemId: 'kids', quantity: 1 }] })).toEqual(
      { allocation: [{ orderItemId: 'kids', amountCents: 0, quantity: 1 }], amountCents: 0 },
    )
    expect(() =>
      allocateNamedLines({ items: free, lines: [{ orderItemId: 'kids', quantity: 1 }] }),
    ).toThrow(/worth nothing/u)
  })
})

/**
 * A pay-at-the-venue order (SPEC3 §10.2): two $40 tickets owed at the door,
 * $6 of booking fee and no tax paid online.
 */
const VENUE_ORDER = Object.freeze({
  id: 'venue-order',
  paymentMethod: 'AT_VENUE',
  subtotalCents: 8_000,
  discountCents: 0,
  venueDueCents: 8_000,
  feesCents: 600,
  taxCents: 0,
  totalCents: 600,
})

/** Its one line of two tickets. */
const VENUE_LINES = Object.freeze([
  line({ id: 'door', quantity: 2, unitPriceCents: 4_000, subtotalCents: 8_000 }),
])

/** No refund in flight on any line. */
const NOTHING_PENDING = Object.freeze({ quantities: new Map(), cents: new Map() })

/**
 * A transaction client that holds some refund rows and no refund lines.
 *
 * @param {Array<object>} rows `Refund` rows.
 * @returns {object} Enough of a client for {@link partsSpokenFor}.
 */
const holding = (rows) => ({
  refund: { findMany: async () => rows },
  refundItem: { findMany: async () => [] },
})

describe('orders paid at the venue (SPEC3 §10.2)', () => {
  it('has no face value online: the parts are its booking fee and tax, and its basis is the net ticket price', () => {
    expect(orderParts(VENUE_ORDER)).toEqual({ faceValueCents: 0, feeCents: 600, taxCents: 0 })
    expect(orderBasis(VENUE_ORDER)).toBe(8_000)
    // A card order's basis is its face value, so card orders compute as before.
    expect(orderBasis(FEE_ORDER)).toBe(orderParts(FEE_ORDER).faceValueCents)
  })

  it('splits a sum with face value 0: all of it fee and tax', () => {
    expect(splitRefund(VENUE_ORDER, 600)).toEqual({ faceValueCents: 0, feeCents: 600, taxCents: 0 })
    expect(splitRefund(VENUE_ORDER, 250)).toEqual({ faceValueCents: 0, feeCents: 250, taxCents: 0 })
  })

  it('gives a ticket back its share of the fee by its basis, and nothing of a face value it never paid online', () => {
    const parts = orderParts(VENUE_ORDER)
    const share = shareBasisOf(VENUE_ORDER, { faceValueCents: 0, feeCents: 0, taxCents: 0 })
    const quoted = quoteNamedLines({
      items: VENUE_LINES,
      lines: [{ orderItemId: 'door', quantity: 1 }],
      pending: NOTHING_PENDING,
      discountCents: 0,
      parts,
      left: parts,
      share,
    })

    expect(quoted.basis).toBe(4_000)
    // Every RefundItem of it is worth 0 online.
    expect(quoted.named).toEqual({
      allocation: [{ orderItemId: 'door', amountCents: 0, quantity: 1 }],
      amountCents: 0,
    })
    expect(quoted.split).toEqual({ faceValueCents: 0, feeCents: 300, taxCents: 0 })
    expect(quoted.amountCents).toBe(300)
  })

  it('shares the rest exactly once one ticket was refunded, by the basis that refund spoke for', async () => {
    const parts = orderParts(VENUE_ORDER)
    const first = {
      id: 'first',
      status: 'SUCCEEDED',
      amountCents: 300,
      allocation: {
        faceValueCents: 0,
        feeCents: 300,
        taxCents: 0,
        basisCents: 4_000,
        form: 'lines',
      },
    }
    const spoken = await partsSpokenFor(holding([first]), VENUE_ORDER)

    expect(spoken).toMatchObject({ faceValueCents: 0, feeCents: 300, basisCents: 4_000 })

    const quoted = quoteNamedLines({
      items: [{ ...VENUE_LINES[0], refundedQuantity: 1 }],
      lines: [{ orderItemId: 'door', quantity: 1 }],
      pending: NOTHING_PENDING,
      discountCents: 0,
      parts,
      left: partsLeft(parts, spoken),
      share: shareBasisOf(VENUE_ORDER, spoken),
    })

    // 300 and 300: the two refunds sum to the fee exactly.
    expect(quoted.split).toEqual({ faceValueCents: 0, feeCents: 300, taxCents: 0 })
  })

  it('reads an allocation stored without a basis as its face value (every refund before this build)', async () => {
    const legacy = {
      id: 'legacy',
      status: 'SUCCEEDED',
      amountCents: 1_199,
      allocation: { faceValueCents: 1_000, feeCents: 108, taxCents: 91, form: 'lines' },
    }
    const stamped = {
      id: 'stamped',
      status: 'SUCCEEDED',
      amountCents: 1_199,
      allocation: {
        faceValueCents: 1_000,
        feeCents: 108,
        taxCents: 91,
        basisCents: 1_000,
        form: 'lines',
      },
    }

    expect((await partsSpokenFor(holding([legacy]), FEE_ORDER)).basisCents).toBe(1_000)
    expect(await partsSpokenFor(holding([legacy]), FEE_ORDER)).toEqual(
      await partsSpokenFor(holding([stamped]), FEE_ORDER),
    )
  })

  it('does not share out again the tax a booking-fee refund gave back (2 × $40 at 825 bps: 330 and 330, not 357 and 303)', async () => {
    // A card order: N = 8,000, F = 667, T = applyBps(8,667, 825) = 715. The
    // booking fee refunded on its own took 667 and its tax share, 55.
    const order = {
      id: 'taxed-card',
      subtotalCents: 8_000,
      discountCents: 0,
      feesCents: 667,
      taxCents: 715,
      totalCents: 9_382,
    }
    const items = [line({ id: 'pair', quantity: 2, unitPriceCents: 4_000, subtotalCents: 8_000 })]
    const parts = orderParts(order)
    const feeRefund = {
      id: 'fee',
      status: 'SUCCEEDED',
      amountCents: 722,
      allocation: { faceValueCents: 0, feeCents: 667, taxCents: 55, basisCents: 0, form: 'fee' },
    }
    const ask = async (rows, refunded) => {
      const spoken = await partsSpokenFor(holding(rows), order)

      return quoteNamedLines({
        items: [{ ...items[0], refundedQuantity: refunded }],
        lines: [{ orderItemId: 'pair', quantity: 1 }],
        pending: NOTHING_PENDING,
        discountCents: 0,
        parts,
        left: partsLeft(parts, spoken),
        share: shareBasisOf(order, spoken),
      })
    }

    const first = await ask([feeRefund], 0)

    expect(first.split).toEqual({ faceValueCents: 4_000, feeCents: 0, taxCents: 330 })

    const second = await ask(
      [
        feeRefund,
        {
          id: 'one',
          status: 'SUCCEEDED',
          amountCents: 4_330,
          allocation: { ...first.split, basisCents: 4_000, form: 'lines' },
        },
      ],
      1,
    )

    expect(second.split).toEqual({ faceValueCents: 4_000, feeCents: 0, taxCents: 330 })
    // Every cent of tax given back, exactly once.
    expect(55 + first.split.taxCents + second.split.taxCents).toBe(715)
  })

  it('leaves a card order’s line refund exactly as it was', () => {
    const parts = orderParts(FEE_ORDER)
    const before = quoteNamedLines({
      items: FEE_LINES,
      lines: [{ orderItemId: 'balcony', quantity: 1 }],
      pending: NOTHING_PENDING,
      discountCents: FEE_ORDER.discountCents,
      parts,
      left: parts,
    })
    const after = quoteNamedLines({
      items: FEE_LINES,
      lines: [{ orderItemId: 'balcony', quantity: 1 }],
      pending: NOTHING_PENDING,
      discountCents: FEE_ORDER.discountCents,
      parts,
      left: parts,
      share: shareBasisOf(FEE_ORDER, { faceValueCents: 0, feeCents: 0, taxCents: 0 }),
    })

    expect(after.split).toEqual(before.split)
    expect(after.named).toEqual(before.named)
  })
})

describe('a booking fee kept when unpaid tickets were cancelled (SPEC3-XI §10.2)', () => {
  // 2 × $45 at the site default: N = 9,000, F = 531 + 198 = 729. One ticket
  // was cancelled unpaid: its basis 4,500, its share of the fee kept, 364.
  const KEPT_ORDER = Object.freeze({
    id: 'kept-order',
    paymentMethod: 'AT_VENUE',
    subtotalCents: 9_000,
    discountCents: 0,
    venueDueCents: 9_000,
    feesCents: 729,
    taxCents: 0,
    totalCents: 729,
    refundedCents: 0,
    refundPendingCents: 0,
    venueCancelledBasisCents: 4_500,
    venueFeeKeptCents: 364,
  })
  const KEPT_LINES = Object.freeze([
    line({
      id: 'pair',
      quantity: 2,
      unitPriceCents: 4_500,
      subtotalCents: 9_000,
      venueCancelledQuantity: 1,
    }),
  ])

  it('is never refundable: what is left excludes it, and a card order computes as before', () => {
    expect(refundableCents(KEPT_ORDER)).toBe(365)
    expect(refundableCents({ ...KEPT_ORDER, refundPendingCents: 365 })).toBe(0)
    // Every kept column is 0 on a card order.
    expect(
      refundableCents({ totalCents: 7_200, refundedCents: 1_000, refundPendingCents: 0 }),
    ).toBe(6_200)
  })

  it('is spoken for, with the cancelled tickets’ basis, by every form', async () => {
    const spoken = await partsSpokenFor(holding([]), KEPT_ORDER)

    expect(spoken).toMatchObject({
      faceValueCents: 0,
      feeCents: 364,
      taxCents: 0,
      basisCents: 4_500,
    })
    expect(partsLeft(orderParts(KEPT_ORDER), spoken)).toEqual({
      faceValueCents: 0,
      feeCents: 365,
      taxCents: 0,
    })
    // A card order speaks for nothing it did not refund.
    expect(await partsSpokenFor(holding([]), FEE_ORDER)).toMatchObject({
      faceValueCents: 0,
      feeCents: 0,
      taxCents: 0,
      basisCents: 0,
    })
  })

  it('leaves the other ticket exactly the rest: its refund by name is 365 (729 = 364 + 365)', async () => {
    const parts = orderParts(KEPT_ORDER)
    const spoken = await partsSpokenFor(holding([]), KEPT_ORDER)
    const quoted = quoteNamedLines({
      items: KEPT_LINES,
      lines: [{ orderItemId: 'pair', quantity: 1 }],
      pending: NOTHING_PENDING,
      discountCents: 0,
      parts,
      left: partsLeft(parts, spoken),
      share: shareBasisOf(KEPT_ORDER, spoken),
    })

    expect(quoted.split).toEqual({ faceValueCents: 0, feeCents: 365, taxCents: 0 })
    expect(364 + quoted.amountCents).toBe(729)
  })

  it('refunds exactly what is left on a whole refund', async () => {
    const parts = orderParts(KEPT_ORDER)
    const left = partsLeft(parts, await partsSpokenFor(holding([]), KEPT_ORDER))

    expect(
      refundPartsFor({ parts, left, form: 'whole', amountCents: refundableCents(KEPT_ORDER) }),
    ).toEqual({ faceValueCents: 0, feeCents: 365, taxCents: 0 })
  })

  it('leaves the booking fee on its own only what is not kept, and nothing once all of it is', async () => {
    expect(await feeRefundQuote(holding([]), KEPT_ORDER)).toMatchObject({
      feeCents: 365,
      taxCents: 0,
      amountCents: 365,
    })
    expect(
      await feeRefundQuote(holding([]), {
        ...KEPT_ORDER,
        venueCancelledBasisCents: 9_000,
        venueFeeKeptCents: 729,
      }),
    ).toMatchObject({ feeCents: 0, amountCents: 0 })
  })

  it('counts a cancelled ticket as gone at every quantity-left site: never offered, never refunded', () => {
    expect(lineQuantityLeft(KEPT_LINES[0])).toBe(1)
    expect(lineQuantityLeft(KEPT_LINES[0], 1)).toBe(0)
    // A card order's line, which has no cancelled tickets, computes as before.
    expect(lineQuantityLeft(line({ refundedQuantity: 1 }))).toBe(1)

    expect(() =>
      priceNamedLines({
        items: KEPT_LINES,
        lines: [{ orderItemId: 'pair', quantity: 2 }],
        pendingByLine: new Map(),
        discountCents: 0,
        roomByLine: new Map([['pair', 9_000]]),
      }),
    ).toThrowError(expect.objectContaining({ statusCode: 422 }))

    const whole = allocateAcrossLines({ items: KEPT_LINES, amountCents: 0, whole: true })

    expect(whole.reduce((sum, row) => sum + row.quantity, 0)).toBe(1)
  })
})
