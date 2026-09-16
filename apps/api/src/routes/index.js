/**
 * Route registration.
 *
 * Every endpoint in `@desi-event/api-contract` is wired here. The contract test
 * asserts that the two lists match, so an endpoint added to the contract and
 * forgotten here fails the suite rather than 404ing in production.
 *
 * @module @desi-event/api/routes
 */

import { registerAnalyticsRoutes } from './analytics.js'
import { registerAuthRoutes } from './auth.js'
import { registerSessionRoutes } from './sessions.js'
import { installRawBodyParser, registerWebhookRoutes } from './webhooks.js'
import { registerTeamRoutes } from './teams.js'
import { registerEventRoutes } from './events.js'
import { registerFinanceRoutes } from './finance.js'
import { registerHealthRoutes } from './health.js'
import { registerHoldRoutes } from './holds.js'
import { registerEventAuthoringRoutes } from './event-authoring.js'
import { registerModerationRoutes } from './moderation.js'
import { registerOrganizerRoutes } from './organizers.js'
import { registerPublicVenueRoutes, registerVenueMapRoutes, registerVenueRoutes } from './venues.js'
import { registerOrderRoutes } from './orders.js'
import { registerOperationsRoutes } from './operations.js'
import { registerPaymentRoutes } from './payments.js'
import { registerReconciliationRoutes } from './reconciliation.js'
import { registerRefundRoutes } from './refunds.js'
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
  registerOrganizerRoutes(app, deps)
  registerVenueRoutes(app, deps)
  registerVenueMapRoutes(app, deps)
  registerPublicVenueRoutes(app, deps)
  registerEventRoutes(app, deps)
  registerEventAuthoringRoutes(app, deps)
  registerModerationRoutes(app, deps)
  registerTicketTypeRoutes(app, deps)
  registerSessionRoutes(app, deps)
  registerHoldRoutes(app, deps)
  registerOrderRoutes(app, deps)
  registerOperationsRoutes(app, deps)
  registerPaymentRoutes(app, deps)
  registerRefundRoutes(app, deps)
  registerReconciliationRoutes(app, deps)
  registerFinanceRoutes(app, deps)
  registerAnalyticsRoutes(app, deps)

  // Scoped, so the raw-body parser applies to the webhook routes and nowhere
  // else. A global raw parser would silently stop validating every other request
  // body in the application.
  app.register(async (scope) => {
    installRawBodyParser(scope)
    registerWebhookRoutes(scope, deps)
  })

  registerTicketRoutes(app, deps)
  registerWaitlistRoutes(app, deps)
}
