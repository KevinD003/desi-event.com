/**
 * Build a configured Fastify instance.
 *
 * Everything the application touches from outside — the database, the payment
 * and messaging providers, the logger, the clock's worth of configuration — is
 * passed in. Nothing is imported for its side effects and nothing is
 * constructed here. That is what lets the whole HTTP surface be exercised with
 * `app.inject()` against a stubbed Prisma client and the in-memory providers,
 * with no PostgreSQL, no Redis and no network anywhere in the test run.
 *
 * @module @desi-event/api/app
 */

import Fastify from 'fastify'
import { PAYMENT_MODES, parseOrThrow } from '@desi-event/schemas'
import { apiEnvSchema } from '@desi-event/schemas/env'
import { assertPaymentModeAllowed } from '@desi-event/providers'

import { registerAuth } from './plugins/auth.js'
import { registerDocs } from './plugins/docs.js'
import { registerErrorHandler } from './plugins/error-handler.js'
import { registerRateLimit } from './plugins/rate-limit.js'
import { registerSecurity } from './plugins/security.js'
import { registerValidation } from './plugins/validation.js'
import { registerRoutes } from './routes/index.js'
import { generateOrderReference } from './lib/identifiers.js'
import { codeMailerFromEnv } from './lib/code-mailer.js'
import { resolveDeliveryMode } from './lib/delivery.js'
import { createPostgresMediaStorage } from './lib/media-storage.js'

/** Largest request body accepted: comfortably above any legitimate payload. */
export const BODY_LIMIT_BYTES = 1_048_576

/**
 * @typedef {object} BuildAppOptions
 * @property {object} prisma A Prisma client, or any object implementing the delegates the routes use.
 * @property {object} providers A provider registry from `@desi-event/providers`.
 * @property {object} env The API environment; validated here, so a partial object with the required secrets is enough.
 * @property {object} [logger] A pino logger. Fastify creates its own when omitted.
 * @property {object} [redis] An ioredis-compatible client, probed by `GET /health`.
 * @property {string} [version] Version string reported by the health endpoint and the OpenAPI document.
 * @property {boolean} [docs] Whether to mount `/docs` and `/openapi.json`. Defaults to `true`.
 * @property {{global?: object, auth?: object, pass?: object, admission?: object, mediaUpload?: object, mediaRead?: object, organizerInvite?: object, transferMail?: object, quote?: object, trafficBeacon?: object, websiteVisit?: object}} [rateLimit] Rate-limit overrides. `trafficBeacon` takes `max` (per visitor, from `TRAFFIC_BEACON_MAX_PER_MINUTE` in `server.js`), `sharedMax`, `timeWindow` and `processMax`; `websiteVisit` takes `max`, `sharedMax`, `timeWindow` and `eventMax` (counted visits per event a minute).
 * @property {object} [mediaStorage] Where picture bytes live. Defaults to the PostgreSQL adapter; see `lib/media-storage.js`.
 * @property {Record<string, string|undefined>} [processEnv] Environment the payment kill switch inspects. Defaults to the process environment; a test passes its own.
 * @property {function(object): Promise<void>} [deliver] A delivery hook injected by a caller (tests). It receives the auth routes' single-use links and the show-once codes alike. Without one, codes are emailed only when `DELIVERY_MODE=EMAIL` names an SMTP server (`lib/code-mailer.js`), and auth links are never emailed — see `lib/delivery.js`.
 */

/**
 * Build the API.
 *
 * @param {BuildAppOptions} options Injected dependencies and configuration.
 * @returns {Promise<object>} A Fastify instance that has not yet started listening.
 * @throws {Error} When the environment is missing or malformed.
 */
