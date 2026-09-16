import { describe, it, expect } from 'vitest'

import logger, {
  logger as namedLogger,
  createLogger,
  getDefaultLogger,
  LOG_LEVELS,
  REDACT_PATHS,
  REDACTION_CENSOR,
  LoggerConfigurationError,
} from './index.js'

describe('package surface', () => {
  it('exports the contract other packages import', () => {
    expect(typeof createLogger).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.child).toBe('function')
    expect(LOG_LEVELS).toContain('info')
    expect(REDACT_PATHS.length).toBeGreaterThan(0)
    expect(REDACTION_CENSOR).toBe('[REDACTED]')
    expect(new LoggerConfigurationError('x').statusCode).toBe(500)
  })
})

describe('the shared logger instance', () => {
  it('is a singleton across named, default and lazy access', () => {
    expect(namedLogger).toBe(logger)
    expect(getDefaultLogger()).toBe(logger)
  })

  it('stays the same instance across repeat imports', async () => {
    const first = await import('./index.js')
    const second = await import('./index.js')

    expect(first.logger).toBe(second.logger)
    expect(first.logger).toBe(logger)
  })

  it('is not the same instance as a freshly created logger', () => {
    expect(createLogger({ name: 'other' })).not.toBe(logger)
  })
})
