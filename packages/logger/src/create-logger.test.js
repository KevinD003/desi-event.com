import { describe, it, expect, afterEach, vi } from 'vitest'

import {
  createLogger,
  createChildLogger,
  buildLoggerOptions,
  isPrettyEnabled,
  getDefaultLogger,
  resetDefaultLogger,
  DEFAULT_LOGGER_NAME,
} from './create-logger.js'
import { LoggerConfigurationError } from './errors.js'
import { REDACTION_CENSOR } from './redaction.js'
import { createCaptureStream } from '../tests/capture.js'

/** A request-shaped object of the kind a route handler dumps into a log line. */
const SECRET_PAYLOAD = {
  req: {
    method: 'POST',
    url: '/v1/orders',
    headers: {
      authorization: 'Bearer super-secret-jwt',
      cookie: 'session=abc123',
      'set-cookie': 'session=abc123; HttpOnly',
      'stripe-signature': 't=1,v1=deadbeef',
      'x-razorpay-signature': 'rzp-sig-value',
      'content-type': 'application/json',
    },
    body: {
      password: 'hunter2',
      buyerEmail: 'ticket@example.com',
    },
  },
  user: {
    id: 'usr_1',
    passwordHash: '$2b$10$hashedhashedhashed',
    sessionToken: 'sess-token-value',
  },
  payment: {
    provider: 'razorpay',
    key_secret: 'rzp_secret_value',
    webhookSecret: 'whsec_value',
  },
  someWrapper: {
    accessToken: 'wrapped-access-token',
  },
  token: 'top-level-token',
  apiKey: 'top-level-api-key',
}

/** Every secret string that must never survive serialisation. */
const SECRET_VALUES = [
  'super-secret-jwt',
  'abc123',
  'deadbeef',
  'rzp-sig-value',
  'hunter2',
  'hashedhashedhashed',
  'sess-token-value',
  'rzp_secret_value',
  'whsec_value',
  'wrapped-access-token',
  'top-level-token',
  'top-level-api-key',
]

afterEach(() => {
  vi.unstubAllEnvs()
  resetDefaultLogger()
})

describe('redaction', () => {
  it('strips every secret from the serialised line', () => {
    const stream = createCaptureStream()
    const log = createLogger({ name: 'api', destination: stream, env: {} })

    log.info(SECRET_PAYLOAD, 'order created')

    const raw = stream.raw()
    for (const secret of SECRET_VALUES) expect(raw).not.toContain(secret)

    const line = stream.last()
    expect(line.req.headers.authorization).toBe(REDACTION_CENSOR)
    expect(line.req.headers.cookie).toBe(REDACTION_CENSOR)
    expect(line.req.headers['set-cookie']).toBe(REDACTION_CENSOR)
    expect(line.req.headers['stripe-signature']).toBe(REDACTION_CENSOR)
    expect(line.req.headers['x-razorpay-signature']).toBe(REDACTION_CENSOR)
    expect(line.req.body.password).toBe(REDACTION_CENSOR)
    expect(line.user.passwordHash).toBe(REDACTION_CENSOR)
    expect(line.user.sessionToken).toBe(REDACTION_CENSOR)
    expect(line.payment.key_secret).toBe(REDACTION_CENSOR)
    expect(line.payment.webhookSecret).toBe(REDACTION_CENSOR)
    expect(line.token).toBe(REDACTION_CENSOR)
    expect(line.apiKey).toBe(REDACTION_CENSOR)
  })

  it('redacts sensitive keys one level below an unrecognised container', () => {
    const stream = createCaptureStream()
    const log = createLogger({ destination: stream, env: {} })

    log.info({ someWrapper: { accessToken: 'wrapped-access-token', password: 'hunter2' } }, 'hi')

    expect(stream.raw()).not.toContain('wrapped-access-token')
    expect(stream.last().someWrapper).toEqual({
      accessToken: REDACTION_CENSOR,
      password: REDACTION_CENSOR,
    })
  })

  it('leaves non-sensitive fields untouched', () => {
    const stream = createCaptureStream()
    const log = createLogger({ destination: stream, env: {} })

    log.info(SECRET_PAYLOAD, 'order created')

    const line = stream.last()
    expect(line.req.method).toBe('POST')
    expect(line.req.headers['content-type']).toBe('application/json')
    expect(line.req.body.buyerEmail).toBe('ticket@example.com')
    expect(line.user.id).toBe('usr_1')
    expect(line.msg).toBe('order created')
  })

  it('applies service-specific extra paths', () => {
    const stream = createCaptureStream()
    const log = createLogger({
      destination: stream,
      env: {},
      redactPaths: ['gateway.upiVpa'],
    })

    log.info({ gateway: { upiVpa: 'someone@okbank', mode: 'UPI' } }, 'charge')

    expect(stream.raw()).not.toContain('someone@okbank')
    expect(stream.last().gateway.mode).toBe('UPI')
  })

  it('survives redaction of a key that is absent', () => {
    const stream = createCaptureStream()
    const log = createLogger({ destination: stream, env: {} })

    log.info({ eventId: 'evt_1' }, 'nothing secret here')

    expect(stream.last().eventId).toBe('evt_1')
  })
})

