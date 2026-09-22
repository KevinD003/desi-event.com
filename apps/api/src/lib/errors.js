/**
 * Error normalisation: one place that turns anything thrown inside a route
 * into the `errorResponseSchema` envelope.
 *
 * Every domain package ships its own error class (`ValidationError`,
 * `PermissionError`, `InventoryError`, `PricingError`, `ProviderError`) and
 * each already carries a `statusCode` and a machine-readable `code`. This
 * module deliberately does **not** re-derive those: it reads what the package
 * decided. Recognition is duck-typed on `name`/`code` rather than `instanceof`
 * because a pnpm workspace can legitimately load two physical copies of the
 * same module, and an `instanceof` check would then silently fall through to a
 * 500 for a perfectly ordinary 403.
 *
 * @module @desi-event/api/lib/errors
 */

/** Fallback code used when nothing more specific is known. */
export const INTERNAL_ERROR_CODE = 'INTERNAL_SERVER_ERROR'

/** Message sent in production instead of an unexpected error's own message. */
export const INTERNAL_ERROR_MESSAGE = 'An unexpected error occurred.'

/** Default code per status, used when an error carries a status but no code. */
const CODE_BY_STATUS = Object.freeze({
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  409: 'CONFLICT',
  410: 'HOLD_EXPIRED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  500: INTERNAL_ERROR_CODE,
  503: 'SERVICE_UNAVAILABLE',
})

/** Error `name` values owned by the domain packages. */
const DOMAIN_ERROR_NAMES = Object.freeze([
  'ValidationError',
  'PermissionError',
  'InventoryError',
  'PricingError',
  'ProviderError',
])

/**
 * `@fastify/jwt` and `fast-jwt` codes that mean "the credential is the
 * problem". They arrive with assorted statuses (401, 400, 500 for a bad
 * secret), so the status is normalised to 401 rather than trusted.
 *
 * @type {ReadonlySet<string>}
 */
const JWT_ERROR_CODES = new Set([
  'FST_JWT_NO_AUTHORIZATION_IN_HEADER',
  'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED',
  'FST_JWT_AUTHORIZATION_TOKEN_INVALID',
  'FST_JWT_AUTHORIZATION_TOKEN_UNTRUSTED',
  'FST_JWT_BAD_REQUEST',
  'FAST_JWT_MALFORMED',
  'FAST_JWT_INVALID_SIGNATURE',
  'FAST_JWT_EXPIRED',
])

/**
 * An HTTP error as the API reports it.
 *
 * @typedef {object} NormalisedError
 * @property {number} statusCode HTTP status to answer with.
 * @property {string} code Machine-readable code carried in `error.code`.
 * @property {string} message Human-readable message safe to send to a client.
 * @property {Array<{path: string, code: string, message: string}>} [issues] Field-level validation issues.
 * @property {string[]} [problems] Business-rule reasons, for a 4xx.
 * @property {string} [reason] A closed-vocabulary refusal code, for a 4xx.
 * @property {boolean} expected Whether this is an anticipated 4xx rather than a bug.
 */

/**
 * Whether a thrown value is one of the domain error classes.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True when the error was raised deliberately by a package.
 */
export function isDomainError(error) {
  return error instanceof Error && DOMAIN_ERROR_NAMES.includes(error.name)
}

/**
 * Whether a thrown value is a JWT/credential failure.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True when the error concerns the bearer token itself.
 */
export function isAuthError(error) {
  const code = /** @type {{code?: unknown}} */ (error)?.code
  return typeof code === 'string' && JWT_ERROR_CODES.has(code)
}

/**
 * Pick a sensible status for a thrown value.
 *
 * @param {unknown} error The thrown value.
 * @returns {number} An HTTP status between 400 and 599.
 */
function statusOf(error) {
  const raw = /** @type {{statusCode?: unknown, status?: unknown}} */ (error) ?? {}
  const candidate = typeof raw.statusCode === 'number' ? raw.statusCode : raw.status

  if (typeof candidate !== 'number' || !Number.isInteger(candidate)) return 500
  if (candidate < 400 || candidate > 599) return 500

  return candidate
}

/**
 * Translate a thrown value into the response envelope's `error` object.
 *
 * Internals are only exposed when `exposeInternals` is true (i.e. outside
 * production): an unexpected 5xx otherwise answers with a fixed message so a
 * stack trace, a SQL fragment or a connection string can never reach a client.
 *
 * @param {unknown} error The thrown value.
 * @param {object} [options] Behaviour switches.
 * @param {boolean} [options.exposeInternals] Whether to send an unexpected error's own message.
 * @returns {NormalisedError} The normalised error.
 */
