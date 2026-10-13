/**
 * The pure rules of cancelling unpaid pay-at-the-venue tickets (SPEC3-XI
 * XU2, XU5, XU6, §10.2, §14.1): who may cancel, how much of the booking fee is
 * kept, whether the freed places are on sale, and the refusal of a booking
 * taxed on its booking fee — which no booking of this build is, so it is shown
 * with the pricing constant overridden, as SPEC3 §6.2 shows the tax itself.
 */

import { computeOrderTotals } from '@desi-event/pricing'
import { describe, expect, it } from 'vitest'

import { addRows, makeWorld } from '../../tests/helpers/fixtures.js'
import { createPrismaStub, cuid } from '../../tests/helpers/prisma-stub.js'
import { basisLeftWhenLast, orderParts, refundPartsFor } from './refunds.js'
import {
  cancelUnpaidVenueTickets,
  feeHeldOf,
  keptShareOf,
  onlineFeeOutcomeOf,
  placesOnSaleOf,
  venueCancellationAuthority,
} from './venue-bookings.js'

/** Nothing refunded or kept yet. */
const NOTHING_SPOKEN = Object.freeze({ faceValueCents: 0, feeCents: 0, taxCents: 0, basisCents: 0 })

/**
 * A pay-at-the-venue order's parts: no face value online, its fee, no tax.
 *
 * @param {number} feeCents The booking fee charged.
 * @returns {{faceValueCents: number, feeCents: number, taxCents: number}} The parts.
 */
function venueParts(feeCents) {
  return { faceValueCents: 0, feeCents, taxCents: 0 }
}

/**
 * Cancel tickets of basis `lines` one after another, each counted from what
 * the ones before it kept, as successive cancellations of one booking are.
 *
 * @param {object} options Options.
 * @param {number} options.feeCents The booking fee.
 * @param {number} options.orderBasisCents The booking's basis.
 * @param {number[]} options.lines Each cancellation's basis, in order.
 * @returns {number[]} What each kept.
 */
function keptInTurn({ feeCents, orderBasisCents, lines }) {
  const spoken = { ...NOTHING_SPOKEN }

  return lines.map((lineBasisCents) => {
    const { feeKeptCents } = keptShareOf({
      parts: venueParts(feeCents),
      spoken,
      orderBasisCents,
      lineBasisCents,
    })

    spoken.feeCents += feeKeptCents
    spoken.basisCents += lineBasisCents

    return feeKeptCents
  })
}

