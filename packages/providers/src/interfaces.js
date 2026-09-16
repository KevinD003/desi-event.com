/**
 * The provider interfaces, described twice on purpose.
 *
 * Once as JSDoc `@typedef`s, which is how a reader (and an editor) learns the
 * shape, and once as Zod schemas, which is how a *running* process learns it.
 * There is no compiler in this repository, so an adapter that forgets
 * `refund()` would otherwise be discovered halfway through a checkout. The
 * `assert*Provider` validators move that discovery to wiring time and name
 * exactly which members are missing or wrong.
 *
 * Only the members the rest of the system actually calls are required. The
 * schemas are deliberately *loose*, so a real adapter may carry extra methods
 * (webhook verification, client secrets) and the in-memory fakes may carry
 * their test affordances (`sent`, `reset()`) without failing validation.
 *
 * @module @desi-event/providers/interfaces
 */

import { z } from 'zod'
import { formatIssues } from '@desi-event/schemas'
import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js'

/**
 * The four slots a {@link module:@desi-event/providers/registry} must fill.
 *
 * @type {string[]}
 */
export const PROVIDER_KINDS = Object.freeze(['payments', 'email', 'sms', 'storage'])

/**
 * Methods each provider kind must implement.
 *
 * @type {Readonly<Record<string, string[]>>}
 */
export const PROVIDER_METHODS = Object.freeze({
  payments: Object.freeze(['createIntent', 'capture', 'refund', 'getStatus']),
  email: Object.freeze(['send']),
  sms: Object.freeze(['send']),
  storage: Object.freeze(['put', 'getUrl', 'delete']),
})

/**
 * @typedef {object} PaymentIntent
 * @property {string} id Provider-assigned intent id; stored on `Payment.providerRef`.
 * @property {string} status One of `REQUIRES_CAPTURE`, `SUCCEEDED`, `REFUNDED`, `FAILED`.
 * @property {number} amountCents Authorised amount in integer cents.
 * @property {string} currency ISO-4217 currency code, upper-case.
 * @property {(string|undefined)} orderId The `Order.id` this intent belongs to, when supplied.
 * @property {(string|undefined)} failureCode Issuer decline code; only set when `status` is `FAILED`.
 * @property {string} createdAt ISO-8601 creation instant.
 * @property {(string|null)} capturedAt ISO-8601 capture instant, or `null`.
 * @property {(string|null)} refundedAt ISO-8601 refund instant, or `null`.
 * @property {Record<string, unknown>} metadata Free-form bag echoed back untouched.
 */

/**
 * @typedef {object} CreateIntentInput
 * @property {number} amountCents Amount to authorise, integer cents, at least 1.
 * @property {string} currency ISO-4217 currency code.
 * @property {string} [orderId] The `Order.id` being paid for.
 * @property {(boolean|string)} [forceFailure] `true`/`'create'` declines at creation; `'capture'` declines at capture.
 * @property {string} [failureCode] Decline code to report when a failure is forced.
 * @property {Record<string, unknown>} [metadata] Free-form bag echoed back on the intent.
 */

/**
 * @typedef {object} PaymentProvider
 * @property {string} name Human-readable adapter name, recorded on `Payment.provider`.
 * @property {function(CreateIntentInput): PaymentIntent} createIntent Authorise an amount.
 * @property {function((string|object), object=): PaymentIntent} capture Capture a previously authorised intent.
 * @property {function((string|object), object=): PaymentIntent} refund Refund a captured intent.
 * @property {function((string|object)): PaymentIntent} getStatus Read an intent back.
 */

/**
 * @typedef {object} EmailMessage
 * @property {(string|string[])} to One or more recipient addresses.
 * @property {string} subject Subject line.
 * @property {string} [text] Plain-text body. At least one of `text`/`html` is required.
 * @property {string} [html] HTML body.
 * @property {string} [from] Sender address; falls back to the provider default.
 * @property {string} [replyTo] Reply-to address.
 * @property {(string|string[])} [cc] Carbon-copy recipients.
 * @property {(string|string[])} [bcc] Blind carbon-copy recipients.
 * @property {Record<string, unknown>} [metadata] Free-form bag stored with the record.
 */

/**
 * @typedef {object} EmailReceipt
 * @property {string} id Provider-assigned message id.
 * @property {string} providerRef Same value as `id`; the name the API stores.
 * @property {string[]} accepted Normalised recipient addresses.
 * @property {string} status Always `SENT` for an accepted message.
 * @property {string} sentAt ISO-8601 send instant.
 */

