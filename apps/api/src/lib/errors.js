/**
 * Error normalisation: one place that turns anything thrown inside a route
 * into the `errorResponseSchema` envelope.
 *
 * Every domain package ships its own error class (`ValidationError`,
 * `PermissionError`, `InventoryError`, `PricingError`, `ProviderError`) and
 * each already carries a `statusCode` and a machine-readable `code`. This
 * module deliberately does **not** re-derive those: it reads what the package
 * decided. Recognition is duck-typed on `name`/`code` rather than `instanceof`
 * because a pnpm workspace can legitimately load two physical copies of the
 * same module, and an `instanceof` check would then silently fall through to a
 * 500 for a perfectly ordinary 403.
 *
 * @module @desi-event/api/lib/errors
 */

import { WEBSITE_LIMITS } from '@desi-event/schemas/website'

/** Fallback code used when nothing more specific is known. */
export const INTERNAL_ERROR_CODE = 'INTERNAL_SERVER_ERROR'

/** Message sent in production instead of an unexpected error's own message. */
export const INTERNAL_ERROR_MESSAGE = 'An unexpected error occurred.'

/** Default code per status, used when an error carries a status but no code. */
const CODE_BY_STATUS = Object.freeze({
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  409: 'CONFLICT',
  410: 'HOLD_EXPIRED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  500: INTERNAL_ERROR_CODE,
  503: 'SERVICE_UNAVAILABLE',
})

/** Error `name` values owned by the domain packages. */
const DOMAIN_ERROR_NAMES = Object.freeze([
  'ValidationError',
  'PermissionError',
  'InventoryError',
  'PricingError',
  'ProviderError',
])

/**
 * `@fastify/jwt` and `fast-jwt` codes that mean "the credential is the
 * problem". They arrive with assorted statuses (401, 400, 500 for a bad
 * secret), so the status is normalised to 401 rather than trusted.
 *
 * @type {ReadonlySet<string>}
 */
const JWT_ERROR_CODES = new Set([
  'FST_JWT_NO_AUTHORIZATION_IN_HEADER',
  'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED',
  'FST_JWT_AUTHORIZATION_TOKEN_INVALID',
  'FST_JWT_AUTHORIZATION_TOKEN_UNTRUSTED',
  'FST_JWT_BAD_REQUEST',
  'FAST_JWT_MALFORMED',
  'FAST_JWT_INVALID_SIGNATURE',
  'FAST_JWT_EXPIRED',
])

/**
 * An HTTP error as the API reports it.
 *
 * @typedef {object} NormalisedError
 * @property {number} statusCode HTTP status to answer with.
 * @property {string} code Machine-readable code carried in `error.code`.
 * @property {string} message Human-readable message safe to send to a client.
 * @property {Array<{path: string, code: string, message: string}>} [issues] Field-level validation issues.
 * @property {string[]} [problems] Business-rule reasons, for a 4xx.
 * @property {string} [reason] A closed-vocabulary refusal code, for a 4xx.
 * @property {string} [orderReference] The order a checkout answer is about, when one was placed and the caller has to find it (see `orderReferenceOf`).
 * @property {{currentWebsiteUrl?: string|null, enabled?: boolean}} [details] The facts a few refusals name, from a closed list (see `exposedDetailsOf`).
 * @property {boolean} expected Whether this is an anticipated 4xx rather than a bug.
 */

/**
 * The few refusals whose `details` reach the caller, and which keys of them.
 *
 * `details` is otherwise context for whoever reads the code, never sent. These
 * name what the caller has to know to act without reading the page again:
 * the address an organiser changed the website to while an administrator was
 * deciding on the old one, and where the website link's switch stands when a
 * decision changed nothing. Both come from an administrators-only route, and
 * the address is what that route's own reads show the same reader in full.
 * Each key has one type; a value of another type is left out.
 */
