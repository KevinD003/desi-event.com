/**
 * The error type raised by every inventory guard.
 *
 * @module @desi-event/inventory/errors
 */

/**
 * Machine-readable failure codes carried on `InventoryError.code`.
 *
 * Callers branch on these rather than on message text: the API layer maps them
 * to response bodies and the checkout UI maps them to copy.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const INVENTORY_ERROR_CODES = Object.freeze({
  /** Quantity is not an integer, or is below one. */
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  /** Quantity is a valid number but below the ticket type's `minPerOrder`. */
  BELOW_MINIMUM: 'BELOW_MINIMUM',
  /** Quantity is a valid number but above the ticket type's `maxPerOrder`. */
  ABOVE_MAXIMUM: 'ABOVE_MAXIMUM',
  /** Fewer tickets remain than were requested. */
  INSUFFICIENT_INVENTORY: 'INSUFFICIENT_INVENTORY',
  /** Ticket-type counters are malformed (negative, fractional, non-numeric). */
  INVALID_INVENTORY: 'INVALID_INVENTORY',
  /** A hold record is malformed or is not an object. */
  INVALID_HOLD: 'INVALID_HOLD',
  /** A ticket-type status outside the `TicketTypeStatus` enum. */
  INVALID_STATUS: 'INVALID_STATUS',
  /** A date argument is absent or not a usable instant. */
  INVALID_DATE: 'INVALID_DATE',
  /** A hold time-to-live that is not a positive number of seconds. */
  INVALID_TTL: 'INVALID_TTL',
})

/**
 * HTTP status per code. Malformed input is a 400, a request that is
 * well-formed but breaks a per-order rule is a 422, and losing the race for
 * the last tickets is a 409 because retrying with a smaller quantity can
 * succeed.
 *
 * @type {Readonly<Record<string, number>>}
 */
const STATUS_BY_CODE = Object.freeze({
  [INVENTORY_ERROR_CODES.INVALID_QUANTITY]: 400,
  [INVENTORY_ERROR_CODES.BELOW_MINIMUM]: 422,
  [INVENTORY_ERROR_CODES.ABOVE_MAXIMUM]: 422,
  [INVENTORY_ERROR_CODES.INSUFFICIENT_INVENTORY]: 409,
  [INVENTORY_ERROR_CODES.INVALID_INVENTORY]: 400,
  [INVENTORY_ERROR_CODES.INVALID_HOLD]: 400,
  [INVENTORY_ERROR_CODES.INVALID_STATUS]: 400,
  [INVENTORY_ERROR_CODES.INVALID_DATE]: 400,
  [INVENTORY_ERROR_CODES.INVALID_TTL]: 400,
})

/**
 * @typedef {object} InventoryErrorOptions
 * @property {number} [statusCode] Override the status derived from `code`.
 * @property {Record<string, unknown>} [details] Structured context (the offending quantity, the limit it broke, and so on).
 * @property {unknown} [cause] Underlying error, forwarded to `Error.cause`.
 */

/**
 * An inventory rule violation.
 *
 * @augments Error
 */
export class InventoryError extends Error {
  /**
   * @param {string} code One of {@link INVENTORY_ERROR_CODES}.
   * @param {string} message Human-readable explanation.
   * @param {InventoryErrorOptions} [options] Status, details and cause.
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })

    /** @type {string} */
    this.name = 'InventoryError'
    /** @type {string} */
    this.code = code
    /** @type {number} */
    this.statusCode = options.statusCode ?? STATUS_BY_CODE[code] ?? 400
    /** @type {Record<string, unknown>} */
    this.details = options.details ?? {}

    if (Error.captureStackTrace) Error.captureStackTrace(this, InventoryError)
  }

  /**
   * Serialise to the shape `errorResponseSchema` expects, so a route handler
   * can forward the error without reshaping it by hand.
   *
   * @returns {{error: {code: string, message: string, details: Record<string, unknown>}}} A JSON-safe error body.
   */
  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } }
  }
}
