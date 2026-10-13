/**
 * Cancelling unpaid pay-at-the-venue tickets (SPEC3-XI XU1–XU14, §2.2), and
 * the list of bookings still waiting to be paid at the door.
 *
 * The owner's answer to open question 2: "The admin keeps the platform fee and
 * rest is paid to the buyer." An organiser who may refund the organisation's
 * orders (OWNER, ADMIN) or a Desi-Event administrator (ADMIN, SUPER_ADMIN)
 * cancels chosen unpaid tickets of one booking. Each one stops admitting
 * (REVOKED, `venue-unpaid:<cancellationId>`, its pass dead, an open offer to
 * pass it on withdrawn); its place is freed — a reserved seat becomes
 * AVAILABLE, a general-admission place goes back to its tier's stock — and
 * sells again whenever its sales are open; nobody owes its door price any
 * more; and Desi-Event keeps the share of the booking fee paid online for it,
 * for good. The rest would be the tax on that share, which is 0 on every
 * pay-at-the-venue booking of this build (open question 9), so nothing is
 * refunded and nothing is posted to the ledger; a booking that does carry tax
 * on its fee is refused (`VENUE_CANCEL_TAXED`) until that refund is built.
 *
 * ## The only writer
 *
 * This module alone writes `VenueBookingCancellation`, `Ticket.venueCancellationId`,
 * `OrderItem.venueCancelledQuantity`, `Order.venueCancelledBasisCents` and
 * `Order.venueFeeKeptCents`, and it is the only code anywhere that lowers
 * `TicketType.quantitySold` (XU5): settlement counts each place once, a
 * cancelled ticket can never move again (REVOKED is final, its cancellation
 * is set once), and the count falls under the tier's own lock, which every
 * checkout and hold takes before it reads the count. So it cannot oversell.
 *
 * ## Locks (SPEC3-XI §2.1, §2.2)
 *
 * The tiers of the named tickets (sorted, `FOR UPDATE`), their nights and
 * the order's own (`FOR KEY SHARE`, sorted), the order (`FOR UPDATE`), the tickets' order
 * lines (sorted, `FOR UPDATE`), the tickets (sorted, `FOR UPDATE`); then
 * everything is decided again from rows read under those locks, and written:
 * the cancellation, the tickets, their pending offers, the seats, the tiers'
 * counts, the lines' and the order's sums; then the referral use, when the
 * booking has now ended (`settleReferralUsesIfEnded`, whose code is the last
 * lock of the transaction); then the notices and the audit row. The door,
 * refunds, transfer acceptance, night cancellation, deletion, checkout and
 * settlement all take the rows they share with it in the same order.
 *
 * @module @desi-event/api/lib/venue-bookings
 */

import { salesWindowState } from '@desi-event/inventory'
import { isSuppressible } from '@desi-event/notifications'
import { CAPABILITIES, ORG_ROLE_CAPABILITIES } from '@desi-event/permissions'
import { buildPaginationMeta, toSkipTake, withoutAddresses } from '@desi-event/schemas'
import { BOOKABLE_STATUSES, LIVE_STATUSES } from '@desi-event/schemas/lifecycle'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { PAYMENT_TERMS_SENTENCES, forbidden, notFound, paymentTermsRefusal } from './errors.js'
import { memberHolds, platformHolds } from './event-authority.js'
import { lockTicketTypes } from './inventory.js'
import { settleReferralUsesIfEnded } from './referral-uses.js'
import { orderBasis, orderParts, partsLeft, partsSpokenFor } from './refunds.js'
import { sessionWindowState } from './session-inventory.js'
import { VENUE_UNPAID_PREFIX } from './tickets.js'
import { TRANSACTION_BUDGETS, budgetedTransaction } from './transaction-budget.js'
import { BOOKED_UNPAID_ORDER_WHERE, toVenueCancellation } from './venue-payment-filters.js'

/** The template the buyer and the other holders are told with (SPEC3-XI §9.9). */
export const VENUE_BOOKING_CANCELLED_TEMPLATE = 'venue_booking.cancelled'

/** The two authorities a cancellation is made under (XU2), as the row records them. */
export const VENUE_CANCEL_AUTHORITIES = Object.freeze({
  ORGANIZATION_ROLE: 'ORGANIZATION_ROLE',
  PLATFORM_ROLE: 'PLATFORM_ROLE',
})

/** Ticket states a cancellation moves to REVOKED. */
const CANCELLABLE_STATES = Object.freeze(['VALID', 'TRANSFER_PENDING'])

/** Ticket states that still stand on an order: they admit, or will. */
const STANDING_STATES = Object.freeze(['VALID', 'TRANSFER_PENDING', 'CHECKED_IN'])

/** Event statuses whose sales the organiser stopped, and only they can reopen (Rule L). */
const SALES_STOPPED_STATUSES = Object.freeze(['SALES_PAUSED', 'SOLD_OUT'])