describe('keptShareOf: the booking fee kept for cancelled unpaid tickets (SPEC3-XI §10.2)', () => {
  it('2 × $40 at 3.00% + $1.49 (fee 538): one cancelled keeps 269, and the other is refunded 269', () => {
    const [kept] = keptInTurn({ feeCents: 538, orderBasisCents: 8_000, lines: [4_000] })

    expect(kept).toBe(269)

    // The other ticket's later refund by name shares the fee from the basis
    // already taken, the cancelled ticket's included: exactly what is left.
    const refund = refundPartsFor({
      parts: venueParts(538),
      left: { faceValueCents: 0, feeCents: 538 - kept, taxCents: 0 },
      form: 'lines',
      lineFaceCents: 0,
      lineBasisCents: 4_000,
      takenBasisCents: 4_000,
      orderBasisCents: 8_000,
    })

    expect(refund).toEqual({ faceValueCents: 0, feeCents: 269, taxCents: 0 })
    expect(kept + refund.feeCents).toBe(538)
  })

  it('2 × $45 at the site default (fee 729): one cancelled keeps 364, the other keeps or is refunded 365', () => {
    expect(keptInTurn({ feeCents: 729, orderBasisCents: 9_000, lines: [4_500, 4_500] })).toEqual([
      364, 365,
    ])

    const refund = refundPartsFor({
      parts: venueParts(729),
      left: { faceValueCents: 0, feeCents: 729 - 364, taxCents: 0 },
      form: 'lines',
      lineFaceCents: 0,
      lineBasisCents: 4_500,
      takenBasisCents: 4_500,
      orderBasisCents: 9_000,
    })

    expect(refund.feeCents).toBe(365)
  })

  it('$40 + $25 + $25 at the site default (fee 828): the $25s keep 230 and 230, then the $40 368', () => {
    const kept = keptInTurn({ feeCents: 828, orderBasisCents: 9_000, lines: [2_500, 2_500, 4_000] })

    expect(kept).toEqual([230, 230, 368])
    expect(kept.reduce((sum, cents) => sum + cents, 0)).toBe(828)
  })

  it('a fee of 100 over three equal tickets: 33, 33, 34', () => {
    expect(
      keptInTurn({ feeCents: 100, orderBasisCents: 3_000, lines: [1_000, 1_000, 1_000] }),
    ).toEqual([33, 33, 34])
  })

  it('cancelling every ticket at once keeps the whole fee, never a cent more', () => {
    expect(keptInTurn({ feeCents: 729, orderBasisCents: 9_000, lines: [9_000] })).toEqual([729])
  })

  it('a waived booking keeps 0', () => {
    expect(keptInTurn({ feeCents: 0, orderBasisCents: 8_000, lines: [4_000, 4_000] })).toEqual([
      0, 0,
    ])
  })

  it('keeps no more than the fee the order still holds', () => {
    // An earlier refund took 400 of the 538 for basis 4,000 (its own share
    // would have been 269): only 138 is left to keep.
    const { feeKeptCents } = keptShareOf({
      parts: venueParts(538),
      spoken: { faceValueCents: 0, feeCents: 400, taxCents: 0, basisCents: 4_000 },
      orderBasisCents: 8_000,
      lineBasisCents: 4_000,
    })

    expect(feeKeptCents).toBe(138)
  })

  it('has no tax branch: a pay-at-the-venue order is never taxed in this build', () => {
    const { feeKeptCents, ...rest } = keptShareOf({
      parts: { faceValueCents: 0, feeCents: 538, taxCents: 44 },
      spoken: NOTHING_SPOKEN,
      orderBasisCents: 8_000,
      lineBasisCents: 4_000,
    })

    expect(feeKeptCents).toBe(269)
    expect(rest).toEqual({})
  })

  it('4 × $40.01 at 50 % off (fee 868, dues 2001/2001/2000/2000): the cents split by position and by ticket meet in the last share, in either order', () => {
    const parts = venueParts(868)
    const line = { id: 'line', quantity: 4, refundedQuantity: 0, venueCancelledQuantity: 0 }

    // Cancel the cheaper two first: their own dues, 4,000, keep 433.
    const kept = keptShareOf({
      parts,
      spoken: NOTHING_SPOKEN,
      orderBasisCents: 8_002,
      lineBasisCents: 4_000,
    }).feeKeptCents

    expect(kept).toBe(433)

    // The other two, refunded by name, are the last: they take the basis
    // left, 4,002 (priced by position they would be 4,001), and the fee left.
    const last = basisLeftWhenLast({
      items: [{ ...line, venueCancelledQuantity: 2 }],
      taking: new Map([['line', 2]]),
      orderBasisCents: 8_002,
      takenBasisCents: 4_000,
    })

    expect(last).toBe(4_002)

    const refund = refundPartsFor({
      parts,
      left: { faceValueCents: 0, feeCents: 868 - kept, taxCents: 0 },
      form: 'lines',
      lineBasisCents: last,
      takenBasisCents: 4_000,
      orderBasisCents: 8_002,
      lastShare: true,
    })

    expect(kept + refund.feeCents).toBe(868)

    // The other order: the dearer two refunded first by position (basis
    // 4,001, fee 434), then the cheaper two cancelled as the last.
    const refundedFirst = refundPartsFor({
      parts,
      left: { faceValueCents: 0, feeCents: 868, taxCents: 0 },
      form: 'lines',
      lineBasisCents: 4_001,
      takenBasisCents: 0,
      orderBasisCents: 8_002,
    }).feeCents
    const keptLast = keptShareOf({
      parts,
      spoken: { faceValueCents: 0, feeCents: refundedFirst, taxCents: 0, basisCents: 4_001 },
      orderBasisCents: 8_002,
      lineBasisCents: 4_001,
      lastShare: true,
    }).feeKeptCents

    expect(refundedFirst + keptLast).toBe(868)
  })

  it('a ticket still on the order keeps the last-share rule off', () => {
    const line = { id: 'line', quantity: 3, refundedQuantity: 1, venueCancelledQuantity: 0 }

    expect(
      basisLeftWhenLast({
        items: [line],
        taking: new Map([['line', 1]]),
        orderBasisCents: 9_000,
        takenBasisCents: 3_000,
      }),
    ).toBeNull()
    // Held by an unresolved refund counts as taken.
    expect(
      basisLeftWhenLast({
        items: [line],
        pendingByLine: new Map([['line', 1]]),
        taking: new Map([['line', 1]]),
        orderBasisCents: 9_000,
        takenBasisCents: 6_000,
      }),
    ).toBe(3_000)
  })
})

