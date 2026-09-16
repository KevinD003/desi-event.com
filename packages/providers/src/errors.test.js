import { describe, it, expect } from 'vitest'

import {
  ProviderError,
  PROVIDER_ERROR_CODES,
  DEFAULT_PROVIDER_ERROR_STATUS,
  isProviderError,
  statusForProviderErrorCode,
} from './errors.js'

describe('ProviderError', () => {
  it('derives the status from the code', () => {
    const error = new ProviderError(PROVIDER_ERROR_CODES.INTENT_NOT_FOUND, 'missing')

    expect(error.statusCode).toBe(404)
    expect(error.code).toBe('INTENT_NOT_FOUND')
    expect(error.name).toBe('ProviderError')
    expect(error).toBeInstanceOf(Error)
  })

  it('classifies wiring mistakes as 500 and declines as 402', () => {
    expect(new ProviderError(PROVIDER_ERROR_CODES.INVALID_PROVIDER, 'x').statusCode).toBe(500)
    expect(new ProviderError(PROVIDER_ERROR_CODES.INCOMPLETE_REGISTRY, 'x').statusCode).toBe(500)
    expect(new ProviderError(PROVIDER_ERROR_CODES.PAYMENT_DECLINED, 'x').statusCode).toBe(402)
    expect(new ProviderError(PROVIDER_ERROR_CODES.AMOUNT_MISMATCH, 'x').statusCode).toBe(422)
    expect(new ProviderError(PROVIDER_ERROR_CODES.ALREADY_CAPTURED, 'x').statusCode).toBe(409)
    expect(new ProviderError(PROVIDER_ERROR_CODES.SEND_FAILED, 'x').statusCode).toBe(502)
  })

  it('falls back to 500 for an unrecognised code', () => {
    expect(new ProviderError('SOMETHING_NEW', 'x').statusCode).toBe(DEFAULT_PROVIDER_ERROR_STATUS)
    expect(statusForProviderErrorCode('SOMETHING_NEW')).toBe(500)
  })

  it('lets an explicit statusCode win over the mapped one', () => {
    const error = new ProviderError(PROVIDER_ERROR_CODES.SEND_FAILED, 'x', { statusCode: 429 })
    expect(error.statusCode).toBe(429)
  })

  it('defaults issues and details rather than leaving them undefined', () => {
    const error = new ProviderError(PROVIDER_ERROR_CODES.INVALID_AMOUNT, 'x')

    expect(error.issues).toEqual([])
    expect(error.details).toEqual({})
    expect(error.provider).toBeUndefined()
  })

  it('ignores a non-array issues option', () => {
    const error = new ProviderError(PROVIDER_ERROR_CODES.INVALID_AMOUNT, 'x', { issues: 'nope' })
    expect(error.issues).toEqual([])
  })

  it('carries a cause when given one', () => {
    const cause = new Error('underlying')
    const error = new ProviderError(PROVIDER_ERROR_CODES.SEND_FAILED, 'x', { cause })

    expect(error.cause).toBe(cause)
  })

  it('serialises to the error response body shape', () => {
    const error = new ProviderError(PROVIDER_ERROR_CODES.INVALID_PROVIDER, 'bad adapter', {
      provider: 'payments',
      issues: [{ path: 'refund', code: 'missing_method', message: 'refund() is missing' }],
      details: { kind: 'payments' },
    })

    expect(error.toJSON()).toEqual({
      code: 'INVALID_PROVIDER',
      message: 'bad adapter',
      statusCode: 500,
      provider: 'payments',
      issues: [{ path: 'refund', code: 'missing_method', message: 'refund() is missing' }],
      details: { kind: 'payments' },
    })
    expect(JSON.parse(JSON.stringify(error)).code).toBe('INVALID_PROVIDER')
  })
})

describe('isProviderError', () => {
  it('recognises a ProviderError', () => {
    expect(isProviderError(new ProviderError(PROVIDER_ERROR_CODES.SEND_FAILED, 'x'))).toBe(true)
  })

  it('recognises a structurally identical error from another module instance', () => {
    const impostor = new Error('x')
    impostor.name = 'ProviderError'
    impostor.code = 'SEND_FAILED'
    impostor.issues = []

    expect(isProviderError(impostor)).toBe(true)
  })

  it('rejects plain errors and non-errors', () => {
    expect(isProviderError(new Error('x'))).toBe(false)
    expect(isProviderError({ name: 'ProviderError', code: 'X', issues: [] })).toBe(false)
    expect(isProviderError(null)).toBe(false)
    expect(isProviderError('ProviderError')).toBe(false)
  })
})

describe('PROVIDER_ERROR_CODES', () => {
  it('is frozen and self-consistent', () => {
    expect(Object.isFrozen(PROVIDER_ERROR_CODES)).toBe(true)
    for (const [key, value] of Object.entries(PROVIDER_ERROR_CODES)) {
      expect(value).toBe(key)
    }
  })
})
