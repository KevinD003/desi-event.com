/**
 * The filters every count of pay-at-the-venue orders uses, the one state a
 * buyer reads (SPEC3 §9.10, §12.7, as SPEC3-XI §4.6 extends it with passed-on,
 * paid-by-others and cancelled tickets), and how a cancellation of unpaid
 * tickets reads. The filters are checked against the stub's rows here and
 * against PostgreSQL in `tests/payment-terms-foundation-integration.test.js`.
 */

import { describe, expect, it } from 'vitest'

import { createPrismaStub, cuid } from '../../tests/helpers/prisma-stub.js'
import {
  BOOKED_UNPAID_ORDER_WHERE,
  PAID_ORDER_WHERE,
  STANDING_TICKET_STATUSES,
  UNPAID_VENUE_TICKET_WHERE,
  VENUE_CANCELLATION_READERS,
  isUnpaidVenueTicket,
  toVenueCancellation,
  venuePaymentStateOf,
} from './venue-payment-filters.js'

/** The buyer of every order below. */
const BUYER = 'buyer-1'

/** Somebody the buyer passed a ticket to. */
const OTHER = 'holder-2'

/**
 * An order with one line and its tickets, in the shape a read with
 * `items: { include: { tickets: true } }` returns. Every ticket is the
 * buyer's own unless it names another holder.
 *
 * @param {object} order Order columns.
 * @param {object[]} tickets Ticket columns.
 * @returns {object} The order.
 */
function orderWith(order, tickets) {
  return {
    userId: BUYER,
    venueDueCents: 0,
    ...order,
    items: [{ tickets: tickets.map((ticket) => ({ ownerUserId: BUYER, ...ticket })) }],
  }
}

describe('the filters', () => {
  it('spell out SPEC3 §9.10 exactly', () => {
    expect(UNPAID_VENUE_TICKET_WHERE).toEqual({
      venueDueCents: { gt: 0 },
      venuePaymentId: null,
      status: { in: ['VALID', 'TRANSFER_PENDING'] },
    })
    expect(PAID_ORDER_WHERE).toEqual({
      status: 'PAID',
      OR: [
        { paymentMethod: 'CARD' },
        {
          paymentMethod: 'AT_VENUE',
          venuePayments: { some: {} },
          items: { every: { tickets: { none: UNPAID_VENUE_TICKET_WHERE } } },
        },
      ],
    })
    expect(BOOKED_UNPAID_ORDER_WHERE).toEqual({
      status: 'PAID',
      paymentMethod: 'AT_VENUE',
      items: { some: { tickets: { some: UNPAID_VENUE_TICKET_WHERE } } },
    })
  })

  it('are frozen all the way down, so no caller can widen a count for everybody', () => {
    expect(Object.isFrozen(PAID_ORDER_WHERE)).toBe(true)
    expect(Object.isFrozen(PAID_ORDER_WHERE.OR[1].items.every.tickets.none.status.in)).toBe(true)
    expect(Object.isFrozen(STANDING_TICKET_STATUSES)).toBe(true)
    expect(() => {
      UNPAID_VENUE_TICKET_WHERE.status.in.push('CHECKED_IN')
    }).toThrow(TypeError)
  })

  it('count card orders as paid, and pay-at-the-venue orders once paid at the door', async () => {
    const event = { id: cuid() }
    const order = (id, paymentMethod, status = 'PAID') => ({
      id,
      eventId: event.id,
      paymentMethod,
      status,
      reference: id,
    })
    const card = order('card', 'CARD')
    const unpaid = order('unpaid', 'AT_VENUE')
    const paidAtDoor = order('paid-at-door', 'AT_VENUE')
    const halfPaid = order('half-paid', 'AT_VENUE')
    const pending = order('pending', 'AT_VENUE', 'PENDING')
    const line = (orderRow) => ({ id: `line-${orderRow.id}`, orderId: orderRow.id })
    const ticket = (orderRow, n, extra = {}) => ({
      id: `t-${orderRow.id}-${n}`,
      orderItemId: `line-${orderRow.id}`,
      status: 'VALID',
      venueDueCents: 4000,
      venuePaymentId: null,
      ...extra,
    })
    const prisma = createPrismaStub({
      order: [card, unpaid, paidAtDoor, halfPaid, pending],
      orderItem: [card, unpaid, paidAtDoor, halfPaid, pending].map(line),
      ticket: [
        ticket(card, 1, { venueDueCents: 0 }),
        ticket(unpaid, 1),
        ticket(paidAtDoor, 1, { venuePaymentId: 'vp-1', status: 'CHECKED_IN' }),
        // A share of 0 admits without a payment, so it never waits.
        ticket(paidAtDoor, 2, { venueDueCents: 0 }),
        ticket(halfPaid, 1, { venuePaymentId: 'vp-2', status: 'CHECKED_IN' }),
        ticket(halfPaid, 2),
      ],
      venuePayment: [
        { id: 'vp-1', orderId: paidAtDoor.id, eventId: event.id },
        { id: 'vp-2', orderId: halfPaid.id, eventId: event.id },
      ],
    })

    const ids = async (where) =>
      (await prisma.order.findMany({ where })).map((row) => row.id).sort()

    expect(await ids(PAID_ORDER_WHERE)).toEqual(['card', 'paid-at-door'])
    expect(await ids(BOOKED_UNPAID_ORDER_WHERE)).toEqual(['half-paid', 'unpaid'])
    expect(
      (await prisma.ticket.findMany({ where: UNPAID_VENUE_TICKET_WHERE })).map((row) => row.id),
    ).toEqual(['t-unpaid-1', 't-half-paid-2'])
  })
})

