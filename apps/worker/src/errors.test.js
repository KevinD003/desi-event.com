import { describe, it, expect } from 'vitest'
import { UnrecoverableError } from 'bullmq'
import { z } from 'zod'

import {
  PermanentJobError,
  RetryableJobError,
  WORKER_ERROR_CODES,
  parseJobPayload,
} from './errors.js'

const schema = z.object({ orderId: z.string().min(3), quantity: z.number().int().default(1) })

describe('PermanentJobError', () => {
  it('is an UnrecoverableError, so BullMQ stops retrying it', () => {
    const error = new PermanentJobError('nope')

    expect(error).toBeInstanceOf(UnrecoverableError)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('PermanentJobError')
  })

  it('carries a machine-readable code, issues and details', () => {
    const error = new PermanentJobError('bad payload', {
      code: WORKER_ERROR_CODES.INVALID_JOB_PAYLOAD,
      jobName: 'send-email',
      issues: [{ path: 'to', code: 'invalid_format', message: 'bad address' }],
      details: { to: 'nope' },
    })

    expect(error.toJSON()).toEqual({
      name: 'PermanentJobError',
      code: 'INVALID_JOB_PAYLOAD',
      message: 'bad payload',
      jobName: 'send-email',
      issues: [{ path: 'to', code: 'invalid_format', message: 'bad address' }],
      details: { to: 'nope' },
    })
  })

  it('preserves the underlying cause', () => {
    const cause = new Error('root')
    expect(new PermanentJobError('wrapper', { cause }).cause).toBe(cause)
  })
})

describe('RetryableJobError', () => {
  it('is deliberately not an UnrecoverableError', () => {
    const error = new RetryableJobError('try again', {
      code: WORKER_ERROR_CODES.PROVIDER_UNAVAILABLE,
    })

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(UnrecoverableError)
    expect(error.statusCode).toBe(503)
    expect(error.toJSON().code).toBe('PROVIDER_UNAVAILABLE')
  })

  it('preserves the underlying cause', () => {
    const cause = new Error('socket hang up')
    expect(new RetryableJobError('wrapper', { cause }).cause).toBe(cause)
  })
})

describe('parseJobPayload', () => {
  it('returns the parsed payload with defaults applied', () => {
    expect(parseJobPayload(schema, { orderId: 'abc' }, 'issue-tickets')).toEqual({
      orderId: 'abc',
      quantity: 1,
    })
  })

  it('fails permanently, because a bad payload is bad on every attempt', () => {
    const error = (() => {
      try {
        parseJobPayload(schema, { orderId: 'a' }, 'issue-tickets')
        return null
      } catch (thrown) {
        return thrown
      }
    })()

    expect(error).toBeInstanceOf(UnrecoverableError)
    expect(error.code).toBe('INVALID_JOB_PAYLOAD')
    expect(error.jobName).toBe('issue-tickets')
    expect(error.issues[0].path).toBe('orderId')
    expect(error.message).toContain('issue-tickets')
    expect(error.message).toContain('orderId')
  })

  it('reports a root-level failure readably', () => {
    const error = (() => {
      try {
        parseJobPayload(schema, 'not an object', 'issue-tickets')
        return null
      } catch (thrown) {
        return thrown
      }
    })()

    expect(error.message).toContain('<root>')
  })
})