/** What a person who may not act on this booking is told: nothing about it. */
const NO_SUCH_ORDER = 'No such order.'

/**
 * Ascending, as the lock law orders ids.
 *
 * @param {string} a One id.
 * @param {string} b Another.
 * @returns {number} Their order.
 */
function ascending(a, b) {
  if (a === b) return 0

  return a < b ? -1 : 1
}

/**
 * Who may cancel unpaid tickets of this event's bookings, and under which
 * authority (SPEC3-XI XU2). Membership first, never `can()`: a FINANCE_ADMIN's
 * platform role answers yes to `can(actor, 'order:refund', …)`, and the
 * owner's reading names organisers and administrators only.
 *
 * - The actor's own membership in the event's organisation grants
 *   `order:refund` (OWNER, ADMIN): `ORGANIZATION_ROLE`, with that role.
 * - Else the actor belongs to the organisation in another role and their
 *   platform role holds `venue_booking:cancel`: refused, `CONFLICT_OF_INTEREST`
 *   (a platform administrator does not act on their own organisation's
 *   bookings with authority their membership lacks).
 * - Else their platform role holds `venue_booking:cancel` (ADMIN,
 *   SUPER_ADMIN): `PLATFORM_ROLE`, with that role.
 * - Else nobody: null.
 *
 * @param {object|null} actor The request actor, with `role` and `memberships`.
 * @param {{organizationId: string}} event The event.
 * @returns {{authority: 'ORGANIZATION_ROLE'|'PLATFORM_ROLE', role: string}|{refusal: 'CONFLICT_OF_INTEREST'}|null} The answer.
 */
export function venueCancellationAuthority(actor, event) {
  const organizationId = event?.organizationId

  if (!actor || !organizationId) return null

  const memberships = (actor.memberships ?? []).filter(
    (membership) => membership?.organizationId === organizationId,
  )

  if (memberHolds(actor, CAPABILITIES.ORDER_REFUND, organizationId)) {
    const granting = memberships.find((membership) =>
      (ORG_ROLE_CAPABILITIES[membership.role] ?? []).includes(CAPABILITIES.ORDER_REFUND),
    )

    return { authority: VENUE_CANCEL_AUTHORITIES.ORGANIZATION_ROLE, role: granting.role }
  }

  if (!platformHolds(actor, CAPABILITIES.VENUE_BOOKING_CANCEL)) return null

  if (memberships.length > 0) return { refusal: 'CONFLICT_OF_INTEREST' }

  return { authority: VENUE_CANCEL_AUTHORITIES.PLATFORM_ROLE, role: actor.role }
}

/**
 * The share of a booking fee Desi-Event keeps when unpaid tickets of basis
 * `lineBasisCents` are cancelled (SPEC3-XI §10.2, XU6). Pure.
 *
 * Apportioned by basis exactly as a refund of named tickets apportions the
 * fee: cumulative floors counted from the basis already refunded or
 * cancelled (`spoken.basisCents`), so the shares of several cancellations and
 * refunds of one booking add up to its whole fee, never a cent more; and
 * never more than the fee the order still holds. Only the fee is ever kept:
 * a taxed booking is refused before this is asked (`VENUE_CANCEL_TAXED`).
 *
 * @param {object} options Options.
 * @param {{faceValueCents: number, feeCents: number, taxCents: number}} options.parts The order's parts (`orderParts`).
 * @param {{faceValueCents: number, feeCents: number, taxCents: number, basisCents?: number}} options.spoken What refunds and earlier cancellations hold (`partsSpokenFor`).
 * @param {number} options.orderBasisCents The order's basis (`orderBasis`).
 * @param {number} options.lineBasisCents The cancelled tickets' basis: the sum of their dues.
 * @returns {{feeKeptCents: number}} The fee kept.
 */
export function keptShareOf({ parts, spoken, orderBasisCents, lineBasisCents }) {
  const basis = orderBasisCents ?? 0
  const fee = parts?.feeCents ?? 0

  if (basis <= 0 || fee <= 0 || lineBasisCents <= 0) return { feeKeptCents: 0 }

  const held = partsLeft(parts, {
    faceValueCents: spoken?.faceValueCents ?? 0,
    feeCents: spoken?.feeCents ?? 0,
    taxCents: spoken?.taxCents ?? 0,
  })
  const taken = Math.max(0, spoken?.basisCents ?? 0)
  const share = Math.max(
    0,
    Math.floor((fee * (taken + lineBasisCents)) / basis) - Math.floor((fee * taken) / basis),
  )

  return { feeKeptCents: Math.max(0, Math.min(held.feeCents, share)) }
}

/**
 * Whether one tier's sales are open now, read as checkout and the hold route
 * read them; a window the helper cannot read counts as closed.
 *
 * @param {object} tier A `TicketType` row.
 * @param {Date} now The instant.
 * @returns {boolean} True when it sells now.
 */