describe('placesOnSaleOf: whether the freed places are on sale now (SPEC3-XI XU5)', () => {
  const now = new Date('2026-10-01T12:00:00.000Z')
  const tier = (overrides = {}) => ({
    id: cuid(),
    status: 'ON_SALE',
    salesStartAt: null,
    salesEndAt: null,
    eventSessionId: null,
    ...overrides,
  })
  const night = (overrides = {}) => ({
    id: cuid(),
    status: 'SCHEDULED',
    salesStartAt: null,
    salesEndAt: null,
    endsAt: new Date('2026-10-20T23:00:00.000Z'),
    ...overrides,
  })

  it('ALL when the event is bookable and every place, its tier and its night sell now', () => {
    const open = night()
    const tiers = [tier({ eventSessionId: open.id }), tier()]

    expect(placesOnSaleOf({ event: { status: 'ON_SALE' }, tiers, nights: [open], now })).toEqual({
      placesOnSale: 'ALL',
      eventSalesStopped: false,
    })
  })

  it('NONE when the event is not bookable, whatever its tiers', () => {
    for (const status of ['SALES_PAUSED', 'SOLD_OUT', 'POSTPONED']) {
      expect(
        placesOnSaleOf({ event: { status }, tiers: [tier()], nights: [], now }).placesOnSale,
        status,
      ).toBe('NONE')
    }
  })

  it('NONE when the tier window has ended', () => {
    const ended = tier({ salesEndAt: new Date('2026-09-30T00:00:00.000Z') })

    expect(
      placesOnSaleOf({ event: { status: 'ON_SALE' }, tiers: [ended], nights: [], now })
        .placesOnSale,
    ).toBe('NONE')
  })

  it('SOME when one of two tiers is closed', () => {
    const tiers = [tier(), tier({ status: 'CLOSED' })]

    expect(
      placesOnSaleOf({ event: { status: 'PUBLISHED' }, tiers, nights: [], now }).placesOnSale,
    ).toBe('SOME')
  })

  it('NONE when the seat’s night has closed its sales, though the tier sells', () => {
    const closed = night({ salesEndAt: new Date('2026-09-30T00:00:00.000Z') })
    const seated = tier()

    expect(
      placesOnSaleOf({
        event: { status: 'ON_SALE' },
        tiers: [seated],
        nights: [closed],
        places: [{ ticketTypeId: seated.id, eventSessionId: closed.id }],
        now,
      }).placesOnSale,
    ).toBe('NONE')
  })

  it('counts each place: two of one tier on an open night and one on a closed night are SOME', () => {
    const open = night()
    const closed = night({ status: 'CANCELLED' })
    const seated = tier()

    expect(
      placesOnSaleOf({
        event: { status: 'ON_SALE' },
        tiers: [seated],
        nights: [open, closed],
        places: [
          { ticketTypeId: seated.id, eventSessionId: open.id },
          { ticketTypeId: seated.id, eventSessionId: open.id },
          { ticketTypeId: seated.id, eventSessionId: closed.id },
        ],
        now,
      }).placesOnSale,
    ).toBe('SOME')
  })

  it('says the event’s sales are stopped for SALES_PAUSED and SOLD_OUT only', () => {
    const stopped = ['PUBLISHED', 'ON_SALE', 'SALES_PAUSED', 'SOLD_OUT', 'POSTPONED'].filter(
      (status) =>
        placesOnSaleOf({ event: { status }, tiers: [tier()], nights: [], now }).eventSalesStopped,
    )

    expect(stopped).toEqual(['SALES_PAUSED', 'SOLD_OUT'])
  })
})

