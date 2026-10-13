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
 * A ticket cancelled unpaid (SPEC3-XI XU, `venueCancellationId` set) is
 * REVOKED, so it is outside every filter here: it no longer stands and owes
 * nothing.
 *
 * Pure: Prisma `where` objects and functions of rows already read. Nothing
 * here queries the database.
 *
 * @module @desi-event/api/lib/venue-payment-filters
 */

import { FORMER_ADMINISTRATOR_NAME } from './website-redirect.js'

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
 * Event statuses under which a booking has nothing left to pay at the door:
 * the event will not happen. A booking whose online part was all kept, or was
 * waived with a referral code, keeps its tickets VALID when its event is
 * cancelled (nothing is refunded, so nothing withdraws them), and they owe
 * nobody anything.
 */
export const ENDED_EVENT_STATUSES = deepFreeze(['CANCELLED', 'DELETED'])

/**
 * An `Event` filter for events whose bookings may still owe at the door: not
 * cancelled, not deleted. Every count of money still to be paid at the door
 * adds it, beside {@link UNPAID_VENUE_TICKET_WHERE} or
 * {@link BOOKED_UNPAID_ORDER_WHERE}, on the order's event.
 */
export const EVENT_STILL_ON_WHERE = deepFreeze({ status: { notIn: [...ENDED_EVENT_STATUSES] } })

/** The ticket statuses that still hold a place: standing, or let in. */
const HELD_TICKET_STATUSES = deepFreeze(['VALID', 'TRANSFER_PENDING', 'CHECKED_IN'])

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
 * tickets as read (SPEC3-XI §4.6).
 *
 * A ticket is the buyer's own while the buyer's account holds it
 * (`ownerUserId` is the order's `userId`); one passed on is held by another
 * account. A ticket paid at the door has been let in, so it can never be
 * passed on again: whoever holds a paid ticket paid for it (XT7).
 *
 * - `dueCents`: the ticket price after the promo to be paid at the door, as
 *   the order recorded it when it was placed (0 on a card order).
 * - `paidCents`, `paidTickets`: what the buyer paid at the door for the
 *   tickets they hold, whatever became of them since (money taken stays
 *   taken).
 * - `paidByOthersCents`, `paidByOthersTickets`: what people the buyer passed
 *   tickets to paid at the door for them. Theirs, not the buyer's.
 * - `unpaidCents`, `unpaidTickets`: what the buyer's own standing tickets
 *   still owe.
 * - `passedOnUnpaidCents`, `passedOnUnpaidTickets`: what standing tickets
 *   another account holds still owe; whoever holds them pays.
 * - `cancelledCents`, `cancelledTickets`: the door price no longer owed for
 *   the tickets cancelled unpaid.
 * - `feeKeptCents`: the booking fee Desi-Event kept for those tickets.
 * - `state`, by precedence: `ENDED` when the order's event was cancelled or
 *   deleted (nothing is owed at the door of an event that will not happen,
 *   whatever was paid there before); else `TO_PAY` while a ticket of the
 *   buyer's own still owes; else `PAID` once anything was taken at the door,
 *   by the buyer or by others; else `PASSED_ON` while a passed-on ticket still
 *   owes; else `CANCELLED` when tickets were cancelled unpaid; else `ENDED`
 *   when the order's tickets were issued and none holds a place any more (its night was
 *   cancelled, or its tickets were refunded or withdrawn); else `NONE`.
 *   Always `NONE` for a card order; `ENDED` only for an order whose
 *   `paymentMethod` is `AT_VENUE`. A booking that ended never reads as paid.
 *
 * The event is the order's own (`order.event.status`) unless `eventStatus` is
 * given; read without either, only the tickets decide. While the event is
 * cancelled or deleted, its standing tickets owe nothing: `unpaid*` and
 * `passedOnUnpaid*` are 0.
 *
 * @param {{paymentMethod?: string, userId: string|null, venueDueCents?: number, venueFeeKeptCents?: number, event?: {status?: string}|null, items: Array<{tickets: Array<{ownerUserId: string|null, venueDueCents?: number, venuePaymentId?: string|null, venueCancellationId?: string|null, status?: string}>}>}} order An order with its buyer, its lines and their tickets.
 * @param {{eventStatus?: string|null}} [options] The event's status, when the order was read without its event.
 * @returns {{dueCents: number, paidCents: number, paidTickets: number, paidByOthersCents: number, paidByOthersTickets: number, unpaidTickets: number, unpaidCents: number, passedOnUnpaidTickets: number, passedOnUnpaidCents: number, cancelledTickets: number, cancelledCents: number, feeKeptCents: number, state: 'TO_PAY'|'PAID'|'PASSED_ON'|'CANCELLED'|'ENDED'|'NONE'}} The state.
 * @throws {TypeError} For an order read without its buyer, lines or tickets, or a ticket read without its holder: counting none would say "nothing owed" of an order that owes, and guessing a holder would tell the buyer of money someone else paid.
 */
