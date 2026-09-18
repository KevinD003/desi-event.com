/**
 * The trust boundary on the mock provider's payment callback.
 *
 * `POST /v1/payments/webhook` is `auth: 'none'`, and correctly so — a payment
 * provider has no session to present. What was missing is the thing that takes
 * over from authentication on such a route: proof that the message came from the
 * provider. Without it the endpoint accepted a body and believed it, and since
 * `settleCheckout` gates only on `status: 'PENDING'`, anyone who could reach the
 * API could mint themselves tickets against an order they had just created.
 *
 * ## Where the key comes from
 *
 * Nowhere new. `AUTH_SECRET` already fans out through HKDF with a distinct
 * purpose label per use (`deriveSealingKey`), so this adds a purpose rather than
 * a secret. That matters more than it sounds:
 *
 *   - there is no new environment variable to forget, and therefore no
 *     deployment that is accidentally unprotected because somebody missed one;
 *   - nothing new appears in `.env.example` that could be copied into
 *     production as a real value;
 *   - `AUTH_SECRET` never reaches the browser, so neither does this key;
 *   - a key derived for this purpose cannot open anything sealed for another.
 *
 * ## Why the signature covers fields rather than raw bytes
 *
 * `/v1/webhooks/stripe` signs the exact bytes, because **Stripe** signs them and
 * a parsed body is a body whose bytes are gone. That reasoning does not transfer
 * here: this is our own mock provider and we define both ends of the scheme. So
 * the signature covers a canonical encoding of the callback's fields instead,
 * which binds everything the handler can read while avoiding a second raw-body
 * parser and the byte-fidelity plumbing that comes with it.
 *
 * The encoding is a sorted `[key, value]` array rendered with `JSON.stringify`.
 * Sorted, so two callers cannot disagree about order; an array of pairs rather
 * than an object, so no field name can be confused with a value; every field the
 * schema allows, so nothing meaningful is left unsigned — including
 * `amountCents`, which the handler happens not to read today but which a future
 * amount check would have to trust.
 *
 * ## What this does not claim
 *
 * This is the **mock** provider's boundary. It is not Stripe's, it proves
 * nothing about real payments, and the real provider's verification is the
 * separate, already-correct path in `@desi-event/providers`. When a real
 * provider is wired, it brings its own verifier; this one stays with the mock.
 *
 * @module @desi-event/api/lib/mock-webhook
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

import { deriveSealingKey } from '@desi-event/auth'

/**
 * The header a signed mock callback arrives in.
 *
 * Deliberately not `stripe-signature`: this is not Stripe, and a header that
 * claimed to be would invite somebody to point a real Stripe endpoint at it.
 *
 * @type {string}
 */
export const MOCK_SIGNATURE_HEADER = 'desi-signature'

/**
 * The HKDF purpose label for this key.
 *
 * Changing it invalidates every signature, which is the intended way to rotate.
 *
 * @type {string}
 */
export const MOCK_WEBHOOK_PURPOSE = 'mock-payment-webhook'

/**
 * How far out of date a signed callback may be.
 *
 * Matches the provider package's `TOLERANCE_SECONDS`. Long enough for a slow
 * queue, short enough that a captured callback is not replayable for a day.
 *
 * @type {number}
 */
export const MOCK_TOLERANCE_SECONDS = 300

/**
 * Every field a signature covers, in the order they are canonicalised.
 *
 * The full set the request schema allows. Signing a subset would leave the rest
 * malleable, and the one most likely to matter later — `amountCents` — is
 * exactly the field a future "does this match the order total?" check would need
 * to be able to trust.
 *
 * @type {ReadonlyArray<string>}
 */
export const SIGNED_FIELDS = Object.freeze([
  'amountCents',
  'currency',
  'eventType',
  'failureCode',
  'orderReference',
  'provider',
  'providerEventId',
  'providerRef',
])

/**
 * The canonical bytes for a callback body.
 *
 * @param {object} body The callback body.
 * @returns {string} A deterministic encoding of its signed fields.
 */
export function canonicalise(body) {
  const pairs = SIGNED_FIELDS.filter(
    (key) => body?.[key] !== undefined && body?.[key] !== null,
  ).map((key) => [key, String(body[key])])

  return JSON.stringify(pairs)
}