export async function buildApp(options) {
  const {
    prisma,
    providers,
    env: rawEnv,
    logger,
    redis,
    version = '0.1.0',
    docs = true,
    rateLimit = {},
    processEnv = process.env,
    deliver,
    payments: paymentsOverride,
    processInline = false,
    mediaStorage: mediaStorageOverride,
  } = options

  if (!prisma) throw new TypeError('buildApp requires a prisma client')
  if (!providers) throw new TypeError('buildApp requires a provider registry')

  const env = parseOrThrow(apiEnvSchema, rawEnv ?? {}, 'Invalid API environment')

  // How show-once codes reach people, decided once. An injected hook wins;
  // otherwise EMAIL with an SMTP server builds the mailer. EMAIL named with no
  // way to send throws here, before anything listens: an invitation nobody can
  // receive is worse than a deployment that will not start.
  //
  // Only the code routes (teams, tickets, organiser invitations) get the
  // mailer. Account-confirmation and password-reset links are links carrying
  // a token, and a credential never goes in a URL, so they are not emailed in
  // any mode: the auth routes keep only an injected hook.
  const codeDeliver = deliver ?? codeMailerFromEnv(env)
  const deliveryMode = resolveDeliveryMode({ env, deliver: codeDeliver })

  // Before anything is built: decide the payment mode, or refuse to start.
  // Two modes are permitted and neither moves real money; a live credential, a
  // request for production, an incomplete sandbox configuration or a secret in a
  // browser-readable variable all stop the boot here rather than at a buyer.
  //
  // The schema above strips unknown variables, so the gate reads the unparsed
  // environment — a stray STRIPE_SECRET_KEY has to be visible to it.
  // The gate always runs, even when a caller supplies a resolution: a test that
  // hands in sandbox credentials must not be a way past the kill switch. The
  // supplied resolution replaces the *result*, never the check, and it cannot
  // name a mode the gate would have refused.
  const gated = assertPaymentModeAllowed({
    env: { ...processEnv, ...(rawEnv ?? {}) },
    logger,
  })
  const payments = paymentsOverride ?? gated

  if (payments.live === true || !Object.values(PAYMENT_MODES).includes(payments.mode)) {
    throw new TypeError(
      `A payment mode of "${payments.mode}" was supplied, which is not one this system runs. ` +
        'Only mock and stripe_test exist, and neither moves real money.',
    )
  }

  const app = Fastify({
    ...(logger ? { loggerInstance: logger } : { logger: false }),
    bodyLimit: BODY_LIMIT_BYTES,
    // X-Forwarded-For is not trusted: a spoofable client address would let one
    // caller spread its requests across unlimited rate-limit buckets.
    trustProxy: false,
    genReqId: () => generateOrderReference(),
  })

  app.decorate('prisma', prisma)
  app.decorate('providers', providers)
  app.decorate('env', env)
  app.decorate('payments', payments)
  app.decorate('deliveryMode', deliveryMode)

  // Picture bytes: in PostgreSQL unless a caller supplies another adapter.
  const mediaStorage = mediaStorageOverride ?? createPostgresMediaStorage(prisma)

  app.decorate('mediaStorage', mediaStorage)

  // The mode and nothing else: no code exists yet, and none is ever logged.
  app.log.info(
    { deliveryMode, smtp: Boolean(!deliver && codeDeliver) },
    'single-use codes are delivered in this mode',
  )

  await registerValidation(app)
  await registerErrorHandler(app, { nodeEnv: env.NODE_ENV })
  await registerSecurity(app, { corsOrigin: env.CORS_ORIGIN })
  await registerRateLimit(app, { global: rateLimit.global })
  await registerAuth(app, { prisma, env })

  if (docs) await registerDocs(app, { version })

  registerRoutes(app, {
    prisma,
    providers,
    env,
    redis,
    version,
    payments,
    authLimit: rateLimit.auth,
    organizerInviteLimit: rateLimit.organizerInvite,
    transferMailLimit: rateLimit.transferMail,
    passLimit: rateLimit.pass,
    admissionLimit: rateLimit.admission,
    deliver,
    codeDeliver,
    deliveryMode,
    mediaStorage,
    mediaUploadLimit: rateLimit.mediaUpload,
    mediaReadLimit: rateLimit.mediaRead,
    quoteLimit: rateLimit.quote,
    trafficBeaconLimit: rateLimit.trafficBeacon,
    websiteVisitLimit: rateLimit.websiteVisit,
    processInline,
  })

  return app
}

export default buildApp
