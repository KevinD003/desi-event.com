/**
 * Cancelling unpaid pay-at-the-venue tickets (SPEC3-XI XU, §11.1):
 * `venueBookings.unpaid` and `venueBookings.cancel`.
 *
 * Registered by the foundation addendum (Stage AX3) so the contract, the
 * guards and the budget are in place before the handlers exist: the session,
 * the FINANCE_VIEW step-up on the list and the FINANCE_ACTION step-up on the
 * cancel come from the contract and run before any handler, so a caller
 * without a recent second factor is asked for one before anything else is
 * answered, and that answer discloses no booking. Who may act (a membership in
 * the event's organisation that grants `order:refund`, or the platform-only
 * `venue_booking:cancel`; everybody else 404, `CONFLICT_OF_INTEREST` 403 for a
 * platform administrator whose membership does not grant it) is the handler's,
 * because the organisation is known only once the order or the event is read
 * (`lib/venue-bookings.js`, Stage B1-V). The cancel carries its own limit of
 * sixty an hour per person (`venue-cancel:actor:<id>`). Both handlers answer
 * 501 `NOT_BUILT` until Stage B1-V replaces them.
 *
 * @module @desi-event/api/routes/venue-bookings
 */

import { exposedServerError } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'
import { venueCancelRateLimit } from '../plugins/rate-limit.js'

/** What a route answers until its handler is built. */
const NOT_BUILT = 'NOT_BUILT'

/**
 * The handler of a route registered before it was built: never cached, and a
 * 501 that says so.
 *
 * @param {object} _request The request.
 * @param {object} reply The reply.
 * @returns {Promise<never>} Never resolves.
 * @throws {Error} Always: 501 `NOT_BUILT`.
 */
async function notBuilt(_request, reply) {
  reply.header('cache-control', 'no-store, private')

  throw exposedServerError(501, NOT_BUILT, 'This route has no handler in this build.')
}

/**
 * Register the unpaid-bookings list and the cancel route.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {{max?: number, timeWindow?: string|number}} [deps.venueCancelLimit] Overrides for the cancel's limit.
 * @returns {void} Nothing.
 */
export function registerVenueBookingRoutes(app, { venueCancelLimit = {} } = {}) {
  defineRoute(app, 'venueBookings.unpaid', { handler: notBuilt })
  defineRoute(app, 'venueBookings.cancel', {
    config: { rateLimit: venueCancelRateLimit(venueCancelLimit) },
    handler: notBuilt,
  })
}
