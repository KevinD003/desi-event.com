/**
 * Money taken at the door for tickets booked to pay at the venue (SPEC3 §9),
 * and what is reported of it.
 *
 * ## Not platform money
 *
 * A payment taken at the door never passes through Desi-Event: the organiser
 * holds it. So nothing here posts to the ledger, counts it as owed to an
 * organiser or refunds it. It is recorded in its own table (`VenuePayment`) so
 * the organiser can count their takings against it, and every report says
 * whose money it is.
 *
 * ## Recorded only with the admission it pays for
 *
 * The steward records a payment in the same transaction that lets the tickets
 * it pays for in — one ticket through the single door, several through the
 * order's group pass (`./admission.js`, `./group-admission.js`). A payment
 * cannot be recorded for a ticket that is not being let in, and it cannot be
 * undone, as an admission cannot. This module is the only writer of
 * `VenuePayment` and of `Ticket.venuePaymentId`: the payment row first, then
 * each ticket pointed at it under a conditional update (`venuePaymentId IS
 * NULL`), whose count must be every ticket named. The database holds the rest
 * for any writer: `desi_ticket_venue_payment_guard` (a ticket of this order,
 * owing something, not cancelled, never re-pointed), the append-only trigger,
 * and the deferred `venue_payment_sum` on both sides (the payment equals the
 * dues of exactly its tickets, at commit and for ever).
 *
 * ## Whoever holds a paid ticket paid for it
 *
 * A ticket booked to pay at the door can be passed on (the owner's answer to
 * open question 7); its new holder pays at the door. A paid ticket has been let
 * in and is never passed on again, so the account holding it is the account
 * that paid (SPEC3-XI XT7). The door tells a holder only about the tickets that
 * account holds, and the group pass covers only the buyer's own.
 *
 * @module @desi-event/api/lib/venue-payments
 */

import { CAPABILITIES } from '@desi-event/permissions'
import { formatMoney } from '@desi-event/pricing'
import { buildPaginationMeta, toSkipTake, withoutAddresses } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { paymentTermsRefusal } from './errors.js'
import { memberHolds, platformHolds } from './event-authority.js'
import { venueCancellationAuthority } from './venue-bookings.js'
import {
  BOOKED_UNPAID_ORDER_WHERE,
  ENDED_EVENT_STATUSES,
  EVENT_STILL_ON_WHERE,
  STANDING_TICKET_STATUSES,
  UNPAID_VENUE_TICKET_WHERE,
  isUnpaidVenueTicket,
  toVenueCancellation,
} from './venue-payment-filters.js'

/** How a payment taken at the door is recorded (`VenuePaymentVia`). */
export const VENUE_PAYMENT_VIA = Object.freeze({
  DOOR_TICKET: 'DOOR_TICKET',
  DOOR_GROUP: 'DOOR_GROUP',
})

/** Order statuses whose bookings were refunded or cancelled: their door money is the organiser's to return. */
const ENDED_ORDER_STATUSES = Object.freeze(['REFUNDED', 'CANCELLED'])

/** How many cancellations of unpaid tickets the report lists (SPEC3-XI §9.8). */
export const REPORT_CANCELLATIONS_LIMIT = 50

/**
 * An amount as a steward or a buyer reads it in a sentence: `$40.00`.
 *
 * @param {number} cents Integer cents.
 * @param {string} currency ISO-4217 code.
 * @returns {string} The formatted amount.
 */
export function doorAmount(cents, currency) {
  return formatMoney(cents, currency || 'USD', 'en-US')
}

/**
 * The sum of the dues of some tickets.
 *
 * @param {Array<{venueDueCents?: number}>} tickets Ticket rows.
 * @returns {number} Cents.
 */
function dueOf(tickets) {
  return tickets.reduce((sum, ticket) => sum + (ticket.venueDueCents ?? 0), 0)
}

/**
 * What a door is told about a ticket's payment at the door (SPEC3 §9.3,
 * SPEC3-XI §9.3), from the ticket as the door read it.
 *
 * - null: the ticket owes nothing there (a card order, a $0 share), or it no
 *   longer stands (refunded, withdrawn, cancelled unpaid): nothing to take.
 * - `{ paid: true }`: paid at the door already (an every-night pass let in on
 *   an earlier night).
 * - `{ paid: false, booking }`: what to take, and, for information, the
 *   order's other standing unpaid tickets held by the same account as this
 *   one, and whether that account is the buyer (whose group pass covers them).
 *   A ticket passed on is held by somebody else, who pays with their own.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object} ticket A ticket with its order (`orderItem.order`: `id`, `userId`, `currency`).
 * @returns {Promise<object|null>} An `admissionPaymentSchema` payload, or null.
 */