/**
 * @typedef {object} EmailProvider
 * @property {string} name Human-readable adapter name.
 * @property {function(EmailMessage): EmailReceipt} send Deliver one message.
 * @property {object[]} [sent] Test affordance: every message the fake accepted.
 */

/**
 * @typedef {object} SmsMessage
 * @property {string} to Recipient phone number in international format.
 * @property {string} body Message text.
 * @property {string} [from] Sender id; falls back to the provider default.
 * @property {Record<string, unknown>} [metadata] Free-form bag stored with the record.
 */

/**
 * @typedef {object} SmsReceipt
 * @property {string} id Provider-assigned message id.
 * @property {string} providerRef Same value as `id`.
 * @property {string} to Normalised recipient number.
 * @property {number} segments Number of 160-character segments billed.
 * @property {string} status Always `SENT` for an accepted message.
 * @property {string} sentAt ISO-8601 send instant.
 */

/**
 * @typedef {object} SmsProvider
 * @property {string} name Human-readable adapter name.
 * @property {function(SmsMessage): SmsReceipt} send Deliver one message.
 * @property {object[]} [sent] Test affordance: every message the fake accepted.
 */

/**
 * @typedef {object} StoredObject
 * @property {string} key Object key, unique within the bucket.
 * @property {string} url Stable, publicly addressable URL for the object.
 * @property {number} size Size in bytes.
 * @property {string} contentType MIME type.
 * @property {string} uploadedAt ISO-8601 upload instant.
 * @property {Record<string, unknown>} metadata Free-form bag stored with the object.
 */

/**
 * @typedef {object} StorageProvider
 * @property {string} name Human-readable adapter name.
 * @property {function(object): StoredObject} put Store bytes under a key.
 * @property {function(string): string} getUrl Resolve a key to its stable URL.
 * @property {function(string): boolean} delete Remove an object; `false` when it was already gone.
 */

/**
 * @typedef {object} ProviderRegistry
 * @property {PaymentProvider} payments Payment adapter.
 * @property {EmailProvider} email Email adapter.
 * @property {SmsProvider} sms SMS adapter.
 * @property {StorageProvider} storage File storage adapter.
 */

/** Every adapter must identify itself; the name lands on `Payment.provider`. */
const providerNameSchema = z.string().min(1).max(64)

/**
 * A schema accepting only callables.
 *
 * Zod has no first-class "method" type that reports well inside an object, so
 * this is a `z.custom` check whose message already names the member.
 *
 * @param {string} method The method name, used in the failure message.
 * @returns {object} A Zod schema matching functions.
 */
function methodSchema(method) {
  return z.custom((value) => typeof value === 'function', {
    message: `Expected ${method}() to be a function`,
  })
}

/**
 * Build a loose object schema requiring `name` plus the given methods.
 *
 * @param {string[]} methods Method names the interface requires.
 * @param {Record<string, object>} [extra] Additional member schemas.
 * @returns {object} A Zod schema validating an implementation structurally.
 */
function interfaceSchema(methods, extra = {}) {
  /** @type {Record<string, object>} */
  const shape = { name: providerNameSchema }
  for (const method of methods) shape[method] = methodSchema(method)
  return z.looseObject({ ...shape, ...extra })
}

/** Structural schema for a {@link PaymentProvider}. */
export const paymentProviderSchema = interfaceSchema(PROVIDER_METHODS.payments)

/** Structural schema for an {@link EmailProvider}. `sent` is optional: only the fakes record. */
export const emailProviderSchema = interfaceSchema(PROVIDER_METHODS.email, {
  sent: z.array(z.unknown()).optional(),
})

/** Structural schema for an {@link SmsProvider}. */
export const smsProviderSchema = interfaceSchema(PROVIDER_METHODS.sms, {
  sent: z.array(z.unknown()).optional(),
})

/** Structural schema for a {@link StorageProvider}. */
export const storageProviderSchema = interfaceSchema(PROVIDER_METHODS.storage)

/** Schema per kind, so the registry can loop instead of branching. */
const SCHEMA_BY_KIND = Object.freeze({
  payments: paymentProviderSchema,
  email: emailProviderSchema,
  sms: smsProviderSchema,
  storage: storageProviderSchema,
})

/**
 * Re-describe Zod issues in terms a wiring mistake is actually about.
 *
 * Zod cannot tell "you forgot `refund`" from "your `refund` is a string" — both
 * fail the same `z.custom` check — but the caller very much can, so the raw
 * implementation is consulted to classify each failed member.
 *
 * @param {object} impl The implementation under validation.
 * @param {string} kind The provider kind being validated.
 * @param {{issues?: Array<object>}} error The `ZodError` produced by `safeParse`.
 * @returns {ProviderIssue[]} One issue per problem, most useful message first.
 */
