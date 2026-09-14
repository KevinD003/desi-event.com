/**
 * Log level resolution.
 *
 * Precedence is: explicit argument, then `LOG_LEVEL`, then a default derived
 * from `NODE_ENV`. An explicit bad level is a programming error and throws; a
 * bad `LOG_LEVEL` is an operator typo on a running box and must never stop the
 * process from booting, so it is ignored in favour of the default.
 *
 * @module @desi-event/logger/levels
 */

import { LoggerConfigurationError } from './errors.js'

/**
 * Accepted level names, ordered from most to least verbose. `silent` disables
 * output entirely and is a pino level, not a severity.
 *
 * @type {string[]}
 */
export const LOG_LEVELS = Object.freeze([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
])

/** Level used when nothing else is configured. */
export const DEFAULT_LEVEL = 'info'

/** Level used when `NODE_ENV` is `development`. */
export const DEVELOPMENT_LEVEL = 'debug'

/**
 * Test whether a value is one of the accepted level names.
 *
 * @param {unknown} value Candidate level.
 * @returns {boolean} True when `value` is a usable pino level name.
 */
export function isLogLevel(value) {
  return typeof value === 'string' && LOG_LEVELS.includes(value.trim().toLowerCase())
}

/**
 * Normalise a level name, tolerating surrounding whitespace and casing.
 *
 * @param {unknown} value Candidate level.
 * @returns {string|null} The canonical level name, or `null` if unusable.
 */
export function normaliseLevel(value) {
  if (typeof value !== 'string') return null
  const candidate = value.trim().toLowerCase()
  return LOG_LEVELS.includes(candidate) ? candidate : null
}

/**
 * Determine the default level for an environment.
 *
 * @param {string} [nodeEnv] Value of `NODE_ENV`.
 * @returns {string} `debug` in development, otherwise `info`.
 */
export function defaultLevelForEnv(nodeEnv) {
  return nodeEnv === 'development' ? DEVELOPMENT_LEVEL : DEFAULT_LEVEL
}

/**
 * Resolve the level a logger should run at.
 *
 * @param {object} [options] Resolution inputs.
 * @param {string} [options.level] Explicitly requested level.
 * @param {object} [options.env] Environment to read, defaults to `process.env`.
 * @returns {string} A canonical pino level name.
 * @throws {LoggerConfigurationError} If `level` is given but is not a known level.
 */
export function resolveLevel(options = {}) {
  const { level, env = process.env } = options

  if (level !== undefined && level !== null && level !== '') {
    const explicit = normaliseLevel(level)
    if (!explicit) {
      throw new LoggerConfigurationError(
        `Unknown log level "${String(level)}". Expected one of: ${LOG_LEVELS.join(', ')}.`,
        { code: 'LOGGER_LEVEL_INVALID', value: level },
      )
    }
    return explicit
  }

  return normaliseLevel(env.LOG_LEVEL) ?? defaultLevelForEnv(env.NODE_ENV)
}