export async function paymentDueForPreview(db, ticket) {
  const due = ticket?.venueDueCents ?? 0

  if (due <= 0) return null

  const order = ticket.orderItem?.order ?? null
  const currency = order?.currency ?? 'USD'

  if (ticket.venuePaymentId) return { dueCents: due, currency, paid: true }

  if (!STANDING_TICKET_STATUSES.includes(ticket.status) || !order) return null

  const holder = ticket.ownerUserId ?? null
  const others = await db.ticket.findMany({
    where: {
      ...UNPAID_VENUE_TICKET_WHERE,
      id: { not: ticket.id },
      ownerUserId: holder,
      orderItem: { orderId: order.id },
    },
    select: { id: true, venueDueCents: true },
  })

  return {
    dueCents: due,
    currency,
    paid: false,
    booking: {
      otherUnpaidTickets: others.length,
      otherUnpaidCents: dueOf(others),
      groupPass: holder !== null && holder === (order.userId ?? null),
    },
  }
}

/**
 * Record one payment taken at the door for tickets being let in now, in the
 * admitting transaction (SPEC3 §9.3, §9.5).
 *
 * The caller holds the order (`FOR SHARE`) and the tickets (`FOR UPDATE`),
 * and has checked that every ticket owes, has no payment, stands, and is about
 * to be admitted, and that the amount equals their dues. The row is written
 * first, then every ticket is pointed at it under `venuePaymentId IS NULL`:
 * a count short of the tickets named means the booking changed meanwhile,
 * and the whole admission is rolled back with 409 `PAYMENT_NOT_RECORDED`.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {{id: string, currency: string}} options.order The order.
 * @param {{id: string, organizationId: string}} options.event Its event.
 * @param {Array<{id: string, venueDueCents: number}>} options.tickets The tickets it pays for.
 * @param {number} options.amountCents What was taken: the tickets' dues together.
 * @param {string|null} options.actorId The steward.
 * @param {string} options.authority The door authority (`ORGANIZATION_ROLE`, `EVENT_SCOPE`, `PLATFORM_ROLE`).
 * @param {string} options.role The role it came with.
 * @param {string|null} options.eventSessionId The night it was taken on.
 * @param {'DOOR_TICKET'|'DOOR_GROUP'} options.via One ticket or the group pass.
 * @param {string|null} [options.gate] The door.
 * @param {Date} options.now The instant.
 * @returns {Promise<object>} The `VenuePayment` row.
 * @throws {Error} 409 `PAYMENT_NOT_RECORDED` when the tickets changed meanwhile.
 */
export async function recordVenuePayment(tx, options) {
  const {
    order,
    event,
    tickets,
    amountCents,
    actorId,
    authority,
    role,
    eventSessionId,
    via,
    gate = null,
    now,
  } = options

  if (!Object.hasOwn(VENUE_PAYMENT_VIA, via)) throw new TypeError(`Unknown payment route: ${via}`)

  // Never a payment that does not match its tickets: the deferred sum would
  // refuse it at commit anyway, and this says why before anything is written.
  if (tickets.length === 0 || dueOf(tickets) !== amountCents || amountCents <= 0) {
    throw paymentTermsRefusal('PAYMENT_NOT_RECORDED')
  }

  const payment = await tx.venuePayment.create({
    data: {
      orderId: order.id,
      eventId: event.id,
      eventSessionId: eventSessionId ?? null,
      organizationId: event.organizationId,
      amountCents,
      currency: order.currency,
      ticketCount: tickets.length,
      via,
      authority,
      role,
      recordedById: actorId ?? null,
      recordedAt: now,
      gate,
    },
  })

  const ids = tickets.map((ticket) => ticket.id).sort()
  const { count } = await tx.ticket.updateMany({
    where: { id: { in: ids }, venuePaymentId: null, venueCancellationId: null },
    data: { venuePaymentId: payment.id },
  })

  if (count !== ids.length) throw paymentTermsRefusal('PAYMENT_NOT_RECORDED')

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.VENUE_PAYMENT_RECORDED,
    entityType: 'VenuePayment',
    entityId: payment.id,
    actorId: actorId ?? null,
    // Ids, amounts and the door's authority. Never the buyer, never a pass.
    metadata: {
      venuePaymentId: payment.id,
      orderId: order.id,
      eventId: event.id,
      eventSessionId: eventSessionId ?? null,
      ticketCount: ids.length,
      amountCents,
      currency: order.currency,
      via,
      authority,
      role,
      organizationId: event.organizationId,
    },
  })

  return payment
}