const EXPOSED_DETAILS = Object.freeze({
  WEBSITE_CHANGED: Object.freeze({
    currentWebsiteUrl: (value) =>
      value === null || (typeof value === 'string' && value.length <= WEBSITE_LIMITS.url),
  }),
  WEBSITE_REDIRECT_UNCHANGED: Object.freeze({
    enabled: (value) => typeof value === 'boolean',
  }),
})

/**
 * Whether a thrown value is one of the domain error classes.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True when the error was raised deliberately by a package.
 */
export function isDomainError(error) {
  return error instanceof Error && DOMAIN_ERROR_NAMES.includes(error.name)
}

/**
 * Whether a thrown value is a JWT/credential failure.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True when the error concerns the bearer token itself.
 */
export function isAuthError(error) {
  const code = /** @type {{code?: unknown}} */ (error)?.code
  return typeof code === 'string' && JWT_ERROR_CODES.has(code)
}

/**
 * PostgreSQL's SQLSTATEs for a character it cannot store.
 *
 * - `22021` `character_not_in_repertoire`: a NUL (0x00) in a text value.
 * - `22P05` `untranslatable_character`: the `\u0000` escape in a `json` or
 *   `jsonb` value ("unsupported Unicode escape sequence"), which is how a NUL
 *   in a JSON column, an audit row's metadata or an outbox payload arrives.
 *
 * @type {ReadonlySet<string>}
 */
const UNSTORABLE_CHARACTER_CODES = new Set(['22021', '22P05'])

/** What a caller is told when they sent one. Names the fix, not the database. */
export const UNSTORABLE_CHARACTER_MESSAGE =
  'The request contains a character that cannot be stored, such as a NUL. Remove it and try again.'

/**
 * What a caller is told when the database refuses to make an unreviewed event
 * public (the `desi_event_status_requires_review` trigger).
 *
 * @type {string}
 */
export const REVIEW_REQUIRED_SENTENCE =
  'This event has not been approved by the Desi-Event team, so it cannot be made public.'

/**
 * What a member is told when they try to give somebody a role that creates or
 * publishes events.
 *
 * @type {string}
 */
export const POSTING_ROLE_SENTENCE =
  'Roles that create or publish events — event manager, manager, administrator and owner — are given by the Desi-Event team, not from this page. Ask the Desi-Event team to add this person to your organisation.'

/**
 * What a caller is told when their write lost a deadlock or a write conflict
 * to another change being saved at the same moment (PostgreSQL `40P01`, Prisma
 * `P2034`). Nothing of their write was kept, so trying again is the remedy.
 *
 * @type {string}
 */
export const TRY_AGAIN_SENTENCE =
  'Another change to this event was being saved at the same moment. Try again.'

/**
 * What a caller is told when a picture write met a change to the pictures it
 * depended on (SPEC2-XI X-P): a replacement cover's current cover removed, a
 * replacement already pointing somewhere, a row gone.
 *
 * @type {string}
 */
export const MEDIA_CHANGED_SENTENCE =
  'The pictures changed while this was being saved. Reload and try again.'

/**
 * What a caller is told when a database guard on deletion, restore or a
 * cancelled night refuses a write the service should never have made. Only a
 * bug reaches these; the caller hears a conflict, not a 500.
 *
 * @type {string}
 */
export const EVENT_CONTROL_CONFLICT_SENTENCE =
  'This event changed while that was being saved, so nothing was changed. Reload and try again.'

/**
 * Database refusals the API answers with a sentence instead of a 500.
 *
 * Each is a rule the service already keeps, held again by the database for a
 * code path that forgets it: a trigger or CHECK raising SQLSTATE `23514`. The
 * driver adapter passes on the SQLSTATE and the message but not the constraint
 * field, so the constraint is recognised by its name, which the migration
 * writes into the message as well (`event_public_requires_review`).
 *
 * @type {ReadonlyArray<{constraint: string, statusCode: number, code: string, message: string}>}
 */
