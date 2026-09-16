/**
 * Verifying that a webhook really came from Stripe.
 *
 * The whole of this module rests on one fact that is easy to lose: **the
 * signature is over the exact bytes Stripe sent.** Not the parsed object, not a
 * re-serialisation of it, not a string that round-tripped through
 * `JSON.parse`/`JSON.stringify` — the bytes. A body parser that runs first, a
 * proxy that reformats, a logger that pretty-prints: any of those and every
 * signature fails, or worse, a permissive implementation is written to make them
 * pass.
 *
 * So `verifyWebhook` takes a `Buffer` and says so, and the API route that feeds
 * it is registered with a raw body parser for its content type alone. There is no
 * fallback path that accepts an object, because a fallback path is the thing
 * somebody reaches for at 2am.
 *
 * Two more properties worth stating because they are what a "temporary bypass"
 * would remove:
 *
 *   - **There is no unsigned mode.** Mock mode does not skip verification; it
 *     verifies against a locally generated signature with a locally held secret,
 *     using the same code path. A deployment with no Stripe credentials still
 *     exercises the real verification.
 *   - **Account webhooks and Connect webhooks have different secrets.** They
 *     arrive at different endpoints and carry different authority: a Connect
 *     event names an account, and verifying it with the platform endpoint's
 *     secret would let a platform event impersonate one.
 *
 * @module @desi-event/providers/webhooks
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js'

/** The header Stripe signs with. */
export const SIGNATURE_HEADER = 'stripe-signature'

/**
 * How far out of step a timestamp may be.
 *
 * Five minutes, which is Stripe's own default. It bounds replay: a captured
 * delivery stops verifying once its timestamp is stale, so an attacker who
 * records one has minutes rather than forever. The durable protection against
 * replay is the unique `(provider, accountContext, providerEventId)` index —
 * this only narrows the window.
 *
 * @type {number}
 */
export const TOLERANCE_SECONDS = 300

/**
 * Which endpoint a delivery arrived at.
 *
 * Two endpoints, two secrets. The account context is what distinguishes them:
 * `CONNECT` events carry an `account` field naming the connected account they are
 * about.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const WEBHOOK_ENDPOINTS = Object.freeze({ ACCOUNT: 'ACCOUNT', CONNECT: 'CONNECT' })

/**
 * Parse a `Stripe-Signature` header.
 *
 * The header is `t=<timestamp>,v1=<sig>,v1=<sig>` — more than one `v1` when a
 * secret is being rotated, which is why the signatures are collected rather than
 * taken as one.
 *
 * @param {string} header The header value.
 * @returns {{timestamp: number|null, signatures: string[]}} The parts.
 */
export function parseSignatureHeader(header) {
  const parts = String(header ?? '').split(',')
  let timestamp = null
  const signatures = []

  for (const part of parts) {
    const [key, value] = part.split('=', 2)

    if (key?.trim() === 't' && value) timestamp = Number(value.trim())
    if (key?.trim() === 'v1' && value) signatures.push(value.trim())
  }

  return { timestamp: Number.isFinite(timestamp) ? timestamp : null, signatures }
}

/**
 * The signature Stripe would compute for a payload.
 *
 * Exported because the tests need to *produce* valid signatures locally — the
 * only honest way to test verification without credentials is to sign with a
 * known secret and check that the verifier agrees, then mutate one byte and check
 * that it does not.
 *
 * @param {Buffer|string} payload The exact bytes.
 * @param {number} timestamp Unix seconds.
 * @param {string} secret The endpoint signing secret.
 * @returns {string} Lower-case hex HMAC-SHA256.
 */
export function computeSignature(payload, timestamp, secret) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8')

  return createHmac('sha256', secret).update(`${timestamp}.`, 'utf8').update(body).digest('hex')
}

/**
 * Build a `Stripe-Signature` header for a payload.
 *
 * For tests and for the mock provider, which signs its own deliveries so that the
 * same verification code runs in every mode.
 *
 * @param {Buffer|string} payload The exact bytes.
 * @param {string} secret The endpoint signing secret.
 * @param {number} [timestamp] Unix seconds.
 * @returns {string} The header value.
 */