export function venuePaymentStateOf(order, { eventStatus } = {}) {
  if (!order || !Array.isArray(order.items)) {
    throw new TypeError('venuePaymentStateOf needs the order with its lines and their tickets')
  }

  if (order.userId === undefined) {
    throw new TypeError('venuePaymentStateOf needs the order with its buyer (userId)')
  }

  const buyer = order.userId ?? null
  // Only a booking known to be paid at the venue can end with nothing to pay.
  const atVenue = order.paymentMethod === 'AT_VENUE'
  const eventEnded = ENDED_EVENT_STATUSES.includes(eventStatus ?? order.event?.status ?? null)
  let held = 0
  let seen = 0
  const counts = {
    paidCents: 0,
    paidTickets: 0,
    paidByOthersCents: 0,
    paidByOthersTickets: 0,
    unpaidCents: 0,
    unpaidTickets: 0,
    passedOnUnpaidCents: 0,
    passedOnUnpaidTickets: 0,
    cancelledCents: 0,
    cancelledTickets: 0,
  }

  for (const item of order.items) {
    if (!Array.isArray(item.tickets)) {
      throw new TypeError('venuePaymentStateOf needs each line with its tickets')
    }

    for (const ticket of item.tickets) {
      if (ticket.ownerUserId === undefined) {
        throw new TypeError('venuePaymentStateOf needs each ticket with its holder (ownerUserId)')
      }

      const due = ticket.venueDueCents ?? 0
      const own = (ticket.ownerUserId ?? null) === buyer

      seen += 1

      if (HELD_TICKET_STATUSES.includes(ticket.status)) held += 1

      if ((ticket.venuePaymentId ?? null) !== null) {
        if (own) {
          counts.paidCents += due
          counts.paidTickets += 1
        } else {
          counts.paidByOthersCents += due
          counts.paidByOthersTickets += 1
        }
      } else if ((ticket.venueCancellationId ?? null) !== null) {
        counts.cancelledCents += due
        counts.cancelledTickets += 1
      } else if (isUnpaidVenueTicket(ticket) && !(eventEnded && atVenue)) {
        if (own) {
          counts.unpaidCents += due
          counts.unpaidTickets += 1
        } else {
          counts.passedOnUnpaidCents += due
          counts.passedOnUnpaidTickets += 1
        }
      }
    }
  }

  let state = 'NONE'

  if (order.paymentMethod === 'CARD') state = 'NONE'
  else if (eventEnded && atVenue) state = 'ENDED'
  else if (counts.unpaidTickets > 0) state = 'TO_PAY'
  else if (counts.paidTickets + counts.paidByOthersTickets > 0) state = 'PAID'
  else if (counts.passedOnUnpaidTickets > 0) state = 'PASSED_ON'
  else if (counts.cancelledTickets > 0) state = 'CANCELLED'
  else if (seen > 0 && held === 0 && atVenue) state = 'ENDED'

  return {
    dueCents: order.venueDueCents ?? 0,
    paidCents: counts.paidCents,
    unpaidTickets: counts.unpaidTickets,
    unpaidCents: counts.unpaidCents,
    paidTickets: counts.paidTickets,
    paidByOthersTickets: counts.paidByOthersTickets,
    paidByOthersCents: counts.paidByOthersCents,
    passedOnUnpaidTickets: counts.passedOnUnpaidTickets,
    passedOnUnpaidCents: counts.passedOnUnpaidCents,
    cancelledTickets: counts.cancelledTickets,
    cancelledCents: counts.cancelledCents,
    feeKeptCents: order.venueFeeKeptCents ?? 0,
    state,
  }
}

/** Who reads a cancellation of unpaid tickets (SPEC3-XI §4.6). */
export const VENUE_CANCELLATION_READERS = deepFreeze([
  'BUYER',
  'HOLDER',
  'ORGANISATION',
  'PLATFORM',
])

/**
 * One cancellation of unpaid tickets (a `VenueBookingCancellation` row), as
 * the order presenters and the report show it (SPEC3-XI §4.6, §11.2): when,
 * by the organiser or the Desi-Event team, how many tickets, the door price no
 * longer owed, the booking fee kept, and the reason given.
 *
 * Only organisation readers get `byName` (SPEC2 W6): the canceller's display
 * name, or "A Desi-Event administrator" for a Desi-Event cancellation whose
 * administrator's account is gone (null for an organiser's account gone).
 * Buyers, holders and the platform's own pages get no name.
 *
 * @param {{createdAt: Date|string, authority: string, cancelledById?: string|null, cancelledBy?: {displayName?: string|null}|null, ticketCount: number, basisCents: number, feeKeptCents: number, reason: string}} row The row; with `cancelledBy` included for an organisation reader.
 * @param {{reader: 'BUYER'|'HOLDER'|'ORGANISATION'|'PLATFORM'}} options Who reads it.
 * @returns {{at: string, by: 'ORGANISER'|'DESI_EVENT', byName?: string|null, ticketCount: number, basisCents: number, feeKeptCents: number, reason: string}} The cancellation.
 * @throws {TypeError} For an unknown reader, or an organisation reader's row read without its canceller.
 */
export function toVenueCancellation(row, { reader } = {}) {
  if (!VENUE_CANCELLATION_READERS.includes(reader)) {
    throw new TypeError(
      `toVenueCancellation reads for one of ${VENUE_CANCELLATION_READERS.join(', ')}`,
    )
  }

  if (!row || typeof row !== 'object') {
    throw new TypeError('toVenueCancellation needs a cancellation row')
  }

  const by = row.authority === 'PLATFORM_ROLE' ? 'DESI_EVENT' : 'ORGANISER'
  const cancellation = {
    at: new Date(row.createdAt).toISOString(),
    by,
    ticketCount: row.ticketCount,
    basisCents: row.basisCents,
    feeKeptCents: row.feeKeptCents,
    reason: row.reason,
  }

  if (reader !== 'ORGANISATION') return cancellation

  if (row.cancelledBy === undefined && (row.cancelledById ?? null) !== null) {
    throw new TypeError('toVenueCancellation needs the row with its canceller (cancelledBy)')
  }

  const name = row.cancelledBy?.displayName ?? null

  return {
    ...cancellation,
    byName: name ?? (by === 'DESI_EVENT' ? FORMER_ADMINISTRATOR_NAME : null),
  }
}