export function normaliseError(error, options = {}) {
  const { exposeInternals = false } = options

  if (isAuthError(error)) {
    return {
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'A valid bearer token is required.',
      expected: true,
    }
  }

  if (isDomainError(error)) {
    const statusCode = statusOf(error)
    /** @type {NormalisedError} */
    const normalised = {
      statusCode,
      code: /** @type {{code?: string}} */ (error).code ?? CODE_BY_STATUS[statusCode] ?? 'ERROR',
      message: /** @type {Error} */ (error).message,
      expected: statusCode < 500,
    }

    const issues = /** @type {{issues?: unknown}} */ (error).issues
    if (Array.isArray(issues) && issues.length > 0 && normalised.code === 'VALIDATION_ERROR') {
      normalised.issues = issues
    }

    // Coherence reasons a business rule collected. Forwarded only below 500:
    // a refusal the caller can act on is worth explaining, and an internal
    // fault's details are not theirs to read.
    const problems = /** @type {{details?: {problems?: unknown}}} */ (error).details?.problems
    if (Array.isArray(problems) && problems.length > 0 && statusCode < 500) {
      normalised.problems = problems.map(String)
    }

    const reason = refusalReasonOf(error)
    if (reason && statusCode < 500) normalised.reason = reason

    // A provider wiring mistake is a 500: do not leak the adapter's own words.
    if (statusCode >= 500 && !exposeInternals) {
      normalised.message = INTERNAL_ERROR_MESSAGE
      normalised.code = INTERNAL_ERROR_CODE
    }

    return normalised
  }

  const statusCode = statusOf(error)

  if (statusCode >= 500) {
    return {
      statusCode,
      code: exposeInternals
        ? /** @type {{code?: string}} */ (error?.code ?? INTERNAL_ERROR_CODE)
        : INTERNAL_ERROR_CODE,
      message: exposeInternals
        ? /** @type {Error} */ (error?.message ?? INTERNAL_ERROR_MESSAGE)
        : INTERNAL_ERROR_MESSAGE,
      expected: false,
    }
  }

  const rawCode = /** @type {{code?: unknown}} */ (error)?.code
  const code =
    typeof rawCode === 'string' && !rawCode.startsWith('FST_')
      ? rawCode
      : (CODE_BY_STATUS[statusCode] ?? 'ERROR')

  /** @type {NormalisedError} */
  const normalised = {
    statusCode,
    code,
    message: /** @type {Error} */ (error)?.message ?? 'Request failed.',
    expected: true,
  }

  const validation = /** @type {{validation?: unknown}} */ (error)?.validation
  if (Array.isArray(validation) && validation.length > 0) {
    normalised.issues = validation.map((issue) => ({
      path: String(issue?.instancePath ?? issue?.path ?? ''),
      code: String(issue?.keyword ?? issue?.code ?? 'invalid'),
      message: String(issue?.message ?? 'Invalid value'),
    }))
  }

  // The API's own refusals arrive here rather than above: `httpError` builds a
  // plain `Error` with a `statusCode`, not one of the packages' domain classes.
  // This branch is where a 422 from `unprocessable(message, { problems })`
  // actually lands, so it is where the reasons have to be picked up.
  const problems = /** @type {{details?: {problems?: unknown}}} */ (error)?.details?.problems
  if (Array.isArray(problems) && problems.length > 0) {
    normalised.problems = problems.map(String)
  }

  const reason = refusalReasonOf(error)
  if (reason) normalised.reason = reason

  return normalised
}

/**
 * The machine-readable refusal code a service attached, if it is one.
 *
 * A door scanner has to branch on *why* a ticket was refused — refunded, wrong
 * event, preview expired — and a sentence is not something to branch on. The
 * services that refuse from a closed vocabulary (`ADMISSION_REFUSAL_REASONS`,
 * `CONNECT_REFUSAL_REASONS`) put the code in `details.reason`; it used to stop
 * there, in the log. Only a bare upper-case identifier is forwarded, so a
 * free-text reason somebody passes as detail one day cannot reach a client by
 * this route.
 *
 * @param {unknown} error The thrown value.
 * @returns {string|null} The code, or null.
 */
function refusalReasonOf(error) {
  const reason = /** @type {{details?: {reason?: unknown}}} */ (error)?.details?.reason

  return typeof reason === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(reason) ? reason : null
}

/**
 * Build the complete response body for a normalised error.
 *
 * @param {NormalisedError} normalised The normalised error.
 * @param {string} [requestId] The request id, echoed so a user can quote it in a support ticket.
 * @returns {{error: {code: string, message: string, statusCode: number, issues?: object[], problems?: string[], reason?: string, requestId?: string}}} The response body.
 */
export function toErrorBody(normalised, requestId) {
  /** @type {Record<string, unknown>} */
  const error = {
    code: normalised.code,
    message: normalised.message,
    statusCode: normalised.statusCode,
  }

  if (normalised.issues) error.issues = normalised.issues
  if (normalised.problems) error.problems = normalised.problems
  if (normalised.reason) error.reason = normalised.reason
  if (requestId) error.requestId = String(requestId).slice(0, 64)

  return { error: /** @type {never} */ (error) }
}

