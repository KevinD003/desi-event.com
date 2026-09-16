/**
 * Validation failure type shared by every package that parses untrusted input.
 *
 * Zod's own `ZodError` is deliberately not thrown across package boundaries:
 * it carries internal shape that would couple the API's error serialiser to a
 * Zod version. {@link ValidationError} is a plain `Error` subclass carrying a
 * flat, transport-safe issue list plus the HTTP status the API should use.
 *
 * @module @desi-event/schemas/errors
 */

/**
 * @typedef {object} ValidationIssue
 * @property {string} path Dot/bracket path to the offending value; `''` for the root value.
 * @property {string} code Machine-readable issue code, e.g. `invalid_type` or `custom`.
 * @property {string} message Human-readable explanation of what is wrong.
 */

/** HTTP status used for every validation failure. */
export const VALIDATION_STATUS_CODE = 400

/** Machine-readable error code carried by {@link ValidationError}. */
export const VALIDATION_ERROR_CODE = 'VALIDATION_ERROR'

/**
 * Render a Zod issue path as a readable string.
 *
 * Numeric segments become array indices so `['items', 0, 'quantity']` reads as
 * `items[0].quantity`, which is what an API client needs in order to highlight
 * the right form field.
 *
 * @param {Array<string|number|symbol>} [path] Raw Zod issue path.
 * @returns {string} A dotted path, or `''` when the issue is on the root value.
 */
export function formatIssuePath(path) {
  if (!Array.isArray(path) || path.length === 0) return ''

  return path.reduce((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`
    const key = String(segment)
    return acc === '' ? key : `${acc}.${key}`
  }, '')
}

/**
 * Flatten a `ZodError` (or anything else carrying an `issues` array) into
 * plain serialisable issue objects.
 *
 * @param {{issues?: Array<object>}} [error] The error to read issues from.
 * @returns {ValidationIssue[]} One entry per issue; empty when there are none.
 */
export function formatIssues(error) {
  const issues = error && Array.isArray(error.issues) ? error.issues : []

  return issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    code: typeof issue.code === 'string' ? issue.code : 'custom',
    message: typeof issue.message === 'string' ? issue.message : 'Invalid value',
  }))
}

/**
 * Error thrown when a value fails schema validation.
 *
 * @augments Error
 */
export class ValidationError extends Error {
  /**
   * @param {string} [message] Summary shown to the caller.
   * @param {ValidationIssue[]} [issues] Flattened issue list.
   * @param {object} [options] Extra options.
   * @param {unknown} [options.cause] Underlying error, normally the `ZodError`.
   */
  constructor(message = 'Validation failed', issues = [], options = {}) {
    super(message)
    this.name = 'ValidationError'
    /** @type {number} */
    this.statusCode = VALIDATION_STATUS_CODE
    /** @type {string} */
    this.code = VALIDATION_ERROR_CODE
    /** @type {ValidationIssue[]} */
    this.issues = Array.isArray(issues) ? issues : []

    if (options.cause !== undefined) this.cause = options.cause
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, ValidationError)
    }
  }

  /**
   * Serialise to the body shape described by `errorResponseSchema`.
   *
   * @returns {{code: string, message: string, statusCode: number, issues: ValidationIssue[]}} A JSON-safe payload.
   */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      issues: this.issues,
    }
  }
}

/**
 * Structural check for {@link ValidationError} that survives duplicated copies
 * of this module in a pnpm workspace.
 *
 * @param {unknown} value Candidate error.
 * @returns {boolean} True when `value` behaves like a `ValidationError`.
 */
export function isValidationError(value) {
  return (
    value instanceof Error &&
    /** @type {{code?: unknown}} */ (value).code === VALIDATION_ERROR_CODE &&
    Array.isArray(/** @type {{issues?: unknown}} */ (value).issues)
  )
}

/**
 * Parse `value` with `schema`, throwing a {@link ValidationError} on failure.
 *
 * This is the single entry point every package should use so that a bad
 * request, a bad job payload and a bad environment all surface the same way.
 *
 * @param {{safeParse: Function}} schema Any Zod schema.
 * @param {unknown} value The value to validate.
 * @param {string} [message] Summary used when validation fails.
 * @returns {unknown} The parsed (and coerced/defaulted) value.
 * @throws {ValidationError} When `value` does not satisfy `schema`.
 * @throws {TypeError} When `schema` is not a Zod schema.
 */
export function parseOrThrow(schema, value, message = 'Validation failed') {
  if (!schema || typeof schema.safeParse !== 'function') {
    throw new TypeError('parseOrThrow expects a Zod schema with a safeParse method')
  }

  const result = schema.safeParse(value)
  if (result.success) return result.data

  throw new ValidationError(message, formatIssues(result.error), { cause: result.error })
}

/**
 * Non-throwing counterpart of {@link parseOrThrow}.
 *
 * @param {{safeParse: Function}} schema Any Zod schema.
 * @param {unknown} value The value to validate.
 * @returns {{success: boolean, data?: unknown, issues?: ValidationIssue[]}} Result discriminated by `success`.
 * @throws {TypeError} When `schema` is not a Zod schema.
 */
export function safeParseWithIssues(schema, value) {
  if (!schema || typeof schema.safeParse !== 'function') {
    throw new TypeError('safeParseWithIssues expects a Zod schema with a safeParse method')
  }

  const result = schema.safeParse(value)
  return result.success
    ? { success: true, data: result.data }
    : { success: false, issues: formatIssues(result.error) }
}
