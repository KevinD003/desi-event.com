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
  createGuestHoldToken,
  groupSeatMap,
  salesWindowState,
  seatCounts,
  toPublicSeat,
} from '@desi-event/inventory'
import { CAPABILITIES, can } from '@desi-event/permissions'
import { BOOKABLE_STATUSES, INDEXABLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import { notFound, unprocessable } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'
import { holdSeats, holdTtlSeconds, loadSeatingPlan } from '../lib/seating.js'

/** Sales window states and the message each one gets. */
const WINDOW_MESSAGE = Object.freeze({
  NOT_STARTED: 'Seats for this session are not on sale yet.',
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
      const { session, organiser } = await visibleSession(request)
      const plan = await loadSeatingPlan(prisma, session.id)

      return {
        data: {
          sessionId: session.id,
          eventId: session.eventId,
          venueMapVersionId: session.venueMapVersionId,
          startsAt: session.startsAt.toISOString(),
          endsAt: session.endsAt.toISOString(),
          timezone: session.timezone,
          counts: seatCounts(plan.eventSeats),
          sections: groupSeatMap({
            sections: plan.sections,
            rows: plan.rows,
            seats: plan.eventSeats.map((eventSeat) => toPublicSeat(eventSeat, { organiser })),
          }),
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
      // sells its Saturday before its Sunday.
      const windowState = salesWindowState({
        status: session.status === 'SCHEDULED' ? 'ON_SALE' : 'CLOSED',
        salesStartAt: session.salesStartAt,
        salesEndAt: session.salesEndAt,
        now,
      })

      if (windowState !== 'ON_SALE') {
        throw unprocessable(WINDOW_MESSAGE[windowState] ?? 'This session is not on sale.', {
          windowState,
        })
      }

      // The tier comes from the seats, not from the request. A buyer naming their
      // own ticket type is a buyer choosing what a seat costs.
      const plan = await loadSeatingPlan(prisma, session.id)
      const chosen = plan.eventSeats.filter((eventSeat) =>
        request.body.seatIds.includes(eventSeat.seatId),
      )
      const ticketTypeId = chosen[0]?.ticketTypeId

      if (!ticketTypeId) {
        throw unprocessable('Those seats are not on sale at this session.')
      }

      const tier = await prisma.ticketType.findUnique({ where: { id: ticketTypeId } })

      if (!tier) throw notFound('No such ticket type.')

      // A guest hold is owned by a one-time token; a signed-in buyer's hold is
      // owned by their account. Exactly one of the two, which the database also
      // enforces — see `ticket_hold_single_owner`.
      const guest = request.actor ? null : createGuestHoldToken()

      const { hold, eventSeatIds } = await holdSeats(prisma, {
        eventSessionId: session.id,
        seatIds: request.body.seatIds,
        maxPerOrder: tier.maxPerOrder,
        hold: {
          ticketTypeId,
          quantity: request.body.seatIds.length,
          expiresAt: new Date(now.getTime() + holdTtlSeconds(env) * 1000),
          userId: request.actor?.id ?? null,
          guestTokenHash: guest?.tokenHash ?? null,
        },
      })

      const taken = plan.eventSeats.filter((eventSeat) => eventSeatIds.includes(eventSeat.id))
      const subtotalCents = taken.reduce(
        (total, eventSeat) => total + (eventSeat.priceCentsOverride ?? tier.priceCents),
        0,
      )

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
          currency: tier.currency,
        },
      }
    },
  })
}