export const DATABASE_REFUSALS = Object.freeze([
  Object.freeze({
    constraint: 'event_public_requires_review',
    statusCode: 409,
    code: 'REVIEW_REQUIRED',
    message: REVIEW_REQUIRED_SENTENCE,
  }),
  Object.freeze({
    constraint: 'invitation_pending_role_is_owner_grantable',
    statusCode: 403,
    code: 'POSTING_ROLE_NEEDS_PLATFORM',
    message: POSTING_ROLE_SENTENCE,
  }),
  // Deletion, restore and cancelled nights (SPEC2-XI X-E): guards under rules
  // `lib/event-deletion.js` and `lib/session-cancellation.js` already keep.
  ...[
    'event_restore_returns_prior_status',
    'event_deletion_records_prior_status',
    'event_deletion_consistency',
    'event_session_cancellation_final',
  ].map((constraint) =>
    Object.freeze({
      constraint,
      statusCode: 409,
      code: 'CONFLICT',
      message: EVENT_CONTROL_CONFLICT_SENTENCE,
    }),
  ),
  // A replacement cover's CHECK and trigger (`media_asset_replacement_shape`,
  // `media_asset_replacement_matches`): the cover it pointed at moved.
  Object.freeze({
    constraint: 'media_asset_replacement_',
    statusCode: 409,
    code: 'MEDIA_CHANGED',
    message: MEDIA_CHANGED_SENTENCE,
  }),
])

/** The SQLSTATE and Prisma codes of a lost deadlock or write conflict. */
const RETRYABLE_CODES = Object.freeze(new Set(['40P01', 'P2034']))

/**
 * Whether a database error is a deadlock or a write conflict that a retry
 * would get past (`40P01`, `P2034`), wherever the driver put the code.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True for one.
 */
export function isRetryableConflict(error) {
  if (!error || typeof error !== 'object') return false

  const { codes } = databaseRefusalParts(error)

  return [...codes].some((code) => RETRYABLE_CODES.has(code))
}

/**
 * The SQLSTATE and the text a database refusal arrived with, wherever the
 * driver adapter and Prisma put them.
 *
 * @param {unknown} error The thrown value.
 * @returns {{codes: Set<string>, text: string}} Every code found, and every message joined.
 */
function databaseRefusalParts(error) {
  const cause = /** @type {any} */ (error)?.meta?.driverAdapterError?.cause
  const codes = new Set(
    [
      /** @type {any} */ (error)?.code,
      cause?.originalCode,
      cause?.code,
      /** @type {any} */ (error)?.cause?.code,
    ].filter((code) => typeof code === 'string'),
  )
  const text = [
    /** @type {any} */ (error)?.message,
    cause?.originalMessage,
    cause?.constraint,
    typeof cause?.constraint === 'object' ? JSON.stringify(cause.constraint) : null,
    /** @type {any} */ (error)?.meta?.constraint,
    /** @type {any} */ (error)?.constraint,
  ]
    .filter((part) => typeof part === 'string')
    .join('\n')

  return { codes, text }
}

/**
 * The refusal a database error means, or null when it is not one of ours.
 *
 * `23514` (a CHECK or a trigger raising it, which Prisma may also report as
 * `P2004`) together with one of {@link DATABASE_REFUSALS}' constraint names.
 * Both are required, so an unrelated check violation is still a fault.
 *
 * @param {unknown} error The thrown value.
 * @returns {Error|null} A 4xx carrying the refusal's code and sentence, or null.
 */
export function databaseRefusal(error) {
  if (!error || typeof error !== 'object') return null

  const { codes, text } = databaseRefusalParts(error)

  if (!codes.has('23514') && !codes.has('P2004')) return null

  const refusal = DATABASE_REFUSALS.find((candidate) => text.includes(candidate.constraint))

  return refusal ? httpError(refusal.statusCode, refusal.code, refusal.message) : null
}

/**
 * Pick a sensible status for a thrown value.
 *
 * @param {unknown} error The thrown value.
 * @returns {number} An HTTP status between 400 and 599.
 */
