/**
 * Error types raised by `@desi-event/api-contract`.
 *
 * Two failure modes are kept apart on purpose. `ApiContractError` means the
 * contract itself — or the way a caller used it — is wrong, which is a bug to
 * be fixed at build time. `ApiClientError` means a perfectly well-formed call
 * came back unhappy from a running server, which callers are expected to catch
 * and render.
 *
 * @module @desi-event/api-contract/errors
 */

/** Status reported for failures that never reached an HTTP response. */
export const NETWORK_ERROR_STATUS = 0

/**
 * A defect in the contract or in how it was used: an unknown route id, a
 * missing path parameter, a duplicated descriptor.
 */
export class ApiContractError extends Error {
  /**
   * @param {string} message Human-readable explanation.
   * @param {object} [options] Extra detail.
   * @param {string} [options.code] Machine-readable code.
   * @param {unknown} [options.details] Arbitrary supporting data.
   * @param {unknown} [options.cause] Underlying error, if any.
   */
  constructor(message, options = {}) {
    const { code = 'API_CONTRACT_ERROR', details, cause } = options
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ApiContractError'
    this.code = code
    this.statusCode = 500
    this.details = details
  }
}

/**
 * A non-2xx (or unreachable) HTTP response from the Desi-Event API.
 *
 * `body` is whatever the server sent — normally the `errorResponseSchema`
 * envelope, but it may be plain text or `null` when the response had no body,
 * so callers must not assume a shape.
 */
export class ApiClientError extends Error {
  /**
   * @param {string} message Human-readable explanation.
   * @param {object} [options] Response detail.
   * @param {number} [options.status] HTTP status code; `0` when the request never completed.
   * @param {unknown} [options.body] Parsed response body, if there was one.
   * @param {string} [options.code] Machine-readable code, normally `body.error.code`.
   * @param {string} [options.method] HTTP method that was attempted.
   * @param {string} [options.url] Fully resolved request URL.
   * @param {string} [options.routeId] Contract route id that produced the request.
   * @param {unknown} [options.cause] Underlying error, if any.
   */
  constructor(message, options = {}) {
    const {
      status = NETWORK_ERROR_STATUS,
      body = null,
      code,
      method,
      url,
      routeId,
      cause,
    } = options

    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ApiClientError'
    this.status = status
    this.statusCode = status
    this.body = body
    this.code = code ?? deriveCode(body, status)
    this.method = method
    this.url = url
    this.routeId = routeId
  }

  /** @returns {boolean} True when the request never produced an HTTP response. */
  get isNetworkError() {
    return this.status === NETWORK_ERROR_STATUS
  }
}

/**
 * Pull the machine-readable code out of a `errorResponseSchema` envelope.
 *
 * @param {unknown} body Parsed response body.
 * @param {number} status HTTP status code, used for the fallback.
 * @returns {string} The server's error code, or a status-derived fallback.
 */
function deriveCode(body, status) {
  if (body && typeof body === 'object' && 'error' in body) {
    const envelope = /** @type {{error?: {code?: unknown}}} */ (body).error
    if (envelope && typeof envelope === 'object' && typeof envelope.code === 'string') {
      return envelope.code
    }
  }

  return status === NETWORK_ERROR_STATUS ? 'NETWORK_ERROR' : `HTTP_${status}`
}

/**
 * Narrow an unknown value to an {@link ApiClientError}.
 *
 * Uses the `name` field rather than `instanceof` so an error that crossed a
 * bundle boundary (web client and API can load separate copies) still matches.
 *
 * @param {unknown} value Candidate value.
 * @returns {boolean} True when the value looks like an `ApiClientError`.
 */
export function isApiClientError(value) {
  return value instanceof ApiClientError || (value instanceof Error && value.name === 'ApiClientError')
}