function tierSelling(tier, now) {
  try {
    return (
      salesWindowState({
        status: tier.status,
        salesStartAt: tier.salesStartAt ?? null,
        salesEndAt: tier.salesEndAt ?? null,
        now,
      }) === 'ON_SALE'
    )
  } catch {
    return false
  }
}

/**
 * Whether the places a cancellation freed are on sale now (SPEC3-XI XU5). A
 * freed place sells only when the event is bookable, its tier's sales window
 * is open, and its night's (the tier's night, or its seat's) is too. Pure.
 *
 * @param {object} options Options.
 * @param {{status: string}} options.event The event.
 * @param {Array<object>} options.tiers The tiers of the freed places (`TicketType` rows).
 * @param {Array<object>} [options.nights] The nights the freed places are for (`EventSession` rows).
 * @param {Array<{ticketTypeId: string, eventSessionId?: string|null}>} [options.places] One entry per freed place; one per tier, on the tier's own night, when not given.
 * @param {Date} options.now The instant.
 * @returns {{placesOnSale: 'ALL'|'SOME'|'NONE', eventSalesStopped: boolean}} The answer.
 */
export function placesOnSaleOf({ event, tiers, nights = [], places = null, now }) {
  const tierOf = new Map((tiers ?? []).map((tier) => [tier.id, tier]))
  const nightOf = new Map((nights ?? []).map((night) => [night.id, night]))
  const freed =
    places ??
    (tiers ?? []).map((tier) => ({
      ticketTypeId: tier.id,
      eventSessionId: tier.eventSessionId ?? null,
    }))
  const bookable = BOOKABLE_STATUSES.has(event?.status)
  let selling = 0

  for (const place of freed) {
    const tier = tierOf.get(place.ticketTypeId)
    const night = place.eventSessionId ? nightOf.get(place.eventSessionId) : null
    const nightSelling = place.eventSessionId
      ? Boolean(night) && sessionWindowState(night, now) === 'ON_SALE'
      : true

    if (bookable && tier && tierSelling(tier, now) && nightSelling) selling += 1
  }

  const placesOnSale =
    freed.length > 0 && selling === freed.length ? 'ALL' : selling === 0 ? 'NONE' : 'SOME'

  return {
    placesOnSale,
    eventSalesStopped: SALES_STOPPED_STATUSES.includes(event?.status),
  }
}

/**
 * The night a ticket is for: its tier's, else its seat's; null for a ticket
 * good for every night, or on an event with no nights.
 *
 * @param {{orderItem?: {ticketType?: {eventSessionId?: string|null}}, eventSeat?: {eventSessionId?: string|null}|null}} ticket The ticket, with its line's tier and its seat.
 * @returns {string|null} The night's id.
 */
function nightIdOf(ticket) {
  return ticket.orderItem?.ticketType?.eventSessionId ?? ticket.eventSeat?.eventSessionId ?? null
}

/**
 * Whether a ticket's night is over (SPEC3-XI XU3, XU4): its own night ended
 * or was cancelled; for a ticket good for every night, no night of the event
 * is still to end; on an event with no nights, the event has ended.
 *
 * @param {string|null} nightId The ticket's night ({@link nightIdOf}).
 * @param {{endsAt: Date|string, sessions?: Array<object>}} event The event, with its nights.
 * @param {Date} now The instant.
 * @returns {boolean} True once it is over.
 */
function nightOver(nightId, event, now) {
  const at = now.getTime()
  const nights = event.sessions ?? []
  const ended = (night) => night.status === 'CANCELLED' || new Date(night.endsAt).getTime() <= at

  if (nightId) {
    const night = nights.find((candidate) => candidate.id === nightId)

    return !night || ended(night)
  }

  if (nights.length > 0) return nights.every(ended)

  return new Date(event.endsAt).getTime() <= at
}

/**
 * A night's name for the cancel dialog: its label, else when it starts in
 * the event's own time zone.
 *
 * @param {object|null} night An `EventSession` row.
 * @returns {string|null} The name, or null for no night.
 */
function nightName(night) {
  if (!night) return null

  const label = typeof night.label === 'string' ? night.label.trim() : ''

  if (label !== '') return label

  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeZone: night.timezone || 'UTC',
    }).format(new Date(night.startsAt))
  } catch {
    return new Date(night.startsAt).toISOString().slice(0, 10)
  }
}

/**
 * The currency an event's bookings are in: its tiers', else its bookings',
 * else US dollars.
 *
 * @param {object} db A Prisma client.
 * @param {string} eventId The event.
 * @returns {Promise<string>} The ISO-4217 code.
 */
