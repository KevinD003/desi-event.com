/**
 * An event's booking fee (the platform fee) and its pay-at-the-venue switch,
 * for the Desi-Event team (SPEC3 §7, §9.1): `paymentTerms.get`,
 * `paymentTerms.setFee` and `paymentTerms.setVenuePayment`.
 *
 * Registered by SPEC3's foundation stage so the contract, the guards and the
 * budget are in place from the start: the session, `payment_terms:manage` and
 * the PAYMENT_TERMS step-up come from the contract (`defineRoute`), and the two
 * writes share one `payment-terms` budget of sixty an hour per administrator.
 * The handlers answer 501 `NOT_BUILT` until the next stage replaces each one
 * with `lib/payment-terms.js`'s (SPEC3 §0.7: no stub ships).
 *
 * @module @desi-event/api/routes/payment-terms
 */

import { exposedServerError } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'
import { DEFAULT_PAYMENT_TERMS_LIMIT, actorBudget } from '../plugins/rate-limit.js'

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
 * Register the booking fee and pay-at-the-venue routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {{max?: number, timeWindow?: string|number}} [deps.paymentTermsLimit] Overrides for the `payment-terms` budget.
 * @returns {void} Nothing.
 */
export function registerPaymentTermsRoutes(app, { paymentTermsLimit = {} } = {}) {
  // One budget for both writes: a change of fee and a change of the switch
  // draw on the same sixty an hour (SPEC3 §4.4).
  const budget = actorBudget({
    name: 'payment-terms',
    ...DEFAULT_PAYMENT_TERMS_LIMIT,
    ...paymentTermsLimit,
  })

  defineRoute(app, 'paymentTerms.get', { handler: notBuilt })
  defineRoute(app, 'paymentTerms.setFee', { preHandler: [budget], handler: notBuilt })
  defineRoute(app, 'paymentTerms.setVenuePayment', { preHandler: [budget], handler: notBuilt })
}
