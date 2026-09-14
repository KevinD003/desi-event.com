import { describe, expect, it } from 'vitest'

import { InventoryError } from '@desi-event/inventory'
import { PermissionError } from '@desi-event/permissions'
import { PricingError } from '@desi-event/pricing'
import { ProviderError } from '@desi-event/providers'
import { ValidationError } from '@desi-event/schemas'

import { httpError, normaliseError, toErrorBody } from '../src/lib/errors.js'
import { bearer, createTestApp, signIn } from './helpers/app.js'

describe('normaliseError', () => {
  it('keeps the status and code each domain package chose', () => {
    const cases = [
      [
        new ValidationError('bad', [{ path: 'email', code: 'invalid', message: 'nope' }]),
        400,
        'VALIDATION_ERROR',
      ],
      [new PermissionError('denied', { capability: 'event:create' }), 403, 'FORBIDDEN'],
      [new InventoryError('INSUFFICIENT_INVENTORY', 'sold out'), 409, 'INSUFFICIENT_INVENTORY'],
      [new InventoryError('ABOVE_MAXIMUM', 'too many'), 422, 'ABOVE_MAXIMUM'],
      [new PricingError('bad money', { code: 'INVALID_ITEM' }), 422, 'INVALID_ITEM'],
      [new ProviderError('PAYMENT_DECLINED', 'declined'), 402, 'PAYMENT_DECLINED'],
    ]

    for (const [error, statusCode, code] of cases) {
      expect(normaliseError(error)).toMatchObject({ statusCode, code, expected: true })
    }
  })

  it('carries validation issues through, and only for validation failures', () => {
    const issues = [{ path: 'items[0].quantity', code: 'too_small', message: 'at least 1' }]

    expect(normaliseError(new ValidationError('bad', issues)).issues).toEqual(issues)
    expect(normaliseError(new PermissionError('denied'))).not.toHaveProperty('issues')
  })

  it('hides an unexpected failure in production and reveals it elsewhere', () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'secret')")

    const production = normaliseError(bug, { exposeInternals: false })
    const development = normaliseError(bug, { exposeInternals: true })

    expect(production).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
      expected: false,
    })
    expect(development.message).toContain('secret')
  })

  it('hides a provider wiring failure too, since a 500 is never the caller fault', () => {
    const wiring = new ProviderError('INVALID_PROVIDER', 'payments adapter is missing capture()')

    expect(normaliseError(wiring, { exposeInternals: false })).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
    })
    expect(normaliseError(wiring, { exposeInternals: true }).message).toContain('capture()')
  })

  it('normalises every JWT failure to a single 401', () => {
    for (const code of [
      'FST_JWT_NO_AUTHORIZATION_IN_HEADER',
      'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED',
      'FAST_JWT_MALFORMED',
    ]) {
      const error = Object.assign(new Error('jwt'), { code, statusCode: 500 })
      expect(normaliseError(error)).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' })
    }
  })

  it('maps a bare status to a conventional code and never leaks a Fastify code', () => {
    expect(normaliseError(Object.assign(new Error('gone'), { statusCode: 410 })).code).toBe(
      'HOLD_EXPIRED',
    )
    expect(
      normaliseError(
        Object.assign(new Error('nope'), { statusCode: 400, code: 'FST_ERR_VALIDATION' }),
      ).code,
    ).toBe('VALIDATION_ERROR')
  })

  it('treats a nonsensical status as a server error', () => {
    expect(normaliseError(Object.assign(new Error('x'), { statusCode: 999 })).statusCode).toBe(500)
    expect(normaliseError(Object.assign(new Error('x'), { statusCode: 200 })).statusCode).toBe(500)
    expect(normaliseError('a string, thrown by something careless').statusCode).toBe(500)
  })
})