async function eventCurrency(db, eventId) {
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
 * An event's bookings with tickets still to be paid at the door, each with
 * those tickets, for the organiser's "Payments at the venue" page, the
 * administrators' list and the cancel dialog (SPEC3-XI §11.2). The caller
 * has decided the reader may ({@link venueCancellationAuthority}).
 *
 * A Desi-Event administrator reads no name: `buyerName` and every
 * `attendeeName` are null for a `PLATFORM_ROLE` reader. An organisation
 * reader gets them without any address in them.
 *
 * @param {object} db A Prisma client.
 * @param {object} options Options.
 * @param {object} options.event The event, with `id`, `title`, `endsAt` and `timezone`.
 * @param {{authority: string}} options.reader The reader's authority.
 * @param {string|null} [options.orderReference] One booking only, by its reference.
 * @param {number} [options.page] The page, from 1.
 * @param {number} [options.perPage] Bookings per page.
 * @param {Date} [options.now] The instant.
 * @returns {Promise<object>} A `venueBookingsResponseSchema` `data` payload.
 */
export async function unpaidVenueBookings(db, options) {
  const { event, reader, orderReference = null, page = 1, perPage = 20, now = new Date() } = options
  const platform = reader?.authority === VENUE_CANCEL_AUTHORITIES.PLATFORM_ROLE
  const { skip, take } = toSkipTake({ page, perPage })
  const where = {
    ...BOOKED_UNPAID_ORDER_WHERE,
    eventId: event.id,
    ...(orderReference ? { reference: orderReference } : {}),
  }
  const sessions = await db.eventSession.findMany({ where: { eventId: event.id } })
  const withNights = { ...event, sessions }
  const nightOfId = new Map(sessions.map((night) => [night.id, night]))

  const [currency, total, orders] = await Promise.all([
    eventCurrency(db, event.id),
    db.order.count({ where }),
    db.order.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip,
      take,
      select: {
        id: true,
        reference: true,
        createdAt: true,
        userId: true,
        buyerName: true,
        feesCents: true,
        items: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            quantity: true,
            ticketType: { select: { eventSessionId: true } },
            tickets: {
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                status: true,
                attendeeName: true,
                ownerUserId: true,
                venueDueCents: true,
                venuePaymentId: true,
                eventSeat: { select: { eventSessionId: true } },
              },
            },
          },
        },
      },
    }),
  ])

  const bookings = orders.map((order) => {
    // Each place of the booking has one current ticket: a ticket passed on
    // is TRANSFERRED and its successor stands for it. Numbered in line and
    // issue order, out of every place the booking bought.
    const places = order.items.reduce((sum, item) => sum + item.quantity, 0)
    const current = order.items.flatMap((item) =>
      item.tickets
        .filter((ticket) => ticket.status !== 'TRANSFERRED' && ticket.status !== 'SUPERSEDED')
        .map((ticket) => ({ ...ticket, orderItem: { ticketType: item.ticketType } })),
    )
    const tickets = []

    current.forEach((ticket, index) => {
      const unpaid =
        (ticket.venueDueCents ?? 0) > 0 &&
        (ticket.venuePaymentId ?? null) === null &&
        CANCELLABLE_STATES.includes(ticket.status)

      if (!unpaid) return

      const nightId = nightIdOf(ticket)
      const over = nightOver(nightId, withNights, now)

      tickets.push({
        ticketId: ticket.id,
        label: `Ticket ${index + 1} of ${Math.max(places, current.length)}`,
        attendeeName: platform ? null : (withoutAddresses(ticket.attendeeName ?? null) ?? null),
        nightLabel: nightName(nightId ? (nightOfId.get(nightId) ?? null) : null),
        everyNight: !nightId && sessions.length > 0,
        dueCents: ticket.venueDueCents,
        heldBy: (ticket.ownerUserId ?? null) === (order.userId ?? null) ? 'BUYER' : 'SOMEONE_ELSE',
        offerPending: ticket.status === 'TRANSFER_PENDING',
        cancellable: !over,
        notCancellable: over ? 'NIGHT_OVER' : null,
      })
    })

    return {
      orderReference: order.reference,
      placedAt: order.createdAt.toISOString(),
      buyerName: platform ? null : (withoutAddresses(order.buyerName ?? '') ?? ''),
      feesCents: order.feesCents ?? 0,
      unpaidTickets: tickets.length,
      unpaidCents: tickets.reduce((sum, ticket) => sum + ticket.dueCents, 0),
      tickets,
    }
  })

  return {
    eventId: event.id,
    eventTitle: event.title,
    // The event's own zone, so a screen writes each booking's date as the
    // event keeps time.
    timezone: event.timezone,
    currency,
    bookings,
    pagination: buildPaginationMeta({ page, perPage, total }),
  }
}

/**
 * The 409 `VENUE_BOOKING_CHANGED`, naming the chosen tickets that stopped
 * being cancellable.
 *
 * @param {string[]} ticketIds The tickets.
 * @returns {Error} The refusal.
 */
function bookingChanged(ticketIds) {
  return paymentTermsRefusal('VENUE_BOOKING_CHANGED', {
    details: { ticketIds: [...ticketIds].sort(ascending) },
  })
}

