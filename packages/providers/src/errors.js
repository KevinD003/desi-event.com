/**
 * The single error type every provider raises.
 *
 * Provider failures arrive from two very different places: a *wiring* mistake
 * (an adapter that does not implement the interface, a registry missing a
 * slot) and a *runtime* failure (a declined card, a bounced address, a missing
 * object). Both are {@link ProviderError} so a caller only has to catch one
 * thing, and both carry a machine-readable `code` plus an HTTP `statusCode` so
 * the API can map them to a response without string matching.
 *
 * @module @desi-event/providers/errors
 */

/**
 * Machine-readable failure codes carried on `ProviderError.code`.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PROVIDER_ERROR_CODES = Object.freeze({
  /** An implementation does not satisfy the provider interface. */
  INVALID_PROVIDER: 'INVALID_PROVIDER',
  /** A registry was constructed without all four provider slots. */
  INCOMPLETE_REGISTRY: 'INCOMPLETE_REGISTRY',
  /** Provider construction options are malformed. */
  INVALID_OPTIONS: 'INVALID_OPTIONS',

  /** An amount is not a positive integer number of cents. */
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  /** A currency is not a three-letter ISO-4217 code. */
  INVALID_CURRENCY: 'INVALID_CURRENCY',
  /** A payment intent reference is neither an id string nor an object carrying one. */
  INVALID_INTENT_REFERENCE: 'INVALID_INTENT_REFERENCE',
  /** No intent exists with the given id. */
  INTENT_NOT_FOUND: 'INTENT_NOT_FOUND',
  /** The intent has already been captured. */
  ALREADY_CAPTURED: 'ALREADY_CAPTURED',
  /** The intent has already been refunded. */
  ALREADY_REFUNDED: 'ALREADY_REFUNDED',
  /** A refund was attempted against an intent that was never captured. */
  NOT_CAPTURED: 'NOT_CAPTURED',
  /** The intent is in a terminal failed state and cannot move again. */
  INTENT_FAILED: 'INTENT_FAILED',
  /** A capture or refund amount does not match the intent amount. */
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  /** A capture or refund currency does not match the intent currency. */
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  /** The (simulated) issuer declined the payment. */
  PAYMENT_DECLINED: 'PAYMENT_DECLINED',

  /** A message body is malformed: missing subject, empty body, wrong type. */
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  /** A recipient address or phone number is not usable. */
  INVALID_RECIPIENT: 'INVALID_RECIPIENT',
  /** The (simulated) upstream transport rejected the message. */
  SEND_FAILED: 'SEND_FAILED',

  /** An object key is empty, too long, or contains unsafe path segments. */
  INVALID_OBJECT_KEY: 'INVALID_OBJECT_KEY',
  /** An object body is not a string or binary buffer. */
  INVALID_OBJECT_BODY: 'INVALID_OBJECT_BODY',
  /** No object is stored under the given key. */
  OBJECT_NOT_FOUND: 'OBJECT_NOT_FOUND',
})

/**
 * Default HTTP status per code.
 *
 * Wiring mistakes are 500 because no request can fix them. Malformed input is
 * 400. A lifecycle conflict (capturing twice) is 409 because the caller's view
 * of the world is stale. An amount that disagrees with the intent is 422: the
 * request is well-formed but contradicts stored state. A decline is 402.
 *
 * @type {Readonly<Record<string, number>>}
 */
