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
import { registerConnectRoutes } from './connect.js'
import { registerSessionRoutes } from './sessions.js'
import { installRawBodyParser, registerWebhookRoutes } from './webhooks.js'
import { registerTeamRoutes } from './teams.js'
import { registerEventRoutes } from './events.js'
import { registerEventControlRoutes } from './event-control.js'
import { registerEventImportRoutes } from './event-imports.js'
import { registerFinanceRoutes } from './finance.js'
import { registerHealthRoutes } from './health.js'
import { registerHoldRoutes } from './holds.js'
import { installImageBodyParser, registerMediaRoutes } from './media.js'
import { registerEventAuthoringRoutes } from './event-authoring.js'
import { registerModerationRoutes } from './moderation.js'
import { registerOrganizerRoutes } from './organizers.js'
import { registerOrganizationRoutes } from './organizations.js'
import { registerOrganizerInvitationRoutes } from './organizer-invitations.js'
import { registerPlatformRoutes } from './platform.js'
import { registerPublicVenueRoutes, registerVenueMapRoutes, registerVenueRoutes } from './venues.js'
import { registerOrderRoutes } from './orders.js'
import { registerPaymentTermsRoutes } from './payment-terms.js'
import { registerPlatformFeeRoutes } from './platform-fees.js'
import { registerReferralCodeRoutes } from './referral-codes.js'
import { registerOperationsRoutes } from './operations.js'
import { registerPaymentRoutes } from './payments.js'
import { registerPrivacyRoutes } from './privacy.js'
import { registerPromoCodeRoutes } from './promo-codes.js'
import { registerReconciliationRoutes } from './reconciliation.js'
import { registerRetentionRoutes } from './retention.js'
import { registerRefundRoutes } from './refunds.js'
import { registerTicketRoutes } from './tickets.js'
import { registerTicketTypeRoutes } from './ticket-types.js'
import { registerTrafficRoutes } from './traffic.js'
import { registerVenueBookingRoutes } from './venue-bookings.js'
import { registerVenuePaymentRoutes } from './venue-payments.js'
import { registerWaitlistRoutes } from './waitlist.js'
import { registerWebsiteRedirectRoutes } from './website-redirect.js'

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
 * @param {{max?: number, timeWindow?: string|number}} [deps.passLimit] Overrides for the admission-pass rate limit, shared by a ticket's pass and an order's group pass.
 * @param {{max?: number, timeWindow?: string|number}} [deps.admissionLimit] Overrides for the door (preview and check-in, single and group) rate limit.
 * @param {function(object): Promise<void>} [deps.deliver] Where the auth routes' single-use links are sent: only an injected hook, never the mailer.
 * @param {function(object): Promise<void>} [deps.codeDeliver] Where show-once codes are sent in EMAIL mode: the injected hook, or the SMTP mailer.
 * @param {{max?: number, timeWindow?: string|number}} [deps.organizerInviteLimit] Overrides for the organiser-invitation budget.
 * @param {{max?: number, timeWindow?: string|number}} [deps.platformEditLimit] Overrides for the platform editing-sitting budget.
 * @param {{max?: number, timeWindow?: string|number}} [deps.eventImportLimit] Overrides for the import budget.
 * @param {Function} [deps.fetchImportImage] How an import copies one picture.
 * @param {{max?: number, timeWindow?: string|number}} [deps.transferMailLimit] Overrides for the ticket-transfer mail budget.
 * @param {'MANUAL'|'EMAIL'} [deps.deliveryMode] How single-use codes reach people, resolved once by `buildApp`.
 * @param {object} [deps.mediaStorage] Where picture bytes live; see `lib/media-storage.js`.
 * @param {{max?: number, timeWindow?: string|number}} [deps.mediaUploadLimit] Overrides for the picture-upload rate limit.
 * @param {{max?: number, timeWindow?: string|number}} [deps.mediaReadLimit] Overrides for the picture-read rate limit.
 * @param {{max?: number, timeWindow?: string|number}} [deps.quoteLimit] Overrides for the checkout-quote rate limit.
 * @param {{max?: number, sharedMax?: number, timeWindow?: string|number, processMax?: number}} [deps.trafficBeaconLimit] Overrides for the visit-beacon limits.
 * @param {{max?: number, sharedMax?: number, timeWindow?: string|number, eventMax?: number}} [deps.websiteVisitLimit] Overrides for the website-link lookup's limits.
 * @param {{max?: number, timeWindow?: string|number}} [deps.paymentTermsLimit] Overrides for the booking fee and pay-at-the-venue budget (SPEC3 §4.4).
 * @param {{max?: number, timeWindow?: string|number}} [deps.referralAdminLimit] Overrides for the referral-code administration budget.
 * @param {{max?: number, timeWindow?: string|number}} [deps.feeRefundLimit] Overrides for the booking-fee refund limit.
 * @param {{max?: number, timeWindow?: string|number}} [deps.venueCancelLimit] Overrides for the unpaid-tickets cancel limit (SPEC3-XI §4.4).
 * @param {{actorMax?: number, addressMax?: number, sharedMax?: number, timeWindow?: string|number}} [deps.referralAttemptLimit] Overrides for the wrong referral codes budget the checkout routes share.
 * @returns {void} Nothing.
 */
