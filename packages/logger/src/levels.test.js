import { describe, it, expect } from 'vitest'

import {
  LOG_LEVELS,
  DEFAULT_LEVEL,
  DEVELOPMENT_LEVEL,
  isLogLevel,
  normaliseLevel,
  defaultLevelForEnv,
  resolveLevel,
} from './levels.js'
import { LoggerConfigurationError } from './errors.js'

describe('isLogLevel', () => {
  it('accepts every documented level', () => {
    for (const level of LOG_LEVELS) expect(isLogLevel(level)).toBe(true)
  })

  it('accepts sloppy casing and padding', () => {
    expect(isLogLevel(' DEBUG ')).toBe(true)
  })

  it('rejects unknown names and non-strings', () => {
    expect(isLogLevel('verbose')).toBe(false)
    expect(isLogLevel('')).toBe(false)
    expect(isLogLevel(20)).toBe(false)
    expect(isLogLevel(null)).toBe(false)
    expect(isLogLevel(undefined)).toBe(false)
  })
})

describe('normaliseLevel', () => {
  it('canonicalises a usable level', () => {
    expect(normaliseLevel('  WARN')).toBe('warn')
  })

  it('returns null for anything unusable', () => {
    expect(normaliseLevel('nope')).toBeNull()
    expect(normaliseLevel(undefined)).toBeNull()
    expect(normaliseLevel({})).toBeNull()
  })
})

describe('defaultLevelForEnv', () => {
  it('is debug in development and info everywhere else', () => {
    expect(defaultLevelForEnv('development')).toBe(DEVELOPMENT_LEVEL)
    expect(defaultLevelForEnv('production')).toBe(DEFAULT_LEVEL)
    expect(defaultLevelForEnv('test')).toBe(DEFAULT_LEVEL)
    expect(defaultLevelForEnv(undefined)).toBe(DEFAULT_LEVEL)
  })
})

describe('resolveLevel', () => {
  it('prefers an explicit level over the environment', () => {
    expect(resolveLevel({ level: 'error', env: { LOG_LEVEL: 'trace' } })).toBe('error')
  })

  it('normalises the explicit level', () => {
    expect(resolveLevel({ level: 'Fatal', env: {} })).toBe('fatal')
  })

  it('throws on an unknown explicit level', () => {
    expect(() => resolveLevel({ level: 'chatty', env: {} })).toThrow(LoggerConfigurationError)

    try {
      resolveLevel({ level: 'chatty', env: {} })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('LOGGER_LEVEL_INVALID')
      expect(error.statusCode).toBe(500)
      expect(error.value).toBe('chatty')
      expect(error.message).toContain('chatty')
    }
  })

  it('falls back to LOG_LEVEL when no level is given', () => {
    expect(resolveLevel({ env: { LOG_LEVEL: 'trace' } })).toBe('trace')
    expect(resolveLevel({ level: undefined, env: { LOG_LEVEL: 'silent' } })).toBe('silent')
    expect(resolveLevel({ level: '', env: { LOG_LEVEL: 'warn' } })).toBe('warn')
  })

  it('ignores an unusable LOG_LEVEL rather than refusing to boot', () => {
    expect(resolveLevel({ env: { LOG_LEVEL: 'loud' } })).toBe(DEFAULT_LEVEL)
    expect(resolveLevel({ env: { LOG_LEVEL: 'loud', NODE_ENV: 'development' } })).toBe(
      DEVELOPMENT_LEVEL,
    )
  })

  it('defaults by NODE_ENV when LOG_LEVEL is absent', () => {
    expect(resolveLevel({ env: { NODE_ENV: 'development' } })).toBe('debug')
    expect(resolveLevel({ env: { NODE_ENV: 'production' } })).toBe('info')
    expect(resolveLevel({ env: {} })).toBe('info')
  })

  it('reads process.env when no env is supplied', () => {
    expect(LOG_LEVELS).toContain(resolveLevel())
  })
})
