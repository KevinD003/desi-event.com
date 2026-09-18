/**
 * Environment schemas.
 *
 * Each application parses `process.env` once at boot through the schema for
 * its process, so a missing or malformed variable fails immediately with a
 * precise message instead of surfacing as a confusing runtime error later.
 *
 * Unknown variables are stripped rather than rejected — `process.env` is full
 * of things that are none of our business.
 *
 * @module @desi-event/schemas/env
 */

import { z } from 'zod'

import { NODE_ENVS, logLevelSchema, nodeEnvSchema } from './enums.js'
import { parseOrThrow } from './errors.js'
import { urlSchema } from './primitives.js'

/** Shortest JWT signing secret accepted anywhere. */
export const MIN_JWT_SECRET_LENGTH = 32

/**
 * Secrets that ship in `.env.example` and in countless copy-pasted guides.
 * They are fine locally and fatal in production, so they are rejected only
 * when `NODE_ENV=production`.
 *
 * @type {string[]}
 */
export const INSECURE_JWT_SECRETS = Object.freeze([
  'dev-only-insecure-secret-change-me-before-any-deploy',
  'change-me',
  'changeme',
  'secret',
  'supersecret',
  'development',
  'test-secret',
])

/**
 * True when a secret is a known placeholder or self-describes as one.
 *
 * @param {string} secret The configured `JWT_SECRET`.
 * @returns {boolean} Whether the secret must be refused in production.
 */
export function isInsecureJwtSecret(secret) {
  if (typeof secret !== 'string') return true
  const normalised = secret.trim().toLowerCase()
  if (INSECURE_JWT_SECRETS.includes(normalised)) return true
  return /insecure|change-?me|placeholder|dev-only/.test(normalised)
}

const postgresUrlSchema = z
  .string()
  .min(1)
  .regex(/^postgres(ql)?:\/\/.+/i, 'DATABASE_URL must be a postgresql:// connection string')

const redisUrlSchema = z
  .string()
  .min(1)
  .regex(/^rediss?:\/\/.+/i, 'REDIS_URL must be a redis:// connection string')

const portSchema = z.coerce.number().int().min(1).max(65_535)

/**
 * `NODE_ENV` for a long-running server process.
 *
 * Deliberately defaults to `production`, unlike the shared `nodeEnvSchema`,
 * which defaults to development so local tooling needs no setup.
 *
 * The security guards below key off this value: the placeholder-secret check
 * only fires in production. With a development default, a deployment that
 * simply forgot to set `NODE_ENV` would boot happily on the public example
 * secret and accept forged tokens. Defaulting to production means forgetting
 * the variable produces the *safe* behaviour, and local development — which
 * already sets `NODE_ENV=development` in `.env.example` — is unaffected.
 */
const serverNodeEnvSchema = z.enum([...NODE_ENVS]).default('production')

/**
 * Treat an empty string as absent.
 *
 * `z.coerce.number()` turns `''` into `0`, so a variable left blank in a `.env`
 * file (`PLATFORM_FEE_BPS=`) silently becomes a zero fee rather than falling
 * back to the default. Blank means "not set".
 *
 * @param {unknown} value The raw environment value.
 * @returns {unknown} `undefined` when blank, otherwise the value unchanged.
 */
const blankAsAbsent = (value) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

/**
 * A boolean environment variable that survives being parsed twice.
 *
 * `z.stringbool()` reads a string and produces a boolean, which makes the
 * schema's output invalid as its own input: the API parses the environment at
 * startup and `buildApp` parses it again, and the second pass was handed the
 * boolean the first pass produced. That failed with "expected string, received
 * boolean" — and it failed for every deployment, because the field has a
 * default and so is always present in the output whether or not anybody set it.
 *
 * Normalising a boolean back to its string form makes parsing idempotent, which
 * is the property any schema applied to its own output needs.
 *
 * @param {boolean} defaultValue Value used when the variable is absent or blank.
 * @returns {object} A Zod schema accepting 'true', 'false', a real boolean, or nothing.
 */
const envBoolean = (defaultValue) =>
  z.preprocess((value) => {
    if (typeof value === 'boolean') return value ? 'true' : 'false'

    return blankAsAbsent(value)
  }, z.stringbool().default(defaultValue))

/** Variables every server process shares. */
const commonEnvFields = {
  NODE_ENV: serverNodeEnvSchema,
  LOG_LEVEL: logLevelSchema.default('info'),
}