export function registerRoutes(app, deps) {
  // The routes that issue show-once codes send them through `codeDeliver`;
  // the auth routes keep `deliver`, which only a caller injects.
  const codeDeps = { ...deps, deliver: deps.codeDeliver ?? deps.deliver }

  registerHealthRoutes(app, deps)
  registerAuthRoutes(app, deps)
  registerTeamRoutes(app, codeDeps)
  registerOrganizerRoutes(app, deps)
  registerOrganizationRoutes(app, deps)
  registerPlatformRoutes(app, deps)
  registerOrganizerInvitationRoutes(app, codeDeps)
  registerVenueRoutes(app, deps)
  registerVenueMapRoutes(app, deps)
  registerPublicVenueRoutes(app, deps)
  registerEventRoutes(app, deps)
  registerEventAuthoringRoutes(app, deps)
  registerEventControlRoutes(app, deps)
  registerEventImportRoutes(app, deps)
  registerModerationRoutes(app, deps)
  registerWebsiteRedirectRoutes(app, deps)
  registerTicketTypeRoutes(app, deps)
  registerSessionRoutes(app, deps)
  registerHoldRoutes(app, deps)
  registerOrderRoutes(app, deps)
  // Booking fees, referral codes and paying at the venue (SPEC3 §11.1).
  registerPaymentTermsRoutes(app, deps)
  registerReferralCodeRoutes(app, deps)
  registerPlatformFeeRoutes(app, deps)
  registerVenuePaymentRoutes(app, deps)
  // Unpaid pay-at-the-venue tickets cancelled (SPEC3-XI §11.1).
  registerVenueBookingRoutes(app, deps)
  registerPromoCodeRoutes(app, deps)
  registerOperationsRoutes(app, deps)
  registerPaymentRoutes(app, deps)
  registerRefundRoutes(app, deps)
  registerReconciliationRoutes(app, deps)
  registerFinanceRoutes(app, deps)
  registerAnalyticsRoutes(app, deps)
  registerTrafficRoutes(app, deps)
  registerPrivacyRoutes(app, deps)
  registerRetentionRoutes(app, deps)
  registerConnectRoutes(app, deps)

  // Scoped, so the raw-body parser applies to the webhook routes and nowhere
  // else. A global raw parser would silently stop validating every other request
  // body in the application.
  app.register(async (scope) => {
    installRawBodyParser(scope)
    registerWebhookRoutes(scope, deps)
  })

  // Scoped for the same reason: the picture upload's body is bytes with a
  // 10 MiB limit, and every other route keeps its 1 MiB JSON body.
  app.register(async (scope) => {
    installImageBodyParser(scope)
    registerMediaRoutes(scope, deps)
  })

  registerTicketRoutes(app, codeDeps)
  registerWaitlistRoutes(app, deps)
}