/**
 * Whether one ticket, as read under its lock, may be cancelled unpaid (XU3).
 *
 * @param {object} ticket The ticket, with `checkIns`.
 * @returns {boolean} True when it may.
 */
function cancellable(ticket) {
  return (
    CANCELLABLE_STATES.includes(ticket.status) &&
    (ticket.venueDueCents ?? 0) > 0 &&
    (ticket.venuePaymentId ?? null) === null &&
    (ticket.venueCancellationId ?? null) === null &&
    (ticket.checkIns ?? []).length === 0
  )
}

/**
 * Cancel chosen unpaid tickets of one pay-at-the-venue booking (SPEC3-XI
 * XU1–XU14), in one transaction under SPEC3-XI §2.2's locks.
 *
 * All or nothing: a named ticket no longer cancellable (paid at the door, let
 * in, passed on, cancelled or refunded meanwhile) refuses the whole request
 * (409 `VENUE_BOOKING_CHANGED`). The same tickets cancelled together already
 * answer that cancellation again (`replayed: true`) and nothing is written.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} options Options.
 * @param {string} options.reference The booking's reference.
 * @param {string[]} options.ticketIds The tickets to cancel, 1 to 100, distinct.
 * @param {string} options.reason Why, 10 to 500 characters, shown to the buyer and the holders.
 * @param {object} options.actor The request actor.
 * @param {Date} [options.now] The instant.
 * @param {string|null} [options.requestId] For the audit trail.
 * @param {{warn?: Function}|null} [options.log] A logger, for the referral return's warning.
 * @returns {Promise<object>} A `venueBookingCancellationResponseSchema` `data` payload.
 * @throws {Error} 404; 403 `CONFLICT_OF_INTEREST`; 422 `TICKET_NOT_IN_BOOKING`; 409 `NOT_A_VENUE_BOOKING`, `VENUE_CANCEL_NOT_LIVE`, `REFUND_IN_PROGRESS`, `VENUE_CANCEL_TAXED`, `VENUE_BOOKING_CHANGED`, `VENUE_NIGHT_OVER`; 503 when it waited too long.
 */