describe('level selection', () => {
  it('honours an explicit level and drops quieter records', () => {
    const stream = createCaptureStream()
    const log = createLogger({ level: 'warn', destination: stream, env: {} })

    log.debug('debug line')
    log.info('info line')
    log.warn('warn line')
    log.error('error line')

    expect(log.level).toBe('warn')
    expect(stream.lines().map((line) => line.msg)).toEqual(['warn line', 'error line'])
  })

  it('reads LOG_LEVEL from the environment', () => {
    const stream = createCaptureStream()
    const log = createLogger({ destination: stream, env: { LOG_LEVEL: 'trace' } })

    log.trace('trace line')

    expect(log.level).toBe('trace')
    expect(stream.lines()).toHaveLength(1)
  })

  it('reads LOG_LEVEL from process.env when no env is injected', () => {
    vi.stubEnv('LOG_LEVEL', 'error')

    const stream = createCaptureStream()
    const log = createLogger({ destination: stream })

    log.warn('dropped')
    log.error('kept')

    expect(log.level).toBe('error')
    expect(stream.lines().map((line) => line.msg)).toEqual(['kept'])
  })

  it('defaults to info, and to debug in development', () => {
    expect(createLogger({ destination: createCaptureStream(), env: {} }).level).toBe('info')
    expect(
      createLogger({ destination: createCaptureStream(), env: { NODE_ENV: 'production' } }).level,
    ).toBe('info')
    expect(
      createLogger({ destination: createCaptureStream(), env: { NODE_ENV: 'development' } }).level,
    ).toBe('debug')
  })

  it('writes nothing at level silent', () => {
    const stream = createCaptureStream()
    const log = createLogger({ level: 'silent', destination: stream, env: {} })

    log.fatal('not written')

    expect(stream.raw()).toBe('')
  })

  it('rejects an unknown level', () => {
    expect(() => createLogger({ level: 'chatty', env: {} })).toThrow(LoggerConfigurationError)
  })
})

describe('isPrettyEnabled', () => {
  it('lets an explicit flag win in both directions', () => {
    expect(isPrettyEnabled({ pretty: true, env: { NODE_ENV: 'production' } })).toBe(true)
    expect(isPrettyEnabled({ pretty: false, env: { NODE_ENV: 'development' } })).toBe(false)
  })

  it('is on only in development by default', () => {
    expect(isPrettyEnabled({ env: { NODE_ENV: 'development' } })).toBe(true)
    expect(isPrettyEnabled({ env: { NODE_ENV: 'production' } })).toBe(false)
    expect(isPrettyEnabled({ env: {} })).toBe(false)
  })

  it('reads process.env by default', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(isPrettyEnabled()).toBe(true)
  })
})

describe('buildLoggerOptions', () => {
  it('adds the pino-pretty transport when pretty is requested', () => {
    const options = buildLoggerOptions({ pretty: true, env: {} })
    expect(options.transport.target).toBe('pino-pretty')
    expect(options.transport.options.colorize).toBe(true)
  })

  it('adds the transport in development without being asked', () => {
    expect(buildLoggerOptions({ env: { NODE_ENV: 'development' } }).transport).toBeDefined()
  })

  it('emits plain JSON in production so log shipping keeps working', () => {
    const options = buildLoggerOptions({ env: { NODE_ENV: 'production' } })
    expect(options.transport).toBeUndefined()
    expect(options.level).toBe('info')
  })

  it('never combines a transport with a caller-supplied destination', () => {
    const options = buildLoggerOptions({
      pretty: true,
      destination: createCaptureStream(),
      env: { NODE_ENV: 'development' },
    })
    expect(options.transport).toBeUndefined()
  })

  it('carries redaction and error serialisers', () => {
    const options = buildLoggerOptions({ env: {} })
    expect(options.redact.censor).toBe(REDACTION_CENSOR)
    expect(options.redact.paths.length).toBeGreaterThan(0)
    expect(typeof options.serializers.err).toBe('function')
    expect(typeof options.serializers.error).toBe('function')
  })

  it('only sets name and base when they are supplied', () => {
    expect(buildLoggerOptions({ env: {} })).not.toHaveProperty('name')
    expect(buildLoggerOptions({ env: {} })).not.toHaveProperty('base')

    const options = buildLoggerOptions({ name: 'worker', base: null, env: {} })
    expect(options.name).toBe('worker')
    expect(options.base).toBeNull()
  })
})

