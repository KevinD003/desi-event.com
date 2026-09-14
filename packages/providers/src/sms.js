/**
 * An in-memory SMS provider.
 *
 * Mirrors the email fake — every accepted message lands in `sent` — with the
 * differences that actually matter for SMS: a phone number rather than an
 * address, a single recipient per message, and a segment count, because a
 * "one" message that silently bills as four is the bug this fake exists to
 * make visible in a test.
 *
 * @module @desi-event/providers/sms
 */

import { phoneSchema } from '@desi-event/schemas'
import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js'
import {
  createClock,
  createIdFactory,
  freezeRecord,
  isPlainObject,
  normaliseMetadata,
  requireText,
} from './internal.js'

/**
 * Any message addressed to this number is rejected with `SEND_FAILED`.
 *
 * It is drawn from the North American 555-01xx range reserved for fiction, so
 * it can never reach a real handset.
 *
 * @type {string}
 */
export const SMS_FAILURE_NUMBER = '+15550100199'

/** Default sender id used when a message omits `from`. */
export const DEFAULT_SMS_SENDER = 'DESIEVT'

/** Longest accepted message body. */
const MAX_BODY_LENGTH = 1600

/** Characters per billed segment for a single-part GSM-7 message. */
const SEGMENT_LENGTH = 160

/**
 * Validate a phone number and strip its formatting.
 *
 * Spaces, brackets and dashes are removed so that `+1 (555) 010-0199` and
 * `+15550100199` are recognised as the same recipient — which matters both for
 * the failure trigger and for a test asserting on `sent[0].to`.
 *
 * @param {unknown} value Candidate phone number.
 * @param {string} field Field name used in errors.
 * @param {string} provider Provider name attached to any error raised.
 * @returns {string} The compacted number, e.g. `+15550100199`.
 * @throws {ProviderError} `INVALID_RECIPIENT` when the number is unusable.
 */
function parsePhone(value, field, provider) {
  const result = phoneSchema.safeParse(value)
  if (!result.success) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_RECIPIENT,
      `Expected \`${field}\` to be a phone number in international format`,
      { provider, details: { field, received: value } },
    )
  }
  return /** @type {string} */ (result.data).replace(/[\s()-]/g, '')
}

/**
 * Count the 160-character segments a body is billed as.
 *
 * @param {string} body The message body.
 * @returns {number} At least one segment.
 */
function countSegments(body) {
  return Math.max(1, Math.ceil(body.length / SEGMENT_LENGTH))
}

/**
 * @typedef {object} InMemorySmsProviderOptions
 * @property {string} [name] Adapter name.
 * @property {string} [from] Default sender id for messages that omit `from`.
 * @property {string} [idPrefix] Prefix for generated message ids.
 * @property {string} [failureNumber] Number that always fails; defaults to {@link SMS_FAILURE_NUMBER}.
 * @property {(Date|number|string|function(): (Date|number|string))} [now] Fixed instant or clock function.
 */

/**
 * Create an in-memory {@link SmsProvider}.
 *
 * @param {InMemorySmsProviderOptions} [options] Construction options.
 * @returns {SmsProvider} A provider with `send`, the `sent` record array, plus `lastSent()` and `reset()` for tests.
 * @throws {ProviderError} `INVALID_OPTIONS` when `now` is not a usable instant; `INVALID_RECIPIENT` when `failureNumber` is not a phone number.
 */
export function createInMemorySmsProvider(options = {}) {
  const {
    name = 'in-memory-sms',
    from: defaultFrom = DEFAULT_SMS_SENDER,
    idPrefix = 'sms',
    failureNumber = SMS_FAILURE_NUMBER,
    now,
  } = options

  const sender = requireText(defaultFrom, 'from', {
    code: PROVIDER_ERROR_CODES.INVALID_OPTIONS,
    provider: name,
    maxLength: 32,
  })
  const normalisedFailureNumber = parsePhone(failureNumber, 'failureNumber', name)
  const clock = createClock(now)
  const nextId = createIdFactory(idPrefix)

  /**
   * Every message this provider accepted, oldest first. The array identity is
   * stable across `reset()`.
   *
   * @type {object[]}
   */
  const sent = []

  /**
   * Deliver one message.
   *
   * @param {SmsMessage} message The message to send.
   * @returns {SmsReceipt} A receipt carrying the provider message id and segment count.
   * @throws {ProviderError} `INVALID_MESSAGE` when the message or body is malformed; `INVALID_RECIPIENT` for an unusable number; `SEND_FAILED` when `forceFailure` is set or the recipient is the failure number.
   */
  function send(message) {
    if (!isPlainObject(message)) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.INVALID_MESSAGE,
        'send expects a message object with `to` and `body`',
        { provider: name, details: { received: message === null ? 'null' : typeof message } },
      )
    }

    const to = parsePhone(message.to, 'to', name)
    const body = requireText(message.body, 'body', {
      code: PROVIDER_ERROR_CODES.INVALID_MESSAGE,
      provider: name,
      maxLength: MAX_BODY_LENGTH,
    })
    const messageFrom =
      message.from === undefined || message.from === null
        ? sender
        : requireText(message.from, 'from', {
            code: PROVIDER_ERROR_CODES.INVALID_MESSAGE,
            provider: name,
            maxLength: 32,
          })
    const metadata = normaliseMetadata(message.metadata, PROVIDER_ERROR_CODES.INVALID_MESSAGE, name)

    if (message.forceFailure === true || to === normalisedFailureNumber) {
      throw new ProviderError(PROVIDER_ERROR_CODES.SEND_FAILED, `Delivery to ${to} failed`, {
        provider: name,
        details: { to, segments: countSegments(body) },
      })
    }

    const id = nextId()
    const sentAt = clock().toISOString()
    const segments = countSegments(body)
    const record = freezeRecord({ id, from: messageFrom, to, body, segments, metadata, sentAt })
    sent.push(record)

    return /** @type {SmsReceipt} */ (
      freezeRecord({ id, providerRef: id, to, segments, status: 'SENT', sentAt })
    )
  }

  /**
   * The most recently accepted message.
   *
   * @returns {(object|undefined)} The last record, or `undefined` when nothing has been sent.
   */
  function lastSent() {
    return sent[sent.length - 1]
  }

  /**
   * Drop every recorded message, keeping the `sent` array identity.
   *
   * @returns {void}
   */
  function reset() {
    sent.length = 0
  }

  return /** @type {SmsProvider} */ ({ name, from: sender, send, sent, lastSent, reset })
}