export async function cancelUnpaidVenueTickets(prisma, options) {
  const { reference, ticketIds, actor, now = new Date(), requestId = null, log = null } = options
  const reason = String(options.reason).trim()
  const named = [...new Set(ticketIds ?? [])].sort(ascending)

  // 0. What is fixed for the life of the rows, read unlocked: the booking, its
  // event, and each named ticket's line, tier, tier night and seat night.
  const booking = await prisma.order.findUnique({
    where: { reference },
    select: {
      id: true,
      reference: true,
      eventId: true,
      eventSessionId: true,
      paymentMethod: true,
      userId: true,
      referralCodeId: true,
      event: { select: { id: true, organizationId: true } },
    },
  })

  if (!booking?.event) throw notFound(NO_SUCH_ORDER)

  const authority = venueCancellationAuthority(actor, booking.event)

  if (!authority) throw notFound(NO_SUCH_ORDER)

  if (authority.refusal) {
    throw forbidden(PAYMENT_TERMS_SENTENCES.conflictOfInterest, 'CONFLICT_OF_INTEREST')
  }

  if (booking.paymentMethod !== 'AT_VENUE') throw paymentTermsRefusal('NOT_A_VENUE_BOOKING')

  const fixed = await prisma.ticket.findMany({
    where: { id: { in: named } },
    select: {
      id: true,
      orderItemId: true,
      eventSeat: { select: { eventSessionId: true } },
      orderItem: {
        select: {
          orderId: true,
          ticketTypeId: true,
          ticketType: { select: { eventSessionId: true } },
        },
      },
    },
  })

  if (
    fixed.length !== named.length ||
    fixed.some((ticket) => ticket.orderItem?.orderId !== booking.id)
  ) {
    throw paymentTermsRefusal('TICKET_NOT_IN_BOOKING')
  }

  const tierIds = [...new Set(fixed.map((ticket) => ticket.orderItem.ticketTypeId))].sort(ascending)
  // The tickets' nights, and the order's own: a cancellation that ends the
  // booking writes the order twice (its sums, then the referral marker), and
  // PostgreSQL checks the order's foreign keys again on the second write,
  // taking `KEY SHARE` on its night after the order. Taken here, in its place
  // (SPEC3-XI §2.1), a night's cancellation holding that night waits for this
  // or this for it, before either holds what the other needs.
  const nightIds = [
    ...new Set(
      [...fixed.map((ticket) => nightIdOf(ticket)), booking.eventSessionId].filter(Boolean),
    ),
  ].sort(ascending)
  const lineIds = [...new Set(fixed.map((ticket) => ticket.orderItemId))].sort(ascending)
  const by =
    authority.authority === VENUE_CANCEL_AUTHORITIES.PLATFORM_ROLE ? 'DESI_EVENT' : 'ORGANISER'
  const readerKind =
    authority.authority === VENUE_CANCEL_AUTHORITIES.PLATFORM_ROLE ? 'PLATFORM' : 'ORGANISATION'

  const budget = {
    budget: TRANSACTION_BUDGETS.ROW,
    refusal: PAYMENT_TERMS_SENTENCES.venueCancelTryAgain,
  }

  return budgetedTransaction(prisma, budget, async (tx) => {
    // 1. The tiers, sorted.
    await lockTicketTypes(tx, tierIds)

    // 2. Their nights and the order's own, sorted, so none can be deleted
    // under us; a night's cancellation, which updates it, waits for us, or we
    // for it.
    for (const id of nightIds) {
      await tx.$queryRaw`SELECT "id" FROM "EventSession" WHERE "id" = ${id} FOR KEY SHARE`
    }

    // 3. The order.
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${booking.id} FOR UPDATE`

    // 4. The tickets' lines, sorted.
    for (const id of lineIds) {
      await tx.$queryRaw`SELECT "id" FROM "OrderItem" WHERE "id" = ${id} FOR UPDATE`
    }

    // 5. The tickets, sorted. Then everything again, from rows read now.
    for (const id of named) {
      await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${id} FOR UPDATE`
    }

    const event = await tx.event.findUnique({
      where: { id: booking.eventId },
      include: { sessions: true },
    })
    const order = await tx.order.findUnique({ where: { id: booking.id } })
    const tickets = await tx.ticket.findMany({
      where: { id: { in: named } },
      orderBy: { id: 'asc' },
      include: {
        checkIns: { select: { id: true } },
        eventSeat: { select: { id: true, eventSessionId: true } },
        orderItem: { select: { id: true, ticketTypeId: true, ticketType: true } },
      },
    })

    // Asked again, after a lost answer or by two people at once: the same
    // tickets, all cancelled by one cancellation, are that cancellation.
    const cancelledBy = new Set(tickets.map((ticket) => ticket.venueCancellationId ?? null))
    const [only] = [...cancelledBy]

    if (cancelledBy.size === 1 && only !== null && tickets.every((t) => t.status === 'REVOKED')) {
      return replayOf(tx, { cancellationId: only, event, readerKind, now })
    }

    if (!LIVE_STATUSES.has(event.status)) throw paymentTermsRefusal('VENUE_CANCEL_NOT_LIVE')

    if ((order.refundPendingCents ?? 0) > 0) throw paymentTermsRefusal('REFUND_IN_PROGRESS')

    // Only the booking fee is ever kept; the tax on it would go back to the
    // buyer, and that refund is not built (XU6).
    if ((order.taxCents ?? 0) > 0) throw paymentTermsRefusal('VENUE_CANCEL_TAXED')

    const changed = tickets.filter((ticket) => order.status !== 'PAID' || !cancellable(ticket))

    if (changed.length > 0) throw bookingChanged(changed.map((ticket) => ticket.id))

    if (tickets.some((ticket) => nightOver(nightIdOf(ticket), event, now))) {
      throw paymentTermsRefusal('VENUE_NIGHT_OVER')
    }

    // 6. Writes. The share of the booking fee kept, counted from what refunds
    // and earlier cancellations already took (none pending: refused above).
    const basisCents = tickets.reduce((sum, ticket) => sum + ticket.venueDueCents, 0)
    const { feeKeptCents } = keptShareOf({
      parts: orderParts(order),
      spoken: await partsSpokenFor(tx, order),
      orderBasisCents: orderBasis(order),
      lineBasisCents: basisCents,
    })

    const cancellation = await tx.venueBookingCancellation.create({
      data: {
        orderId: order.id,
        eventId: event.id,
        organizationId: event.organizationId,
        ticketCount: tickets.length,
        basisCents,
        feeKeptCents,
        currency: order.currency,
        authority: authority.authority,
        role: authority.role,
        reason,
        cancelledById: actor?.id ?? null,
        createdAt: now,
      },
    })

    // Each ticket conditionally: the count is what this call moved.
    for (const ticket of tickets) {
      const { count } = await tx.ticket.updateMany({
        where: {
          id: ticket.id,
          status: { in: [...CANCELLABLE_STATES] },
          venuePaymentId: null,
          venueCancellationId: null,
        },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokedReason: `${VENUE_UNPAID_PREFIX}${cancellation.id}`,
          // The pass dies with the ticket, as on every withdrawal.
          credentialHash: null,
          credentialVersion: { increment: 1 },
          venueCancellationId: cancellation.id,
        },
      })

      if (count !== 1) throw bookingChanged([ticket.id])
    }

    // Their offers to pass them on, read after the tickets' locks: an offer
    // committed while this waited is seen, and withdrawn.
    await tx.ticketTransfer.updateMany({
      where: { ticketId: { in: named }, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledAt: now },
    })

    // The seats go back on the map, whatever the time to the event: the
    // cancelled pass is dead, so only a new buyer's ticket can use one.
    let seatsReturned = 0

    for (const seatId of tickets
      .map((ticket) => ticket.eventSeat?.id ?? null)
      .filter(Boolean)
      .sort(ascending)) {
      const { count } = await tx.eventSeat.updateMany({
        where: { id: seatId, status: 'SOLD' },
        data: { status: 'AVAILABLE', orderItemId: null, holdId: null },
      })

      seatsReturned += count
    }

    // The tiers' sold counts, one tier at a time in id order, under the
    // tiers' locks taken first: the only place a count ever falls.
    const perTier = new Map()
    const perLine = new Map()

    for (const ticket of tickets) {
      const tierId = ticket.orderItem.ticketTypeId

      perTier.set(tierId, (perTier.get(tierId) ?? 0) + 1)
      perLine.set(ticket.orderItemId, (perLine.get(ticket.orderItemId) ?? 0) + 1)
    }

    for (const tierId of [...perTier.keys()].sort(ascending)) {
      await tx.ticketType.update({
        where: { id: tierId },
        data: { quantitySold: { decrement: perTier.get(tierId) } },
      })
    }

    for (const lineId of [...perLine.keys()].sort(ascending)) {
      await tx.orderItem.update({
        where: { id: lineId },
        data: { venueCancelledQuantity: { increment: perLine.get(lineId) } },
      })
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        venueCancelledBasisCents: { increment: basisCents },
        venueFeeKeptCents: { increment: feeKeptCents },
      },
    })

    // Whether the freed places are on sale now, from the rows held.
    const tiers = await tx.ticketType.findMany({ where: { id: { in: tierIds } } })
    const sale = placesOnSaleOf({
      event,
      tiers,
      nights: event.sessions ?? [],
      places: tickets.map((ticket) => ({
        ticketTypeId: ticket.orderItem.ticketTypeId,
        eventSessionId: nightIdOf(ticket),
      })),
      now,
    })
    const placesReturned = Object.fromEntries(
      [...perTier.keys()].sort(ascending).map((tierId) => [tierId, perTier.get(tierId)]),
    )

    // The referral use, when the booking has now ended: the code is the last
    // lock this transaction takes.
    await settleReferralUsesIfEnded(tx, {
      entries: [{ orderId: order.id, cause: 'VENUE_UNPAID_CANCELLED' }],
      actorId: actor?.id ?? null,
      requestId,
      now,
      log,
    })

    // The buyer, and every other account holding one of these tickets.
    await writeCancellationNotices(tx, {
      cancellation,
      order,
      event,
      tickets,
      by,
      reason,
    })

    await recordAudit(tx, {
      action: AUDIT_ACTIONS.VENUE_BOOKING_CANCELLED,
      entityType: 'VenueBookingCancellation',
      entityId: cancellation.id,
      actorId: actor?.id ?? null,
      metadata: {
        cancellationId: cancellation.id,
        orderId: order.id,
        eventId: event.id,
        organizationId: event.organizationId,
        ticketIds: named,
        ticketCount: tickets.length,
        basisCents,
        feeKeptCents,
        currency: order.currency,
        seatsReturned,
        placesReturned,
        placesOnSale: sale.placesOnSale,
        authority: authority.authority,
        role: authority.role,
        reason,
        requestId,
      },
    })

    const written = await tx.venueBookingCancellation.findUnique({
      where: { id: cancellation.id },
      include: { cancelledBy: { select: { displayName: true } } },
    })
    const shown = toVenueCancellation(written, { reader: readerKind })

    return {
      cancellationId: cancellation.id,
      orderReference: order.reference,
      ticketCount: tickets.length,
      basisCents,
      feeKeptCents,
      currency: order.currency,
      cancelledAt: shown.at,
      by: shown.by,
      byName: shown.byName ?? null,
      reason,
      seatsReturned,
      placesReturned,
      placesOnSale: sale.placesOnSale,
      eventSalesStopped: sale.eventSalesStopped,
      replayed: false,
    }
  })
}

