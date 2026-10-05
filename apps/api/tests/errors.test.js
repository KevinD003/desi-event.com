import { describe, expect, it } from 'vitest'

import { InventoryError } from '@desi-event/inventory'
import { PermissionError } from '@desi-event/permissions'
import { PricingError } from '@desi-event/pricing'
import { ProviderError } from '@desi-event/providers'
import { ValidationError, errorResponseSchema } from '@desi-event/schemas'

import {
  DATABASE_REFUSALS,
  POSTING_ROLE_SENTENCE,
  REVIEW_REQUIRED_SENTENCE,
  UNSTORABLE_CHARACTER_MESSAGE,
  databaseRefusal,
  exposedServerError,
  httpError,
  normaliseError,
  toErrorBody,
} from '../src/lib/errors.js'
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

  it('answers 400, not 500, for a character PostgreSQL cannot store', () => {
    // The shape the Prisma driver adapter throws for a NUL in a text value,
    // copied from a real query against PostgreSQL.
    const nul = Object.assign(new Error('Database error. Code: `22021`.'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2039',
      meta: {
        modelName: 'Event',
        driverAdapterError: {
          cause: {
            originalCode: '22021',
            originalMessage: 'invalid byte sequence for encoding "UTF8": 0x00',
            kind: 'postgres',
          },
        },
      },
    })

    for (const exposeInternals of [true, false]) {
      expect(normaliseError(nul, { exposeInternals })).toEqual({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: UNSTORABLE_CHARACTER_MESSAGE,
        expected: true,
      })
    }

    // And the NUL a JSON column refuses: `\u0000` in a jsonb value is 22P05,
    // "unsupported Unicode escape sequence", again copied from a real query.
    const jsonNul = {
      ...nul,
      meta: {
        modelName: 'AuditLog',
        driverAdapterError: {
          cause: {
            originalCode: '22P05',
            originalMessage: 'unsupported Unicode escape sequence',
            kind: 'postgres',
          },
        },
      },
    }

    for (const exposeInternals of [true, false]) {
      expect(normaliseError(jsonNul, { exposeInternals })).toEqual({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: UNSTORABLE_CHARACTER_MESSAGE,
        expected: true,
      })
    }

    // Only those SQLSTATEs: any other database failure under the same Prisma
    // code is still a fault, and still hidden in production.
    const check = {
      ...nul,
      meta: { driverAdapterError: { cause: { originalCode: '23514', kind: 'postgres' } } },
    }

    expect(normaliseError(check, { exposeInternals: false })).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
    })
  })

  it('keeps the words of a 5xx the API raised for the caller to read, in production too', () => {
    // A checkout whose capture timed out: "do not pay again" is the sentence
    // the buyer needs, and masking it is how somebody comes to pay twice.
    const timeout = exposedServerError(
      502,
      'PAYMENT_TIMEOUT',
      'Whether you were charged is being checked; please do not pay again.',
      { orderReference: 'DE-7K2M9Q' },
    )

    for (const exposeInternals of [true, false]) {
      expect(normaliseError(timeout, { exposeInternals })).toEqual({
        statusCode: 502,
        code: 'PAYMENT_TIMEOUT',
        message: 'Whether you were charged is being checked; please do not pay again.',
        orderReference: 'DE-7K2M9Q',
        expected: false,
      })
    }

    // The same status raised the ordinary way is still masked.
    expect(
      normaliseError(httpError(502, 'PAYMENT_TIMEOUT', 'upstream said: 10.0.0.4 refused'), {
        exposeInternals: false,
      }),
    ).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' })
  })

  it('forwards the order a refusal is about, and only a bare reference', () => {
    const pending = httpError(409, 'ORDER_PENDING', 'Still being checked.', {
      orderReference: 'DE-7K2M9Q',
    })
    const prose = httpError(409, 'ORDER_PENDING', 'Still being checked.', {
      orderReference: 'the order you placed a moment ago',
    })

    expect(normaliseError(pending).orderReference).toBe('DE-7K2M9Q')
    expect(toErrorBody(normaliseError(pending)).error.orderReference).toBe('DE-7K2M9Q')
    expect(normaliseError(prose)).not.toHaveProperty('orderReference')
    expect(toErrorBody(normaliseError(prose)).error).not.toHaveProperty('orderReference')
  })

  it('forwards details only for the website refusals that name them, and only their keys', () => {
    const changed = httpError(409, 'WEBSITE_CHANGED', 'The address changed.', {
      currentWebsiteUrl: 'https://rangoli.example/',
      problems: ['ignored here'],
      internal: 'never sent',
    })
    const removed = httpError(409, 'WEBSITE_CHANGED', 'The address changed.', {
      currentWebsiteUrl: null,
    })
    const unchanged = httpError(409, 'WEBSITE_REDIRECT_UNCHANGED', 'Already on.', {
      enabled: true,
      currentWebsiteUrl: 'https://rangoli.example/',
    })

    expect(errorResponseSchema.parse(toErrorBody(normaliseError(changed))).error.details).toEqual({
      currentWebsiteUrl: 'https://rangoli.example/',
    })
    expect(toErrorBody(normaliseError(removed)).error.details).toEqual({ currentWebsiteUrl: null })
    expect(errorResponseSchema.parse(toErrorBody(normaliseError(unchanged))).error.details).toEqual(
      { enabled: true },
    )

    // Any other code, a wrong type, or a 5xx carries none.
    const others = [
      httpError(409, 'CONFLICT', 'No.', { currentWebsiteUrl: 'https://rangoli.example/' }),
      httpError(409, 'WEBSITE_REDIRECT_UNCHANGED', 'Already on.', { enabled: 'yes' }),
      httpError(409, 'WEBSITE_CHANGED', 'Changed.', { currentWebsiteUrl: 42 }),
      httpError(409, 'WEBSITE_CHANGED', 'Changed.'),
      httpError(500, 'WEBSITE_CHANGED', 'Changed.', { currentWebsiteUrl: 'https://x.example/' }),
    ]

    for (const error of others) {
      expect(toErrorBody(normaliseError(error)).error).not.toHaveProperty('details')
    }
  })

  it('treats a nonsensical status as a server error', () => {
    expect(normaliseError(Object.assign(new Error('x'), { statusCode: 999 })).statusCode).toBe(500)
    expect(normaliseError(Object.assign(new Error('x'), { statusCode: 200 })).statusCode).toBe(500)
    expect(normaliseError('a string, thrown by something careless').statusCode).toBe(500)
  })
})

