/**
 * The filters every count of pay-at-the-venue orders uses (SPEC3 §9.10), and
 * the one buyer-facing state they come to (§12.7).
 *
 * A pay-at-the-venue order is PAID once its online part — the booking fee, or
 * nothing — has settled, while its ticket price is still to be paid at the
 * door. So "paid" means two things, and every place that counts orders or
 * shows a buyer where they stand reads it from here rather than spelling it
 * out again:
 *
 *   - an unpaid pay-at-the-venue ticket owes something at the door, has no
 *     payment recorded, and still stands (VALID or TRANSFER_PENDING);
 *   - an order counts as paid when it is a card order, or a pay-at-the-venue
 *     order with a payment taken at the door and no standing ticket still
 *     waiting for one;
 *   - a booked-and-unpaid order is a PAID pay-at-the-venue order with a
 *     standing ticket still waiting.
 *
 * Pure: Prisma `where` objects and one function of an order already read.
 * Nothing here queries the database.
 *
 * @module @desi-event/api/lib/venue-payment-filters
 */

/**
 * Freeze an object and everything in it.
 *
 * @param {*} value The value.
 * @returns {*} The same value, frozen all the way down.
 */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)

    for (const inner of Object.values(value)) deepFreeze(inner)
  }

  return value
}

/** The ticket statuses that still stand: they admit, or will once a hand-on completes. */
export const STANDING_TICKET_STATUSES = deepFreeze(['VALID', 'TRANSFER_PENDING'])

/**
 * A ticket that owes a payment at the door, has none recorded, and still
 * stands. A `Ticket` filter.
 */
export const UNPAID_VENUE_TICKET_WHERE = deepFreeze({
  venueDueCents: { gt: 0 },
  venuePaymentId: null,
  status: { in: [...STANDING_TICKET_STATUSES] },
})

/**
 * An order that counts as paid: a PAID card order, or a PAID pay-at-the-venue
 * order with a payment taken at the door and no standing ticket of it still
 * waiting for one. An `Order` filter, for "Orders paid" in analytics and
 * traffic.
 */
export const PAID_ORDER_WHERE = deepFreeze({
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

/**
 * A PAID pay-at-the-venue order with a standing ticket still waiting for its
 * payment at the door. An `Order` filter.
 */
export const BOOKED_UNPAID_ORDER_WHERE = deepFreeze({
  status: 'PAID',
  paymentMethod: 'AT_VENUE',
  items: { some: { tickets: { some: UNPAID_VENUE_TICKET_WHERE } } },
})

/**
 * Whether one ticket, as read, matches {@link UNPAID_VENUE_TICKET_WHERE}.
 *
 * @param {{venueDueCents?: number, venuePaymentId?: string|null, status?: string}} ticket A ticket row.
 * @returns {boolean} True when it owes a payment at the door, has none, and stands.
 */
export function isUnpaidVenueTicket(ticket) {
  return (
    (ticket.venueDueCents ?? 0) > 0 &&
    (ticket.venuePaymentId ?? null) === null &&
    STANDING_TICKET_STATUSES.includes(ticket.status)
  )
}

/**
 * Where a pay-at-the-venue order stands at the door, from the order and its
 * tickets as read.
 *
 * - `dueCents`: the ticket price after the promo to be paid at the door, as
 *   the order recorded it when it was placed (0 on a card order).
 * - `paidCents`, `paidTickets`: what was taken at the door, and for how many
 *   tickets, whatever became of them since (money taken stays taken).
 * - `unpaidCents`, `unpaidTickets`: what the standing tickets still owe.
 * - `state`: `TO_PAY` while a standing ticket still owes, else `PAID` once
 *   anything was taken at the door, else `NONE`.
 *
 * @param {{venueDueCents?: number, items: Array<{tickets: Array<{venueDueCents?: number, venuePaymentId?: string|null, status?: string}>}>}} order An order with its lines and their tickets.
 * @returns {{dueCents: number, paidCents: number, unpaidTickets: number, unpaidCents: number, paidTickets: number, state: 'TO_PAY'|'PAID'|'NONE'}} The state.
 * @throws {TypeError} For an order read without its lines and tickets: counting none would say "nothing owed" of an order that owes.
 */
export function venuePaymentStateOf(order) {
  if (!order || !Array.isArray(order.items)) {
    throw new TypeError('venuePaymentStateOf needs the order with its lines and their tickets')
  }

  let paidCents = 0
  let paidTickets = 0
  let unpaidCents = 0
  let unpaidTickets = 0

  for (const item of order.items) {
    if (!Array.isArray(item.tickets)) {
      throw new TypeError('venuePaymentStateOf needs each line with its tickets')
    }

    for (const ticket of item.tickets) {
      const due = ticket.venueDueCents ?? 0

      if ((ticket.venuePaymentId ?? null) !== null) {
        paidCents += due
        paidTickets += 1
      } else if (isUnpaidVenueTicket(ticket)) {
        unpaidCents += due
        unpaidTickets += 1
      }
    }
  }

  const state = unpaidTickets > 0 ? 'TO_PAY' : paidTickets > 0 ? 'PAID' : 'NONE'

  return {
    dueCents: order.venueDueCents ?? 0,
    paidCents,
    unpaidTickets,
    unpaidCents,
    paidTickets,
    state,
  }
}
