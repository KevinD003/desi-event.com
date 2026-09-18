import { afterEach, describe, expect, it } from 'vitest'

import { ValidationError } from './errors.js'
import {
  INSECURE_JWT_SECRETS,
  MIN_JWT_SECRET_LENGTH,
  apiEnvSchema,
  isInsecureJwtSecret,
  loadApiEnv,
  loadWebEnv,
  loadWorkerEnv,
  webEnvSchema,
  workerEnvSchema,
} from './env.js'

const STRONG_SECRET = 'JX8mQ2vZ7pL4nR1tY6wB3sK9dF0hG5cA2eU8iO4pZ1xV'
const DB_URL = 'postgresql://desi:desi@127.0.0.1:5432/desi_event?schema=public'
const REDIS = 'redis://127.0.0.1:6379'

/**
 * A minimally valid API environment.
 *
 * @param {object} [overrides] Values to merge in.
 * @returns {object} An environment object.
 */
function apiEnv(overrides = {}) {
  return { DATABASE_URL: DB_URL, REDIS_URL: REDIS, JWT_SECRET: STRONG_SECRET, ...overrides }
}

/**
 * Collect the issue paths of a failed parse.
 *
 * @param {object} result A Zod safeParse result.
 * @returns {string[]} Dotted issue paths.
 */
function issuePaths(result) {
  return result.error.issues.map((issue) => issue.path.join('.'))
}