describe('venueCancellationAuthority: who may cancel (SPEC3-XI XU2)', () => {
  const organizationId = cuid()
  const event = { organizationId }
  const member = (role, platformRole = 'ORGANIZER') => ({
    id: cuid(),
    role: platformRole,
    memberships: [{ organizationId, role }],
  })

  it('an OWNER or ADMIN member, under the organisation’s authority', () => {
    expect(venueCancellationAuthority(member('OWNER'), event)).toEqual({
      authority: 'ORGANIZATION_ROLE',
      role: 'OWNER',
    })
    expect(venueCancellationAuthority(member('ADMIN'), event)).toEqual({
      authority: 'ORGANIZATION_ROLE',
      role: 'ADMIN',
    })
  })

  it('a platform ADMIN or SUPER_ADMIN outside the organisation, under the platform’s', () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN']) {
      expect(venueCancellationAuthority({ id: cuid(), role, memberships: [] }, event)).toEqual({
        authority: 'PLATFORM_ROLE',
        role,
      })
    }
  })

  it('a platform ADMIN who is an ADMIN member acts as the organisation', () => {
    expect(venueCancellationAuthority(member('ADMIN', 'ADMIN'), event)).toEqual({
      authority: 'ORGANIZATION_ROLE',
      role: 'ADMIN',
    })
  })

  it('a platform ADMIN who belongs to the organisation in another role: conflict of interest', () => {
    for (const role of ['STAFF', 'FINANCE', 'VIEWER', 'SCANNER']) {
      expect(venueCancellationAuthority(member(role, 'ADMIN'), event), role).toEqual({
        refusal: 'CONFLICT_OF_INTEREST',
      })
    }
  })

  it('nobody else: other members, other platform roles, buyers, nobody', () => {
    for (const role of ['FINANCE', 'MANAGER', 'EVENT_MANAGER', 'STAFF', 'VIEWER', 'SCANNER']) {
      expect(venueCancellationAuthority(member(role), event), role).toBeNull()
    }

    for (const role of ['FINANCE_ADMIN', 'MODERATOR', 'SUPPORT', 'ATTENDEE', 'ORGANIZER']) {
      expect(
        venueCancellationAuthority({ id: cuid(), role, memberships: [] }, event),
        role,
      ).toBeNull()
    }

    // An OWNER of another organisation.
    expect(
      venueCancellationAuthority(
        { id: cuid(), role: 'ORGANIZER', memberships: [{ organizationId: cuid(), role: 'OWNER' }] },
        event,
      ),
    ).toBeNull()
    expect(venueCancellationAuthority(null, event)).toBeNull()
  })
})

