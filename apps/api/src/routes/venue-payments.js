/**
 * An event's payments taken at the door and its bookings still unpaid there,
 * for the organiser's "Payments at the venue" page (SPEC3 §9.8, SPEC3-XI
 * §9.8): `venuePayments.report`.
 *
 * The contract runs the session and the FINANCE_VIEW step-up first. Who may
 * read it is decided here, once the event is read, because the organisation is
 * known only then: a member whose role holds `finance:view` in the event's
 * organisation, or a platform role holding `finance:view`. Anybody else gets
 * the same 404 as an event that does not exist. The money taken at the door is
 * the organiser's; the report is what Desi-Event recorded of it
 * (`lib/venue-payments.js`).
 *
 * @module @desi-event/api/routes/venue-payments
 */

import { notFound } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'
import { venuePaymentReader, venuePaymentsReport } from '../lib/venue-payments.js'

/** The one answer for an event that does not exist and one the reader may not see. */
const NO_SUCH_EVENT = 'No such event.'

/**
 * Register the payments-at-the-venue report route.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerVenuePaymentRoutes(app, { prisma }) {
  defineRoute(app, 'venuePayments.report', {
    handler: async (request, reply) => {
      // Who paid what at the door, and buyers' names: never cached anywhere.
      reply.header('cache-control', 'no-store, private')

      const event = await prisma.event.findUnique({
        where: { id: request.params.id },
        select: {
          id: true,
          organizationId: true,
          status: true,
          endsAt: true,
          sessions: { select: { id: true, status: true, endsAt: true } },
        },
      })

      if (!event) throw notFound(NO_SUCH_EVENT)

      const reader = venuePaymentReader(request.actor, event.organizationId)

      if (!reader) throw notFound(NO_SUCH_EVENT)

      const { page, perPage } = request.query ?? {}

      return {
        data: await venuePaymentsReport(prisma, {
          event,
          actor: request.actor,
          reader,
          page,
          perPage,
        }),
      }
    },
  })
}