/**
 * The signing key for this deployment.
 *
 * @param {string} authSecret The deployment's `AUTH_SECRET`.
 * @returns {Buffer} A 256-bit key for this purpose alone.
 * @throws {TypeError} When no secret is supplied — fail closed, never open.
 */
export function mockWebhookKey(authSecret) {
  if (typeof authSecret !== 'string' || authSecret === '') {
    throw new TypeError('A mock webhook key needs AUTH_SECRET; there is no unkeyed mode.')
  }

  return deriveSealingKey(authSecret, MOCK_WEBHOOK_PURPOSE)
}

/**
 * Sign a callback body, for the mock provider and for tests.
 *
 * Exported so that the legitimate senders — the in-memory provider's callers and
 * the load scenarios — sign the same way the route verifies, rather than each
 * re-deriving the scheme and drifting from it.
 *
 * @param {object} body The callback body.
 * @param {string} authSecret The deployment's `AUTH_SECRET`.
 * @param {number} [timestamp] Unix seconds; defaults to now.
 * @returns {string} The header value, `t=<unix>,v1=<hex>`.
 */
export function signMockWebhook(body, authSecret, timestamp = Math.floor(Date.now() / 1000)) {
  const key = mockWebhookKey(authSecret)
  const digest = createHmac('sha256', key)
    .update(`${timestamp}.`, 'utf8')
    .update(canonicalise(body), 'utf8')
    .digest('hex')

  return `t=${timestamp},v1=${digest}`
}

/**
 * Why a delivery was refused. For the log, never for the sender.
 *
 * @typedef {{ok: true}|{ok: false, reason: string}} MockVerification
 */

/**
 * Verify a signed mock callback.
 *
 * Fails closed at every step. There is no mode in which an unsigned body is
 * accepted, and no branch that treats a missing secret as permission.
 *
 * @param {object} options Verification inputs.
 * @param {object} options.body The parsed callback body.
 * @param {string|string[]|undefined} options.signature The signature header.
 * @param {string} options.authSecret The deployment's `AUTH_SECRET`.
 * @param {number} [options.toleranceSeconds] Age tolerance.
 * @param {Date} [options.now] The clock, injectable for tests.
 * @returns {MockVerification} Whether it verified, and why not.
 */
export function verifyMockWebhook({
  body,
  signature,
  authSecret,
  toleranceSeconds = MOCK_TOLERANCE_SECONDS,
  now = new Date(),
}) {
  const header = Array.isArray(signature) ? signature[0] : signature

  if (typeof authSecret !== 'string' || authSecret === '') {
    return { ok: false, reason: 'no signing key is configured' }
  }

  if (typeof header !== 'string' || header === '') {
    return { ok: false, reason: 'no signature header' }
  }

  /** @type {Record<string, string>} */
  const parts = {}

  for (const segment of header.split(',')) {
    const index = segment.indexOf('=')

    if (index > 0) parts[segment.slice(0, index).trim()] = segment.slice(index + 1).trim()
  }

  const timestamp = Number.parseInt(parts.t ?? '', 10)

  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'the header has no timestamp' }
  if (typeof parts.v1 !== 'string' || parts.v1 === '') {
    return { ok: false, reason: 'the header has no v1 signature' }
  }

  const age = Math.abs(Math.floor(now.getTime() / 1000) - timestamp)

  if (age > toleranceSeconds) {
    return { ok: false, reason: `the timestamp is ${age}s out, tolerance is ${toleranceSeconds}s` }
  }

  let expected

  try {
    expected = createHmac('sha256', mockWebhookKey(authSecret))
      .update(`${timestamp}.`, 'utf8')
      .update(canonicalise(body), 'utf8')
      .digest('hex')
  } catch {
    return { ok: false, reason: 'the signing key could not be derived' }
  }

  const supplied = Buffer.from(parts.v1, 'utf8')
  const wanted = Buffer.from(expected, 'utf8')

  // Length first: `timingSafeEqual` throws on a mismatch, and a thrown
  // comparison is a comparison that leaked its answer through the exception.
  if (supplied.length !== wanted.length) return { ok: false, reason: 'the signature did not match' }
  if (!timingSafeEqual(supplied, wanted))
    return { ok: false, reason: 'the signature did not match' }

  return { ok: true }
}
