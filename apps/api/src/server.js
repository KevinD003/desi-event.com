/**
 * Process entry point: parse the environment, build the app, listen, and shut
 * down cleanly.
 *
 * Nothing here is importable for its side effects by a test — `buildApp` in
 * `./app.js` is the seam for that. This file exists to own the things a
 * process owns: configuration, real connections, signals and exit codes.
 *
 * @module @desi-event/api/server
 */

import { randomUUID } from 'node:crypto'

import dotenv from 'dotenv'
import { createLogger } from '@desi-event/logger'
import { createPrismaClient, disconnectPrisma } from '@desi-event/db'
import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { isValidationError } from '@desi-event/schemas'
import { loadApiEnv } from '@desi-event/schemas/env'

import { buildApp } from './app.js'

/** How long a shutdown may take before the process is killed anyway. */
export const SHUTDOWN_TIMEOUT_MS = 10_000

/** Signals that mean "stop accepting work and finish what you are doing". */
export const SHUTDOWN_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM'])

/**
 * The providers this process runs with: the in-memory ones, each process in
 * its own id space.
 *
 * The simulated payment provider numbers intents, refunds, transfers and
 * payouts from one, and the database outlives the process. Started again
 * against the same database, it handed out `pi_000001` a second time, and the
 * first simulated checkout after any restart was refused by
 * `Payment(provider, providerRef)` — a server error on the purchase page, found
 * by the browser suite. A real processor's ids never repeat; with a prefix
 * drawn per process, the stand-in's do not either. The load runner draws one
 * per run for the same reason.
 *
 * @returns {object} A fresh registry of in-memory adapters.
 */
export function createProcessProviders() {
  return createInMemoryProviderRegistry({
    payments: { idPrefix: `pi${randomUUID().slice(0, 8)}` },
  })
}

/**
 * Start the API.
 *
 * @returns {Promise<object>} The running instance and its closer.
 * @throws {Error} When the environment is invalid.
 */
export async function start() {
  dotenv.config({ quiet: true })

  const env = loadApiEnv()
  const logger = createLogger({
    name: 'api',
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV !== 'production',
  })
  const prisma = createPrismaClient({ connectionString: env.DATABASE_URL })

  // The in-memory providers are the default wiring. A deployment swaps them
  // for real adapters here — the one place that knows they are not real.
  const providers = createProcessProviders()

  const app = await buildApp({
    prisma,
    providers,
    env,
    logger,
    // The budget is the deployment's to set: behind a shared egress address a
    // hundred real visitors arrive as one caller, and the default would
    // throttle them. The default itself is unchanged.
    rateLimit: { global: { max: env.RATE_LIMIT_MAX, timeWindow: env.RATE_LIMIT_WINDOW } },
  })

  await app.listen({ port: env.API_PORT, host: env.API_HOST })

  /**
   * Stop listening, drain in-flight requests and close the database pool.
   *
   * @returns {Promise<void>} Resolves once everything is closed.
   */
  async function close() {
    await app.close()
    await disconnectPrisma()
  }

  return { app, close }
}

/**
 * Install signal handlers that shut the process down once, cleanly.
 *
 * A second signal during shutdown exits immediately: an operator pressing
 * Ctrl-C twice means "stop now", not "queue another graceful shutdown".
 *
 * @param {object} instance The running instance.
 * @returns {void} Nothing.
 */
export function installShutdownHandlers(instance) {
  let closing = false

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => {
      if (closing) {
        process.exit(1)
        return
      }

      closing = true
      instance.app.log.info({ signal }, 'shutting down')

      const timer = setTimeout(() => {
        instance.app.log.error({ signal }, 'shutdown timed out; exiting')
        process.exit(1)
      }, SHUTDOWN_TIMEOUT_MS)

      // An unref'd timer does not itself keep the event loop alive, so a clean
      // shutdown still lets the process exit at its own pace.
      timer.unref()

      instance
        .close()
        .then(() => {
          clearTimeout(timer)
          process.exit(0)
        })
        .catch((error) => {
          instance.app.log.error({ err: error }, 'shutdown failed')
          process.exit(1)
        })
    })
  }
}

/**
 * Report a startup failure in a form an operator can act on, then exit.
 *
 * @param {unknown} error The failure.
 * @returns {void} Nothing; the process exits.
 */
function failFast(error) {
  if (isValidationError(error)) {
    console.error('The API environment is invalid:')
    for (const issue of error.issues) {
      console.error(`  - ${issue.path || '<root>'}: ${issue.message}`)
    }
  } else {
    console.error(error)
  }

  process.exit(1)
}

// Only self-starts when run directly, so importing this module in a tool or a
// test never binds a port.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  start().then(installShutdownHandlers).catch(failFast)
}
