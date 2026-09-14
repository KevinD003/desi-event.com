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

import { routeById } from '@desi-event/api-contract'

import { routeSchema } from './validation.js'

/**
 * Attach a handler to the contract route with the given id.
 *
 * The `auth` mode from the descriptor selects the guard: `bearer` installs
 * `app.authenticate`, `optional` installs `app.optionalAuth`, and `none`
 * installs neither. Forgetting to protect a route is therefore not something a
 * handler author can do by omission.
 *
 * The guard runs as an `onRequest` hook, not a `preHandler`. Fastify validates
 * the body before `preHandler`, so a `preHandler` guard would let an anonymous
 * caller learn the shape of a protected endpoint from its 400 responses. At
 * `onRequest` the 401 comes first and the body is never even parsed.
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
  if (route.auth === 'bearer') guards.push(app.authenticate)
  if (route.auth === 'optional') guards.push(app.optionalAuth)

  app.route({
    method: route.method,
    url: route.path,
    schema: routeSchema(route),
    ...(config ? { config } : {}),
    ...(guards.length > 0 ? { onRequest: guards } : {}),
    ...(preHandler.length > 0 ? { preHandler } : {}),
    /**
     * Run the handler and apply the descriptor's declared success status.
     *
     * @param {object} request The incoming request.
     * @param {object} reply The reply.
     * @returns {Promise<unknown>} The response payload.
     */
    handler: async (request, reply) => {
      const payload = await handler(request, reply)

      // A handler that has already chosen a status (an idempotent no-op, say)
      // keeps it; otherwise the contract's success status applies.
      if (!reply.sent && reply.statusCode === 200 && route.successStatus !== 200) {
        reply.code(route.successStatus)
      }

      return payload
    },
  })

  return route
}