function statusOf(error) {
  const raw = /** @type {{statusCode?: unknown, status?: unknown}} */ (error) ?? {}
  const candidate = typeof raw.statusCode === 'number' ? raw.statusCode : raw.status

  if (typeof candidate !== 'number' || !Number.isInteger(candidate)) return 500
  if (candidate < 400 || candidate > 599) return 500

  return candidate
}

/**
 * Translate a thrown value into the response envelope's `error` object.
 *
 * Internals are only exposed when `exposeInternals` is true (i.e. outside
 * production): an unexpected 5xx otherwise answers with a fixed message so a
 * stack trace, a SQL fragment or a connection string can never reach a client.
 *
 * @param {unknown} error The thrown value.
 * @param {object} [options] Behaviour switches.
 * @param {boolean} [options.exposeInternals] Whether to send an unexpected error's own message.
 * @returns {NormalisedError} The normalised error.
 */
export function normaliseError(error, options = {}) {
  const { exposeInternals = false } = options

  // A character PostgreSQL cannot store — a NUL above all, which every text
  // and JSON column refuses — is a bad request, not a fault. The request
  // validator refuses a NUL in every string of a validated request
  // (`lib/validation.js`), so this is the backstop for one that arrives by
  // another road: the caller hears 400 and what to change, and the log is not
  // given a 500.
  if (UNSTORABLE_CHARACTER_CODES.has(databaseErrorCode(error))) {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: UNSTORABLE_CHARACTER_MESSAGE,
      expected: true,
    }
  }

  // A deadlock or write conflict lost to a change saved at the same moment
  // (SPEC2-XI X-E). Nothing of this write was kept; trying again is the fix.
  if (isRetryableConflict(error)) {
    return { statusCode: 409, code: 'TRY_AGAIN', message: TRY_AGAIN_SENTENCE, expected: true }
  }

  // A rule the database holds for the service — the review gate, the posting-
  // role rule on team invitations — refusing a write a code path forgot to
  // check. The caller hears the rule, not a 500.
  const refusal = databaseRefusal(error)

  if (refusal) {
    return {
      statusCode: refusal.statusCode,
      code: refusal.code,
      message: refusal.message,
      expected: true,
    }
  }

  if (isAuthError(error)) {
    return {
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'A valid bearer token is required.',
      expected: true,
    }
  }

  if (isDomainError(error)) {
    const statusCode = statusOf(error)
    /** @type {NormalisedError} */
    const normalised = {
      statusCode,
      code: /** @type {{code?: string}} */ (error).code ?? CODE_BY_STATUS[statusCode] ?? 'ERROR',
      message: /** @type {Error} */ (error).message,
      expected: statusCode < 500,
    }

    const issues = /** @type {{issues?: unknown}} */ (error).issues
    if (Array.isArray(issues) && issues.length > 0 && normalised.code === 'VALIDATION_ERROR') {
      normalised.issues = issues
    }

    // Coherence reasons a business rule collected. Forwarded only below 500:
    // a refusal the caller can act on is worth explaining, and an internal
    // fault's details are not theirs to read.
    const problems = /** @type {{details?: {problems?: unknown}}} */ (error).details?.problems
    if (Array.isArray(problems) && problems.length > 0 && statusCode < 500) {
      normalised.problems = problems.map(String)
    }

    const reason = refusalReasonOf(error)
    if (reason && statusCode < 500) normalised.reason = reason

    // A provider wiring mistake is a 500: do not leak the adapter's own words.
    if (statusCode >= 500 && !exposeInternals) {
      normalised.message = INTERNAL_ERROR_MESSAGE
      normalised.code = INTERNAL_ERROR_CODE
    }

    return normalised
  }

  const statusCode = statusOf(error)

  // A 5xx the API raised on purpose, with a sentence the caller must read:
  // "your payment may have been taken; do not pay again" is not an internal
  // detail, and replacing it with "An unexpected error occurred" is how a
  // buyer comes to pay twice. Only an error built by `exposedServerError`
  // carries `expose`, so an unexpected failure is still masked.
  if (statusCode >= 500 && /** @type {{expose?: unknown}} */ (error)?.expose === true) {
    /** @type {NormalisedError} */
    const exposed = {
      statusCode,
      code: /** @type {{code?: string}} */ (error).code ?? INTERNAL_ERROR_CODE,
      message: /** @type {Error} */ (error).message,
      expected: false,
    }

    const orderReference = orderReferenceOf(error)
    if (orderReference) exposed.orderReference = orderReference

    return exposed
  }

  if (statusCode >= 500) {
    return {
      statusCode,
      code: exposeInternals
        ? /** @type {{code?: string}} */ (error?.code ?? INTERNAL_ERROR_CODE)
        : INTERNAL_ERROR_CODE,
      message: exposeInternals
        ? /** @type {Error} */ (error?.message ?? INTERNAL_ERROR_MESSAGE)
        : INTERNAL_ERROR_MESSAGE,
      expected: false,
    }
  }

  const rawCode = /** @type {{code?: unknown}} */ (error)?.code
  const code =
    typeof rawCode === 'string' && !rawCode.startsWith('FST_')
      ? rawCode
      : (CODE_BY_STATUS[statusCode] ?? 'ERROR')

  /** @type {NormalisedError} */
  const normalised = {
    statusCode,
    code,
    message: /** @type {Error} */ (error)?.message ?? 'Request failed.',
    expected: true,
  }

  const validation = /** @type {{validation?: unknown}} */ (error)?.validation
  if (Array.isArray(validation) && validation.length > 0) {
    normalised.issues = validation.map((issue) => ({
      path: String(issue?.instancePath ?? issue?.path ?? ''),
      code: String(issue?.keyword ?? issue?.code ?? 'invalid'),
      message: String(issue?.message ?? 'Invalid value'),
    }))
  }

  // The API's own refusals arrive here rather than above: `httpError` builds a
  // plain `Error` with a `statusCode`, not one of the packages' domain classes.
  // This branch is where a 422 from `unprocessable(message, { problems })`
  // actually lands, so it is where the reasons have to be picked up.
  const problems = /** @type {{details?: {problems?: unknown}}} */ (error)?.details?.problems
  if (Array.isArray(problems) && problems.length > 0) {
    normalised.problems = problems.map(String)
  }

  const reason = refusalReasonOf(error)
  if (reason) normalised.reason = reason

  const orderReference = orderReferenceOf(error)
  if (orderReference) normalised.orderReference = orderReference

  const details = exposedDetailsOf(error, code)
  if (details) normalised.details = details

  return normalised
}

