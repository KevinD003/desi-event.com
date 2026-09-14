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

  return normalised
}

/**
 * Build the complete response body for a normalised error.
 *
 * @param {NormalisedError} normalised The normalised error.
 * @param {string} [requestId] The request id, echoed so a user can quote it in a support ticket.
 * @returns {{error: {code: string, message: string, statusCode: number, issues?: object[], requestId?: string}}} The response body.
 */
export function toErrorBody(normalised, requestId) {
  /** @type {Record<string, unknown>} */
  const error = {
    code: normalised.code,
    message: normalised.message,
    statusCode: normalised.statusCode,
  }

  if (normalised.issues) error.issues = normalised.issues
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
 * @returns {Error} A 401 error.
 */
export function unauthorized(message = 'A valid bearer token is required.') {
  return httpError(401, 'UNAUTHORIZED', message)
}
