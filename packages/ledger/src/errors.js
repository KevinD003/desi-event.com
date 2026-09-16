/**
 * The error type every ledger guard raises.
 *
 * @module @desi-event/ledger/errors
 */

/**
 * Machine-readable failure codes carried on `LedgerError.code`.
 *
 * Callers branch on these rather than on message text. Most of them are 500s
 * rather than 4xx, and deliberately so: a caller cannot send a request that
 * unbalances a batch — the amounts are computed server-side from a pricing
 * snapshot — so an unbalanced batch is a bug in this system, not bad input, and
 * reporting it as a client error would file it under the wrong heading.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const LEDGER_ERROR_CODES = Object.freeze({
  /** Debits and credits do not agree. */
  UNBALANCED: 'UNBALANCED',
  /** A batch with no entries records nothing. */
  EMPTY_BATCH: 'EMPTY_BATCH',
  /** An amount that is not an integer number of minor units. */
  AMOUNT_NOT_INTEGER: 'AMOUNT_NOT_INTEGER',
  /** A zero or negative amount. Direction carries the sign, not the amount. */
  AMOUNT_NOT_POSITIVE: 'AMOUNT_NOT_POSITIVE',
  /** An amount past the point where integer arithmetic is exact. */
  AMOUNT_TOO_LARGE: 'AMOUNT_TOO_LARGE',
  /** An account code no chart of accounts entry matches. */
  UNKNOWN_ACCOUNT: 'UNKNOWN_ACCOUNT',
  /** A batch kind outside the schema's enum. */
  UNKNOWN_KIND: 'UNKNOWN_KIND',
  /** Neither DEBIT nor CREDIT. */
  BAD_DIRECTION: 'BAD_DIRECTION',
  /** A currency that is not a three-letter ISO 4217 code. */
  BAD_CURRENCY: 'BAD_CURRENCY',
  /** Two currencies in one batch. */
  MIXED_CURRENCY: 'MIXED_CURRENCY',
  /** A batch for a source event that has already posted one. */
  ALREADY_POSTED: 'ALREADY_POSTED',
  /** An attempt to change a posted batch. */
  IMMUTABLE: 'IMMUTABLE',
})

/**
 * HTTP status per code.
 *
 * `ALREADY_POSTED` is a 409 because it is the expected outcome of a retry and
 * the caller's correct response is to carry on; everything else is a 500,
 * because nothing a browser can send should be able to cause it.
 *
 * @type {Readonly<Record<string, number>>}
 */
const STATUS_BY_CODE = Object.freeze({
  [LEDGER_ERROR_CODES.ALREADY_POSTED]: 409,
  [LEDGER_ERROR_CODES.IMMUTABLE]: 409,
})

/**
 * @typedef {object} LedgerErrorOptions
 * @property {number} [statusCode] Override the status derived from `code`.
 * @property {Record<string, unknown>} [details] Structured context.
 * @property {unknown} [cause] Underlying error, forwarded to `Error.cause`.
 */

/**
 * A ledger rule violation.
 *
 * @augments Error
 */
export class LedgerError extends Error {
  /**
   * @param {string} code One of {@link LEDGER_ERROR_CODES}.
   * @param {string} message Human-readable explanation.
   * @param {Record<string, unknown>|LedgerErrorOptions} [options] Details, or the options object.
   */
  constructor(code, message, options = {}) {
    const normalised =
      options && (options.details || options.statusCode || options.cause)
        ? options
        : { details: options }

    super(message, normalised.cause === undefined ? undefined : { cause: normalised.cause })

    /** @type {string} */
    this.name = 'LedgerError'

    /** @type {string} */
    this.code = code

    /** @type {number} */
    this.statusCode = normalised.statusCode ?? STATUS_BY_CODE[code] ?? 500

    /** @type {Record<string, unknown>} */
    this.details = normalised.details ?? {}
  }
}
