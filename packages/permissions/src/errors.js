/**
 * The error thrown when an authorization check fails.
 *
 * @module @desi-event/permissions/errors
 */

/**
 * @typedef {object} PermissionErrorDetails
 * @property {string} [capability] The capability that was denied.
 * @property {string|null} [organizationId] The organisation the check was scoped to, if any.
 * @property {string|null} [actorId] The actor that was denied, if known.
 * @property {string} [reason] Machine-readable denial reason, see {@link PermissionError#reason}.
 */

/**
 * Raised by {@link assertCan} when an actor lacks a capability.
 *
 * `statusCode` is always 403, including for a missing actor: this package
 * cannot distinguish "no credentials were sent" from "the credentials were
 * rejected upstream", and answering 401 for the former would leak that
 * distinction. The `reason` field carries the detail for logging.
 */
export class PermissionError extends Error {
  /**
   * @param {string} message Human-readable message.
   * @param {PermissionErrorDetails} [details] Structured context for logs and API responses.
   */
  constructor(message, details = {}) {
    super(message)

    this.name = 'PermissionError'

    /** @type {number} HTTP status to answer with. */
    this.statusCode = 403

    /** @type {string} Machine-readable error code. */
    this.code = 'FORBIDDEN'

    /** @type {string|null} The capability that was denied. */
    this.capability = details.capability ?? null

    /** @type {string|null} Organisation the check was scoped to. */
    this.organizationId = details.organizationId ?? null

    /** @type {string|null} Actor that was denied. */
    this.actorId = details.actorId ?? null

    /**
     * Why the check failed: `'unauthenticated'` (no actor),
     * `'unknown_capability'` (capability string not recognised) or
     * `'missing_capability'` (actor is known but not permitted).
     *
     * @type {string}
     */
    this.reason = details.reason ?? 'missing_capability'

    if (Error.captureStackTrace) Error.captureStackTrace(this, PermissionError)
  }

  /**
   * Serialise to the shape the HTTP layer returns to clients.
   *
   * @returns {{error: string, message: string, statusCode: number, capability: string|null}} A JSON-safe payload.
   */
  toJSON() {
    return {
      error: this.code,
      message: this.message,
      statusCode: this.statusCode,
      capability: this.capability,
    }
  }
}
