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

import { isIP } from 'node:net'

import { z } from 'zod'

import { NODE_ENVS, logLevelSchema, nodeEnvSchema } from './enums.js'
import { parseOrThrow } from './errors.js'
import { emailSchema, urlSchema } from './primitives.js'

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

/** The web servers' loopback addresses, which the API believes by default. */
export const DEFAULT_TRAFFIC_TRUSTED_FORWARDERS = Object.freeze([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
])

/**
 * The SMTP server that emails show-once codes when `DELIVERY_MODE=EMAIL`.
 *
 * All optional: email is opt-in and never inferred, so SMTP settings with
 * `DELIVERY_MODE` unset still mean MANUAL. What EMAIL needs together is checked
 * in the API schema's refinement below.
 */
const smtpEnvFields = {
  SMTP_HOST: z
    .preprocess(blankAsAbsent, z.string().trim().min(1).max(253).optional())
    .describe('The SMTP server that emails invitation and ticket-transfer codes.'),
  SMTP_PORT: z.preprocess(blankAsAbsent, portSchema.default(587)),
  SMTP_SECURE: envBoolean(false).describe('Implicit TLS from the first byte (usually port 465).'),
  SMTP_REQUIRE_TLS: envBoolean(true).describe(
    'Refuse to send unless STARTTLS succeeds. Ignored when SMTP_SECURE is true.',
  ),
  SMTP_USER: z.preprocess(blankAsAbsent, z.string().min(1).max(320).optional()),
  SMTP_PASSWORD: z.preprocess(blankAsAbsent, z.string().min(1).max(512).optional()),
  SMTP_FROM: z
    .preprocess(blankAsAbsent, emailSchema.optional())
    .describe('The address codes are sent from.'),
}

/**
 * Visit counting in the API.
 *
 * `TRAFFIC_TRUSTED_FORWARDERS` lists the addresses whose `x-desi-client-address`
 * header is believed: the web servers. Exact IPv4 or IPv6 literals,
 * comma-separated; anything else that connects is counted as its own address.
 * Normalised to a list in `preprocess`, so parsing the result again (the API
 * parses its environment twice) gives the same list.
 */
const trafficEnvFields = {
  TRAFFIC_TRUSTED_FORWARDERS: z
    .preprocess(
      (value) => {
        const supplied = blankAsAbsent(value)

        if (supplied === undefined) return [...DEFAULT_TRAFFIC_TRUSTED_FORWARDERS]
        if (typeof supplied !== 'string') return supplied

        return supplied
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      },
      z
        .array(
          z
            .string()
            .refine(
              (entry) => isIP(entry) !== 0,
              'TRAFFIC_TRUSTED_FORWARDERS must list IP addresses',
            ),
        )
        .min(1, 'TRAFFIC_TRUSTED_FORWARDERS must list IP addresses'),
    )
    .describe('Addresses whose x-desi-client-address header is believed: the web servers.'),
  TRAFFIC_BEACON_MAX_PER_MINUTE: z
    .preprocess(blankAsAbsent, z.coerce.number().int().min(1).max(10_000).default(60))
    .describe('Visit beacons one visitor may send a minute.'),
}

/**
 * Copying an imported listing's pictures (SPEC2-XI §4.5).
 *
 * `network` (the default) fetches each picture from its one allowed host;
 * `fixtures` reads it, by the address's file name, from `IMPORT_IMAGE_FIXTURE_DIR`
 * with no network at all, for tests and the browser suites. `fixtures` is
 * refused in production, and needs the directory.
 */
