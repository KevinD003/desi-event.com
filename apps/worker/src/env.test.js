import { describe, it, expect } from 'vitest'
import { isValidationError } from '@desi-event/schemas'

import { describeEnvError, loadEnv } from './env.js'

/** The smallest environment the schema accepts. */
const MINIMAL = Object.freeze({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public',
  REDIS_URL: 'redis://127.0.0.1:6379',
})

describe('loadEnv', () => {
  it('fills in every default the worker relies on', () => {
    const env = loadEnv(MINIMAL)

    expect(env).toMatchObject({
      LOG_LEVEL: 'info',
      QUEUE_PREFIX: 'desi-event',
      WORKER_CONCURRENCY: 5,
      EXPIRE_HOLDS_INTERVAL_MS: 30_000,
      TICKET_HOLD_TTL_SECONDS: 600,
    })
  })

  it('coerces the numeric variables that arrive as strings', () => {
    const env = loadEnv({ ...MINIMAL, WORKER_CONCURRENCY: '12', EXPIRE_HOLDS_INTERVAL_MS: '90000' })

    expect(env.WORKER_CONCURRENCY).toBe(12)
    expect(env.EXPIRE_HOLDS_INTERVAL_MS).toBe(90_000)
  })

  it('strips variables that are none of the worker’s business', () => {
    const env = loadEnv({ ...MINIMAL, AWS_SECRET_ACCESS_KEY: 'hunter2' })

    expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
  })

  it.each([
    ['a missing Redis URL', { REDIS_URL: undefined }],
    ['a Redis URL that is not redis://', { REDIS_URL: 'http://127.0.0.1:6379' }],
    ['a missing database URL', { DATABASE_URL: undefined }],
    ['a database URL that is not postgres://', { DATABASE_URL: 'mysql://localhost/desi' }],
    ['concurrency below one', { WORKER_CONCURRENCY: '0' }],
    ['a sweep interval under a second', { EXPIRE_HOLDS_INTERVAL_MS: '100' }],
  ])('refuses %s', (_label, overrides) => {
    expect(() => loadEnv({ ...MINIMAL, ...overrides })).toThrow()
  })

  it('names the offending variable in the error it throws', () => {
    const error = (() => {
      try {
        loadEnv({ ...MINIMAL, REDIS_URL: 'nope' })
        return null
      } catch (thrown) {
        return thrown
      }
    })()

    expect(isValidationError(error)).toBe(true)
    expect(error.issues[0].path).toBe('REDIS_URL')
  })
})

describe('describeEnvError', () => {
  it('renders one line per offending variable', () => {
    const error = (() => {
      try {
        loadEnv({ NODE_ENV: 'test' })
        return null
      } catch (thrown) {
        return thrown
      }
    })()

    const lines = describeEnvError(error)

    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines.join('\n')).toContain('DATABASE_URL')
    expect(lines.join('\n')).toContain('REDIS_URL')
  })

  it('falls back to the message for anything that is not a validation failure', () => {
    expect(describeEnvError(new Error('redis refused the connection'))).toEqual([
      'redis refused the connection',
    ])
    expect(describeEnvError(undefined)).toEqual(['undefined'])
  })
})
