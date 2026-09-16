/**
 * Registering a contract route on a Fastify instance.
 *
 * Every endpoint is declared once, in `@desi-event/api-contract`. Handlers are
 * attached to those descriptors by id, which means a route cannot exist in the
 * server without existing in the published document, a path cannot be typed
 * differently in the two places, and the auth mode declared in the contract is
 * the auth mode actually enforced.
 *
 * @module @desi-event/api/lib/register
 */

import { AUTHENTICATED_MODES, routeById } from '@desi-event/api-contract'

import { routeSchema } from './validation.js'

/**
 * Attach a handler to the contract route with the given id.
 *
 * The `auth` mode from the descriptor selects the guard: `session` installs
 * `app.requireSession` (cookie or bearer), `bearer` installs `app.authenticate`
 * (bearer only), `optional` installs `app.optionalAuth`, and `none` installs
 * neither. Forgetting to protect a route is therefore not something a handler
 * author can do by omission.
 *
 * The guard runs as an `onRequest` hook, not a `preHandler`. Fastify validates
 * the body before `preHandler`, so a `preHandler` guard would let an anonymous
 * caller learn the shape of a protected endpoint from its 400 responses. At
 * `onRequest` the 401 comes first and the body is never even parsed.
 *
 * A declared `capability` and `stepUp` install *preHandlers* rather than
 * `onRequest` hooks, and that difference is deliberate: a capability check often
 * reads `organizationId` from the body, which does not exist until Fastify has
 * parsed and validated it. The ordering that follows — 401 before 400 before 403
 * — is the right one anyway: an anonymous caller learns nothing, a signed-in
 * caller with a malformed request is told what is malformed, and a well-formed
 * request from somebody without the power is refused.
 *
 * @param {object} app The Fastify instance.
 * @param {string} id The contract route id, e.g. `events.list`.
 * @param {object} options Route options.
 * @param {Function} options.handler The request handler; it receives `(request, reply)`.
 * @param {object} [options.config] Fastify route `config`, e.g. a per-route rate limit.
 * @param {Array<Function>} [options.preHandler] Extra preHandlers appended after the auth guard.
 * @returns {object} The contract descriptor the route was registered from.
 * @throws {Error} When no route has that id.
 */
export function defineRoute(app, id, options) {
  const route = routeById(id)
  const { handler, config, preHandler = [] } = options

  /** @type {Array<Function>} */
  const guards = []
  if (route.auth === 'session') guards.push(app.requireSession)
  if (route.auth === 'bearer') guards.push(app.authenticate)
  if (route.auth === 'optional') guards.push(app.optionalAuth)

  /** @type {Array<Function>} */
  const declared = []

  // Finding NF-12, and first in the list: a privileged account with no second
  // factor is refused before any capability is even consulted. The exemptions —
  // enrolling, reading your own profile, managing sessions, changing your
  // password, signing out — are declared in the contract, so what an un-enrolled
  // privileged user may still reach is reviewable in one place rather than
  // inferred from a path match.
  if (AUTHENTICATED_MODES.includes(route.auth) && !route.mfaExempt) {
    declared.push(app.requireMfaEnrolment)
  }

  if (route.capability)
    declared.push(app.requireCapability(route.capability, route.capabilityScope))
  // The window comes from the contract's named policy, not from the request and
  // not from a module default — finding NF-11.
  if (route.stepUp) declared.push(app.requireStepUp(route.stepUp))

  // The contract's requirements come first: a route's own preHandlers are for
  // loading resources, and they should not run for a caller who is about to be
  // refused.
  const preHandlers = [...declared, ...preHandler]

  app.route({
    method: route.method,
    url: route.path,
    schema: routeSchema(route),
    ...(config ? { config } : {}),
    ...(guards.length > 0 ? { onRequest: guards } : {}),
    ...(preHandlers.length > 0 ? { preHandler: preHandlers } : {}),
    /**
     * Apply the descriptor's success status, then run the handler.
     *
     * In that order, so a handler can *choose* a different one. Applying it
     * afterwards looks equivalent and is not: a handler answering 200 where the
     * contract declares 201 — an idempotent retry that created nothing — is
     * indistinguishable afterwards from a handler that set nothing, because
     * Fastify's own default is also 200. Set first, the contract's status is
     * what a handler that says nothing gets, and a handler that says something
     * is believed.
     *
     * An error thrown from the handler is unaffected: the error handler sets
     * the status from the error itself.
     *
     * @param {object} request The incoming request.
     * @param {object} reply The reply.
     * @returns {Promise<unknown>} The response payload.
     */
    handler: async (request, reply) => {
      if (route.successStatus !== 200) reply.code(route.successStatus)

      return handler(request, reply)
    },
  })

  return route
}