describe('isUnpaidVenueTicket', () => {
  it('is a standing ticket that owes at the door and has no payment', () => {
    expect(isUnpaidVenueTicket({ venueDueCents: 1, venuePaymentId: null, status: 'VALID' })).toBe(
      true,
    )
    expect(
      isUnpaidVenueTicket({ venueDueCents: 1, venuePaymentId: null, status: 'TRANSFER_PENDING' }),
    ).toBe(true)
    expect(isUnpaidVenueTicket({ venueDueCents: 0, venuePaymentId: null, status: 'VALID' })).toBe(
      false,
    )
    expect(isUnpaidVenueTicket({ venueDueCents: 1, venuePaymentId: 'vp', status: 'VALID' })).toBe(
      false,
    )

    for (const status of ['CHECKED_IN', 'TRANSFERRED', 'REVOKED', 'REFUNDED', 'CANCELLED']) {
      expect(isUnpaidVenueTicket({ venueDueCents: 1, venuePaymentId: null, status }), status).toBe(
        false,
      )
    }
  })
})

describe('venuePaymentStateOf', () => {
  it('says TO_PAY while a standing ticket owes, with what is owed and what was paid', () => {
    expect(
      venuePaymentStateOf(
        orderWith({ venueDueCents: 8000 }, [
          { venueDueCents: 4000, venuePaymentId: 'vp', status: 'CHECKED_IN' },
          { venueDueCents: 4000, venuePaymentId: null, status: 'VALID' },
        ]),
      ),
    ).toEqual({
      dueCents: 8000,
      paidCents: 4000,
      unpaidTickets: 1,
      unpaidCents: 4000,
      paidTickets: 1,
      paidByOthersTickets: 0,
      paidByOthersCents: 0,
      passedOnUnpaidTickets: 0,
      passedOnUnpaidCents: 0,
      cancelledTickets: 0,
      cancelledCents: 0,
      feeKeptCents: 0,
      state: 'TO_PAY',
    })
  })

  it('says PAID once nothing standing owes and something was taken at the door', () => {
    expect(
      venuePaymentStateOf(
        orderWith({ venueDueCents: 4000 }, [
          { venueDueCents: 4000, venuePaymentId: 'vp', status: 'CHECKED_IN' },
          { venueDueCents: 0, venuePaymentId: null, status: 'VALID' },
        ]),
      ).state,
    ).toBe('PAID')
  })

  it('says NONE for a card order, and for a refunded booking nothing was paid on', () => {
    expect(
      venuePaymentStateOf(
        orderWith({ venueDueCents: 0 }, [{ venueDueCents: 0, venuePaymentId: null }]),
      ),
    ).toMatchObject({ dueCents: 0, paidCents: 0, unpaidTickets: 0, state: 'NONE' })
    expect(
      venuePaymentStateOf(
        orderWith({ venueDueCents: 4000 }, [
          { venueDueCents: 4000, venuePaymentId: null, status: 'REFUNDED' },
        ]),
      ),
    ).toMatchObject({ dueCents: 4000, unpaidTickets: 0, unpaidCents: 0, state: 'NONE' })
  })

  it('says ENDED, owing nothing, for a booking whose event was cancelled or deleted, its tickets still standing', () => {
    for (const status of ['CANCELLED', 'DELETED']) {
      const order = orderWith(
        { paymentMethod: 'AT_VENUE', venueDueCents: 8000, event: { status } },
        [
          { venueDueCents: 4000, venuePaymentId: null, status: 'VALID' },
          { ownerUserId: OTHER, venueDueCents: 4000, venuePaymentId: null, status: 'VALID' },
        ],
      )

      expect(venuePaymentStateOf(order), status).toMatchObject({
        unpaidTickets: 0,
        unpaidCents: 0,
        passedOnUnpaidTickets: 0,
        passedOnUnpaidCents: 0,
        state: 'ENDED',
      })
    }

    // Read without its event, the caller says the event's status.
    expect(
      venuePaymentStateOf(
        orderWith({ paymentMethod: 'AT_VENUE', venueDueCents: 4000 }, [
          { venueDueCents: 4000, venuePaymentId: null, status: 'VALID' },
        ]),
        { eventStatus: 'CANCELLED' },
      ).state,
    ).toBe('ENDED')
    // Money taken at the door before the event was called off stays counted.
    expect(
      venuePaymentStateOf(
        orderWith(
          { paymentMethod: 'AT_VENUE', venueDueCents: 4000, event: { status: 'CANCELLED' } },
          [{ venueDueCents: 4000, venuePaymentId: 'vp', status: 'VALID' }],
        ),
      ),
    ).toMatchObject({ paidCents: 4000, paidTickets: 1, state: 'ENDED' })
    // An event still on: the same booking owes.
    expect(
      venuePaymentStateOf(
        orderWith(
          { paymentMethod: 'AT_VENUE', venueDueCents: 4000, event: { status: 'ON_SALE' } },
          [{ venueDueCents: 4000, venuePaymentId: null, status: 'VALID' }],
        ),
      ).state,
    ).toBe('TO_PAY')
  })

  it('says ENDED for a booking none of whose tickets holds a place, nothing paid or cancelled unpaid (its night cancelled)', () => {
    expect(
      venuePaymentStateOf(
        orderWith({ paymentMethod: 'AT_VENUE', venueDueCents: 8000 }, [
          { venueDueCents: 4000, venuePaymentId: null, status: 'CANCELLED' },
          { venueDueCents: 4000, venuePaymentId: null, status: 'CANCELLED' },
        ]),
      ),
    ).toMatchObject({ unpaidTickets: 0, state: 'ENDED' })
    // A ticket of $0 still standing keeps it a booking with nothing to pay.
    expect(
      venuePaymentStateOf(
        orderWith({ paymentMethod: 'AT_VENUE', venueDueCents: 4000 }, [
          { venueDueCents: 4000, venuePaymentId: null, status: 'REFUNDED' },
          { venueDueCents: 0, venuePaymentId: null, status: 'VALID' },
        ]),
      ).state,
    ).toBe('NONE')
    // A card order never ends this way.
    expect(
      venuePaymentStateOf(
        orderWith({ paymentMethod: 'CARD', event: { status: 'CANCELLED' } }, [
          { venueDueCents: 0, venuePaymentId: null, status: 'REFUNDED' },
        ]),
      ).state,
    ).toBe('NONE')
  })

  it('keeps money taken at the door on a ticket refunded afterwards', () => {
    expect(
      venuePaymentStateOf(
        orderWith({ venueDueCents: 4000 }, [
          { venueDueCents: 4000, venuePaymentId: 'vp', status: 'REFUNDED' },
        ]),
      ),
    ).toMatchObject({ paidCents: 4000, paidTickets: 1, state: 'PAID' })
  })

  it('refuses an order read without its lines or tickets', () => {
    expect(() => venuePaymentStateOf({ venueDueCents: 4000 })).toThrow(TypeError)
    expect(() => venuePaymentStateOf({ venueDueCents: 4000, items: [{}] })).toThrow(TypeError)
  })

  it('refuses an order read without its buyer, or a ticket without its holder', () => {
    expect(() => venuePaymentStateOf({ venueDueCents: 4000, items: [{ tickets: [] }] })).toThrow(
      /userId/u,
    )
    expect(() =>
      venuePaymentStateOf({
        userId: BUYER,
        venueDueCents: 4000,
        items: [{ tickets: [{ venueDueCents: 4000, venuePaymentId: null, status: 'VALID' }] }],
      }),
    ).toThrow(/ownerUserId/u)
  })

  it('counts passed-on tickets apart: the new holder pays, not the buyer (XT5, XT6)', () => {
    expect(
      venuePaymentStateOf(
        orderWith({ paymentMethod: 'AT_VENUE', venueDueCents: 8000 }, [
          { ownerUserId: OTHER, venueDueCents: 4000, venuePaymentId: null, status: 'VALID' },
          {
            ownerUserId: OTHER,
            venueDueCents: 4000,
            venuePaymentId: null,
            status: 'TRANSFER_PENDING',
          },
          // The predecessor of an accepted hand-on no longer stands.
          { venueDueCents: 4000, venuePaymentId: null, status: 'TRANSFERRED' },
        ]),
      ),
    ).toMatchObject({
      unpaidTickets: 0,
      unpaidCents: 0,
      passedOnUnpaidTickets: 2,
      passedOnUnpaidCents: 8000,
      state: 'PASSED_ON',
    })
  })

  it('counts money paid at the door by people the buyer passed tickets to as theirs (XT7)', () => {
    expect(
      venuePaymentStateOf(
        orderWith({ paymentMethod: 'AT_VENUE', venueDueCents: 12000 }, [
          { ownerUserId: OTHER, venueDueCents: 4000, venuePaymentId: 'vp-1', status: 'CHECKED_IN' },
          { venueDueCents: 4000, venuePaymentId: 'vp-2', status: 'CHECKED_IN' },
          {
            ownerUserId: 'holder-3',
            venueDueCents: 4000,
            venuePaymentId: 'vp-3',
            status: 'REFUNDED',
          },
        ]),
      ),
    ).toMatchObject({
      paidCents: 4000,
      paidTickets: 1,
      paidByOthersCents: 8000,
      paidByOthersTickets: 2,
      state: 'PAID',
    })
    expect(
      venuePaymentStateOf(
        orderWith({ paymentMethod: 'AT_VENUE', venueDueCents: 4000 }, [
          { ownerUserId: OTHER, venueDueCents: 4000, venuePaymentId: 'vp-1', status: 'CHECKED_IN' },
        ]),
      ),
    ).toMatchObject({ paidCents: 0, paidTickets: 0, paidByOthersTickets: 1, state: 'PAID' })
  })

  it('counts tickets cancelled unpaid and the booking fee kept for them', () => {
    expect(
      venuePaymentStateOf(
        orderWith({ paymentMethod: 'AT_VENUE', venueDueCents: 8000, venueFeeKeptCents: 300 }, [
          {
            venueDueCents: 4000,
            venuePaymentId: null,
            venueCancellationId: 'c-1',
            status: 'REVOKED',
          },
          {
            ownerUserId: OTHER,
            venueDueCents: 4000,
            venuePaymentId: null,
            venueCancellationId: 'c-1',
            status: 'REVOKED',
          },
        ]),
      ),
    ).toEqual({
      dueCents: 8000,
      paidCents: 0,
      unpaidTickets: 0,
      unpaidCents: 0,
      paidTickets: 0,
      paidByOthersTickets: 0,
      paidByOthersCents: 0,
      passedOnUnpaidTickets: 0,
      passedOnUnpaidCents: 0,
      cancelledTickets: 2,
      cancelledCents: 8000,
      feeKeptCents: 300,
      state: 'CANCELLED',
    })
  })

  it('takes the states in order: own unpaid, then paid, then passed on, then cancelled', () => {
    const own = { venueDueCents: 1000, venuePaymentId: null, status: 'VALID' }
    const paid = { venueDueCents: 1000, venuePaymentId: 'vp', status: 'CHECKED_IN' }
    const paidByOther = { ...paid, ownerUserId: OTHER }
    const passedOn = { ...own, ownerUserId: OTHER }
    const cancelled = {
      venueDueCents: 1000,
      venuePaymentId: null,
      venueCancellationId: 'c',
      status: 'REVOKED',
    }
    const stateOf = (tickets) =>
      venuePaymentStateOf(orderWith({ paymentMethod: 'AT_VENUE', venueDueCents: 5000 }, tickets))
        .state

    expect(stateOf([own, paid, paidByOther, passedOn, cancelled])).toBe('TO_PAY')
    expect(stateOf([paid, passedOn, cancelled])).toBe('PAID')
    expect(stateOf([paidByOther, passedOn, cancelled])).toBe('PAID')
    expect(stateOf([passedOn, cancelled])).toBe('PASSED_ON')
    expect(stateOf([cancelled])).toBe('CANCELLED')
    expect(stateOf([])).toBe('NONE')
  })

  it('says NONE for a card order, whatever its tickets', () => {
    expect(
      venuePaymentStateOf(
        orderWith({ paymentMethod: 'CARD', venueDueCents: 0 }, [
          { venueDueCents: 0, venuePaymentId: null, status: 'VALID' },
          { ownerUserId: OTHER, venueDueCents: 0, venuePaymentId: null, status: 'VALID' },
        ]),
      ).state,
    ).toBe('NONE')
  })

  it('counts a guest order’s tickets, held by nobody, as the buyer’s own', () => {
    expect(
      venuePaymentStateOf(
        orderWith({ userId: null, paymentMethod: 'AT_VENUE', venueDueCents: 4000 }, [
          { ownerUserId: null, venueDueCents: 4000, venuePaymentId: null, status: 'VALID' },
        ]),
      ),
    ).toMatchObject({ unpaidTickets: 1, passedOnUnpaidTickets: 0, state: 'TO_PAY' })
  })
})

