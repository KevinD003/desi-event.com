/**
 * Liveness and readiness.
 *
 * @module @desi-event/api/routes/health
 */

import { PAYMENT_MODES, PRODUCTION_PAYMENTS_DISABLED_MESSAGE } from '@desi-event/providers'

import { httpError } from '../lib/errors.js'
import { defineRoute } from '../lib/register.js'

/**
 * Probe the database with the cheapest query PostgreSQL will accept.
 *
 * @param {object} prisma The Prisma client.
 * @returns {Promise<boolean>} True when the query succeeded.
 */
async function checkDatabase(prisma) {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}

/**
 * Probe Redis, when a client was injected.
 *
 * @param {?object} redis An ioredis-compatible client, or nothing.
 * @returns {Promise<boolean|null>} True/false when a client exists, `null` when there is nothing to probe.
 */
async function checkRedis(redis) {
  if (!redis || typeof redis.ping !== 'function') return null

  try {
    await redis.ping()
    return true
  } catch {
    return false
  }
}

/**
 * Register `GET /health`.
 *
 * A reachable database is the bar for "this instance can serve traffic", so
 * losing it answers 503 and a load balancer drains the instance. Redis backs
 * rate limiting and background jobs only; losing it degrades the service
 * rather than ending it, so the instance stays in rotation and says so.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} [deps.redis] An optional ioredis-compatible client.
 * @param {object} deps.env The parsed API environment.
 * @param {object} [deps.payments] The resolved payment mode. Reported so an operator can see, without reading the code, that no card payment can occur.
 * @param {string} [deps.version] Version string reported in the payload.
 * @returns {void} Nothing.
 */
export function registerHealthRoutes(app, { prisma, redis, env, payments, version = '0.1.0' }) {
  defineRoute(app, 'health.get', {
    handler: async () => {
      const [database, redisOk] = await Promise.all([checkDatabase(prisma), checkRedis(redis)])

      if (!database) {
        throw httpError(503, 'SERVICE_UNAVAILABLE', 'The database is unreachable.')
      }

      /** @type {{database: boolean, redis?: boolean}} */
      const checks = { database }
      if (redisOk !== null) checks.redis = redisOk

      return {
        status: redisOk === false ? 'degraded' : 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        version,
        logLevel: env.LOG_LEVEL,
        timestamp: new Date(),
        checks,
        // Deliberately part of the liveness payload rather than a separate
        // endpoint: an operator checking whether this instance is healthy is
        // exactly the person who needs to know it cannot take money.
        payments: {
          mode: payments?.mode ?? PAYMENT_MODES.MOCK,
          demo: true,
          live: false,
          label: payments?.label ?? 'DEMO',
          message: payments?.message ?? PRODUCTION_PAYMENTS_DISABLED_MESSAGE,
        },
      }
    },
  })
}
