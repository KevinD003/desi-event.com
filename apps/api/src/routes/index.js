/**
 * Route registration.
 *
 * Every endpoint in `@desi-event/api-contract` is wired here. The contract test
 * asserts that the two lists match, so an endpoint added to the contract and
 * forgotten here fails the suite rather than 404ing in production.
 *
 * @module @desi-event/api/routes
 */

import { registerAuthRoutes } from './auth.js'
import { registerTeamRoutes } from './teams.js'
import { registerEventRoutes } from './events.js'
import { registerHealthRoutes } from './health.js'
import { registerHoldRoutes } from './holds.js'
import { registerOrderRoutes } from './orders.js'
import { registerPaymentRoutes } from './payments.js'
import { registerTicketRoutes } from './tickets.js'
import { registerTicketTypeRoutes } from './ticket-types.js'
import { registerWaitlistRoutes } from './waitlist.js'

/**
 * Register every API route on an instance.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.providers The provider registry.
 * @param {object} deps.env The parsed API environment.
 * @param {object} [deps.redis] An optional ioredis-compatible client for the health probe.
 * @param {string} [deps.version] Version string reported by the health endpoint.
 * @param {object} [deps.payments] The resolved payment mode, reported by the health endpoint.
 * @param {{max?: number, timeWindow?: string|number}} [deps.authLimit] Overrides for the credential-endpoint rate limit.
 * @param {function(object): Promise<void>} [deps.deliver] Where a single-use link is sent.
 * @returns {void} Nothing.
 */
export function registerRoutes(app, deps) {
  registerHealthRoutes(app, deps)
  registerAuthRoutes(app, deps)
  registerTeamRoutes(app, deps)
  registerEventRoutes(app, deps)
  registerTicketTypeRoutes(app, deps)
  registerHoldRoutes(app, deps)
  registerOrderRoutes(app, deps)
  registerPaymentRoutes(app, deps)
  registerTicketRoutes(app, deps)
  registerWaitlistRoutes(app, deps)
}
