/**
 * Request rate limiting.
 *
 * Two budgets: a generous global one that exists to blunt scraping and
 * accidental client loops, and a much tighter one applied per route to the
 * credential endpoints, where the thing being rationed is password guesses
 * rather than bandwidth.
 *
 * @module @desi-event/api/plugins/rate-limit
 */

import rateLimit from '@fastify/rate-limit'

/** Global budget: enough for a busy browsing session, far below a scraper. */
export const DEFAULT_GLOBAL_LIMIT = Object.freeze({ max: 300, timeWindow: '1 minute' })

/** Credential-endpoint budget, sized for a human who mistypes a password. */
export const DEFAULT_AUTH_LIMIT = Object.freeze({ max: 10, timeWindow: '1 minute' })

/**
 * Admission-pass budget.
 *
 * What is being rationed here is neither bandwidth nor password guesses: it is
 * how fast somebody who has taken over a session can harvest passes. A holder
 * opening their own ticket does it a handful of times before a door; thirty a
 * minute is far above that and far below useful for a scraper.
 *
 * @type {Readonly<{max: number, timeWindow: string}>}
 */
export const DEFAULT_PASS_LIMIT = Object.freeze({ max: 30, timeWindow: '1 minute' })

/**
 * Door budget: previews and confirmations, per scanner.
 *
 * Keyed on the signed-in account rather than the address. A venue's scanners
 * usually share one uplink, so an address key would make every steward at a
 * door draw on one budget — and would give a single misbehaving device the
 * power to throttle all of them. Run at `preHandler`, after the session guard,
 * so the actor is known; an unauthenticated request is refused before it
 * spends anything.
 *
 * Two requests per attendee, one every couple of seconds at a busy door, is
 * about sixty a minute per steward. A hundred and twenty leaves room for
 * re-scans and is far below what probing printed codes would need.
 *
 * @type {Readonly<{max: number, timeWindow: string}>}
 */
export const DEFAULT_ADMISSION_LIMIT = Object.freeze({ max: 120, timeWindow: '1 minute' })

/**
 * Build the per-route `config.rateLimit` object for the door routes.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, normally only supplied by tests and the load suite.
 * @returns {object} The effective admission limit.
 */
export function admissionRateLimit(overrides = {}) {
  return {
    ...DEFAULT_ADMISSION_LIMIT,
    ...overrides,
    hook: 'preHandler',
    keyGenerator: (request) =>
      request.actor?.id ? `actor:${request.actor.id}` : `ip:${request.ip}`,
  }
}

/**
 * Build the per-route `config.rateLimit` object for admission-pass retrieval.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, normally only supplied by tests.
 * @returns {{max: number, timeWindow: string|number}} The effective pass limit.
 */
export function passRateLimit(overrides = {}) {
  return { ...DEFAULT_PASS_LIMIT, ...overrides }
}

/**
 * Build the per-route `config.rateLimit` object for the auth endpoints.
 *
 * @param {{max?: number, timeWindow?: string|number}} [overrides] Limit overrides, normally only supplied by tests.
 * @returns {{max: number, timeWindow: string|number}} The effective auth limit.
 */
export function authRateLimit(overrides = {}) {
  return { ...DEFAULT_AUTH_LIMIT, ...overrides }
}

/**
 * Register the global rate limiter.
 *
 * `errorResponseBuilder` returns an `Error` rather than a body: the plugin
 * *throws* whatever it is given, so returning a plain object produces a 500.
 * Returning a properly coded error routes the rejection through the shared
 * error handler instead, which means a throttled caller gets exactly the same
 * envelope as every other failure.
 *
 * @param {object} app The Fastify instance.
 * @param {object} [options] Limiter options.
 * @param {{max?: number, timeWindow?: string|number}} [options.global] Overrides for the global budget.
 * @returns {Promise<void>} Resolves once the limiter is registered.
 */
export async function registerRateLimit(app, options = {}) {
  const global = { ...DEFAULT_GLOBAL_LIMIT, ...(options.global ?? {}) }

  await app.register(rateLimit, {
    global: true,
    max: global.max,
    timeWindow: global.timeWindow,
    // Documentation is static and cheap; throttling it only makes the API
    // look broken to somebody reading about it.
    allowList: (request) => request.url.startsWith('/docs'),
    errorResponseBuilder: (_request, context) => {
      const retryInSeconds = Math.ceil(Number(context.ttl ?? 0) / 1000)
      const error = new Error(`Too many requests. Retry in ${retryInSeconds} seconds.`)

      Object.assign(error, { statusCode: context.statusCode ?? 429, code: 'RATE_LIMITED' })

      return error
    },
  })
}
