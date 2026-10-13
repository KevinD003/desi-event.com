/**
 * Cancelling unpaid pay-at-the-venue tickets (SPEC3-XI XU, §11.1):
 * `venueBookings.unpaid` and `venueBookings.cancel`.
 *
 * The session, the FINANCE_VIEW step-up on the list and the FINANCE_ACTION
 * step-up on the cancel come from the contract and run before either handler,
 * so a caller without a recent second factor is asked for one before anything
 * else is answered, and that answer discloses no booking. Who may act is the
 * handler's, because the organisation is known only once the event or the
 * order is read (`venueCancellationAuthority`, `lib/venue-bookings.js`): an
 * organisation member whose own role may refund the organisation's orders
 * (OWNER, ADMIN), or a platform administrator holding `venue_booking:cancel`
 * (ADMIN, SUPER_ADMIN) who does not belong to the organisation. Anybody else
 * gets 404 from both; a platform administrator who belongs to the
 * organisation in a role that may not refund is refused the cancel with 403
 * `CONFLICT_OF_INTEREST` and gets 404 from the list. The cancel carries its
 * own limit of sixty an hour per person (`venue-cancel:actor:<id>`). Both
 * answer `cache-control: no-store, private`.
 *
 * @module @desi-event/api/routes/venue-bookings
 */

import { notFound } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'
import {
  cancelUnpaidVenueTickets,
  unpaidVenueBookings,
  venueCancellationAuthority,
} from '../lib/venue-bookings.js'
import { venueCancelRateLimit } from '../plugins/rate-limit.js'

/** The one answer for an event a reader may not see the bookings of. */
const NO_SUCH_EVENT = 'No such event.'

/**
 * Register the unpaid-bookings list and the cancel route.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {{max?: number, timeWindow?: string|number}} [deps.venueCancelLimit] Overrides for the cancel's limit.
 * @returns {void} Nothing.
 */
export function registerVenueBookingRoutes(app, { prisma, venueCancelLimit = {} } = {}) {
  defineRoute(app, 'venueBookings.unpaid', {
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store, private')

      const event = await prisma.event.findUnique({
        where: { id: request.params.id },
        select: { id: true, title: true, organizationId: true, endsAt: true, timezone: true },
      })

      if (!event) throw notFound(NO_SUCH_EVENT)

      const reader = venueCancellationAuthority(request.actor, event)

      // A reader without the authority, and one refused for a conflict of
      // interest, are both answered as if the event had no such list.
      if (!reader || reader.refusal) throw notFound(NO_SUCH_EVENT)

      const { page, perPage, order = null } = request.query ?? {}

      return {
        data: await unpaidVenueBookings(prisma, {
          event,
          reader,
          orderReference: order,
          page,
          perPage,
          now: new Date(),
        }),
      }
    },
  })

  defineRoute(app, 'venueBookings.cancel', {
    config: { rateLimit: venueCancelRateLimit(venueCancelLimit) },
    handler: async (request, reply) => {
      reply.header('cache-control', 'no-store, private')

      const { ticketIds, reason } = request.body

      return {
        data: await cancelUnpaidVenueTickets(prisma, {
          reference: request.params.reference,
          ticketIds,
          reason,
          actor: request.actor,
          now: new Date(),
          requestId: request.id,
          log: request.log,
        }),
      }
    },
  })
}