/**
 * A cancellation asked for again: answered as it was written, nothing
 * written now. Whether its places are on sale is read now.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {string} options.cancellationId The cancellation.
 * @param {object} options.event The event, with its nights.
 * @param {'ORGANISATION'|'PLATFORM'} options.readerKind Who reads it.
 * @param {Date} options.now The instant.
 * @returns {Promise<object>} The response payload, `replayed: true`.
 */
async function replayOf(tx, { cancellationId, event, readerKind, now }) {
  const row = await tx.venueBookingCancellation.findUnique({
    where: { id: cancellationId },
    include: {
      cancelledBy: { select: { displayName: true } },
      order: { select: { reference: true } },
      tickets: {
        orderBy: { id: 'asc' },
        select: {
          id: true,
          eventSeatId: true,
          eventSeat: { select: { eventSessionId: true } },
          orderItem: {
            select: { ticketTypeId: true, ticketType: { select: { eventSessionId: true } } },
          },
        },
      },
    },
  })
  const perTier = new Map()

  for (const ticket of row.tickets) {
    const tierId = ticket.orderItem.ticketTypeId

    perTier.set(tierId, (perTier.get(tierId) ?? 0) + 1)
  }

  const tierIds = [...perTier.keys()].sort(ascending)
  const tiers = await tx.ticketType.findMany({ where: { id: { in: tierIds } } })
  const sale = placesOnSaleOf({
    event,
    tiers,
    nights: event.sessions ?? [],
    places: row.tickets.map((ticket) => ({
      ticketTypeId: ticket.orderItem.ticketTypeId,
      eventSessionId: nightIdOf(ticket),
    })),
    now,
  })
  const shown = toVenueCancellation(row, { reader: readerKind })

  return {
    cancellationId: row.id,
    orderReference: row.order.reference,
    ticketCount: row.ticketCount,
    basisCents: row.basisCents,
    feeKeptCents: row.feeKeptCents,
    currency: row.currency,
    cancelledAt: shown.at,
    by: shown.by,
    byName: shown.byName ?? null,
    reason: row.reason,
    seatsReturned: row.tickets.filter((ticket) => ticket.eventSeatId).length,
    placesReturned: Object.fromEntries(tierIds.map((tierId) => [tierId, perTier.get(tierId)])),
    placesOnSale: sale.placesOnSale,
    eventSalesStopped: sale.eventSalesStopped,
    replayed: true,
  }
}

