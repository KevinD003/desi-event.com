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

/** `process.env` for the Fastify API. */
export const apiEnvSchema = z
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
    API_PORT: portSchema.default(4000),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    CORS_ORIGIN: z.string().min(1).default('*'),
    ...feeEnvFields,
    ...holdTtlField,
    /**
     * Deliberate opt-in to illustrative tax rates in production.
     *
     * Absent, production refuses to price an order under a DEMO tax policy.
     * Setting this is a decision somebody has to make on purpose and own.
     */
    ALLOW_DEMO_TAX_IN_PRODUCTION: z
      .preprocess(blankAsAbsent, z.stringbool().default(false))
      .describe('Charge illustrative tax rates in production. Requires a deliberate decision.'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && isInsecureJwtSecret(env.JWT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message:
          'JWT_SECRET is the development placeholder. Generate a real secret before deploying to production.',
      })
    }
  })

/** `process.env` for the BullMQ worker. */
export const workerEnvSchema = z.object({
  ...commonEnvFields,
  DATABASE_URL: postgresUrlSchema,
  REDIS_URL: redisUrlSchema,
  QUEUE_PREFIX: z.string().min(1).max(64).default('desi-event'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  EXPIRE_HOLDS_INTERVAL_MS: z.coerce.number().int().min(1000).max(3_600_000).default(30_000),
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