describe('a booking taxed on its booking fee (SPEC3-XI XU6, open question F)', () => {
  it('is refused VENUE_CANCEL_TAXED once the constant is overridden, and nothing is written', async () => {
    const world = await makeWorld()
    const { ids } = world
    const tier = { ...ids.generalAdmission, currency: 'USD', quantitySold: 2 }
    // Priced as a pay-at-the-venue booking would be if open question 9 were
    // answered the other way: tax on the online booking fee.
    const totals = computeOrderTotals({
      items: [{ ticketTypeId: tier.id, quantity: 2, unitPriceCents: 4_000 }],
      feeConfig: { percentageBps: 300, flatCents: 149, currency: 'USD' },
      taxRateBps: 825,
      currency: 'USD',
      now: new Date(),
      paymentMethod: 'AT_VENUE',
      atVenueTaxesBookingFee: true,
    })

    expect(totals.taxCents).toBeGreaterThan(0)

    const paidAt = new Date('2026-09-01T12:00:00.000Z')
    const order = {
      id: cuid(),
      reference: 'DE-TAXED01',
      eventId: ids.publishedEvent.id,
      eventSessionId: null,
      userId: ids.attendee.id,
      buyerEmail: ids.attendee.email,
      buyerName: ids.attendee.displayName,
      status: 'PAID',
      currency: 'USD',
      subtotalCents: totals.subtotalCents,
      discountCents: 0,
      feesCents: totals.feesCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      refundedCents: 0,
      refundPendingCents: 0,
      paidAt,
      createdAt: paidAt,
      updatedAt: paidAt,
      paymentMethod: 'AT_VENUE',
      feeGrossCents: totals.feesCents,
      venueDueCents: totals.venueDueCents,
      venueCancelledBasisCents: 0,
      venueFeeKeptCents: 0,
    }
    const item = {
      id: cuid(),
      orderId: order.id,
      ticketTypeId: tier.id,
      quantity: 2,
      unitPriceCents: 4_000,
      subtotalCents: 8_000,
      refundedQuantity: 0,
      refundedCents: 0,
      venueDueCents: 8_000,
      venueCancelledQuantity: 0,
    }
    const tickets = [0, 1].map((index) => ({
      id: cuid(),
      orderItemId: item.id,
      code: `DET-TAXED${index}`,
      credentialHash: `taxed-${index}`,
      credentialVersion: 1,
      ownerUserId: ids.attendee.id,
      eventSeatId: null,
      status: 'VALID',
      venueDueCents: 4_000,
      venuePaymentId: null,
      venueCancellationId: null,
      createdAt: paidAt,
      updatedAt: paidAt,
    }))

    world.seed.ticketType = world.seed.ticketType.map((row) => (row.id === tier.id ? tier : row))
    addRows(world.seed, { order: [order], orderItem: [item], ticket: tickets })

    const prisma = createPrismaStub(world.seed)
    const owner = {
      id: ids.owner.id,
      role: 'ORGANIZER',
      memberships: [{ organizationId: ids.organization.id, role: 'OWNER' }],
    }

    // The parts are still the fee and its tax: what a refund would give back.
    expect(orderParts(order)).toEqual({
      faceValueCents: 0,
      feeCents: totals.feesCents,
      taxCents: totals.taxCents,
    })

    await expect(
      cancelUnpaidVenueTickets(prisma, {
        reference: order.reference,
        ticketIds: [tickets[0].id],
        reason: 'Not paid before the doors opened.',
        actor: owner,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'VENUE_CANCEL_TAXED' })

    expect(prisma._store.venueBookingCancellation ?? []).toHaveLength(0)
    expect(prisma._store.ticket.filter((row) => row.status === 'REVOKED')).toHaveLength(0)
    expect(prisma._store.ticketType.find((row) => row.id === tier.id).quantitySold).toBe(2)
  })
})

describe('what the buyer is told of the booking fee paid online (codes review: a fee refunded by hand)', () => {
  /**
   * A pay-at-the-venue order of two $40 tickets with a $6.70 fee.
   *
   * @param {object} [overrides] Columns to change.
   * @returns {object} The order.
   */
  function booked(overrides = {}) {
    return {
      subtotalCents: 8_000,
      discountCents: 0,
      venueDueCents: 8_000,
      feesCents: 670,
      taxCents: 0,
      totalCents: 670,
      refundedCents: 0,
      refundPendingCents: 0,
      venueFeeKeptCents: 0,
      ...overrides,
    }
  }

  it('says the fee is kept when a share of it is', () => {
    expect(onlineFeeOutcomeOf({ order: booked(), spoken: NOTHING_SPOKEN, feeKeptCents: 335 })).toBe(
      'KEPT',
    )
  })

  it('says nothing was paid online only when the order paid nothing online', () => {
    const waived = booked({ feesCents: 0, totalCents: 0 })

    expect(onlineFeeOutcomeOf({ order: waived, spoken: NOTHING_SPOKEN, feeKeptCents: 0 })).toBe(
      'NONE_PAID',
    )
  })

  it('says the fee was refunded earlier when every cent of it went back, although nothing is kept', () => {
    const order = booked({ refundedCents: 670 })
    const spoken = { ...NOTHING_SPOKEN, feeCents: 670 }

    expect(onlineFeeOutcomeOf({ order, spoken, feeKeptCents: 0 })).toBe('REFUNDED_EARLIER')
  })

  it('never says refunded earlier when part of the fee was kept by an earlier cancellation', () => {
    const order = booked({ refundedCents: 335, venueFeeKeptCents: 335 })
    const spoken = { ...NOTHING_SPOKEN, feeCents: 670 }

    expect(onlineFeeOutcomeOf({ order, spoken, feeKeptCents: 0 })).toBe('NONE_KEPT')
  })

  it('says none of it is kept for these when the fee is still held but their share is nothing', () => {
    expect(onlineFeeOutcomeOf({ order: booked(), spoken: NOTHING_SPOKEN, feeKeptCents: 0 })).toBe(
      'NONE_KEPT',
    )
  })

  it('feeHeldOf: the fee still held, 0 once it was refunded by hand although it was paid', () => {
    expect(feeHeldOf(booked())).toBe(670)
    expect(feeHeldOf(booked({ refundedCents: 670 }))).toBe(0)
    expect(feeHeldOf(booked({ venueFeeKeptCents: 335 }))).toBe(335)
    expect(feeHeldOf(booked({ refundPendingCents: 670 }))).toBe(0)
    expect(feeHeldOf(booked({ feesCents: 0, totalCents: 0 }))).toBe(0)
  })
})
