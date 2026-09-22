/**
 * Redaction rules.
 *
 * This is the reason the monorepo has a logger package instead of importing
 * pino directly: every service gets the same guarantee that credentials,
 * session cookies and payment provider secrets never reach a log sink, even
 * when a handler logs a whole request, user row or provider response by
 * accident.
 *
 * pino redaction is path based, and cost is not uniform across paths. A
 * literal path such as `req.headers.authorization` is a couple of property
 * lookups, while a wildcard path such as `*.password` is re-evaluated against
 * every top-level key of every log object. The path set below is therefore
 * built from three parts: every sensitive key at the log root, a deliberately
 * short wildcard list for the keys most likely to appear one level down inside
 * an unexpected object, and explicit deeper paths for the containers this
 * codebase actually logs (`req.headers`, `req.body`, `payment`, ...). Services
 * with their own shapes extend the set through `extraPaths`.
 *
 * @module @desi-event/logger/redaction
 */

/** Replacement written in place of a redacted value. */
export const REDACTION_CENSOR = '[REDACTED]'

/**
 * Header names that carry credentials or provider signatures.
 *
 * Node lower-cases incoming header names, but hand-built header objects and
 * provider payloads do not, so the common capitalised spellings are listed too.
 *
 * @type {string[]}
 */
export const SENSITIVE_HEADER_KEYS = Object.freeze([
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'x-webhook-signature',
  'stripe-signature',
  'x-razorpay-signature',
])

/**
 * Object keys whose values are secret wherever they appear. `key_secret` and
 * `webhookSecret` are the payment provider credentials (Razorpay and Stripe
 * respectively) that would otherwise be logged verbatim when a provider error
 * response is dumped.
 *
 * @type {string[]}
 */
export const SENSITIVE_FIELD_KEYS = Object.freeze([
  'password',
  'passwordHash',
  'password_hash',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'apiKey',
  'secret',
  'clientSecret',
  'webhookSecret',
  'signingSecret',
  'key_secret',
  'privateKey',
  'otp',
  'cvv',
  'cardNumber',
  // The admission pass. `credential` is the plaintext a QR carries and
  // `credentialHash` its digest; neither is a password, so neither was caught
  // by any entry above. The digest is not a secret in the sense the others are
  // — it opens nothing — but it identifies a ticket by a value only its holder
  // should know, and this net exists precisely for the handler that logs a
  // whole row by accident.
  'credential',
  'credentialHash',
])

/**
 * Keys redacted one level below any top-level property (`*.password` and
 * friends). Kept short on purpose: each entry is checked against every
 * top-level key of every log object.
 *
 * @type {string[]}
 */
export const WILDCARD_KEYS = Object.freeze([
  'authorization',
  'cookie',
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'secret',
  'apiKey',
  'key_secret',
  // `{ ticket: { credential } }` is the shape a handler logging a scan result
  // would produce, and the check-in route takes the credential in its body.
  'credential',
])

/**
 * Containers that hold headers in the objects this codebase logs.
 *
 * @type {string[]}
 */
export const HEADER_CONTAINERS = Object.freeze([
  'headers',
  'req.headers',
  'res.headers',
  'request.headers',
  'response.headers',
])

/**
 * Containers that hold secret-bearing fields in the objects this codebase logs.
 *
 * @type {string[]}
 */
export const FIELD_CONTAINERS = Object.freeze([
  'body',
  'req.body',
  'request.body',
  'user',
  'payment',
  'provider',
  'credentials',
])

/** Keys that can be written with dot notation in a pino redact path. */
const BARE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Build a single pino redact path, quoting keys that are not valid
 * identifiers (`set-cookie`, `stripe-signature`, ...).
 *
 * @param {string} container Dotted container prefix, or `''` for the log root.
 * @param {string} key Property name to redact.
 * @returns {string} A pino/fast-redact path expression.
 */
export function redactPath(container, key) {
  const bare = BARE_KEY.test(key)
  if (container === '') return bare ? key : `["${key}"]`
  return bare ? `${container}.${key}` : `${container}["${key}"]`
}

/**
 * Build the full, de-duplicated list of redaction paths.
 *
 * @param {object} [options] Extra configuration.
 * @param {string[]} [options.extraPaths] Additional pino redact paths to append.
 * @returns {string[]} Redaction paths in declaration order, without duplicates.
 */
export function buildRedactPaths(options = {}) {
  const { extraPaths = [] } = options
  const paths = []

  for (const key of SENSITIVE_HEADER_KEYS) paths.push(redactPath('', key))
  for (const key of SENSITIVE_FIELD_KEYS) paths.push(redactPath('', key))
  for (const key of WILDCARD_KEYS) paths.push(redactPath('*', key))
  for (const container of HEADER_CONTAINERS) {
    for (const key of SENSITIVE_HEADER_KEYS) paths.push(redactPath(container, key))
  }
  for (const container of FIELD_CONTAINERS) {
    for (const key of SENSITIVE_FIELD_KEYS) paths.push(redactPath(container, key))
  }
  for (const path of extraPaths) paths.push(path)

  return [...new Set(paths)]
}

/**
 * Default redaction paths, computed once because the matrix never changes.
 *
 * @type {string[]}
 */
export const REDACT_PATHS = Object.freeze(buildRedactPaths())

/**
 * Build the `redact` option object handed to pino.
 *
 * @param {object} [options] Extra configuration.
 * @param {string[]} [options.extraPaths] Additional paths to redact.
 * @param {string} [options.censor] Replacement value, defaults to `[REDACTED]`.
 * @returns {{paths: string[], censor: string, remove: boolean}} A pino `redact` option.
 */
export function buildRedactOptions(options = {}) {
  const { extraPaths = [], censor = REDACTION_CENSOR } = options
  const paths = extraPaths.length > 0 ? buildRedactPaths({ extraPaths }) : [...REDACT_PATHS]

  // The key is censored rather than removed: an explicit `[REDACTED]` tells
  // whoever is reading the log that the field existed, which a missing key does
  // not.
  return { paths, censor, remove: false }
}
