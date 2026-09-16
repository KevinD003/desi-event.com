/**
 * Error type raised when the logger is configured with values it cannot use.
 *
 * Configuration mistakes surface at wiring time rather than at the first log
 * call, so a typo in a level name fails the boot instead of silently
 * swallowing every subsequent `debug` line.
 *
 * @module @desi-event/logger/errors
 */

/**
 * Thrown when `createLogger` receives an option it cannot honour.
 *
 * @augments Error
 */
export class LoggerConfigurationError extends Error {
  /**
   * @param {string} message Human-readable explanation.
   * @param {object} [options] Extra detail.
   * @param {string} [options.code] Machine-readable code.
   * @param {unknown} [options.value] The offending value.
   */
  constructor(message, options = {}) {
    super(message)
    this.name = 'LoggerConfigurationError'
    /** @type {number} HTTP status to use if this escapes to a request handler. */
    this.statusCode = 500
    /** @type {string} Machine-readable code. */
    this.code = options.code ?? 'LOGGER_CONFIGURATION_INVALID'
    /** @type {unknown} The value that was rejected. */
    this.value = options.value
  }
}

export default LoggerConfigurationError
