/**
 * Paying at the venue: whether it is offered, and the one limit on how many
 * tickets may wait to be paid at the door (SPEC3 §6.4 as SPEC3-XI §3 §6.4
 * replaces it).
 *
 * A booking to pay at the venue takes its places when its online part — the
 * booking fee, or nothing at all with a referral code — settles, while its
 * ticket price is still to be paid at the door. Without a ceiling, free
 * accounts and a fee-waiving code could hold a whole event for nothing. So an
 * administrator sets, per event, the most tickets that may be booked to pay at
 * the venue and still be unpaid at one time, across all buyers. There is no
 * limit per account (the owner's answer to open question 1): one account can
 * book up to the event's limit, and the event's limit and cancelling unpaid
 * tickets are what bound that.
 *
 * ## Race-safe counting
 *
 * Every pay-at-the-venue order of an event takes the event's advisory lock
 * (`pg_advisory_xact_lock`) in its first transaction, so two such orders take
 * turns until the first commits. The unpaid tickets are then counted in **one
 * statement** — one snapshot under READ COMMITTED — so an order settling
 * between two reads can never be counted in neither: a PENDING order counts the
 * tickets its lines will carry a share for (`unitsWithShare`), a PAID one its
 * standing tickets that owe at the door and have no payment. Settlement moves
 * an order from PENDING to PAID and issues its tickets in one transaction, so
 * the statement sees it one way or the other, never both or neither. A ticket
 * cancelled unpaid is REVOKED and not counted; a ticket handed on counts once.
 *
 * The advisory lock is the last lock a checkout takes (SPEC3-XI §2.1 row 11),
 * after its referral code.
 *
 * @module @desi-event/api/lib/venue-booking-limits
 */

import { BOOKABLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { paymentTermsRefusal } from './errors.js'

/**
 * Whether buyers may pay the ticket price at the door for this event now
 * (SPEC3 DV2, without the basket's own condition): the switch is on, the event
 * is bookable, it is not online and it is not held by the platform-held
 * organisation (an imported event: nobody takes money at its door).
 *
 * @param {object} event An event with its `venuePaymentEnabled`, `status`, `isOnline` and, when loaded, `organization.platformHeldSource`.
 * @returns {boolean} True when the choice is offered.
 */
export function venuePaymentAvailable(event) {
  return (
    event?.venuePaymentEnabled === true &&
    BOOKABLE_STATUSES.has(event.status) &&
    event.isOnline !== true &&
    !event.organization?.platformHeldSource
  )
}

/**
 * How many tickets of an event wait to be paid at the door: one statement over
 * its pay-at-the-venue orders still PENDING (the tickets their lines will
 * carry a share for) and PAID (their standing unpaid tickets). Nothing is
 * counted per account.
 *
 * The SQL carries the marker `venue-booking-count`, by which the test double
 * recognises it.
 *
 * @param {object} tx A transaction client.
 * @param {string} eventId The event.
 * @returns {Promise<number>} The count.
 */
export async function unpaidVenueTickets(tx, eventId) {
  // The event's id is the statement's one value (`e`), so the two counts read
  // one snapshot of one event.
  const rows = await tx.$queryRaw`
    SELECT (
      COALESCE((
        SELECT SUM(LEAST(i."quantity", i."venueDueCents"))
        FROM "OrderItem" i
        JOIN "Order" o ON o."id" = i."orderId"
        WHERE o."eventId" = e."id"
          AND o."paymentMethod" = 'AT_VENUE'
          AND o."status" = 'PENDING'
      ), 0)
      + (
        SELECT COUNT(*)
        FROM "Ticket" t
        JOIN "OrderItem" i ON i."id" = t."orderItemId"
        JOIN "Order" o ON o."id" = i."orderId"
        WHERE o."eventId" = e."id"
          AND o."paymentMethod" = 'AT_VENUE'
          AND o."status" = 'PAID'
          AND t."venueDueCents" > 0
          AND t."venuePaymentId" IS NULL
          AND t."status" IN ('VALID', 'TRANSFER_PENDING')
      )
    )::int AS "eventUnpaid"
    FROM (SELECT ${eventId}::text AS "id") e /* venue-booking-count */`

  return Number(rows?.[0]?.eventUnpaid ?? 0)
}

/**
 * Refuse a pay-at-the-venue order that would take the event past its limit
 * (SPEC3-XI §3 §6.4). Call in the order's first transaction, after the
 * referral code's lock: it takes the event's advisory lock, held until the
 * transaction ends.
 *
 * The limit is read again under the lock: a lower limit saved since the order
 * was priced applies to it.
 *
 * @param {object} tx A transaction client.
 * @param {object} params Inputs.
 * @param {{id: string}} params.event The event.
 * @param {number} params.adding The tickets this order adds that carry a share (`Σ unitsWithShare`).
 * @returns {Promise<{eventUnpaid: number, limit: number}>} What was counted, for tests.
 * @throws {Error} 409 `VENUE_PAYMENT_FULL` when the event's limit would be passed. No count is disclosed.
 */
export async function assertVenueBookingLimits(tx, { event, adding }) {
  if (!event?.id) throw new TypeError('assertVenueBookingLimits needs the event')
  if (!Number.isInteger(adding) || adding < 0) {
    throw new TypeError('assertVenueBookingLimits needs a whole number of tickets to add')
  }

  // A statement, not a query: the lock function returns `void`, which a
  // query cannot hand back as a column.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('venue-booking:' || ${event.id}::text, 0))`

  const eventUnpaid = await unpaidVenueTickets(tx, event.id)
  const current = await tx.event.findUnique({
    where: { id: event.id },
    select: { venuePaymentLimit: true },
  })
  const limit = current?.venuePaymentLimit ?? 0

  if (eventUnpaid + adding > limit) throw paymentTermsRefusal('VENUE_PAYMENT_FULL')

  return { eventUnpaid, limit }
}