export function signPayload(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${computeSignature(payload, timestamp, secret)}`
}

/**
 * Verify a webhook delivery and return its event.
 *
 * Every refusal is distinct in the log and identical to the caller: a webhook
 * sender gets a 400 and nothing else, because telling an attacker which part of
 * their forgery was wrong is telling them how to fix it.
 *
 * @param {object} delivery The delivery.
 * @param {Buffer} delivery.rawBody The **exact** bytes received, before any parsing.
 * @param {string} delivery.signature The `Stripe-Signature` header.
 * @param {string} delivery.secret The signing secret for the endpoint it arrived at.
 * @param {number} [delivery.toleranceSeconds] How stale a timestamp may be.
 * @param {Date} [delivery.now] The current time.
 * @returns {object} The parsed event, plus the account context and payload digest.
 * @throws {ProviderError} When the delivery does not verify.
 */
export function verifyWebhook({
  rawBody,
  signature,
  secret,
  toleranceSeconds = TOLERANCE_SECONDS,
  now = new Date(),
}) {
  /**
   * Refuse, with a reason for the log and nothing for the sender.
   *
   * @param {string} reason Why, for the log.
   * @returns {never} Never returns.
   */
  const refuse = (reason) => {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID,
      'This webhook delivery could not be verified.',
      { provider: 'stripe', details: { reason } },
    )
  }

  // Stated as a check rather than a comment, because a string that arrives here
  // has already been through a parser and its bytes are no longer the bytes
  // Stripe signed.
  if (!Buffer.isBuffer(rawBody)) {
    refuse('the raw body was not a Buffer; it has been parsed or re-encoded')
  }

  if (typeof secret !== 'string' || secret === '') refuse('no signing secret is configured')
  if (typeof signature !== 'string' || signature === '') refuse('no signature header')

  const { timestamp, signatures } = parseSignatureHeader(signature)

  if (timestamp === null) refuse('the signature header has no timestamp')
  if (signatures.length === 0) refuse('the signature header has no v1 signature')

  const age = Math.abs(Math.floor(now.getTime() / 1000) - timestamp)

  if (age > toleranceSeconds)
    refuse(`the timestamp is ${age}s out, tolerance is ${toleranceSeconds}s`)

  const expected = Buffer.from(computeSignature(rawBody, timestamp, secret), 'utf8')
  const matched = signatures.some((candidate) => {
    const supplied = Buffer.from(candidate, 'utf8')

    return supplied.length === expected.length && timingSafeEqual(supplied, expected)
  })

  if (!matched) refuse('no v1 signature matched')

  let event

  try {
    event = JSON.parse(rawBody.toString('utf8'))
  } catch {
    // Signed and unparseable is a strange combination — it means somebody with
    // the signing secret sent nonsense — but it must not be an unhandled throw.
    refuse('the payload is signed but is not JSON')
  }

  if (!event?.id || !event?.type) refuse('the payload is not a Stripe event')

  return {
    event,
    // The connected account an event is about, or null for a platform event.
    // Stored alongside the event id, so that the same event id arriving for two
    // accounts is two facts rather than a duplicate.
    accountContext: event.account ?? null,
    apiVersion: event.api_version ?? null,
    createdAt: event.created ? new Date(event.created * 1000) : null,
  }
}

/**
 * Event types this system knows how to act on.
 *
 * Every other type is recorded and ignored — recorded, because a type nobody
 * handles today is evidence when somebody asks why something did not happen, and
 * because Stripe retries anything that is not acknowledged.
 *
 * The names are the ones Stripe emits for the pinned API version. They are
 * listed rather than pattern-matched, because a prefix match on
 * `payment_intent.` would silently start handling a type that does not mean what
 * the handler assumes.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const HANDLED_EVENTS = Object.freeze({
  'payment_intent.succeeded': 'payment.succeeded',
  'payment_intent.payment_failed': 'payment.failed',
  'payment_intent.canceled': 'payment.cancelled',
  'payment_intent.processing': 'payment.processing',
  'payment_intent.requires_action': 'payment.requires_action',
  'payment_intent.amount_capturable_updated': 'payment.authorized',
  'charge.refunded': 'refund.succeeded',
  'charge.refund.updated': 'refund.updated',
  'charge.dispute.created': 'dispute.opened',
  'charge.dispute.closed': 'dispute.closed',
  'charge.dispute.funds_withdrawn': 'dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated': 'dispute.funds_reinstated',
  'account.updated': 'connect.account_updated',
  'account.application.deauthorized': 'connect.deauthorized',
  'transfer.created': 'transfer.created',
  'transfer.reversed': 'transfer.reversed',
  'payout.paid': 'payout.paid',
  'payout.failed': 'payout.failed',
})

/**
 * Whether this system acts on an event type.
 *
 * @param {string} type A Stripe event type.
 * @returns {boolean} True when there is a handler.
 */
export function isHandledEvent(type) {
  return Object.hasOwn(HANDLED_EVENTS, type)
}