describe('createLogger', () => {
  it('stamps the logger name on every line', () => {
    const stream = createCaptureStream()
    const log = createLogger({ name: 'worker', destination: stream, env: {} })

    log.info('started')

    expect(stream.last().name).toBe('worker')
  })

  it('drops pid and hostname when base is null', () => {
    const stream = createCaptureStream()
    const log = createLogger({ destination: stream, base: null, env: {} })

    log.info('started')

    const line = stream.last()
    expect(line.pid).toBeUndefined()
    expect(line.hostname).toBeUndefined()
  })

  it('serialises errors with type, message and stack', () => {
    const stream = createCaptureStream()
    const log = createLogger({ destination: stream, env: {} })

    log.error({ err: new TypeError('hold expired') }, 'failed')

    const { err } = stream.last()
    expect(err.type).toBe('TypeError')
    expect(err.message).toBe('hold expired')
    expect(err.stack).toContain('create-logger.test.js')
  })

  it('rejects a destination that cannot be written to', () => {
    expect(() => createLogger({ destination: {}, env: {} })).toThrow(LoggerConfigurationError)

    try {
      createLogger({ destination: 'stdout', env: {} })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error.code).toBe('LOGGER_DESTINATION_INVALID')
      expect(error.statusCode).toBe(500)
    }
  })

  it('builds a real pretty-printing logger when asked', () => {
    const log = createLogger({ name: 'pretty', pretty: true, level: 'silent', env: {} })
    expect(typeof log.info).toBe('function')
    expect(log.level).toBe('silent')
  })
})

describe('child loggers', () => {
  it('carries request-scoped bindings on every line', () => {
    const stream = createCaptureStream()
    const log = createLogger({ name: 'api', destination: stream, env: {} })
    const requestLog = log.child({ requestId: 'req_1', userId: 'usr_1' })

    requestLog.info('handling')
    requestLog.warn('slow')

    for (const line of stream.lines()) {
      expect(line.requestId).toBe('req_1')
      expect(line.userId).toBe('usr_1')
      expect(line.name).toBe('api')
    }
  })

  it('inherits redaction, so a request logger is as safe as its parent', () => {
    const stream = createCaptureStream()
    const log = createLogger({ destination: stream, env: {} })
    const requestLog = createChildLogger(log, { requestId: 'req_2' })

    requestLog.info(SECRET_PAYLOAD, 'order created')

    const raw = stream.raw()
    for (const secret of SECRET_VALUES) expect(raw).not.toContain(secret)
    expect(stream.last().requestId).toBe('req_2')
  })

  it('does not let a child leak secrets through its own bindings', () => {
    const stream = createCaptureStream()
    const log = createLogger({ destination: stream, env: {} })

    createChildLogger(log, { requestId: 'req_3', token: 'binding-token' }).info('bound')

    expect(stream.raw()).not.toContain('binding-token')
    expect(stream.last().token).toBe(REDACTION_CENSOR)
  })

  it('can be quieter than its parent', () => {
    const stream = createCaptureStream()
    const log = createLogger({ level: 'debug', destination: stream, env: {} })
    const quiet = createChildLogger(log, { requestId: 'req_4' })
    quiet.level = 'error'

    quiet.info('dropped')
    quiet.error('kept')

    expect(stream.lines().map((line) => line.msg)).toEqual(['kept'])
  })

  it('rejects a parent that is not a logger', () => {
    expect(() => createChildLogger({}, { requestId: 'x' })).toThrow(LoggerConfigurationError)
    expect(() => createChildLogger(null, { requestId: 'x' })).toThrow(/pino logger/)
  })

  it('rejects bindings that are not a plain object', () => {
    const log = createLogger({ destination: createCaptureStream(), env: {} })

    expect(() => createChildLogger(log, null)).toThrow(LoggerConfigurationError)
    expect(() => createChildLogger(log, ['requestId'])).toThrow(/plain object/)
    expect(() => createChildLogger(log, 'requestId')).toThrow(LoggerConfigurationError)
  })
})

describe('getDefaultLogger', () => {
  it('returns the same instance every time', () => {
    expect(getDefaultLogger()).toBe(getDefaultLogger())
  })

  it('names itself after the platform by default', () => {
    expect(getDefaultLogger().bindings().name).toBe(DEFAULT_LOGGER_NAME)
  })

  it('rebuilds after an explicit reset', () => {
    const first = getDefaultLogger()
    resetDefaultLogger()
    expect(getDefaultLogger()).not.toBe(first)
  })

  it('takes its name from LOG_NAME when set', () => {
    vi.stubEnv('LOG_NAME', 'checkin-scanner')
    resetDefaultLogger()

    expect(getDefaultLogger().bindings().name).toBe('checkin-scanner')
  })
})
