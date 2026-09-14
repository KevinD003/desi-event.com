import { describe, expect, it } from 'vitest'

import {
  ApiClientError,
  ApiContractError,
  NETWORK_ERROR_STATUS,
  isApiClientError,
} from './errors.js'

describe('ApiContractError', () => {
  it('defaults its code and reports a server-side status', () => {
    const error = new ApiContractError('boom')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ApiContractError')
    expect(error.code).toBe('API_CONTRACT_ERROR')
    expect(error.statusCode).toBe(500)
    expect(error.message).toBe('boom')
  })

  it('carries a code, details and a cause', () => {
    const cause = new Error('root')
    const error = new ApiContractError('boom', { code: 'X', details: { a: 1 }, cause })

    expect(error.code).toBe('X')
    expect(error.details).toEqual({ a: 1 })
    expect(error.cause).toBe(cause)
  })
})

describe('ApiClientError', () => {
  it('mirrors status onto statusCode so it matches the house error shape', () => {
    const error = new ApiClientError('nope', { status: 404 })

    expect(error.status).toBe(404)
    expect(error.statusCode).toBe(404)
  })

  it('derives the code from the server error envelope', () => {
    const error = new ApiClientError('nope', {
      status: 409,
      body: { error: { code: 'SOLD_OUT', message: 'Sold out', statusCode: 409 } },
    })

    expect(error.code).toBe('SOLD_OUT')
  })

  it('falls back to HTTP_<status> when the body is not an envelope', () => {
    expect(new ApiClientError('nope', { status: 500, body: 'oops' }).code).toBe('HTTP_500')
    expect(new ApiClientError('nope', { status: 500, body: { error: 'oops' } }).code).toBe(
      'HTTP_500',
    )
    expect(new ApiClientError('nope', { status: 500, body: { error: { code: 7 } } }).code).toBe(
      'HTTP_500',
    )
  })

  it('defaults to a network error with status 0', () => {
    const error = new ApiClientError('unreachable')

    expect(error.status).toBe(NETWORK_ERROR_STATUS)
    expect(error.code).toBe('NETWORK_ERROR')
    expect(error.isNetworkError).toBe(true)
    expect(error.body).toBeNull()
  })

  it('does not call a 4xx a network error', () => {
    expect(new ApiClientError('nope', { status: 400 }).isNetworkError).toBe(false)
  })

  it('lets an explicit code win over the envelope', () => {
    const error = new ApiClientError('nope', {
      status: 404,
      code: 'OVERRIDE',
      body: { error: { code: 'NOT_FOUND' } },
    })

    expect(error.code).toBe('OVERRIDE')
  })

  it('records which request failed', () => {
    const error = new ApiClientError('nope', {
      status: 404,
      method: 'GET',
      url: 'https://api.test/v1/events/x',
      routeId: 'events.get',
    })

    expect(error.method).toBe('GET')
    expect(error.url).toBe('https://api.test/v1/events/x')
    expect(error.routeId).toBe('events.get')
  })
})

describe('isApiClientError', () => {
  it('recognises the class', () => {
    expect(isApiClientError(new ApiClientError('x'))).toBe(true)
  })

  it('recognises a copy from another bundle by name', () => {
    const impostor = new Error('x')
    impostor.name = 'ApiClientError'

    expect(isApiClientError(impostor)).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isApiClientError(new Error('x'))).toBe(false)
    expect(isApiClientError(new ApiContractError('x'))).toBe(false)
    expect(isApiClientError(null)).toBe(false)
    expect(isApiClientError({ name: 'ApiClientError' })).toBe(false)
  })
})
