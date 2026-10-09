/**
 * The filters every count of pay-at-the-venue orders uses, and the one state
 * a buyer reads (SPEC3 §9.10, §12.7). The filters are checked against the
 * stub's rows here and against PostgreSQL in
 * `tests/payment-terms-foundation-integration.test.js`.
 */

import { describe, expect, it } from 'vitest'

import { createPrismaStub, cuid } from '../../tests/helpers/prisma-stub.js'
import {
  BOOKED_UNPAID_ORDER_WHERE,
  PAID_ORDER_WHERE,
  STANDING_TICKET_STATUSES,
  UNPAID_VENUE_TICKET_WHERE,
  isUnpaidVenueTicket,
  venuePaymentStateOf,
} from './venue-payment-filters.js'

/**
 * An order with one line and its tickets, in the shape a read with
 * `items: { include: { tickets: true } }` returns.
 *
 * @param {object} order Order columns.
 * @param {object[]} tickets Ticket columns.
 * @returns {object} The order.
 */
function orderWith(order, tickets) {
  return { venueDueCents: 0, ...order, items: [{ tickets }] }
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
})
