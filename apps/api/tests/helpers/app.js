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

import { totp } from '@desi-event/auth'
import { createInMemoryProviderRegistry } from '@desi-event/providers'

import { buildApp } from '../../src/app.js'
import { createPrismaStub } from './prisma-stub.js'
import { MFA_TEST_SECRET, enrolPrivilegedUsers, makeWorld } from './fixtures.js'

/** A JWT secret long enough for `apiEnvSchema`, and obviously not a real one. */
import { resolveTaxPolicy } from '@desi-event/pricing'

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
    WEB_ORIGIN: 'https://desi-event.test',
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
 * @param {object} [options.payments] Override the resolved payment mode, so a test can supply sandbox signing secrets without a live boot gate.
 * @param {boolean} [options.processInline] Process a webhook delivery before answering, since the tests have no worker.
 * @param {function(object): Promise<void>} [options.deliver] Captures the single-use links the auth routes issue, which is the only way a test can see one: the database holds a digest.
 * @param {Record<string, string|undefined>} [options.processEnv] Environment the payment kill switch inspects. Empty by default, so a stray variable on the machine running the suite cannot change the result.
 * @returns {Promise<{app: object, prisma: object, providers: object, ids: object}>} The harness.
 */
export async function createTestApp(options = {}) {
  const world = options.seed ? { seed: options.seed, ids: options.ids ?? {} } : await makeWorld()

  // Finding NF-12: a privileged account cannot reach a guarded route without a
  // confirmed second factor, so the seed's privileged accounts get one. Derived
  // rather than listed, because a test that adds a FINANCE member should not have
  // to know it has also created an enrolment requirement.
  const { enrolled } = enrolPrivilegedUsers(world.seed)

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
    processEnv: options.processEnv ?? {},
    deliver: options.deliver,
    payments: options.payments,
    processInline: options.processInline ?? false,
  })

  await app.ready()

  // Plain properties rather than `app.decorate`, which Fastify refuses once the
  // instance has started. Only the test helpers read them.
  app.testEnrolledEmails = enrolled
  app.testPrisma = prisma

  return { app, prisma, providers, enrolled, ids: world.ids }
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
/**
 * A valid one-time code for an enrolled fixture account, or undefined.
 *
 * @param {object} app The test instance, carrying the enrolled set and the store.
 * @param {string} email The account's email address.
 * @returns {string|undefined} A code, when the account holds a factor.
 */
export function mfaCodeFor(app, email) {
  if (!app.testEnrolledEmails?.has(email)) return undefined

  // TOTP refuses a code whose counter it has already seen, so two sign-ins in
  // the same thirty-second window would fail the second one — correctly. A real
  // user waits; a test cannot. Clearing `lastUsedAt` on the account's factor is
  // this suite's way of saying thirty seconds have passed, and it touches only
  // the replay bookkeeping, never the verification itself.
  const user = (app.testPrisma?._store?.user ?? []).find((row) => row.email === email)

  for (const factor of app.testPrisma?._store?.mfaFactor ?? []) {
    if (factor.userId === user?.id && factor.type === 'TOTP') factor.lastUsedAt = null
  }

  return totp(MFA_TEST_SECRET)
}

/**
 * Sign in and return the bearer token.
 *
 * @param {object} app The Fastify instance.
 * @param {string} email The account's email address.
 * @param {string} [password] The password.
 * @returns {Promise<string>} The session secret.
 */
export async function signIn(app, email, password = 'correct-horse-battery') {
  // A privileged fixture account holds a confirmed second factor — finding
  // NF-12 requires one — so sign-in asks for a code. Supplying it here rather
  // than in every caller keeps the tests about what they are testing, and keeps
  // the flow the same shape a real privileged sign-in has.
  const code = mfaCodeFor(app, email)

  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email, password, ...(code ? { code } : {}) },
  })

  if (response.statusCode !== 200) {
    throw new Error(`Sign-in failed for ${email}: ${response.statusCode} ${response.body}`)
  }

  const body = response.json()

  if (!body.token) {
    throw new Error(`Sign-in for ${email} returned no token: ${response.body}`)
  }

  return body.token
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
 * The tax rate the API would apply to the fixture event.
 *
 * Resolved by jurisdiction, exactly as the route does. Taking it from the
 * currency instead is the defect this replaced: an event is taxed where it is
 * held, not where its currency is used.
 *
 * @param {string} [country] ISO 3166-1 alpha-2 country of the venue.
 * @param {string|null} [region] Subdivision code.
 * @returns {number} The rate in basis points.
 */
export function taxRateBps(country = 'IN', region = null) {
  return resolveTaxPolicy({ country, region }).rateBps
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
