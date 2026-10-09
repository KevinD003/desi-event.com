/**
 * An event's payments taken at the door and its bookings still unpaid there,
 * for the organiser's "Payments at the venue" page (SPEC3 §9.8):
 * `venuePayments.report`.
 *
 * Registered by SPEC3's foundation stage so the contract and the FINANCE_VIEW
 * step-up are in place from the start; who may read it (`finance:view` in the
 * event's organisation, or platform `finance:view`; anybody else 404) is the
 * handler's, because the organisation is known only once the event is read.
 * The handler answers 501 `NOT_BUILT` until the next stage replaces it with
 * `lib/venue-payments.js`'s (SPEC3 §0.7).
 *
 * @module @desi-event/api/routes/venue-payments
 */

import { exposedServerError } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'

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
 * Register the payments-at-the-venue report route.
 *
 * @param {object} app The Fastify instance.
 * @returns {void} Nothing.
 */
export function registerVenuePaymentRoutes(app) {
  defineRoute(app, 'venuePayments.report', { handler: notBuilt })
}