/**
 * Whether a ticket line is for one night: its tier names the night, or the
 * ticket holds a seat on it.
 *
 * @param {object} item An order line with `ticketType.eventSessionId`.
 * @param {object} ticket One of its tickets, with `eventSeat.eventSessionId`.
 * @param {string} sessionId The night.
 * @returns {boolean} True when the ticket is for that night.
 */
function ticketOnNight(item, ticket, sessionId) {
  return (
    (ticket.eventSeat?.eventSessionId ?? null) === sessionId ||
    (item.ticketType?.eventSessionId ?? null) === sessionId
  )
}

/**
 * What a deletion, an event cancellation or a night cancellation touches of
 * pay-at-the-venue bookings (SPEC3 §9.7): how many such paid orders, and what
 * was taken at the door for their tickets, which stays with the organiser.
 * For a night, the orders with a ticket for that night and those tickets.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object} options Options.
 * @param {string} options.eventId The event.
 * @param {string|null} [options.sessionId] The night, or null for the whole event.
 * @returns {Promise<{orders: number, ticketsPaidAtDoor: number, paidAtDoorCents: number}>} The facts.
 */
export async function atVenueFacts(db, { eventId, sessionId = null }) {
  const orders = await db.order.findMany({
    where: { eventId, paymentMethod: 'AT_VENUE', status: 'PAID' },
    select: {
      id: true,
      items: {
        select: {
          ticketType: { select: { eventSessionId: true } },
          tickets: {
            select: {
              venueDueCents: true,
              venuePaymentId: true,
              eventSeat: { select: { eventSessionId: true } },
            },
          },
        },
      },
    },
  })

  let touched = 0
  let ticketsPaidAtDoor = 0
  let paidAtDoorCents = 0

  for (const order of orders) {
    let counted = sessionId === null

    for (const item of order.items ?? []) {
      for (const ticket of item.tickets ?? []) {
        if (sessionId !== null && !ticketOnNight(item, ticket, sessionId)) continue

        counted = true

        if (ticket.venuePaymentId) {
          ticketsPaidAtDoor += 1
          paidAtDoorCents += ticket.venueDueCents ?? 0
        }
      }
    }

    if (counted) touched += 1
  }

  return { orders: touched, ticketsPaidAtDoor, paidAtDoorCents }
}

/**
 * Who reads an event's payments at the venue, and as what (SPEC3 §9.8): a
 * member whose role holds `finance:view` in the event's organisation, as the
 * organisation; else a platform role holding `finance:view`, as the platform;
 * else nobody (the route answers 404). Membership is read first.
 *
 * @param {object} actor The request actor.
 * @param {string} organizationId The event's organisation.
 * @returns {'ORGANISATION'|'PLATFORM'|null} The reader.
 */
export function venuePaymentReader(actor, organizationId) {
  if (memberHolds(actor, CAPABILITIES.FINANCE_VIEW, organizationId)) return 'ORGANISATION'
  if (platformHolds(actor, CAPABILITIES.FINANCE_VIEW)) return 'PLATFORM'

  return null
}

/**
 * Whether an actor may cancel unpaid tickets of an event's bookings
 * (SPEC3-XI XU2): their membership in the event's organisation grants
 * `order:refund` (OWNER, ADMIN); or they hold no membership there and their
 * platform role holds `venue_booking:cancel` (ADMIN, SUPER_ADMIN). A platform
 * administrator whose membership grants less does not act on their own
 * organisation's bookings with platform authority (`CONFLICT_OF_INTEREST`).
 *
 * @param {object} actor The request actor.
 * @param {string} organizationId The event's organisation.
 * @returns {boolean} True when they may.
 */
export function mayCancelUnpaid(actor, organizationId) {
  const authority = venueCancellationAuthority(actor, { organizationId })

  return Boolean(authority?.authority)
}