describe('apiEnvSchema', () => {
  it('fills every default from a minimal environment', () => {
    expect(apiEnvSchema.parse(apiEnv())).toEqual({
      // Production, not development: see the fail-safe test below.
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      DATABASE_URL: DB_URL,
      REDIS_URL: REDIS,
      JWT_SECRET: STRONG_SECRET,
      // Filled from JWT_SECRET rather than defaulted, so a deployment with one
      // strong secret is not refused for not having two.
      AUTH_SECRET: STRONG_SECRET,
      JWT_EXPIRES_IN: '7d',
      API_PORT: 4000,
      API_HOST: '0.0.0.0',
      CORS_ORIGIN: '*',
      // On by default. Assuming HTTPS on a plain-HTTP deployment produces a
      // cookie the browser refuses, which is loud; assuming the reverse produces
      // a session cookie sent in the clear, which is not.
      SECURE_COOKIES: true,
      PLATFORM_FEE_BPS: 590,
      PLATFORM_FEE_FLAT_CENTS: 99,
      TICKET_HOLD_TTL_SECONDS: 600,
      // A knob with a default, not a constant: behind a shared egress address
      // a hundred real visitors arrive as one caller and the same number
      // throttles them.
      RATE_LIMIT_MAX: 300,
      RATE_LIMIT_WINDOW: '1 minute',
      // Off by default: charging illustrative tax rates in production has to
      // be a deliberate decision somebody owns.
      ALLOW_DEMO_TAX_IN_PRODUCTION: false,
    })
  })

  it('takes an explicitly supplied AUTH_SECRET over JWT_SECRET', () => {
    const distinct = 'a-separate-auth-secret-long-enough-to-be-one'
    const parsed = apiEnvSchema.parse(apiEnv({ AUTH_SECRET: distinct }))

    expect(parsed.AUTH_SECRET).toBe(distinct)
    expect(parsed.JWT_SECRET).toBe(STRONG_SECRET)
  })

  it('treats a blank AUTH_SECRET as unset rather than as an empty secret', () => {
    expect(apiEnvSchema.parse(apiEnv({ AUTH_SECRET: '   ' })).AUTH_SECRET).toBe(STRONG_SECRET)
  })

  it('reports only JWT_SECRET when AUTH_SECRET was never supplied', () => {
    // Otherwise a deployment that forgot one secret is told to fix two, and one
    // of them is a variable nobody set.
    const result = apiEnvSchema.safeParse(apiEnv({ JWT_SECRET: 'short' }))

    expect(result.success).toBe(false)
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(['JWT_SECRET'])
  })

  it('reports AUTH_SECRET when it was supplied and is too short', () => {
    const result = apiEnvSchema.safeParse(apiEnv({ AUTH_SECRET: 'short' }))

    expect(result.success).toBe(false)
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(['AUTH_SECRET'])
  })

  it('coerces the numeric variables, which arrive as strings', () => {
    const parsed = apiEnvSchema.parse(
      apiEnv({
        API_PORT: '8080',
        PLATFORM_FEE_BPS: '250',
        PLATFORM_FEE_FLAT_CENTS: '0',
        TICKET_HOLD_TTL_SECONDS: '900',
      }),
    )
    expect(parsed).toMatchObject({
      API_PORT: 8080,
      PLATFORM_FEE_BPS: 250,
      PLATFORM_FEE_FLAT_CENTS: 0,
      TICKET_HOLD_TTL_SECONDS: 900,
    })
  })

  it('ignores unrelated variables that live in process.env', () => {
    const parsed = apiEnvSchema.parse(apiEnv({ PATH: '/usr/bin', HOME: '/root' }))
    expect(parsed).not.toHaveProperty('PATH')
    expect(parsed).not.toHaveProperty('HOME')
  })

  it('requires DATABASE_URL, REDIS_URL and JWT_SECRET', () => {
    expect(issuePaths(apiEnvSchema.safeParse({})).sort()).toEqual([
      'DATABASE_URL',
      'JWT_SECRET',
      'REDIS_URL',
    ])
  })

  it('rejects a connection string pointing at the wrong engine', () => {
    expect(issuePaths(apiEnvSchema.safeParse(apiEnv({ DATABASE_URL: 'mysql://x/y' })))).toEqual([
      'DATABASE_URL',
    ])
    expect(
      issuePaths(apiEnvSchema.safeParse(apiEnv({ REDIS_URL: 'http://localhost:6379' }))),
    ).toEqual(['REDIS_URL'])
  })

  it('accepts postgres:// and rediss:// spellings', () => {
    expect(
      apiEnvSchema.safeParse(
        apiEnv({ DATABASE_URL: 'postgres://u:p@h/db', REDIS_URL: 'rediss://h:6380' }),
      ).success,
    ).toBe(true)
  })

  it('enforces a minimum JWT secret length', () => {
    const short = 'x'.repeat(MIN_JWT_SECRET_LENGTH - 1)
    const result = apiEnvSchema.safeParse(apiEnv({ JWT_SECRET: short }))
    expect(issuePaths(result)).toEqual(['JWT_SECRET'])
    expect(result.error.issues[0].message).toMatch(/at least 32 characters/)
    expect(
      apiEnvSchema.safeParse(apiEnv({ JWT_SECRET: 'x'.repeat(MIN_JWT_SECRET_LENGTH) })).success,
    ).toBe(true)
  })

  it('accepts the .env.example placeholder outside production', () => {
    const placeholder = INSECURE_JWT_SECRETS[0]
    for (const NODE_ENV of ['development', 'test']) {
      expect(apiEnvSchema.safeParse(apiEnv({ NODE_ENV, JWT_SECRET: placeholder })).success).toBe(
        true,
      )
    }
  })

  it('rejects the .env.example placeholder in production', () => {
    const result = apiEnvSchema.safeParse(
      apiEnv({ NODE_ENV: 'production', JWT_SECRET: INSECURE_JWT_SECRETS[0] }),
    )
    expect(issuePaths(result)).toEqual(['JWT_SECRET'])
    expect(result.error.issues[0].message).toMatch(/placeholder/i)
  })

  it('accepts a real secret in production', () => {
    expect(
      apiEnvSchema.safeParse(apiEnv({ NODE_ENV: 'production', JWT_SECRET: STRONG_SECRET })).success,
    ).toBe(true)
  })

  it('validates the token lifetime format', () => {
    expect(apiEnvSchema.parse(apiEnv({ JWT_EXPIRES_IN: '30m' })).JWT_EXPIRES_IN).toBe('30m')
    expect(issuePaths(apiEnvSchema.safeParse(apiEnv({ JWT_EXPIRES_IN: 'forever' })))).toEqual([
      'JWT_EXPIRES_IN',
    ])
  })

  it('bounds the port, the fee and the hold TTL', () => {
    expect(issuePaths(apiEnvSchema.safeParse(apiEnv({ API_PORT: '0' })))).toEqual(['API_PORT'])
    expect(issuePaths(apiEnvSchema.safeParse(apiEnv({ API_PORT: '70000' })))).toEqual(['API_PORT'])
    expect(issuePaths(apiEnvSchema.safeParse(apiEnv({ PLATFORM_FEE_BPS: '10001' })))).toEqual([
      'PLATFORM_FEE_BPS',
    ])
    expect(issuePaths(apiEnvSchema.safeParse(apiEnv({ TICKET_HOLD_TTL_SECONDS: '5' })))).toEqual([
      'TICKET_HOLD_TTL_SECONDS',
    ])
  })

  it('rejects an unknown log level and NODE_ENV', () => {
    expect(issuePaths(apiEnvSchema.safeParse(apiEnv({ LOG_LEVEL: 'verbose' })))).toEqual([
      'LOG_LEVEL',
    ])
    expect(issuePaths(apiEnvSchema.safeParse(apiEnv({ NODE_ENV: 'staging' })))).toEqual([
      'NODE_ENV',
    ])
  })
})