describe('toErrorBody', () => {
  it('builds the envelope and truncates a runaway request id', () => {
    const body = toErrorBody(normaliseError(httpError(409, 'CONFLICT', 'nope')), 'x'.repeat(200))

    expect(body.error).toMatchObject({ code: 'CONFLICT', message: 'nope', statusCode: 409 })
    expect(body.error.requestId).toHaveLength(64)
  })

  it('omits the request id when there is none', () => {
    expect(toErrorBody(normaliseError(httpError(404, 'NOT_FOUND', 'gone')))).toEqual({
      error: { code: 'NOT_FOUND', message: 'gone', statusCode: 404 },
    })
  })
})

describe('the error handler over HTTP', () => {
  it('answers an unknown route with the same envelope', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/v1/nope' })

    expect(response.statusCode).toBe(404)
    expect(response.json().error).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 })
    expect(response.json().error.requestId).toEqual(expect.any(String))

    await app.close()
  })

  it('answers 400 for a body that is not JSON at all', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.statusCode).toBe(400)

    await app.close()
  })

  it('never leaks an internal message in production', async () => {
    const { app, prisma } = await createTestApp({ env: { NODE_ENV: 'production' } })

    prisma.event.findMany = async () => {
      throw new Error('relation "Event" does not exist at 10.0.0.4:5432')
    }

    const response = await app.inject({ method: 'GET', url: '/v1/events' })

    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain('10.0.0.4')
    expect(response.json().error).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    })

    await app.close()
  })

  it('turns a response that breaks its own contract into a 500, not a bad payload', async () => {
    const { app, prisma } = await createTestApp()

    // A row that a widened select might produce: the schema refuses it rather
    // than letting a malformed event reach a client.
    prisma.event.findMany = async () => [{ id: 'not-a-cuid', title: 42 }]

    const response = await app.inject({ method: 'GET', url: '/v1/events' })

    expect(response.statusCode).toBe(500)
    expect(response.json().error.code).toBe('RESPONSE_SERIALIZATION_ERROR')

    await app.close()
  })

  it('sets the standard security headers and answers a CORS preflight', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['content-security-policy']).toContain("default-src 'self'")

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/events',
      headers: { origin: 'https://desievent.example', 'access-control-request-method': 'GET' },
    })
    expect(preflight.statusCode).toBe(204)
    // `CORS_ORIGIN=*` reflects whatever origin asked, which is what a public
    // read-mostly API wants.
    expect(preflight.headers['access-control-allow-origin']).toBe('https://desievent.example')

    await app.close()
  })

  it('honours an explicit CORS allow-list', async () => {
    const { app } = await createTestApp({ env: { CORS_ORIGIN: 'https://desievent.example' } })

    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://desievent.example' },
    })
    const refused = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil-desievent.example' },
    })

    expect(allowed.headers['access-control-allow-origin']).toBe('https://desievent.example')
    expect(refused.headers['access-control-allow-origin']).toBeUndefined()

    await app.close()
  })

  it('logs a 5xx through the injected logger with the request id', async () => {
    /** @type {object[]} */
    const lines = []
    const sink = {
      level: 'error',
      /**
       * @param {object} details Structured log details.
       * @returns {void} Nothing.
       */
      error: (details) => lines.push(details),
      info: () => {},
      warn: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
      silent: () => {},
      /**
       * @returns {object} A child logger.
       */
      child: () => sink,
    }

    const { app, prisma } = await createTestApp({ logger: sink })
    prisma.event.findMany = async () => {
      throw new Error('boom')
    }

    const response = await app.inject({ method: 'GET', url: '/v1/events' })

    expect(response.statusCode).toBe(500)
    const logged = lines.find((line) => line && line.requestId)
    expect(logged).toMatchObject({ requestId: response.json().error.requestId, url: '/v1/events' })

    await app.close()
  })

  it('refuses a payload larger than the body limit', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: bearer(token),
      payload: { description: 'x'.repeat(1_100_000) },
    })

    expect(response.statusCode).toBe(413)

    await app.close()
  })
})