/**
 * Build an error that the error handler will render with a given status.
 *
 * Used for the API's own business rejections (a duplicate email, an event that
 * is not visible) which have no package of their own.
 *
 * @param {number} statusCode HTTP status to answer with.
 * @param {string} code Machine-readable code, e.g. `CONFLICT`.
 * @param {string} message Human-readable message.
 * @param {object} [details] Extra context attached for logging.
 * @returns {Error} An error carrying `statusCode` and `code`.
 */
export function httpError(statusCode, code, message, details) {
  const error = new Error(message)

  Object.assign(error, { statusCode, code, ...(details ? { details } : {}) })

  return error
}

/**
 * Shorthand for a 404 that never distinguishes "absent" from "not yours".
 *
 * @param {string} [message] Message to send.
 * @returns {Error} A 404 error.
 */
export function notFound(message = 'Resource not found.') {
  return httpError(404, 'NOT_FOUND', message)
}

/**
 * Shorthand for a 409 state collision.
 *
 * @param {string} message Message to send.
 * @param {object} [details] Extra context attached for logging.
 * @returns {Error} A 409 error.
 */
export function conflict(message, details) {
  return httpError(409, 'CONFLICT', message, details)
}

/**
 * Shorthand for a 422: well-formed but not actionable.
 *
 * @param {string} message Message to send.
 * @param {object} [details] Extra context attached for logging.
 * @returns {Error} A 422 error.
 */
export function unprocessable(message, details) {
  return httpError(422, 'UNPROCESSABLE', message, details)
}

/**
 * Shorthand for a 401.
 *
 * @param {string} [message] Message to send.
 * @param {string} [code] Machine-readable code. Defaults to `UNAUTHORIZED`; a
 *   caller names its own when the remedy differs — `MFA_ENROLMENT_REQUIRED`
 *   means "enrol a factor", which is a different action from "sign in again".
 * @returns {Error} A 401 error.
 */
export function unauthorized(message = 'A valid bearer token is required.', code = 'UNAUTHORIZED') {
  return httpError(401, code, message)
}

/**
 * Shorthand for a 403: authenticated, and still not allowed.
 *
 * The code is a parameter rather than fixed because a 403 arrives for two
 * genuinely different reasons — the caller lacks a capability, or holds it and
 * has not authenticated again recently — and a client that wants to offer a
 * "confirm your identity" prompt has to be able to tell them apart.
 *
 * @param {string} message Message to send.
 * @param {string} [code] Machine-readable code.
 * @returns {Error} A 403 error.
 */
export function forbidden(message, code = 'FORBIDDEN') {
  return httpError(403, code, message)
}

/**
 * Shorthand for a 429, carrying the interval the caller should wait.
 *
 * @param {string} message Message to send.
 * @param {number} [retryAfterSeconds] Seconds to put in `Retry-After`.
 * @returns {Error} A 429 error.
 */
export function tooManyRequests(message, retryAfterSeconds) {
  const error = httpError(429, 'RATE_LIMITED', message)

  if (Number.isFinite(retryAfterSeconds)) {
    Object.assign(error, { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)) })
  }

  return error
}

/**
 * The database's own error code, wherever Prisma put it.
 *
 * A `RAISE EXCEPTION` from a trigger reaches the client as PostgreSQL's
 * `P0001`, and Prisma wraps it: the outer `error.code` is a Prisma code
 * (`P2039` at the time of writing, and not stable across versions), while the
 * original sits under `meta.driverAdapterError.cause.originalCode`. Checking
 * only the outer one is how a trigger refusal — which the application is
 * supposed to handle — arrives at a user as a 500.
 *
 * Both places are checked, and the outer one first, so an ordinary unique
 * violation (`P2002`, which Prisma does surface directly) still matches.
 *
 * @param {unknown} error Whatever was thrown.
 * @returns {string|null} The database's code, or null when there is not one.
 */
export function databaseErrorCode(error) {
  const outer = error?.code

  if (typeof outer === 'string' && outer.startsWith('P') && outer !== 'P2039') return outer

  const nested = error?.meta?.driverAdapterError?.cause?.originalCode

  return typeof nested === 'string' ? nested : typeof outer === 'string' ? outer : null
}

/**
 * What a trigger said when it refused a write.
 *
 * The message is the one the migration wrote, which is prose somebody chose to
 * be read — "check-in refused: ticket … is CHECKED_IN, which does not admit".
 * A handler that has decided to surface it has something better to say than a
 * generic conflict.
 *
 * @param {unknown} error Whatever was thrown.
 * @returns {string|null} The trigger's message, or null.
 */
export function triggerMessage(error) {
  const nested = error?.meta?.driverAdapterError?.cause?.originalMessage

  return typeof nested === 'string' ? nested : null
}