/**
 * Whether an event's last night is over: its last night not cancelled has
 * ended, or, for an event with no nights left, the event has.
 *
 * @param {object} event The event, with `endsAt` and `sessions`.
 * @param {Date} now The instant.
 * @returns {boolean} True when it is over.
 */
export function eventEnded(event, now) {
  const nights = (event.sessions ?? []).filter((night) => night.status !== 'CANCELLED')
  const ends = nights.length > 0 ? nights.map((night) => night.endsAt) : [event.endsAt]
  const last = Math.max(...ends.filter(Boolean).map((value) => new Date(value).getTime()))

  return Number.isFinite(last) && last <= now.getTime()
}

/**
 * A night's label for a report, or null when it has none.
 *
 * @param {{label?: string|null}|null} session The night.
 * @returns {string|null} The label.
 */
function nightLabel(session) {
  const label = typeof session?.label === 'string' ? session.label.trim() : ''

  return label === '' ? null : label
}

/**
 * The currency an event's report is in: its tiers', else its bookings', else
 * US dollars (every event sells in one currency).
 *
 * @param {object} db A Prisma client.
 * @param {string} eventId The event.
 * @returns {Promise<string>} The ISO-4217 code.
 */
async function reportCurrency(db, eventId) {
  const tier = await db.ticketType.findFirst({
    where: { eventId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { currency: true },
  })

  if (tier?.currency) return tier.currency

  const order = await db.order.findFirst({
    where: { eventId, paymentMethod: 'AT_VENUE' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { currency: true },
  })

  return order?.currency ?? 'USD'
}

/**
 * An event's payments taken at the door and its bookings still unpaid there,
 * for the organiser's "Payments at the venue" page (SPEC3 §9.8, SPEC3-XI
 * §9.8). The caller has decided who reads it ({@link venuePaymentReader}).
 *
 * Figures: the tickets booked to pay at the door and not paid (the buyer's and
 * those passed on alike) and what they owe; the payments taken (amount,
 * tickets, records); after the event's last night, the tickets not paid by
 * the end; what was taken at the door on bookings later refunded or cancelled
 * (the organiser returns it themselves); and the unpaid tickets cancelled, the
 * door price no longer owed for them and the booking fee kept. Then a page of
 * payments and of bookings with unpaid tickets, the newest cancellations, and
 * whether the reader may cancel unpaid tickets. No addresses: attendee names
 * as the door shows them, buyers' names with any address hidden.
 *
 * @param {object} db A Prisma client.
 * @param {object} options Options.
 * @param {object} options.event The event, with `id`, `organizationId`, `status`, `endsAt` and `sessions`.
 * @param {object} options.actor The request actor.
 * @param {'ORGANISATION'|'PLATFORM'} options.reader Who reads it.
 * @param {number} [options.page] The page, from 1.
 * @param {number} [options.perPage] Rows per page.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<object>} A `venuePaymentsReportSchema` payload.
 */
export async function venuePaymentsReport(db, options) {
  const { event, actor, reader, page = 1, perPage = 20, now = new Date() } = options
  const { skip, take } = toSkipTake({ page, perPage })
  const ended = eventEnded(event, now)
  // A cancelled or deleted event's bookings owe nothing at the door: the
  // event will not happen, whatever their tickets' status says.
  const unpaidWhere = {
    ...UNPAID_VENUE_TICKET_WHERE,
    orderItem: {
      order: {
        eventId: event.id,
        status: 'PAID',
        paymentMethod: 'AT_VENUE',
        event: EVENT_STILL_ON_WHERE,
      },
    },
  }
  const refundedWhere = ENDED_EVENT_STATUSES.includes(event.status)
    ? { eventId: event.id }
    : { eventId: event.id, order: { status: { in: [...ENDED_ORDER_STATUSES] } } }
  const ordersWhere = {
    ...BOOKED_UNPAID_ORDER_WHERE,
    eventId: event.id,
    event: EVENT_STILL_ON_WHERE,
  }

  const [
    currency,
    unpaid,
    taken,
    takenOnRefunded,
    cancelled,
    paymentRows,
    paymentsTotal,
    orderRows,
    ordersTotal,
    cancellationRows,
  ] = await Promise.all([
    reportCurrency(db, event.id),
    db.ticket.findMany({ where: unpaidWhere, select: { id: true, venueDueCents: true } }),
    db.venuePayment.aggregate({
      where: { eventId: event.id },
      _sum: { amountCents: true, ticketCount: true },
      _count: true,
    }),
    db.venuePayment.aggregate({ where: refundedWhere, _sum: { amountCents: true } }),
    db.venueBookingCancellation.aggregate({
      where: { eventId: event.id },
      _sum: { ticketCount: true, basisCents: true, feeKeptCents: true },
    }),
    db.venuePayment.findMany({
      where: { eventId: event.id },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
      include: {
        order: { select: { reference: true } },
        eventSession: { select: { label: true } },
        recordedBy: { select: { displayName: true } },
        tickets: {
          select: { id: true, attendeeName: true, venueDueCents: true },
          orderBy: { id: 'asc' },
        },
      },
    }),
    db.venuePayment.count({ where: { eventId: event.id } }),
    db.order.findMany({
      where: ordersWhere,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip,
      take,
      select: {
        reference: true,
        buyerName: true,
        items: {
          select: {
            tickets: {
              select: { venueDueCents: true, venuePaymentId: true, status: true },
            },
          },
        },
      },
    }),
    db.order.count({ where: ordersWhere }),
    db.venueBookingCancellation.findMany({
      where: { eventId: event.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: REPORT_CANCELLATIONS_LIMIT + 1,
      include: {
        order: { select: { reference: true } },
        cancelledBy: { select: { displayName: true } },
      },
    }),
  ])

  const unpaidCents = dueOf(unpaid)
  const toCancellationReader = reader === 'ORGANISATION' ? 'ORGANISATION' : 'PLATFORM'

  return {
    currency,
    summary: {
      unpaidTickets: unpaid.length,
      unpaidCents,
      paidAtDoorTickets: taken._sum?.ticketCount ?? 0,
      paidAtDoorCents: taken._sum?.amountCents ?? 0,
      payments: typeof taken._count === 'number' ? taken._count : (taken._count?._all ?? 0),
      eventEnded: ended,
      // Unpaid tickets cannot have been let in: a ticket owing a payment is
      // admitted only with it. So after the last night every unpaid ticket
      // is one nobody paid for by the end.
      notPaidByEndTickets: ended ? unpaid.length : 0,
      notPaidByEndCents: ended ? unpaidCents : 0,
      paidOnRefundedCents: takenOnRefunded._sum?.amountCents ?? 0,
      cancelledUnpaidTickets: cancelled._sum?.ticketCount ?? 0,
      cancelledUnpaidCents: cancelled._sum?.basisCents ?? 0,
      feeKeptCents: cancelled._sum?.feeKeptCents ?? 0,
    },
    payments: paymentRows.map((row) => ({
      id: row.id,
      recordedAt: row.recordedAt,
      nightLabel: nightLabel(row.eventSession),
      recordedByName: row.recordedBy?.displayName ?? null,
      orderReference: row.order.reference,
      ticketCount: row.ticketCount,
      amountCents: row.amountCents,
      via: row.via,
      tickets: (row.tickets ?? []).map((ticket) => ({
        ticketId: ticket.id,
        attendeeName: withoutAddresses(ticket.attendeeName ?? null),
        amountCents: ticket.venueDueCents,
      })),
    })),
    unpaidOrders: orderRows.map((row) => {
      const tickets = (row.items ?? []).flatMap((item) => item.tickets ?? [])
      const owing = tickets.filter(isUnpaidVenueTicket)

      return {
        orderReference: row.reference,
        buyerName: withoutAddresses(row.buyerName ?? '') ?? '',
        unpaidTickets: owing.length,
        unpaidCents: dueOf(owing),
      }
    }),
    cancellations: cancellationRows.slice(0, REPORT_CANCELLATIONS_LIMIT).map((row) => {
      const cancellation = toVenueCancellation(row, { reader: toCancellationReader })

      return {
        id: row.id,
        at: cancellation.at,
        by: cancellation.by,
        byName: cancellation.byName ?? null,
        orderReference: row.order.reference,
        ticketCount: row.ticketCount,
        basisCents: row.basisCents,
        reason: row.reason,
      }
    }),
    cancellationsHasMore: cancellationRows.length > REPORT_CANCELLATIONS_LIMIT,
    canCancelUnpaid: mayCancelUnpaid(actor, event.organizationId),
    pagination: buildPaginationMeta({
      page,
      perPage,
      total: Math.max(paymentsTotal, ordersTotal),
    }),
  }
}