describe('databaseRefusal', () => {
  /**
   * A refusal shaped the way Prisma's driver adapter reports a raised
   * exception: a known request error whose cause carries the SQLSTATE and the
   * database's own message.
   *
   * @param {string} message The database's message.
   * @param {string} [code] The SQLSTATE.
   * @returns {Error} The error.
   */
  function adapterError(message, code = '23514') {
    return Object.assign(new Error('Invalid `prisma.event.update()` invocation'), {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: code, originalMessage: message } } },
    })
  }

  it('answers 409 REVIEW_REQUIRED when the review gate refuses a status', () => {
    const refusal = databaseRefusal(
      adapterError('event_public_requires_review: an event becomes public only after review'),
    )

    expect(refusal).toMatchObject({
      statusCode: 409,
      code: 'REVIEW_REQUIRED',
      message: REVIEW_REQUIRED_SENTENCE,
    })
  })

  it('answers 403 POSTING_ROLE_NEEDS_PLATFORM when a team invitation offers a posting role', () => {
    const refusal = databaseRefusal(
      Object.assign(new Error('violates check constraint'), {
        code: 'P2004',
        meta: { constraint: 'invitation_pending_role_is_owner_grantable' },
      }),
    )

    expect(refusal).toMatchObject({
      statusCode: 403,
      code: 'POSTING_ROLE_NEEDS_PLATFORM',
      message: POSTING_ROLE_SENTENCE,
    })
  })

  it('reads a raw driver error too: a SQLSTATE and the constraint in its message', () => {
    const raw = Object.assign(new Error('new row violates event_public_requires_review'), {
      code: '23514',
    })

    expect(databaseRefusal(raw)?.code).toBe('REVIEW_REQUIRED')
  })

  it('needs both the check SQLSTATE and a known name: anything else stays a fault', () => {
    // A known name with another SQLSTATE.
    expect(databaseRefusal(adapterError('event_public_requires_review', '23505'))).toBeNull()
    // A check violation nobody has a sentence for.
    expect(databaseRefusal(adapterError('ticket_quantity_positive'))).toBeNull()
    expect(databaseRefusal(null)).toBeNull()
    expect(databaseRefusal('event_public_requires_review')).toBeNull()
    expect(databaseRefusal(new Error('event_public_requires_review'))).toBeNull()
  })

  it('is applied by normaliseError, so a refusal is never a 500 and carries no SQL', () => {
    const normalised = normaliseError(
      adapterError(
        'ERROR: event_public_requires_review (status PUBLISHED) on relation "Event" row 42',
      ),
      { exposeInternals: false },
    )

    expect(normalised).toMatchObject({ statusCode: 409, code: 'REVIEW_REQUIRED' })
    expect(JSON.stringify(toErrorBody(normalised))).not.toMatch(/relation|row 42|ERROR:/u)
  })

  it('names each refusal once, with a 4xx', () => {
    const names = DATABASE_REFUSALS.map((refusal) => refusal.constraint)

    expect(new Set(names).size).toBe(names.length)

    for (const refusal of DATABASE_REFUSALS) {
      expect(refusal.statusCode).toBeGreaterThanOrEqual(400)
      expect(refusal.statusCode).toBeLessThan(500)
    }
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
