/**
 * Refunding one order's booking fee by hand, for the Desi-Event team (SPEC3
 * §7.4): `platformFees.preview` and `platformFees.refund`.
 *
 * Registered by SPEC3's foundation stage so the contract, the guards and the
 * budget are in place from the start: the session, `platform_fee:refund` and,
 * on the refund, the FINANCE_ACTION step-up come from the contract, and the
 * refund carries its own limit of thirty an hour per administrator
 * (`fee-refund:actor:<id>`). The handlers answer 501 `NOT_BUILT` until the next
 * stage replaces each one (SPEC3 §0.7).
 *
 * @module @desi-event/api/routes/platform-fees
 */

import { exposedServerError } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'
import { feeRefundRateLimit } from '../plugins/rate-limit.js'

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
 * Register the booking-fee refund routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {{max?: number, timeWindow?: string|number}} [deps.feeRefundLimit] Overrides for the refund's limit.
 * @returns {void} Nothing.
 */
export function registerPlatformFeeRoutes(app, { feeRefundLimit = {} } = {}) {
  defineRoute(app, 'platformFees.preview', { handler: notBuilt })
  defineRoute(app, 'platformFees.refund', {
    config: { rateLimit: feeRefundRateLimit(feeRefundLimit) },
    handler: notBuilt,
  })
}
