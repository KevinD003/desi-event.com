/**
 * Process entry point: parse the environment, open the real connections, start
 * every worker, register the repeatable jobs, and shut all of it down cleanly
 * on a signal.
 *
 * This file is the *only* place in the package that constructs a live Prisma
 * client, a Redis connection or a provider adapter. Everything else — the
 * processors, the queue helpers, the scheduler — takes its dependencies as
 * arguments, which is what lets the whole worker be tested without Redis or a
 * database. Keep it that way: logic that creeps in here becomes logic that
 * cannot be tested.
 *
 * @module @desi-event/worker/main
 */

import dotenv from 'dotenv'
import { createLogger } from '@desi-event/logger'
import { createPrismaClient } from '@desi-event/db'
import { assertPaymentModeAllowed, createInMemoryProviderRegistry } from '@desi-event/providers'

import { describeEnvError, loadEnv } from './env.js'
import { closeRedisConnection, createRedisConnection } from './connection.js'
import { closeQueues, createQueues } from './queues.js'
import { createProcessors } from './processors/index.js'
import { closeWorkers, createWorkers } from './workers.js'
import { registerRepeatableJobs } from './scheduler.js'
import { createShutdown, installShutdownHandlers } from './shutdown.js'

/**
 * @typedef {object} WorkerRuntime
 * @property {object} env The parsed environment.
 * @property {object} logger The process logger.
 * @property {object} connection The shared Redis connection.
 * @property {Record<string, object>} queues Every queue, keyed by name.
 * @property {Array<object>} workers Every running worker.
 * @property {Record<string, Function>} processors The processors, exposed for diagnostics.
 * @property {function(): Promise<void>} close Graceful shutdown.
 */

/**
 * Boot the worker.
 *
 * @param {object} [options] Overrides, used by tests and by embedding callers.
 * @param {object} [options.env] A pre-parsed environment; skips reading `process.env`.
 * @param {object} [options.logger] A logger to use instead of building one.
 * @param {object} [options.prisma] A Prisma client to use instead of creating one.
 * @param {object} [options.providers] A provider registry; defaults to the in-memory one.
 * @param {object} [options.connection] A Redis connection to use instead of opening one.
 * @param {Record<string, string|undefined>} [options.processEnv] Environment the payment kill switch inspects. Defaults to the process environment.
 * @returns {Promise<WorkerRuntime>} The running process's parts and its closer.
 * @throws {ValidationError} When the environment is invalid.
 */
export async function start(options = {}) {
  dotenv.config({ quiet: true })

  const env = options.env ?? loadEnv()

  const logger =
    options.logger ??
    createLogger({
      name: 'worker',
      level: env.LOG_LEVEL,
      pretty: env.NODE_ENV === 'development',
    })

  // The worker fulfils orders and would be the process issuing refunds, so it
  // refuses to start for the same reasons the API does: a deployment that
  // believes it has card payments must be told it does not.
  assertPaymentModeAllowed({ env: options.processEnv ?? process.env, logger })

  const prisma = options.prisma ?? createPrismaClient({ connectionString: env.DATABASE_URL })

  // The in-memory providers are the default wiring. A deployment swaps them
  // for real adapters here — the one place that knows they are not real.
  const providers = options.providers ?? createInMemoryProviderRegistry()

  const connection = options.connection ?? createRedisConnection({ url: env.REDIS_URL, logger })

  const queues = createQueues({ connection, prefix: env.QUEUE_PREFIX })
  const processors = createProcessors({
    prisma,
    providers,
    logger,
    retentionActivated: env.RETENTION_ENFORCEMENT_ACTIVATED,
  })
  const workers = createWorkers({
    processors,
    connection,
    prefix: env.QUEUE_PREFIX,
    concurrency: env.WORKER_CONCURRENCY,
    logger,
  })

  await registerRepeatableJobs({
    queues,
    intervalMs: env.EXPIRE_HOLDS_INTERVAL_MS,
    logger,
  })

  const close = createShutdown({
    logger,
    closeWorkers: () => closeWorkers(workers),
    closeQueues: () => closeQueues(queues),
    closeDatabase: () => prisma.$disconnect(),
    closeConnection: () => closeRedisConnection(connection),
  })

  logger.info(
    {
      queues: Object.keys(queues),
      concurrency: env.WORKER_CONCURRENCY,
      prefix: env.QUEUE_PREFIX,
      sweepIntervalMs: env.EXPIRE_HOLDS_INTERVAL_MS,
      // Said at boot rather than only when a rehearsal runs. An operator
      // reading the startup line should be able to answer "would a retention
      // sweep do anything here?" without enqueueing one to find out.
      retentionActivated: env.RETENTION_ENFORCEMENT_ACTIVATED,
    },
    'worker started',
  )

  return { env, logger, connection, queues, workers, processors, close }
}

/**
 * Report a startup failure in a form an operator can act on, then exit.
 *
 * @param {unknown} error The failure.
 * @returns {void} Nothing; the process exits.
 */
function failFast(error) {
  console.error('The worker failed to start:')
  for (const line of describeEnvError(error)) console.error(`  - ${line}`)
  if (!(/** @type {{issues?: unknown[]}} */ (error)?.issues?.length)) console.error(error)
  process.exit(1)
}

// Only self-starts when run directly, so importing this module in a tool or a
// test never opens a connection.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  start()
    .then((runtime) => installShutdownHandlers({ close: runtime.close, logger: runtime.logger }))
    .catch(failFast)
}