/**
 * The part of a refusal's `details` its caller is told, for the codes in
 * `EXPOSED_DETAILS` only.
 *
 * @param {unknown} error The thrown value.
 * @param {string} code The code the answer carries.
 * @returns {Record<string, unknown>|null} The keys that are told, or null.
 */
function exposedDetailsOf(error, code) {
  const allowed = Object.hasOwn(EXPOSED_DETAILS, code) ? EXPOSED_DETAILS[code] : null
  const details = /** @type {{details?: unknown}} */ (error)?.details

  if (!allowed || !details || typeof details !== 'object') return null

  /** @type {Record<string, unknown>} */
  const exposed = {}

  for (const [key, accepts] of Object.entries(allowed)) {
    if (Object.hasOwn(details, key) && accepts(details[key])) exposed[key] = details[key]
  }

  return Object.keys(exposed).length > 0 ? exposed : null
}

/**
 * The order a checkout answer is about, when the service named one.
 *
 * A checkout that placed an order and could not finish it — a capture that
 * timed out, a capture the order could not be completed for, a retry of an
 * attempt whose payment is still being checked — has to tell the buyer where
 * that order is, or the only thing left to press is Pay. The service puts the
 * reference in `details.orderReference`; only a bare reference is forwarded.
 *
 * @param {unknown} error The thrown value.
 * @returns {string|null} The reference, or null.
 */
