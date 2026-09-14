/**
 * Logger construction.
 *
 * @module @desi-event/logger/create-logger
 */

import pino from 'pino'

import { LoggerConfigurationError } from './errors.js'
import { resolveLevel } from './levels.js'
import { buildRedactOptions } from './redaction.js'

/** Name used by the shared instance when the service does not set one. */
export const DEFAULT_LOGGER_NAME = 'desi-event'

/**
 * A pino logger instance.
 *
 * The shared ESLint preset runs `jsdoc` in strict JSDoc mode, where a
 * TypeScript `import('pino').Logger` type annotation is a syntax error, so the
 * surface this codebase relies on is named here instead.
 *
 * @typedef {object} Logger
 * @property {string} level Current level name; assignable at runtime.
 * @property {Function} trace Log at trace level.
 * @property {Function} debug Log at debug level.
 * @property {Function} info Log at info level.
 * @property {Function} warn Log at warn level.
 * @property {Function} error Log at error level.
 * @property {Function} fatal Log at fatal level.
 * @property {Function} child Derive a child logger carrying extra bindings.
 * @property {Function} bindings Fields this logger attaches to every line.
 */

/**
 * @typedef {object} CreateLoggerOptions
 * @property {string} [name] Logger name, emitted on every line as `name`.
 * @property {string} [level] Explicit level. Overrides `LOG_LEVEL`.
 * @property {boolean} [pretty] Force the `pino-pretty` transport on or off.
 * @property {object} [destination] Stream to write to; anything with a `write` method. Mutually exclusive with the pretty transport, and how tests capture output.
 * @property {string[]} [redactPaths] Extra pino redact paths for service-specific shapes.
 * @property {object|null} [base] Fields attached to every line. `null` drops pino's default `pid`/`hostname`.
 * @property {object} [env] Environment to read, defaults to `process.env`.
 */

/**
 * Decide whether output should go through the `pino-pretty` transport.
 *
 * Explicit `pretty` always wins; otherwise pretty printing is on only in
 * development. Production must stay newline-delimited JSON because the log
 * shipper parses it.
 *
 * @param {object} [options] Inputs.
 * @param {boolean} [options.pretty] Explicit request.
 * @param {object} [options.env] Environment to read, defaults to `process.env`.
 * @returns {boolean} True when the pretty transport should be used.
 */
export function isPrettyEnabled(options = {}) {
  const { pretty, env = process.env } = options
  if (typeof pretty === 'boolean') return pretty
  return env.NODE_ENV === 'development'
}

/**
 * Build the options object handed to pino.
 *
 * Kept separate from {@link createLogger} so the wiring decisions (level,
 * redaction, transport) can be asserted in tests without starting a transport
 * worker thread.
 *
 * @param {CreateLoggerOptions} [options] Logger options.
 * @returns {object} A pino options object.
 * @throws {LoggerConfigurationError} If `level` is not a known level name.
 */
export function buildLoggerOptions(options = {}) {
  const { name, level, pretty, destination, redactPaths = [], base, env = process.env } = options

  /** @type {object} */
  const pinoOptions = {
    level: resolveLevel({ level, env }),
    redact: buildRedactOptions({ extraPaths: redactPaths }),
    serializers: { err: pino.stdSerializers.err, error: pino.stdSerializers.err },
  }

  if (name !== undefined) pinoOptions.name = name
  if (base !== undefined) pinoOptions.base = base

  // pino cannot write to a transport and a caller-supplied stream at the same
  // time, so an explicit destination wins and output stays plain JSON.
  if (!destination && isPrettyEnabled({ pretty, env })) {
    pinoOptions.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: false,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
      },
    }
  }

  return pinoOptions
}

/**
 * Create a logger.
 *
 * @param {CreateLoggerOptions} [options] Logger options.
 * @returns {Logger} A configured pino logger.
 * @throws {LoggerConfigurationError} If `level` is unknown or `destination` is not writable.
 */
export function createLogger(options = {}) {
  const { destination } = options

  if (destination !== undefined && typeof destination?.write !== 'function') {
    throw new LoggerConfigurationError('`destination` must be a writable stream.', {
      code: 'LOGGER_DESTINATION_INVALID',
      value: destination,
    })
  }

  const pinoOptions = buildLoggerOptions(options)

  return destination ? pino(pinoOptions, destination) : pino(pinoOptions)
}

/**
 * Create a child logger carrying request-scoped fields.
 *
 * Children inherit the parent's level, redaction and destination, so a
 * request logger is as safe as the root one.
 *
 * @param {Logger} parent Logger to derive from.
 * @param {object} bindings Fields to attach to every line, e.g. `{ requestId, userId }`.
 * @returns {Logger} The child logger.
 * @throws {LoggerConfigurationError} If `parent` is not a logger or `bindings` is not a plain object.
 */
export function createChildLogger(parent, bindings) {
  if (typeof parent?.child !== 'function') {
    throw new LoggerConfigurationError('`parent` must be a pino logger.', {
      code: 'LOGGER_PARENT_INVALID',
      value: parent,
    })
  }
  if (bindings === null || typeof bindings !== 'object' || Array.isArray(bindings)) {
    throw new LoggerConfigurationError('`bindings` must be a plain object.', {
      code: 'LOGGER_BINDINGS_INVALID',
      value: bindings,
    })
  }

  return parent.child(bindings)
}

/** @type {Logger|null} */
let defaultLogger = null

/**
 * Get the process-wide shared logger, creating it on first use.
 *
 * @returns {Logger} The singleton logger.
 */
export function getDefaultLogger() {
  defaultLogger ??= createLogger({ name: process.env.LOG_NAME || DEFAULT_LOGGER_NAME })
  return defaultLogger
}

/**
 * Drop the cached singleton so the next {@link getDefaultLogger} call rebuilds
 * it. Intended for tests that change `LOG_LEVEL`; production code should hold
 * on to the instance instead.
 *
 * @returns {void}
 */
export function resetDefaultLogger() {
  defaultLogger = null
}