/** Pricing knobs shared by the API and the worker, which both price orders. */
const feeEnvFields = {
  PLATFORM_FEE_BPS: z.preprocess(
    blankAsAbsent,
    z.coerce.number().int().min(0).max(10_000).default(590),
  ),
  PLATFORM_FEE_FLAT_CENTS: z.preprocess(
    blankAsAbsent,
    z.coerce.number().int().min(0).max(100_000).default(99),
  ),
}

/** How long a checkout hold survives, shared by the API and the worker sweep. */
const holdTtlField = {
  TICKET_HOLD_TTL_SECONDS: z.preprocess(
    blankAsAbsent,
    z.coerce.number().int().min(30).max(86_400).default(600),
  ),
}

/**
 * The global request budget, per address.
 *
 * A knob rather than a constant because the right number is a property of the
 * deployment, not of the software. The default blunts scraping from the open
 * internet; behind a corporate NAT or a shared egress address, a hundred real
 * people arrive as one caller and the same number throttles them. An operator
 * has to be able to say so without editing source.
 *
 * Bounded on both sides: too low and the site throttles its own visitors, too
 * high and the control is decorative. Zero is not accepted, because "off" is
 * not a rate limit and somebody would reach for it.
 */
const rateLimitFields = {
  RATE_LIMIT_MAX: z.preprocess(
    blankAsAbsent,
    z.coerce.number().int().min(30).max(100_000).default(300),
  ),
  RATE_LIMIT_WINDOW: z.string().trim().min(2).max(32).default('1 minute'),
}

/** `process.env` for the Fastify API. */
export const apiEnvSchema = z.preprocess(
  /**
   * Fill `AUTH_SECRET` from `JWT_SECRET` before anything is validated.
   *
   * A `z.default()` cannot read another field and a trailing `.transform()`
   * cannot be rendered to JSON Schema — which the package's own guard checks for
   * every exported schema. Preprocessing is the house convention for exactly
   * this: normalise on the way in, so the schema stays representable.
   *
   * Idempotent, because `server.js` parses the environment and `app.js` parses
   * that result again: on the second pass `AUTH_SECRET` is already set and this
   * leaves it alone.
   *
   * @param {unknown} value The raw environment.
   * @returns {unknown} The environment with `AUTH_SECRET` resolved.
   */
  (value) => {
    if (!value || typeof value !== 'object') return value

    const env = /** @type {Record<string, unknown>} */ (value)
    const supplied = typeof env.AUTH_SECRET === 'string' ? env.AUTH_SECRET.trim() : ''

    return supplied === '' ? { ...env, AUTH_SECRET: env.JWT_SECRET } : env
  },
  z
    .object({
      ...commonEnvFields,
      DATABASE_URL: postgresUrlSchema,
      REDIS_URL: redisUrlSchema,
      JWT_SECRET: z.string().min(MIN_JWT_SECRET_LENGTH, {
        message: `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`,
      }),
      JWT_EXPIRES_IN: z
        .string()
        .regex(/^\d+[smhdw]$/, 'JWT_EXPIRES_IN must look like 30m, 12h or 7d')
        .default('7d'),
      /**
       * The key behind everything Phase 2 seals or pseudonymises.
       *
       * One secret rather than four, because four secrets is four things to
       * rotate and three of them will be the development placeholder. Every use
       * derives its own key from this through HKDF with a distinct purpose label,
       * so a value sealed for one use cannot be opened by code that seals another.
       *
       * Defaults to `JWT_SECRET` when unset: a deployment that has one strong
       * secret should not be refused for not having two. That fallback is applied
       * in the refinement below rather than here, because a default cannot read
       * another field.
       */
      AUTH_SECRET: z.string().optional(),
      API_PORT: portSchema.default(4000),
      API_HOST: z.string().min(1).default('0.0.0.0'),
      CORS_ORIGIN: z.string().min(1).default('*'),
      /**
       * Whether this deployment is reached over HTTPS.
       *
       * Decides the `Secure` flag and the `__Host-` cookie prefix. It cannot be
       * inferred from the request: behind a proxy every request arrives as plain
       * HTTP, and trusting `X-Forwarded-Proto` means trusting whatever a caller
       * sends when the proxy is misconfigured. So it is configuration, and it
       * defaults to true — the failure mode of assuming HTTPS on a plain-HTTP
       * deployment is a cookie the browser refuses, which is loud; the failure
       * mode of the reverse is a session cookie sent in the clear, which is not.
       */
      SECURE_COOKIES: envBoolean(true).describe(
        'Set Secure and the __Host- prefix on session cookies. Only turn this off for local HTTP.',
      ),
      /** Where the browser app is served from, for the CSRF origin check. */
      WEB_ORIGIN: z.string().min(1).optional(),
      ...feeEnvFields,
      ...holdTtlField,
      ...rateLimitFields,
      /**
       * Deliberate opt-in to illustrative tax rates in production.
       *
       * Absent, production refuses to price an order under a DEMO tax policy.
       * Setting this is a decision somebody has to make on purpose and own.
       */
      ALLOW_DEMO_TAX_IN_PRODUCTION: envBoolean(false).describe(
        'Charge illustrative tax rates in production. Requires a deliberate decision.',
      ),
    })
    .superRefine((env, ctx) => {
      // Only when it was supplied on purpose. When it was filled from JWT_SECRET
      // the two are the same string, and JWT_SECRET's own rules below already
      // report the problem — telling somebody to fix a variable they never set is
      // how a validation message stops being read.
      const suppliedOnPurpose = env.AUTH_SECRET !== env.JWT_SECRET

      if (suppliedOnPurpose && (env.AUTH_SECRET?.length ?? 0) < MIN_JWT_SECRET_LENGTH) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_SECRET'],
          message: `AUTH_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`,
        })
      }

      if (
        suppliedOnPurpose &&
        env.NODE_ENV === 'production' &&
        isInsecureJwtSecret(env.AUTH_SECRET)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_SECRET'],
          message:
            'AUTH_SECRET is the development placeholder. Generate a real secret before deploying to production.',
        })
      }

      if (env.NODE_ENV === 'production' && isInsecureJwtSecret(env.JWT_SECRET)) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_SECRET'],
          message:
            'JWT_SECRET is the development placeholder. Generate a real secret before deploying to production.',
        })
      }
    }),
)