function describeIssues(impl, kind, error) {
  const methods = PROVIDER_METHODS[kind] ?? []

  return formatIssues(error).map((issue) => {
    if (!methods.includes(issue.path)) return issue

    const value = impl[issue.path]
    if (value === undefined || value === null) {
      return {
        path: issue.path,
        code: 'missing_method',
        message: `${issue.path}() is missing`,
      }
    }
    return {
      path: issue.path,
      code: 'invalid_method',
      message: `${issue.path} must be a function, received ${typeof value}`,
    }
  })
}

/**
 * Validate an implementation against one of the provider interfaces.
 *
 * @param {string} kind One of {@link PROVIDER_KINDS}.
 * @param {unknown} impl The candidate implementation.
 * @returns {object} The same `impl`, unchanged, so the call can be inlined.
 * @throws {ProviderError} `INVALID_PROVIDER`, with `.issues` naming every missing or wrong member.
 */
function assertProvider(kind, impl) {
  const schema = SCHEMA_BY_KIND[kind]

  if (impl === null || typeof impl !== 'object') {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_PROVIDER,
      `Expected the ${kind} provider to be an object, received ${impl === null ? 'null' : typeof impl}`,
      {
        provider: kind,
        issues: [
          {
            path: '',
            code: 'invalid_type',
            message: `Expected an object implementing the ${kind} provider interface`,
          },
        ],
        details: { kind },
      },
    )
  }

  const result = schema.safeParse(impl)
  if (result.success) return impl

  const issues = describeIssues(/** @type {object} */ (impl), kind, result.error)
  const summary = issues.map((issue) => issue.message).join('; ')

  throw new ProviderError(
    PROVIDER_ERROR_CODES.INVALID_PROVIDER,
    `Invalid ${kind} provider: ${summary}`,
    { provider: kind, issues, details: { kind, members: issues.map((issue) => issue.path) } },
  )
}

/**
 * Assert that `impl` satisfies the {@link PaymentProvider} interface.
 *
 * @param {unknown} impl Candidate payment adapter.
 * @returns {PaymentProvider} The same implementation, unchanged.
 * @throws {ProviderError} `INVALID_PROVIDER` listing each missing or non-callable member.
 */
export function assertPaymentProvider(impl) {
  return /** @type {PaymentProvider} */ (assertProvider('payments', impl))
}

/**
 * Assert that `impl` satisfies the {@link EmailProvider} interface.
 *
 * @param {unknown} impl Candidate email adapter.
 * @returns {EmailProvider} The same implementation, unchanged.
 * @throws {ProviderError} `INVALID_PROVIDER` listing each missing or non-callable member.
 */
export function assertEmailProvider(impl) {
  return /** @type {EmailProvider} */ (assertProvider('email', impl))
}

/**
 * Assert that `impl` satisfies the {@link SmsProvider} interface.
 *
 * @param {unknown} impl Candidate SMS adapter.
 * @returns {SmsProvider} The same implementation, unchanged.
 * @throws {ProviderError} `INVALID_PROVIDER` listing each missing or non-callable member.
 */
export function assertSmsProvider(impl) {
  return /** @type {SmsProvider} */ (assertProvider('sms', impl))
}

/**
 * Assert that `impl` satisfies the {@link StorageProvider} interface.
 *
 * @param {unknown} impl Candidate storage adapter.
 * @returns {StorageProvider} The same implementation, unchanged.
 * @throws {ProviderError} `INVALID_PROVIDER` listing each missing or non-callable member.
 */
export function assertStorageProvider(impl) {
  return /** @type {StorageProvider} */ (assertProvider('storage', impl))
}

/**
 * Non-throwing counterpart of the `assert*Provider` validators.
 *
 * @param {string} kind One of {@link PROVIDER_KINDS}.
 * @param {unknown} impl Candidate implementation.
 * @returns {{valid: boolean, issues: ProviderIssue[]}} Result and, when invalid, the issues.
 * @throws {ProviderError} `INVALID_OPTIONS` when `kind` is not a known provider kind.
 */
export function inspectProvider(kind, impl) {
  if (!PROVIDER_KINDS.includes(kind)) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_OPTIONS,
      `Unknown provider kind "${kind}"; expected one of ${PROVIDER_KINDS.join(', ')}`,
      { details: { kind } },
    )
  }

  try {
    assertProvider(kind, impl)
    return { valid: true, issues: [] }
  } catch (error) {
    return { valid: false, issues: /** @type {ProviderError} */ (error).issues }
  }
}

export { assertProvider }
