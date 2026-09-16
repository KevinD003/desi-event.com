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