const importEnvFields = {
  IMPORT_IMAGE_SOURCE: z
    .preprocess(blankAsAbsent, z.enum(['network', 'fixtures']).default('network'))
    .describe(
      'Where imported pictures are copied from: "network" (their one allowed host), or "fixtures" (a directory, never in production).',
    ),
  IMPORT_IMAGE_FIXTURE_DIR: z
    .preprocess(blankAsAbsent, z.string().min(1).max(1024).optional())
    .describe('The directory pictures are read from when IMPORT_IMAGE_SOURCE is "fixtures".'),
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
      /**
       * How single-use codes reach the person they are for.
       *
       * Optional, and resolved by the API at boot rather than defaulted here,
       * because the right answer depends on whether a delivery provider is wired
       * in: unset with no provider is MANUAL, unset with one is EMAIL. EMAIL named
       * explicitly with no provider refuses to boot — an invitation silently
       * dropped is worse than a deployment that will not start.
       */
      DELIVERY_MODE: z
        .preprocess(blankAsAbsent, z.enum(['MANUAL', 'EMAIL']).optional())
        .describe(
          'How single-use codes reach people. MANUAL shows each code once to whoever issued it. EMAIL sends it through the SMTP server named by SMTP_HOST (or a provider wired in by code).',
        ),
      ...smtpEnvFields,
      ...trafficEnvFields,
      ...importEnvFields,
    })
    .superRefine((env, ctx) => {
      // Pictures read from a directory are for tests and the browser suites:
      // a production server copies them from their host, or not at all.
      if (env.IMPORT_IMAGE_SOURCE === 'fixtures' && env.NODE_ENV === 'production') {
        ctx.addIssue({
          code: 'custom',
          path: ['IMPORT_IMAGE_SOURCE'],
          message: 'IMPORT_IMAGE_SOURCE=fixtures is for tests only and is refused in production.',
        })
      }

      if (env.IMPORT_IMAGE_SOURCE === 'fixtures' && !env.IMPORT_IMAGE_FIXTURE_DIR) {
        ctx.addIssue({
          code: 'custom',
          path: ['IMPORT_IMAGE_FIXTURE_DIR'],
          message: 'IMPORT_IMAGE_FIXTURE_DIR is required when IMPORT_IMAGE_SOURCE is fixtures.',
        })
      }

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

      // Emailing codes through SMTP: what has to be set together. Checked only
      // when EMAIL was asked for and an SMTP server named, because SMTP settings
      // without DELIVERY_MODE=EMAIL change nothing.
      if (env.DELIVERY_MODE === 'EMAIL' && env.SMTP_HOST) {
        if (!env.SMTP_FROM) {
          ctx.addIssue({
            code: 'custom',
            path: ['SMTP_FROM'],
            message: 'SMTP_FROM is required to email codes: the address they are sent from.',
          })
        }

        if (!absoluteOrigin(env.WEB_ORIGIN, env.NODE_ENV === 'production')) {
          ctx.addIssue({
            code: 'custom',
            path: ['WEB_ORIGIN'],
            message:
              env.NODE_ENV === 'production'
                ? 'WEB_ORIGIN is required to email codes, and must be an https address in production: each letter links to the page where the code is typed.'
                : 'WEB_ORIGIN is required to email codes, as an absolute address: each letter links to the page where the code is typed.',
          })
        }

        if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) {
          ctx.addIssue({
            code: 'custom',
            path: [env.SMTP_USER ? 'SMTP_PASSWORD' : 'SMTP_USER'],
            message: 'Set SMTP_USER and SMTP_PASSWORD together, or neither.',
          })
        }

        if (env.NODE_ENV === 'production' && !env.SMTP_SECURE && !env.SMTP_REQUIRE_TLS) {
          ctx.addIssue({
            code: 'custom',
            path: ['SMTP_REQUIRE_TLS'],
            message:
              'This server refuses to send codes over an unencrypted connection in production: set SMTP_SECURE or SMTP_REQUIRE_TLS.',
          })
        }
      }
    }),
)

/**
 * Whether a value is an absolute http(s) origin, https only when required.
 *
 * @param {unknown} value The configured origin.
 * @param {boolean} httpsOnly Whether only https is acceptable.
 * @returns {boolean} True when it is one.
 */
function absoluteOrigin(value, httpsOnly) {
  if (typeof value !== 'string' || value.trim() === '') return false

  try {
    const { protocol } = new URL(value)

    return httpsOnly ? protocol === 'https:' : protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

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
   * Note what this flag does **not** do: it does not enable deletion. The
   * retention rehearsal has no deletion path. The only deletion on a timer in
   * this repository is the traffic roll-up's, of raw visit rows it has already
   * added up (see `@desi-event/db/traffic-rollup`), and this flag does not
   * touch it. It gates whether a rehearsal runs at all, so that an environment
   * nobody has considered does not quietly start counting people's rows.
   */
  RETENTION_ENFORCEMENT_ACTIVATED: envBoolean(false).describe(
    'Let this environment run a retention rehearsal. Off means it records SKIPPED_DISABLED and counts nothing.',
  ),
  /** How often the traffic roll-up adds visits up: ten minutes by default. */
  TRAFFIC_ROLLUP_INTERVAL_MS: z
    .preprocess(blankAsAbsent, z.coerce.number().int().min(60_000).max(3_600_000).default(600_000))
    .describe('How often visits to event pages are added up into daily totals.'),
  ...feeEnvFields,
  ...holdTtlField,
})

/** `process.env` for the Next.js web app. */
export const webEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  NEXT_PUBLIC_API_URL: urlSchema.default('http://127.0.0.1:4000'),
  NEXT_PUBLIC_SITE_URL: urlSchema.default('http://127.0.0.1:3000'),
  WEB_PORT: portSchema.default(3000),
  /**
   * How many proxies in front of the web server append to `x-forwarded-for`,
   * so the visitor's address is that many entries from the end. Zero takes the
   * address from the connection, which behind a proxy is the proxy's.
   */
  TRAFFIC_TRUSTED_PROXY_HOPS: z
    .preprocess(blankAsAbsent, z.coerce.number().int().min(0).max(5).default(0))
    .describe('Proxies in front of the web server that append to x-forwarded-for.'),
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