/**
 * The notices a cancellation writes (SPEC3-XI XU11, §9.9): one to the buyer,
 * and one to each other account holding a cancelled ticket, each saying only
 * what is theirs. Ids and prose only: no address, no code, no token in a
 * payload. Keyed on the cancellation and the recipient, so nothing is written
 * twice.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} options Options.
 * @param {object} options.cancellation The cancellation row.
 * @param {object} options.order The order.
 * @param {object} options.event The event.
 * @param {Array<object>} options.tickets The cancelled tickets, as read before the cancellation.
 * @param {'ORGANISER'|'DESI_EVENT'} options.by Who cancelled them.
 * @param {string} options.reason The reason given.
 * @returns {Promise<number>} How many rows were written.
 */
async function writeCancellationNotices(tx, { cancellation, order, event, tickets, by, reason }) {
  const prose = withoutAddresses(reason)
  const common = {
    template: VENUE_BOOKING_CANCELLED_TEMPLATE,
    channel: 'EMAIL',
    suppressible: isSuppressible(VENUE_BOOKING_CANCELLED_TEMPLATE),
  }
  const lines = await tx.orderItem.findMany({ where: { orderId: order.id }, select: { id: true } })
  const others = await tx.ticket.count({
    where: {
      orderItemId: { in: lines.map((line) => line.id) },
      status: { in: [...STANDING_STATES] },
    },
  })
  let written = 0

  if (order.buyerEmail) {
    const created = await tx.notificationOutbox.createMany({
      data: [
        {
          ...common,
          recipient: order.buyerEmail,
          userId: order.userId ?? null,
          // Stamped so an organisation-scoped privacy redaction finds the row.
          organizationId: event.organizationId,
          payload: {
            eventId: event.id,
            eventTitle: event.title,
            recipient: 'BUYER',
            orderReference: order.reference,
            ticketCount: tickets.length,
            dueCents: cancellation.basisCents,
            feeKeptCents: cancellation.feeKeptCents,
            currency: order.currency,
            reason: prose,
            by,
            othersRemain: others > 0,
          },
          dedupeKey: `venue-booking-cancelled:${cancellation.id}:buyer`,
        },
      ],
      skipDuplicates: true,
    })

    written += created.count
  }

  const held = new Map()

  for (const ticket of tickets) {
    const holder = ticket.ownerUserId ?? null

    if (!holder || holder === (order.userId ?? null)) continue

    const mine = held.get(holder) ?? { count: 0, dueCents: 0 }

    mine.count += 1
    mine.dueCents += ticket.venueDueCents
    held.set(holder, mine)
  }

  if (held.size === 0) return written

  const accounts = await tx.user.findMany({
    where: { id: { in: [...held.keys()] } },
    select: { id: true, email: true },
  })

  for (const account of [...accounts].sort((a, b) => ascending(a.id, b.id))) {
    if (!account.email) continue

    const mine = held.get(account.id)
    const created = await tx.notificationOutbox.createMany({
      data: [
        {
          ...common,
          recipient: account.email,
          userId: account.id,
          organizationId: event.organizationId,
          payload: {
            eventId: event.id,
            eventTitle: event.title,
            recipient: 'HOLDER',
            ticketCount: mine.count,
            dueCents: mine.dueCents,
            currency: order.currency,
            reason: prose,
            by,
          },
          dedupeKey: `venue-booking-cancelled:${cancellation.id}:holder:${account.id}`,
        },
      ],
      skipDuplicates: true,
    })

    written += created.count
  }

  return written
}