const STATUS_BY_CODE = Object.freeze({
  [PROVIDER_ERROR_CODES.INVALID_PROVIDER]: 500,
  [PROVIDER_ERROR_CODES.INCOMPLETE_REGISTRY]: 500,
  [PROVIDER_ERROR_CODES.INVALID_OPTIONS]: 500,

  [PROVIDER_ERROR_CODES.INVALID_AMOUNT]: 400,
  [PROVIDER_ERROR_CODES.INVALID_CURRENCY]: 400,
  [PROVIDER_ERROR_CODES.INVALID_INTENT_REFERENCE]: 400,
  [PROVIDER_ERROR_CODES.INTENT_NOT_FOUND]: 404,
  [PROVIDER_ERROR_CODES.ALREADY_CAPTURED]: 409,
  [PROVIDER_ERROR_CODES.ALREADY_REFUNDED]: 409,
  [PROVIDER_ERROR_CODES.NOT_CAPTURED]: 409,
  [PROVIDER_ERROR_CODES.INTENT_FAILED]: 409,
  [PROVIDER_ERROR_CODES.AMOUNT_MISMATCH]: 422,
  [PROVIDER_ERROR_CODES.CURRENCY_MISMATCH]: 422,
  [PROVIDER_ERROR_CODES.PAYMENT_DECLINED]: 402,

  [PROVIDER_ERROR_CODES.INVALID_MESSAGE]: 400,
  [PROVIDER_ERROR_CODES.INVALID_RECIPIENT]: 400,
  [PROVIDER_ERROR_CODES.SEND_FAILED]: 502,

  [PROVIDER_ERROR_CODES.INVALID_OBJECT_KEY]: 400,
  [PROVIDER_ERROR_CODES.INVALID_OBJECT_BODY]: 400,
  [PROVIDER_ERROR_CODES.OBJECT_NOT_FOUND]: 404,
})

/** Status used when a code is not in {@link STATUS_BY_CODE}. */
export const DEFAULT_PROVIDER_ERROR_STATUS = 500

/**
 * @typedef {object} ProviderIssue
 * @property {string} path Dot path to the offending member; `''` for the value as a whole.
 * @property {string} code Machine-readable issue code, e.g. `missing_method`.
 * @property {string} message Human-readable explanation.
 */

/**
 * @typedef {object} ProviderErrorOptions
 * @property {number} [statusCode] Override the status derived from `code`.
 * @property {string} [provider] Name or kind of the provider that failed.
 * @property {ProviderIssue[]} [issues] Structural problems, used by the `assert*Provider` validators.
 * @property {Record<string, unknown>} [details] Extra context (intent id, amounts, offending recipients).
 * @property {unknown} [cause] Underlying error, forwarded to `Error.cause`.
 */

/**
 * A provider wiring or runtime failure.
 *
 * @augments Error
 */
export class ProviderError extends Error {
  /**
   * @param {string} code One of {@link PROVIDER_ERROR_CODES}.
   * @param {string} message Human-readable explanation.
   * @param {ProviderErrorOptions} [options] Status, provider, issues, details and cause.
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })

    /** @type {string} */
    this.name = 'ProviderError'
    /** @type {string} */
    this.code = code
    /** @type {number} */
    this.statusCode =
      typeof options.statusCode === 'number'
        ? options.statusCode
        : (STATUS_BY_CODE[code] ?? DEFAULT_PROVIDER_ERROR_STATUS)
    /** @type {string|undefined} */
    this.provider = options.provider
    /** @type {ProviderIssue[]} */
    this.issues = Array.isArray(options.issues) ? options.issues : []
    /** @type {Record<string, unknown>} */
    this.details = options.details ?? {}

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, ProviderError)
    }
  }

  /**
   * Serialise to the body shape described by `errorResponseSchema`.
   *
   * @returns {{code: string, message: string, statusCode: number, provider: (string|undefined), issues: ProviderIssue[], details: Record<string, unknown>}} A JSON-safe payload.
   */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      provider: this.provider,
      issues: this.issues,
      details: this.details,
    }
  }
}

/**
 * Look up the default HTTP status for a provider error code.
 *
 * @param {string} code A value from {@link PROVIDER_ERROR_CODES}.
 * @returns {number} The mapped status, or {@link DEFAULT_PROVIDER_ERROR_STATUS} for unknown codes.
 */
export function statusForProviderErrorCode(code) {
  return STATUS_BY_CODE[code] ?? DEFAULT_PROVIDER_ERROR_STATUS
}

/**
 * Structural check for {@link ProviderError} that survives duplicated copies of
 * this module in a pnpm workspace, where `instanceof` can be false across two
 * physically different loads of the same file.
 *
 * @param {unknown} value Candidate error.
 * @returns {boolean} True when `value` behaves like a `ProviderError`.
 */
export function isProviderError(value) {
  return (
    value instanceof Error &&
    value.name === 'ProviderError' &&
    typeof (/** @type {{code?: unknown}} */ (value).code) === 'string' &&
    Array.isArray(/** @type {{issues?: unknown}} */ (value).issues)
  )
}