describe('isInsecureJwtSecret', () => {
  it('flags every known placeholder', () => {
    for (const secret of INSECURE_JWT_SECRETS) {
      expect(isInsecureJwtSecret(secret)).toBe(true)
    }
  })

  it('flags secrets that describe themselves as temporary', () => {
    expect(isInsecureJwtSecret('SUPER-INSECURE-value-here')).toBe(true)
    expect(isInsecureJwtSecret('please-changeme-now')).toBe(true)
    expect(isInsecureJwtSecret('placeholder-value')).toBe(true)
    expect(isInsecureJwtSecret('  Change-Me  ')).toBe(true)
  })

  it('accepts a random secret', () => {
    expect(isInsecureJwtSecret(STRONG_SECRET)).toBe(false)
  })

  it('treats a non-string as insecure', () => {
    expect(isInsecureJwtSecret(undefined)).toBe(true)
    expect(isInsecureJwtSecret(12345)).toBe(true)
  })
})

describe('apiEnvSchema fail-safe defaults', () => {
  it('rejects the placeholder secret when NODE_ENV is not set at all', () => {
    // The guard used to key off NODE_ENV === 'production' while NODE_ENV
    // defaulted to development, so a deployment that merely forgot the
    // variable booted on the public example secret and accepted forged
    // tokens. Forgetting it now produces the safe behaviour instead.
    const result = apiEnvSchema.safeParse(
      apiEnv({ JWT_SECRET: 'dev-only-insecure-secret-change-me-before-any-deploy' }),
    )

    expect(result.success).toBe(false)
    expect(issuePaths(result)).toContain('JWT_SECRET')
  })

  it('still allows the placeholder secret in explicit local development', () => {
    const result = apiEnvSchema.safeParse(
      apiEnv({
        NODE_ENV: 'development',
        JWT_SECRET: 'dev-only-insecure-secret-change-me-before-any-deploy',
      }),
    )

    expect(result.success).toBe(true)
  })

  it('treats a blank numeric variable as absent rather than zero', () => {
    // `PLATFORM_FEE_BPS=` in a .env file used to coerce to 0, silently
    // switching off the platform fee instead of using the default.
    const parsed = apiEnvSchema.parse(
      apiEnv({ PLATFORM_FEE_BPS: '', PLATFORM_FEE_FLAT_CENTS: '  ' }),
    )

    expect(parsed.PLATFORM_FEE_BPS).toBe(590)
    expect(parsed.PLATFORM_FEE_FLAT_CENTS).toBe(99)
  })
})

describe('workerEnvSchema', () => {
  it('fills the queue defaults', () => {
    expect(workerEnvSchema.parse({ DATABASE_URL: DB_URL, REDIS_URL: REDIS })).toEqual({
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      DATABASE_URL: DB_URL,
      REDIS_URL: REDIS,
      QUEUE_PREFIX: 'desi-event',
      WORKER_CONCURRENCY: 5,
      EXPIRE_HOLDS_INTERVAL_MS: 30_000,
      RETENTION_ENFORCEMENT_ACTIVATED: false,
      PLATFORM_FEE_BPS: 590,
      PLATFORM_FEE_FLAT_CENTS: 99,
      TICKET_HOLD_TTL_SECONDS: 600,
    })
  })

  it('leaves retention enforcement off unless an operator says otherwise', () => {
    // The durations a sweep would apply are proposals nobody has approved, so
    // the safe reading of silence is "not here". Asserted on the exact-equality
    // default above as well, but stated separately because this one is a
    // decision rather than a convenience.
    const off = (env) =>
      workerEnvSchema.parse({ DATABASE_URL: DB_URL, REDIS_URL: REDIS, ...env })
        .RETENTION_ENFORCEMENT_ACTIVATED

    expect(off({})).toBe(false)
    expect(off({ RETENTION_ENFORCEMENT_ACTIVATED: '' })).toBe(false)
    expect(off({ RETENTION_ENFORCEMENT_ACTIVATED: 'false' })).toBe(false)
    expect(off({ RETENTION_ENFORCEMENT_ACTIVATED: 'true' })).toBe(true)
    // Its own output is valid input, which is what the idempotence test below
    // guards for the environment as a whole.
    expect(off({ RETENTION_ENFORCEMENT_ACTIVATED: true })).toBe(true)
  })

  it('coerces concurrency and rejects absurd values', () => {
    expect(
      workerEnvSchema.parse({ DATABASE_URL: DB_URL, REDIS_URL: REDIS, WORKER_CONCURRENCY: '12' })
        .WORKER_CONCURRENCY,
    ).toBe(12)
    expect(
      issuePaths(
        workerEnvSchema.safeParse({
          DATABASE_URL: DB_URL,
          REDIS_URL: REDIS,
          WORKER_CONCURRENCY: '0',
        }),
      ),
    ).toEqual(['WORKER_CONCURRENCY'])
  })

  it('does not require a JWT secret, because the worker signs nothing', () => {
    expect(workerEnvSchema.safeParse({ DATABASE_URL: DB_URL, REDIS_URL: REDIS }).success).toBe(true)
  })
})

