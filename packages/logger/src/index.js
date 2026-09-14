/**
 * Shared structured logging for Desi-Event.
 *
 * Services import {@link createLogger} for a named logger, or {@link logger}
 * for the process-wide instance. Both redact credentials, cookies and payment
 * provider secrets; see `./redaction.js` for the rules.
 *
 * ```js
 * import { createLogger, logger } from '@desi-event/logger'
 *
 * const log = createLogger({ name: 'api' })
 * const requestLog = log.child({ requestId })
 * requestLog.info({ req }, 'request received')
 * ```
 *
 * @module @desi-event/logger
 */

import { getDefaultLogger } from './create-logger.js'

export {
  createLogger,
  createChildLogger,
  getDefaultLogger,
  resetDefaultLogger,
  buildLoggerOptions,
  isPrettyEnabled,
  DEFAULT_LOGGER_NAME,
} from './create-logger.js'

export {
  LOG_LEVELS,
  DEFAULT_LEVEL,
  DEVELOPMENT_LEVEL,
  isLogLevel,
  normaliseLevel,
  defaultLevelForEnv,
  resolveLevel,
} from './levels.js'

export {
  REDACTION_CENSOR,
  REDACT_PATHS,
  SENSITIVE_HEADER_KEYS,
  SENSITIVE_FIELD_KEYS,
  WILDCARD_KEYS,
  HEADER_CONTAINERS,
  FIELD_CONTAINERS,
  redactPath,
  buildRedactPaths,
  buildRedactOptions,
} from './redaction.js'

export { LoggerConfigurationError } from './errors.js'

/**
 * The shared process-wide logger. Every import of this module receives the
 * same instance.
 *
 * @type {Logger}
 */
export const logger = getDefaultLogger()

export default logger
