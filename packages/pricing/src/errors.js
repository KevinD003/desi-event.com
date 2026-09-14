/**
 * Error type for the pricing engine.
 *
 * Every rejection carries a machine-readable `code` so that the API layer can
 * map a failure onto a stable error payload without string matching, and a
 * `statusCode` because a pricing rejection is always caused by the request
 * rather than by the server.
 *
 * @module @desi-event/pricing/errors
 */

/**
 * Raised when a pricing input is structurally invalid — a non-integer amount, a
 * negative quantity, an unusable promo code record, a currency mismatch.
 *
 * A promo code that is merely expired, inactive or exhausted is *not* an error:
 * it is an ordinary business state and yields a zero discount instead.
 */
export class PricingError extends Error {
  /**
   * @param {string} message Human-readable description of the failure.
   * @param {object} [options] Extra detail.
   * @param {string} [options.code] Machine-readable error code. Defaults to `PRICING_ERROR`.
   * @param {number} [options.statusCode] HTTP status to surface. Defaults to `422`.
   * @param {unknown} [options.details] Arbitrary context (offending value, index, ...).
   * @param {unknown} [options.cause] Underlying error, if any.
   */
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })

    this.name = 'PricingError'
    this.code = options.code ?? 'PRICING_ERROR'
    this.statusCode = options.statusCode ?? 422
    this.details = options.details

    // Keeps the constructor frame out of stacks on V8 without affecting others.
    if (Error.captureStackTrace) Error.captureStackTrace(this, PricingError)
  }
}

export default PricingError