describe('toVenueCancellation', () => {
  const at = new Date('2026-10-09T18:30:00.000Z')
  const row = (overrides = {}) => ({
    id: 'c-1',
    orderId: 'o-1',
    createdAt: at,
    authority: 'ORGANIZATION_ROLE',
    role: 'OWNER',
    cancelledById: 'u-1',
    cancelledBy: { displayName: 'Priya Shah' },
    ticketCount: 2,
    basisCents: 8000,
    feeKeptCents: 300,
    reason: 'Not paid by the second night.',
    ...overrides,
  })

  it('reads the same for buyers, holders and the platform: no name', () => {
    for (const reader of ['BUYER', 'HOLDER', 'PLATFORM']) {
      expect(toVenueCancellation(row(), { reader }), reader).toEqual({
        at: '2026-10-09T18:30:00.000Z',
        by: 'ORGANISER',
        ticketCount: 2,
        basisCents: 8000,
        feeKeptCents: 300,
        reason: 'Not paid by the second night.',
      })
    }

    expect(toVenueCancellation(row({ authority: 'PLATFORM_ROLE' }), { reader: 'BUYER' }).by).toBe(
      'DESI_EVENT',
    )
  })

  it('names who cancelled for organisation readers only (SPEC2 W6)', () => {
    expect(toVenueCancellation(row(), { reader: 'ORGANISATION' })).toMatchObject({
      by: 'ORGANISER',
      byName: 'Priya Shah',
    })
    expect(
      toVenueCancellation(
        row({ authority: 'PLATFORM_ROLE', cancelledBy: { displayName: 'Ravi' } }),
        {
          reader: 'ORGANISATION',
        },
      ),
    ).toMatchObject({ by: 'DESI_EVENT', byName: 'Ravi' })
  })

  it('says "A Desi-Event administrator" once a Desi-Event canceller’s account is gone', () => {
    expect(
      toVenueCancellation(
        row({ authority: 'PLATFORM_ROLE', cancelledById: null, cancelledBy: null }),
        {
          reader: 'ORGANISATION',
        },
      ).byName,
    ).toBe('A Desi-Event administrator')
    expect(
      toVenueCancellation(row({ cancelledById: null, cancelledBy: null }), {
        reader: 'ORGANISATION',
      }).byName,
    ).toBeNull()
  })

  it('refuses an unknown reader, and an organisation reader’s row read without its canceller', () => {
    expect(VENUE_CANCELLATION_READERS).toEqual(['BUYER', 'HOLDER', 'ORGANISATION', 'PLATFORM'])
    expect(() => toVenueCancellation(row(), { reader: 'ORGANISER' })).toThrow(TypeError)
    expect(() => toVenueCancellation(row(), {})).toThrow(TypeError)

    const { cancelledBy: _cancelledBy, ...withoutCanceller } = row()

    expect(() => toVenueCancellation(withoutCanceller, { reader: 'ORGANISATION' })).toThrow(
      /cancelledBy/u,
    )
    expect(toVenueCancellation(withoutCanceller, { reader: 'BUYER' }).by).toBe('ORGANISER')
  })
})
