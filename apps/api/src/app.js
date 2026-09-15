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
import { apiEnvSchema, parseOrThrow } from '@desi-event/schemas'
import { assertPaymentModeAllowed } from '@desi-event/providers'

import { registerAuth } from './plugins/auth.js'
import { registerDocs } from './plugins/docs.js'
import { registerErrorHandler } from './plugins/error-handler.js'
import { registerRateLimit } from './plugins/rate-limit.js'
import { registerSecurity } from './plugins/security.js'
import { registerValidation } from './plugins/validation.js'
import { registerRoutes } from './routes/index.js'
import { generateOrderReference } from './lib/identifiers.js'

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
 * @property {{global?: object, auth?: object}} [rateLimit] Rate-limit overrides.
 * @property {Record<string, string|undefined>} [processEnv] Environment the payment kill switch inspects. Defaults to the process environment; a test passes its own.
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
  } = options

  if (!prisma) throw new TypeError('buildApp requires a prisma client')
  if (!providers) throw new TypeError('buildApp requires a provider registry')

  const env = parseOrThrow(apiEnvSchema, rawEnv ?? {}, 'Invalid API environment')

  // Before anything is built: decide the payment mode, or refuse to start.
  // Two modes are permitted and neither moves real money; a live credential, a
  // request for production, an incomplete sandbox configuration or a secret in a
  // browser-readable variable all stop the boot here rather than at a buyer.
  //
  // The schema above strips unknown variables, so the gate reads the unparsed
  // environment — a stray STRIPE_SECRET_KEY has to be visible to it.
  const payments = assertPaymentModeAllowed({
    env: { ...processEnv, ...(rawEnv ?? {}) },
    logger,
  })

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
  })

  return app
}

export default buildApp
