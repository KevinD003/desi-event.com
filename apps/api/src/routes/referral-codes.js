/**
 * Referral codes, for the Desi-Event team (SPEC3 §8): codes that remove the
 * whole booking fee from an order. `referralCodes.list`, `.byAdministrator`,
 * `.create`, `.get`, `.update`, `.switchOff` and `.switchOn`.
 *
 * Registered by SPEC3's foundation stage so the contract, the guards and the
 * budget are in place from the start: the session, `referral_code:manage` and
 * the PAYMENT_TERMS step-up (on create, update and switch-on) come from the
 * contract, and the four writes share one `referral-admin` budget of sixty an
 * hour per administrator. The handlers answer 501 `NOT_BUILT` until the next
 * stage replaces each one with `lib/referral-codes.js`'s (SPEC3 §0.7).
 *
 * No log call here takes a referral code's row or its text.
 *
 * @module @desi-event/api/routes/referral-codes
 */

import { exposedServerError } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'
import { DEFAULT_REFERRAL_ADMIN_LIMIT, actorBudget } from '../plugins/rate-limit.js'

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
 * Register the referral code routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {{max?: number, timeWindow?: string|number}} [deps.referralAdminLimit] Overrides for the `referral-admin` budget.
 * @returns {void} Nothing.
 */
export function registerReferralCodeRoutes(app, { referralAdminLimit = {} } = {}) {
  // One budget for every write: making, changing and switching codes draw on
  // the same sixty an hour (SPEC3 §4.4).
  const budget = actorBudget({
    name: 'referral-admin',
    ...DEFAULT_REFERRAL_ADMIN_LIMIT,
    ...referralAdminLimit,
  })

  defineRoute(app, 'referralCodes.list', { handler: notBuilt })
  defineRoute(app, 'referralCodes.byAdministrator', { handler: notBuilt })
  defineRoute(app, 'referralCodes.create', { preHandler: [budget], handler: notBuilt })
  defineRoute(app, 'referralCodes.get', { handler: notBuilt })
  defineRoute(app, 'referralCodes.update', { preHandler: [budget], handler: notBuilt })
  defineRoute(app, 'referralCodes.switchOff', { preHandler: [budget], handler: notBuilt })
  defineRoute(app, 'referralCodes.switchOn', { preHandler: [budget], handler: notBuilt })
}
