/**
 * Test harness: build the real application against a stubbed database and the
 * in-memory providers.
 *
 * Nothing here replaces application code with a mock. The routes, plugins,
 * validation, permissions, pricing and inventory rules under test are the same
 * ones a deployment runs; only the two edges — PostgreSQL and the outside
 * world — are substituted.
 *
 * @module @desi-event/api/tests/helpers/app
 */

import { createInMemoryProviderRegistry } from '@desi-event/providers'

import { buildApp } from '../../src/app.js'
import { createPrismaStub } from './prisma-stub.js'
import { makeWorld } from './fixtures.js'

/** A JWT secret long enough for `apiEnvSchema`, and obviously not a real one. */
import { taxRateBpsForCurrency } from '@desi-event/pricing'

import { feeConfigFor } from '../../src/routes/orders.js'

export const TEST_JWT_SECRET = 'test-only-secret-that-is-long-enough-32'

/**
 * Build a valid API environment for tests.
 *
 * @param {object} [overrides] Variables to override.
 * @returns {object} An environment object `apiEnvSchema` accepts.
 */
export function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_SECRET: TEST_JWT_SECRET,
    JWT_EXPIRES_IN: '7d',
    API_PORT: 4000,
    API_HOST: '127.0.0.1',
    CORS_ORIGIN: '*',
    PLATFORM_FEE_BPS: 590,
    PLATFORM_FEE_FLAT_CENTS: 99,
    TICKET_HOLD_TTL_SECONDS: 600,
    ...overrides,
  }
}

/**
 * Build an application wired to a fresh stub database.
 *
 * @param {object} [options] Harness options.
 * @param {object} [options.seed] Rows to seed, defaulting to the shared world.
 * @param {object} [options.ids] The fixture ids matching `seed`.
 * @param {object} [options.env] Environment overrides.
 * @param {object} [options.providers] A provider registry; in-memory by default.
 * @param {object} [options.redis] A redis stub for the health probe.
 * @param {boolean} [options.docs] Whether to mount the documentation routes.
 * @param {object} [options.logger] A pino logger; omitted (silent) by default.
 * @param {object} [options.rateLimit] Rate-limit overrides.
 * @returns {Promise<{app: object, prisma: object, providers: object, ids: object}>} The harness.
 */
export async function createTestApp(options = {}) {
  const world = options.seed ? { seed: options.seed, ids: options.ids ?? {} } : await makeWorld()

  const prisma = createPrismaStub(world.seed)
  const providers = options.providers ?? createInMemoryProviderRegistry()

  const app = await buildApp({
    prisma,
    providers,
    env: testEnv(options.env),
    logger: options.logger,
    redis: options.redis,
    docs: options.docs ?? false,
    rateLimit: options.rateLimit ?? { global: { max: 10_000, timeWindow: '1 minute' } },
  })

  await app.ready()

  return { app, prisma, providers, ids: world.ids }
}

/**
 * Sign in and return the bearer token.
 *
 * @param {object} app The Fastify instance.
 * @param {string} email The account's email address.
 * @param {string} [password] The password.
 * @returns {Promise<string>} A bearer token.
 * @throws {Error} When sign-in fails, so a broken fixture surfaces immediately.
 */
export async function signIn(app, email, password = 'correct-horse-battery') {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, password },
  })

  if (response.statusCode !== 200) {
    throw new Error(`Sign-in failed for ${email}: ${response.statusCode} ${response.body}`)
  }

  return response.json().token
}

/**
 * Build an `Authorization` header object.
 *
 * @param {string} token A bearer token.
 * @returns {{authorization: string}} Headers for `app.inject`.
 */
export function bearer(token) {
  return { authorization: `Bearer ${token}` }
}

/**
 * The platform fee terms the API itself would use for a currency.
 *
 * Deliberately routed through the route module's own `feeConfigFor` so a test
 * cannot assert against terms the server has stopped using.
 *
 * @param {string} [currency] ISO 4217 code.
 * @returns {{percentageBps: number, flatCents: number, currency: string}} The fee config.
 */
export function feeConfig(currency = 'INR') {
  return feeConfigFor(testEnv(), currency)
}

/**
 * The sales tax rate the API would apply for a currency.
 *
 * @param {string} [currency] ISO 4217 code.
 * @returns {number} The rate in basis points.
 */
export function taxRateBps(currency = 'INR') {
  return taxRateBpsForCurrency(currency)
}

/**
 * Headers proving ownership of a guest hold.
 *
 * @param {{guestToken?: string}} hold The `data` object returned when the hold was taken.
 * @returns {Record<string, string>} Headers carrying the one-time token, or none for an owned hold.
 */
export function holdHeaders(hold) {
  return hold?.guestToken ? { 'x-hold-token': hold.guestToken } : {}
}
