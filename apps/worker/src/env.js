/**
 * The worker's configuration, parsed once at boot.
 *
 * A background process has no request to fail, so a misconfiguration that is
 * only noticed lazily shows up as jobs silently piling up in Redis. Parsing
 * `process.env` through `workerEnvSchema` at startup turns that into an
 * immediate, specific crash with the offending variable named.
 *
 * @module @desi-event/worker/env
 */

import { ValidationError, formatIssues } from '@desi-event/schemas'
import { workerEnvSchema } from '@desi-event/schemas/env'

/**
 * @typedef {object} WorkerEnv
 * @property {string} NODE_ENV Runtime mode.
 * @property {string} LOG_LEVEL Pino level name.
 * @property {string} DATABASE_URL PostgreSQL connection string.
 * @property {string} REDIS_URL Redis connection string.
 * @property {string} QUEUE_PREFIX Namespace for every BullMQ key.
 * @property {number} WORKER_CONCURRENCY Default per-worker concurrency.
 * @property {number} EXPIRE_HOLDS_INTERVAL_MS How often the hold sweep runs.
 * @property {number} PLATFORM_FEE_BPS Platform fee in basis points.
 * @property {number} PLATFORM_FEE_FLAT_CENTS Flat platform fee in cents.
 * @property {number} TICKET_HOLD_TTL_SECONDS Lifetime of a checkout hold.
 */

/**
 * Parse and validate the worker environment.
 *
 * @param {Record<string, string|undefined>} [source] Variables to read. Defaults to `process.env`.
 * @returns {WorkerEnv} The validated, coerced configuration.
 * @throws {ValidationError} When a variable is missing or malformed; `.issues` names each one.
 */
export function loadEnv(source = process.env) {
  const result = workerEnvSchema.safeParse(source)
  if (result.success) return /** @type {WorkerEnv} */ (result.data)

  throw new ValidationError('Invalid worker environment', formatIssues(result.error), {
    cause: result.error,
  })
}

/**
 * Render a configuration failure as lines an operator can act on.
 *
 * Kept separate from {@link loadEnv} so the entry point can print without
 * owning the formatting, and so the formatting can be tested without a process.
 *
 * @param {unknown} error The error thrown by {@link loadEnv}.
 * @returns {string[]} One line per problem; a single line for anything that is not a validation failure.
 */
export function describeEnvError(error) {
  const issues = /** @type {{issues?: Array<object>}} */ (error)?.issues

  if (!Array.isArray(issues) || issues.length === 0) {
    return [String(/** @type {Error} */ (error)?.message ?? error)]
  }

  return issues.map(
    (issue) =>
      `${/** @type {{path?: string}} */ (issue).path || '<root>'}: ${/** @type {{message?: string}} */ (issue).message}`,
  )
}
