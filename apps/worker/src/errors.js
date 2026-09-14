/**
 * Failure types the worker raises, and the one decision every processor has to
 * make about a failure: *is retrying this job going to help?*
 *
 * BullMQ answers that question with a class. Anything thrown from a processor
 * is retried until `attempts` runs out, except `UnrecoverableError`, which is
 * moved straight to the failed set. Getting the distinction wrong is expensive
 * in both directions: retrying a malformed payload burns five attempts and a
 * minute of backoff on a job that can never succeed, while permanently failing
 * a transient database blip loses real work.
 *
 * The rule used throughout this app: **the payload and the world's shape are
 * unrecoverable, the world's availability is retryable.** A job whose data does
 * not match its schema, or that names an order which does not exist, will fail
 * identically forever. A dropped connection or a locked row will not.
 *
 * @module @desi-event/worker/errors
 */

import { UnrecoverableError } from 'bullmq'
import { formatIssues } from '@desi-event/schemas'

/**
 * Machine-readable codes carried on `.code`.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const WORKER_ERROR_CODES = Object.freeze({
  /** A job payload did not satisfy its Zod schema. */
  INVALID_JOB_PAYLOAD: 'INVALID_JOB_PAYLOAD',
  /** The job names a row that does not exist. */
  ENTITY_NOT_FOUND: 'ENTITY_NOT_FOUND',
  /** The row exists but is in a state this job can never act on. */
  INVALID_STATE: 'INVALID_STATE',
  /** The row is not ready yet, but plausibly will be on a later attempt. */
  NOT_READY: 'NOT_READY',
  /** A downstream provider refused the work permanently. */
  PROVIDER_REJECTED: 'PROVIDER_REJECTED',
  /** A downstream provider failed in a way that may clear on its own. */
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
})

/**
 * @typedef {object} JobErrorOptions
 * @property {string} [code] One of {@link WORKER_ERROR_CODES}.
 * @property {string} [jobName] The BullMQ job name, echoed into logs.
 * @property {Array<object>} [issues] Flattened validation issues, when the failure came from a schema.
 * @property {Record<string, unknown>} [details] Structured context an operator needs to act.
 * @property {unknown} [cause] The underlying error.
 */

/**
 * Attach the shared fields to an error instance.
 *
 * Both error classes below need identical members but cannot share a base:
 * one must extend BullMQ's `UnrecoverableError` for the retry semantics, the
 * other plain `Error`. Composition avoids duplicating the field list twice.
 *
 * @param {Error} error The error being constructed.
 * @param {string} name The `name` to report.
 * @param {JobErrorOptions} options Fields to attach.
 * @returns {Error} The same error, for chaining.
 */
function decorate(error, name, options) {
  error.name = name
  /** @type {string} */
  error.code = options.code ?? WORKER_ERROR_CODES.INVALID_STATE
  /** @type {number} */
  error.statusCode = 422
  /** @type {(string|undefined)} */
  error.jobName = options.jobName
  /** @type {Array<object>} */
  error.issues = Array.isArray(options.issues) ? options.issues : []
  /** @type {Record<string, unknown>} */
  error.details = options.details ?? {}
  return error
}

/**
 * A failure that will recur identically on every retry.
 *
 * Extends BullMQ's `UnrecoverableError`, so the job is moved to the failed set
 * immediately instead of consuming its remaining attempts.
 *
 * @augments UnrecoverableError
 */
export class PermanentJobError extends UnrecoverableError {
  /**
   * @param {string} message Human-readable explanation.
   * @param {JobErrorOptions} [options] Code, job name, issues, details and cause.
   */
  constructor(message, options = {}) {
    super(message)
    if (options.cause !== undefined) this.cause = options.cause
    decorate(this, 'PermanentJobError', options)
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, PermanentJobError)
    }
  }

  /**
   * Serialise for structured logging.
   *
   * @returns {{name: string, code: string, message: string, jobName: (string|undefined), issues: Array<object>, details: Record<string, unknown>}} A JSON-safe payload.
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      jobName: this.jobName,
      issues: this.issues,
      details: this.details,
    }
  }
}

/**
 * A failure worth another attempt: a connection blip, a row another
 * transaction is still holding, a provider that is momentarily down.
 *
 * @augments Error
 */
export class RetryableJobError extends Error {
  /**
   * @param {string} message Human-readable explanation.
   * @param {JobErrorOptions} [options] Code, job name, details and cause.
   */
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    decorate(this, 'RetryableJobError', options)
    this.statusCode = 503
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, RetryableJobError)
    }
  }

  /**
   * Serialise for structured logging.
   *
   * @returns {{name: string, code: string, message: string, jobName: (string|undefined), details: Record<string, unknown>}} A JSON-safe payload.
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      jobName: this.jobName,
      details: this.details,
    }
  }
}

/**
 * Validate a job payload, failing the job permanently when it does not match.
 *
 * Every processor calls this as its first statement. A queued job outlives the
 * process that enqueued it — an old producer, a hand-inserted job or a
 * deploy-skew payload can all arrive — so the consumer never trusts `job.data`.
 *
 * `parseOrThrow` from `@desi-event/schemas` is deliberately *not* used here:
 * the `ValidationError` it throws is retryable as far as BullMQ is concerned,
 * and a payload that fails a schema will fail it again on every attempt.
 *
 * @param {{safeParse: Function}} schema The Zod schema for this job's payload.
 * @param {unknown} data The raw `job.data`.
 * @param {string} jobName The job name, used in the message and on the error.
 * @returns {object} The parsed payload, with defaults and coercions applied.
 * @throws {PermanentJobError} Code `INVALID_JOB_PAYLOAD`, carrying `.issues`, when validation fails.
 */
export function parseJobPayload(schema, data, jobName) {
  const result = schema.safeParse(data)
  if (result.success) return result.data

  const issues = formatIssues(result.error)
  const summary = issues.map((issue) => `${issue.path || '<root>'}: ${issue.message}`).join('; ')

  throw new PermanentJobError(`Invalid "${jobName}" job payload — ${summary}`, {
    code: WORKER_ERROR_CODES.INVALID_JOB_PAYLOAD,
    jobName,
    issues,
    details: { jobName },
  })
}