function orderReferenceOf(error) {
  const reference = /** @type {{details?: {orderReference?: unknown}}} */ (error)?.details
    ?.orderReference

  return typeof reference === 'string' && /^[A-Z0-9-]{4,32}$/u.test(reference) ? reference : null
}

/**
 * The machine-readable refusal code a service attached, if it is one.
 *
 * A door scanner has to branch on *why* a ticket was refused — refunded, wrong
 * event, preview expired — and a sentence is not something to branch on. The
 * services that refuse from a closed vocabulary (`ADMISSION_REFUSAL_REASONS`,
 * `CONNECT_REFUSAL_REASONS`) put the code in `details.reason`; it used to stop
 * there, in the log. Only a bare upper-case identifier is forwarded, so a
 * free-text reason somebody passes as detail one day cannot reach a client by
 * this route.
 *
 * @param {unknown} error The thrown value.
 * @returns {string|null} The code, or null.
 */
function refusalReasonOf(error) {
  const reason = /** @type {{details?: {reason?: unknown}}} */ (error)?.details?.reason

  return typeof reason === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(reason) ? reason : null
}

/**
 * Build the complete response body for a normalised error.
 *
 * @param {NormalisedError} normalised The normalised error.
 * @param {string} [requestId] The request id, echoed so a user can quote it in a support ticket.
 * @returns {{error: {code: string, message: string, statusCode: number, issues?: object[], problems?: string[], reason?: string, orderReference?: string, details?: object, requestId?: string}}} The response body.
 */
export function toErrorBody(normalised, requestId) {
  /** @type {Record<string, unknown>} */
  const error = {
    code: normalised.code,
    message: normalised.message,
    statusCode: normalised.statusCode,
  }

  if (normalised.issues) error.issues = normalised.issues
  if (normalised.problems) error.problems = normalised.problems
  if (normalised.reason) error.reason = normalised.reason
  if (normalised.orderReference) error.orderReference = normalised.orderReference
  if (normalised.details) error.details = normalised.details
  if (requestId) error.requestId = String(requestId).slice(0, 64)

  return { error: /** @type {never} */ (error) }
}

/**
 * Build an error that the error handler will render with a given status.
 *
 * Used for the API's own business rejections (a duplicate email, an event that
 * is not visible) which have no package of their own.
 *
 * @param {number} statusCode HTTP status to answer with.
 * @param {string} code Machine-readable code, e.g. `CONFLICT`.
 * @param {string} message Human-readable message.
 * @param {object} [details] Extra context attached for logging.
 * @returns {Error} An error carrying `statusCode` and `code`.
 */
export function httpError(statusCode, code, message, details) {
  const error = new Error(message)

  Object.assign(error, { statusCode, code, ...(details ? { details } : {}) })

  return error
}

/**
 * A 5xx whose code and sentence reach the caller in production too.
 *
 * For the few server-side outcomes the caller has to act on — above all a
 * checkout whose payment may already have been taken, where the one thing the
 * buyer must be told is not to pay again. Everything else that fails with a
 * 5xx is still masked by `normaliseError`, so a stack trace or a SQL fragment
 * cannot leave by this road: only a message written here does.
 *
 * @param {number} statusCode HTTP status, 500 or above.
 * @param {string} code Machine-readable code, e.g. `PAYMENT_TIMEOUT`.
 * @param {string} message The sentence for the caller.
 * @param {object} [details] Extra context; `orderReference` is forwarded.
 * @returns {Error} An error carrying `statusCode`, `code` and `expose`.
 */
export function exposedServerError(statusCode, code, message, details) {
  return Object.assign(httpError(statusCode, code, message, details), { expose: true })
}

/**
 * Shorthand for a 404 that never distinguishes "absent" from "not yours".
 *
 * @param {string} [message] Message to send.
 * @returns {Error} A 404 error.
 */
