/**
 * Sessions and their seats.
 *
 * Two routes: read a seat map, and take seats off it. The second one is where
 * every Phase 2 seating rule meets a request, and it is short because the rules
 * live where they can be tested — the selection rules in
 * `@desi-event/inventory/seating`, the atomicity in `../lib/seating.js`.
 *
 * The thing to notice about `sessions.hold` is what it reads from the request:
 * a list of seat ids. Not a price, not a ticket type, not a hold duration, not a
 * quantity. Every one of those is derived here from rows the buyer cannot touch,
 * because every one of them is something a browser would otherwise be able to
 * negotiate.
 *
 * @module @desi-event/api/routes/sessions
 */

import {
  INVENTORY_ERROR_CODES,
  InventoryError,
  MAX_SEATS_PER_ORDER,
  createGuestHoldToken,
  groupSeatMap,
  salesWindowState,
  seatCounts,
  toPublicSeat,
  withCompanions,
} from '@desi-event/inventory'
import { CAPABILITIES, can } from '@desi-event/permissions'
import { BOOKABLE_STATUSES, INDEXABLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import { notFound, unprocessable } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'
import { holdSeats, holdTtlSeconds, loadSeatingPlan } from '../lib/seating.js'
import { mayBookHiddenTier, sessionWindowState } from '../lib/session-inventory.js'

/**
 * Whether a tier is inside its own sales window now.
 *
 * @param {object} tier A `TicketType` row.
 * @param {Date} now The moment.
 * @returns {boolean} True when a hold would pass the tier's window check.
 */
function tierOnSale(tier, now) {
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

/** Sales window states and the message each one gets. */
const WINDOW_MESSAGE = Object.freeze({
  NOT_STARTED: 'Seats for this session are not on sale now.',
  ENDED: 'Sales for this session have closed.',
  PAUSED: 'Sales for this session are paused.',
  CLOSED: 'This session is no longer on sale.',
  DRAFT: 'This session is not on sale.',
})

/**
 * Register the session routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.env The parsed API environment.
 * @returns {void} Nothing.
 */
export function registerSessionRoutes(app, { prisma, env }) {
  /**
   * Load a session and the event it belongs to, refusing what a caller may not see.
   *
   * A session of an unpublished event is visible only to somebody who may see
   * that organisation's drafts, and it answers 404 rather than 403 to everybody
   * else — the same rule the event routes use, for the same reason: a 403 here
   * would confirm that a session id exists.
   *
   * @param {object} request The incoming request.
   * @returns {Promise<object>} The session, its event, and whether the caller is on the inside.
   * @throws {Error} A 404 when it does not exist or is not visible.
   */
  async function visibleSession(request) {
    const session = await prisma.eventSession.findUnique({ where: { id: request.params.id } })

    if (!session) throw notFound('No such session.')

    const event = await prisma.event.findUnique({ where: { id: session.eventId } })

    if (!event) throw notFound('No such session.')

    const organiser = can(request.actor, CAPABILITIES.EVENT_VIEW_DRAFT, {
      organizationId: event.organizationId,
    })

    // The statuses a listing shows, so a sold-out or paused show's seat map
    // still answers; buying is decided separately below.
    if (!INDEXABLE_STATUSES.has(event.status) && !organiser) throw notFound('No such session.')

    return { session, event, organiser }
  }

  defineRoute(app, 'sessions.seats', {
    handler: async (request) => {
      const { session, event, organiser } = await visibleSession(request)
      const plan = await loadSeatingPlan(prisma, session.id)
      const now = new Date()

      // The tiers selling seats here: the reserved tiers of this night, and
      // any tier a seat is bound to. A stranger sees neither a draft tier nor a
      // hidden one, and a seat sold under one reads as unavailable to them.
      const boundIds = [
        ...new Set(plan.eventSeats.map((eventSeat) => eventSeat.ticketTypeId).filter(Boolean)),
      ]
      const allTiers = await prisma.ticketType.findMany({
        where: {
          eventId: event.id,
          OR: [{ eventSessionId: session.id, reserved: true }, { id: { in: boundIds } }],
        },
        orderBy: [{ sortOrder: 'asc' }, { priceCents: 'asc' }],
      })
      const tiers = organiser
        ? allTiers
        : allTiers.filter((tier) => tier.status !== 'DRAFT' && tier.visibility !== 'HIDDEN')
      const tiersById = new Map(tiers.map((tier) => [tier.id, tier]))

      const zones = session.venueMapVersionId
        ? await prisma.priceZone.findMany({
            where: { venueMapVersionId: session.venueMapVersionId },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          })
        : []

      const seats = plan.eventSeats.map((eventSeat) => {
        const seat = toPublicSeat(eventSeat, { organiser })

        if (organiser) return seat

        // For a buyer a seat is available only when it is free, sold under a
        // tier they may buy, and that tier is on sale now. Why not is not
        // theirs to know, so it reads the same as a taken seat.
        const tier = tiersById.get(eventSeat.ticketTypeId)

        return {
          ...seat,
          ticketTypeId: tier ? tier.id : null,
          available: seat.available && Boolean(tier) && tierOnSale(tier, now),
        }
      })

      const counts = seatCounts(plan.eventSeats)

      if (!organiser) {
        const available = seats.filter((seat) => seat.available).length

        counts.unavailable += counts.available - available
        counts.available = available
      }

      const tierLimit = Math.max(1, ...tiers.map((tier) => tier.maxPerOrder ?? 1))
      const sessionSelling = sessionWindowState(session, now) === 'ON_SALE'

      return {
        data: {
          sessionId: session.id,
          eventId: session.eventId,
          venueMapVersionId: session.venueMapVersionId,
          label: session.label ?? null,
          startsAt: session.startsAt.toISOString(),
          endsAt: session.endsAt.toISOString(),
          doorsOpenAt: session.doorsOpenAt ? session.doorsOpenAt.toISOString() : null,
          timezone: session.timezone,
          status: session.status,
          salesStartAt: session.salesStartAt ? session.salesStartAt.toISOString() : null,
          salesEndAt: session.salesEndAt ? session.salesEndAt.toISOString() : null,
          maxSeatsPerOrder: Math.min(MAX_SEATS_PER_ORDER, tierLimit),
          zones: zones.map((zone) => ({
            id: zone.id,
            name: zone.name,
            sortOrder: zone.sortOrder ?? 0,
          })),
          tiers: tiers.map((tier) => ({
            id: tier.id,
            name: tier.name,
            priceCents: tier.priceCents,
            currency: tier.currency,
            priceZoneId: tier.priceZoneId ?? null,
            minPerOrder: tier.minPerOrder ?? 1,
            maxPerOrder: tier.maxPerOrder ?? 1,
            onSale: BOOKABLE_STATUSES.has(event.status) && sessionSelling && tierOnSale(tier, now),
          })),
          counts,
          sections: groupSeatMap({ sections: plan.sections, rows: plan.rows, seats }),
        },
      }
    },
  })

  defineRoute(app, 'sessions.hold', {
    handler: async (request) => {
      const { session, event } = await visibleSession(request)
      const now = new Date()

      if (!BOOKABLE_STATUSES.has(event.status)) {
        throw unprocessable('This event is not on sale.')
      }

      // The session's own window, which can differ from the event's: a festival
      // sells its Saturday before its Sunday. A scheduled night and one marked
      // on sale both sell; a night with no sales end stops selling when it ends.
      const windowState = sessionWindowState(session, now)

      if (windowState !== 'ON_SALE') {
        throw unprocessable(WINDOW_MESSAGE[windowState] ?? 'This session is not on sale.', {
          windowState,
        })
      }

      // The tier comes from each seat, not from the request. A buyer naming
      // their own ticket type is a buyer choosing what a seat costs. Companion
      // seats are resolved first, because a companion in another zone is sold
      // under its own zone's tier.
      const plan = await loadSeatingPlan(prisma, session.id)
      const resolved = withCompanions(request.body.seatIds, plan.seats)
      const bySeat = new Map(plan.eventSeats.map((eventSeat) => [eventSeat.seatId, eventSeat]))
      const chosen = resolved.map((seatId) => bySeat.get(seatId)).filter(Boolean)

      // A seat not on this session's map is refused by the selection check,
      // with the seat named; a seat no tier sells is not on sale.
      if (chosen.length === 0 || chosen.some((eventSeat) => !eventSeat.ticketTypeId)) {
        throw unprocessable('Those seats are not on sale at this session.')
      }

      const tierIds = [...new Set(chosen.map((eventSeat) => eventSeat.ticketTypeId))]
      const tiers = await prisma.ticketType.findMany({ where: { id: { in: tierIds } } })
      const tiersById = new Map(tiers.map((tier) => [tier.id, tier]))
      const hiddenAllowed = mayBookHiddenTier(request.actor, event)

      for (const id of tierIds) {
        const tier = tiersById.get(id)

        // Another event's tier, another night's, or one hidden from this
        // caller: not on sale here, and said the same way for each.
        if (
          !tier ||
          tier.eventId !== event.id ||
          (tier.eventSessionId && tier.eventSessionId !== session.id) ||
          (tier.visibility === 'HIDDEN' && !hiddenAllowed)
        ) {
          throw unprocessable('Those seats are not on sale at this session.')
        }

        if (!tierOnSale(tier, now)) {
          throw unprocessable(`Seats sold as "${tier.name}" are not on sale now.`, {
            ticketTypeId: tier.id,
          })
        }
      }

      if (new Set(tiers.map((tier) => tier.currency)).size > 1) {
        throw unprocessable('Seats priced in different currencies cannot be held together.')
      }

      // Each tier's own minimum, over the seats this hold takes for it —
      // companion seats included, since each is sold under its own seat's
      // tier. The order is refused below it, so the hold is refused first: a
      // hold nobody could buy only keeps the seats from everybody else.
      /** @type {Map<string, number>} */
      const seatsByTier = new Map()
      for (const eventSeat of chosen) {
        seatsByTier.set(eventSeat.ticketTypeId, (seatsByTier.get(eventSeat.ticketTypeId) ?? 0) + 1)
      }

      for (const [id, count] of seatsByTier) {
        const tier = tiersById.get(id)
        const minimum = tier.minPerOrder ?? 1

        if (count < minimum) {
          const companions = resolved.length > new Set(request.body.seatIds).size
          throw new InventoryError(
            INVENTORY_ERROR_CODES.BELOW_MINIMUM,
            `Seats sold as "${tier.name}" are sold at least ${minimum} at a time, and this selection has ${count}${companions ? ', companion seats included' : ''}. Choose ${minimum - count} more of them, or none.`,
            { details: { ticketTypeId: tier.id, minPerOrder: minimum, requested: count } },
          )
        }
      }

      // The strictest of the tiers involved, never above the platform ceiling.
      const maxPerOrder = Math.min(
        MAX_SEATS_PER_ORDER,
        ...tiers.map((tier) => tier.maxPerOrder ?? MAX_SEATS_PER_ORDER),
      )
      const tierByEventSeatId = new Map(
        chosen.map((eventSeat) => [eventSeat.id, eventSeat.ticketTypeId]),
      )

      // A guest hold is owned by a one-time token; a signed-in buyer's hold is
      // owned by their account. Exactly one of the two, which the database also
      // enforces — see `ticket_hold_single_owner`.
      const guest = request.actor ? null : createGuestHoldToken()

      const { hold, eventSeatIds } = await holdSeats(prisma, {
        eventSessionId: session.id,
        seatIds: request.body.seatIds,
        maxPerOrder,
        tierByEventSeatId,
        plan,
        now,
        hold: {
          // Required by the table; the first seat's tier. Each hold item names
          // its own seat's, and that is what is priced and sold.
          ticketTypeId: chosen[0].ticketTypeId,
          expiresAt: new Date(now.getTime() + holdTtlSeconds(env) * 1000),
          userId: request.actor?.id ?? null,
          guestTokenHash: guest?.tokenHash ?? null,
        },
      })

      const taken = plan.eventSeats.filter((eventSeat) => eventSeatIds.includes(eventSeat.id))
      const subtotalCents = taken.reduce(
        (total, eventSeat) =>
          total +
          (eventSeat.priceCentsOverride ?? tiersById.get(eventSeat.ticketTypeId).priceCents),
        0,
      )
      const firstTier = tiersById.get(chosen[0].ticketTypeId)

      await recordAudit(prisma, {
        actorId: request.actor?.id ?? null,
        action: AUDIT_ACTIONS.SEATS_HELD,
        entityType: 'TicketHold',
        entityId: hold.id,
        metadata: {
          eventSessionId: session.id,
          seats: taken.length,
          mode: request.actor ? 'user' : 'guest',
        },
      })

      return {
        data: {
          id: hold.id,
          eventSessionId: session.id,
          expiresAt: hold.expiresAt.toISOString(),
          guestToken: guest?.token ?? null,
          seats: taken.map((eventSeat) => toPublicSeat({ ...eventSeat, status: 'HELD' })),
          subtotalCents,
          currency: firstTier.currency,
        },
      }
    },
  })
}