describe('webEnvSchema', () => {
  it('defaults both public URLs and the port', () => {
    expect(webEnvSchema.parse({})).toEqual({
      NODE_ENV: 'development',
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4000',
      NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000',
      WEB_PORT: 3000,
    })
  })

  it('rejects a malformed public API URL', () => {
    expect(issuePaths(webEnvSchema.safeParse({ NEXT_PUBLIC_API_URL: 'localhost:4000' }))).toEqual([
      'NEXT_PUBLIC_API_URL',
    ])
  })

  it('coerces the port', () => {
    expect(webEnvSchema.parse({ WEB_PORT: '3001' }).WEB_PORT).toBe(3001)
  })
})

describe('loaders', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key]
    }
    Object.assign(process.env, originalEnv)
  })

  it('loadApiEnv reads process.env by default', () => {
    process.env.DATABASE_URL = DB_URL
    process.env.REDIS_URL = REDIS
    process.env.JWT_SECRET = STRONG_SECRET
    expect(loadApiEnv().API_PORT).toBe(4000)
  })

  it('loadApiEnv throws a ValidationError naming the missing variable', () => {
    let thrown
    try {
      loadApiEnv({})
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(ValidationError)
    expect(thrown.statusCode).toBe(400)
    expect(thrown.message).toBe('Invalid API environment')
    expect(thrown.issues.map((issue) => issue.path)).toContain('DATABASE_URL')
  })

  it('loadWorkerEnv and loadWebEnv behave the same way', () => {
    expect(loadWorkerEnv({ DATABASE_URL: DB_URL, REDIS_URL: REDIS }).QUEUE_PREFIX).toBe(
      'desi-event',
    )
    expect(() => loadWorkerEnv({})).toThrow(ValidationError)

    expect(loadWebEnv({}).WEB_PORT).toBe(3000)
    expect(() => loadWebEnv({ WEB_PORT: 'abc' })).toThrow(ValidationError)
  })

  it('loadWebEnv reads process.env by default', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.desi-event.com'
    expect(loadWebEnv().NEXT_PUBLIC_API_URL).toBe('https://api.desi-event.com')
  })
})

describe('parsing an environment twice', () => {
  /** The smallest environment `apiEnvSchema` accepts. */
  const MINIMAL = Object.freeze({
    DATABASE_URL: 'postgresql://desi:desi@127.0.0.1:5432/desi_event',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_SECRET: 'a-genuinely-random-secret-value-of-length',
  })

  it('produces something the schema still accepts', () => {
    // The API parses `process.env` at startup and `buildApp` parses the result
    // again. A schema whose output its own input rejects means the server
    // cannot start — which is exactly what happened, in every environment,
    // because the offending field has a default and is therefore always
    // present in the output.
    const once = apiEnvSchema.parse(MINIMAL)
    const twice = apiEnvSchema.safeParse(once)

    expect(twice.success).toBe(true)
    expect(twice.data).toEqual(once)
  })

  it('is idempotent for an explicitly supplied boolean', () => {
    const once = apiEnvSchema.parse({ ...MINIMAL, ALLOW_DEMO_TAX_IN_PRODUCTION: 'true' })

    expect(once.ALLOW_DEMO_TAX_IN_PRODUCTION).toBe(true)
    expect(apiEnvSchema.parse(once)).toEqual(once)
  })

  it('still reads the string forms a real environment supplies', () => {
    expect(
      apiEnvSchema.parse({ ...MINIMAL, ALLOW_DEMO_TAX_IN_PRODUCTION: 'false' })
        .ALLOW_DEMO_TAX_IN_PRODUCTION,
    ).toBe(false)
    expect(
      apiEnvSchema.parse({ ...MINIMAL, ALLOW_DEMO_TAX_IN_PRODUCTION: '' })
        .ALLOW_DEMO_TAX_IN_PRODUCTION,
    ).toBe(false)
    expect(apiEnvSchema.parse(MINIMAL).ALLOW_DEMO_TAX_IN_PRODUCTION).toBe(false)
  })

  it('is idempotent for the worker and web environments too', () => {
    const worker = workerEnvSchema.parse(MINIMAL)
    expect(workerEnvSchema.parse(worker)).toEqual(worker)

    const web = webEnvSchema.parse({})
    expect(webEnvSchema.parse(web)).toEqual(web)
  })
})