export function notFound(message = 'Resource not found.') {
  return httpError(404, 'NOT_FOUND', message)
}

/**
 * Shorthand for a 409 state collision.
 *
 * @param {string} message Message to send.
 * @param {object} [details] Extra context attached for logging.
 * @returns {Error} A 409 error.
 */
export function conflict(message, details) {
  return httpError(409, 'CONFLICT', message, details)
}

/**
 * Shorthand for a 422: well-formed but not actionable.
 *
 * @param {string} message Message to send.
 * @param {object} [details] Extra context attached for logging.
 * @returns {Error} A 422 error.
 */
export function unprocessable(message, details) {
  return httpError(422, 'UNPROCESSABLE', message, details)
}

/**
 * Shorthand for a 401.
 *
 * @param {string} [message] Message to send.
 * @param {string} [code] Machine-readable code. Defaults to `UNAUTHORIZED`; a
 *   caller names its own when the remedy differs — `MFA_ENROLMENT_REQUIRED`
 *   means "enrol a factor", which is a different action from "sign in again".
 * @returns {Error} A 401 error.
 */
export function unauthorized(message = 'A valid bearer token is required.', code = 'UNAUTHORIZED') {
  return httpError(401, code, message)
}

/**
 * Shorthand for a 403: authenticated, and still not allowed.
 *
 * The code is a parameter rather than fixed because a 403 arrives for two
 * genuinely different reasons — the caller lacks a capability, or holds it and
 * has not authenticated again recently — and a client that wants to offer a
 * "confirm your identity" prompt has to be able to tell them apart.
 *
 * @param {string} message Message to send.
 * @param {string} [code] Machine-readable code.
 * @returns {Error} A 403 error.
 */
export function forbidden(message, code = 'FORBIDDEN') {
  return httpError(403, code, message)
}

/**
 * Shorthand for a 429, carrying the interval the caller should wait.
 *
 * @param {string} message Message to send.
 * @param {number} [retryAfterSeconds] Seconds to put in `Retry-After`.
 * @returns {Error} A 429 error.
 */
export function tooManyRequests(message, retryAfterSeconds) {
  const error = httpError(429, 'RATE_LIMITED', message)

  if (Number.isFinite(retryAfterSeconds)) {
    Object.assign(error, { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)) })
  }

  return error
}

/**
 * The database's own error code, wherever Prisma put it.
 *
 * A `RAISE EXCEPTION` from a trigger reaches the client as PostgreSQL's
 * `P0001`, and Prisma wraps it: the outer `error.code` is a Prisma code
 * (`P2039` at the time of writing, and not stable across versions), while the
 * original sits under `meta.driverAdapterError.cause.originalCode`. Checking
 * only the outer one is how a trigger refusal — which the application is
 * supposed to handle — arrives at a user as a 500.
 *
 * Both places are checked, and the outer one first, so an ordinary unique
 * violation (`P2002`, which Prisma does surface directly) still matches.
 *
 * @param {unknown} error Whatever was thrown.
 * @returns {string|null} The database's code, or null when there is not one.
 */
export function databaseErrorCode(error) {
  const outer = error?.code

  if (typeof outer === 'string' && outer.startsWith('P') && outer !== 'P2039') return outer

  const nested = error?.meta?.driverAdapterError?.cause?.originalCode

  return typeof nested === 'string' ? nested : typeof outer === 'string' ? outer : null
}

/**
 * What a trigger said when it refused a write.
 *
 * The message is the one the migration wrote, which is prose somebody chose to
 * be read — "check-in refused: ticket … is CHECKED_IN, which does not admit".
 * A handler that has decided to surface it has something better to say than a
 * generic conflict.
 *
 * @param {unknown} error Whatever was thrown.
 * @returns {string|null} The trigger's message, or null.
 */
export function triggerMessage(error) {
  const nested = error?.meta?.driverAdapterError?.cause?.originalMessage

  return typeof nested === 'string' ? nested : null
}