/** `process.env` for the BullMQ worker. */
export const workerEnvSchema = z.object({
  ...commonEnvFields,
  DATABASE_URL: postgresUrlSchema,
  REDIS_URL: redisUrlSchema,
  QUEUE_PREFIX: z.string().min(1).max(64).default('desi-event'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  EXPIRE_HOLDS_INTERVAL_MS: z.coerce.number().int().min(1000).max(3_600_000).default(30_000),
  /**
   * Whether retention enforcement has been activated in this environment.
   *
   * Defaults to off and is expected to stay off. The durations a sweep would
   * apply are `PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW`, so an environment
   * that has not been told otherwise refuses to execute and records
   * `SKIPPED_DISABLED` — the state the schema already anticipated and nothing
   * previously implemented.
   *
   * Note what this flag does **not** do: it does not enable deletion. No
   * deletion path exists anywhere in this repository. It gates whether a
   * rehearsal runs at all, so that an environment nobody has considered does
   * not quietly start counting people's rows.
   */
  RETENTION_ENFORCEMENT_ACTIVATED: envBoolean(false).describe(
    'Let this environment run a retention rehearsal. Off means it records SKIPPED_DISABLED and counts nothing.',
  ),
  ...feeEnvFields,
  ...holdTtlField,
})

/** `process.env` for the Next.js web app. */
export const webEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  NEXT_PUBLIC_API_URL: urlSchema.default('http://127.0.0.1:4000'),
  NEXT_PUBLIC_SITE_URL: urlSchema.default('http://127.0.0.1:3000'),
  WEB_PORT: portSchema.default(3000),
})

/**
 * Parse the API environment.
 *
 * @param {Record<string, string|undefined>} [env] Source of variables. Defaults to `process.env`.
 * @returns {object} The validated, coerced API configuration.
 * @throws {ValidationError} When a variable is missing or malformed.
 */
export function loadApiEnv(env = process.env) {
  return parseOrThrow(apiEnvSchema, env, 'Invalid API environment')
}

/**
 * Parse the worker environment.
 *
 * @param {Record<string, string|undefined>} [env] Source of variables. Defaults to `process.env`.
 * @returns {object} The validated, coerced worker configuration.
 * @throws {ValidationError} When a variable is missing or malformed.
 */
export function loadWorkerEnv(env = process.env) {
  return parseOrThrow(workerEnvSchema, env, 'Invalid worker environment')
}

/**
 * Parse the web environment.
 *
 * @param {Record<string, string|undefined>} [env] Source of variables. Defaults to `process.env`.
 * @returns {object} The validated, coerced web configuration.
 * @throws {ValidationError} When a variable is missing or malformed.
 */
export function loadWebEnv(env = process.env) {
  return parseOrThrow(webEnvSchema, env, 'Invalid web environment')
}
