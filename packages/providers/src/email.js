/**
 * An in-memory email provider.
 *
 * Every accepted message is appended to a `sent` array, which is the whole
 * point: a test asserts on what the system *tried* to send rather than on a
 * mock's call log, so the assertion survives refactors of the calling code.
 *
 * Recipients are validated before a message is accepted, because the failure
 * that actually happens in production is a malformed address assembled from
 * user input, and it should surface at the call site rather than as a silent
 * no-op.
 *
 * @module @desi-event/providers/email
 */

import { emailSchema } from '@desi-event/schemas'
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
 * Any message addressed to this recipient is rejected with `SEND_FAILED`.
 *
 * The address is in the reserved `.test` TLD, so it can never route anywhere
 * real, and it lets a caller exercise retry/bounce handling through layers of
 * code that never touch the provider object.
 *
 * @type {string}
 */
export const EMAIL_BOUNCE_ADDRESS = 'bounce@desi-event.test'

/** Default sender used when a message omits `from`. */
export const DEFAULT_EMAIL_FROM = 'no-reply@desi-event.com'

/** Most recipients accepted on a single message, across `to`, `cc` and `bcc`. */
const MAX_RECIPIENTS = 50

/** Longest accepted subject line. */
const MAX_SUBJECT_LENGTH = 200

/** Longest accepted body, plain text or HTML. */
const MAX_BODY_LENGTH = 200_000

/**
 * Normalise a recipient field into a list of validated addresses.
 *
 * @param {unknown} value A single address, or an array of them.
 * @param {string} field Field name (`to`, `cc`, `bcc`) used in errors.
 * @param {string} provider Provider name attached to any error raised.
 * @param {boolean} required Whether an empty list is a failure.
 * @returns {string[]} Trimmed, lower-cased addresses; possibly empty when optional.
 * @throws {ProviderError} `INVALID_RECIPIENT` when the field is the wrong shape, empty while required, too long, or contains an unusable address.
 */
function parseRecipients(value, field, provider, required) {
  if (value === undefined || value === null) {
    if (!required) return []
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_RECIPIENT,
      `Expected \`${field}\` to be an email address or an array of addresses`,
      { provider, details: { field, received: value === null ? 'null' : 'undefined' } },
    )
  }

  const list = Array.isArray(value) ? value : [value]

  if (list.length === 0) {
    if (!required) return []
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_RECIPIENT,
      `Expected \`${field}\` to contain at least one recipient`,
      { provider, details: { field } },
    )
  }
  if (list.length > MAX_RECIPIENTS) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_RECIPIENT,
      `\`${field}\` accepts at most ${MAX_RECIPIENTS} recipients, received ${list.length}`,
      { provider, details: { field, count: list.length, maxRecipients: MAX_RECIPIENTS } },
    )
  }

  /** @type {string[]} */
  const accepted = []
  /** @type {unknown[]} */
  const invalid = []

  for (const entry of list) {
    const result = emailSchema.safeParse(entry)
    if (result.success) accepted.push(/** @type {string} */ (result.data))
    else invalid.push(entry)
  }

  if (invalid.length > 0) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_RECIPIENT,
      `\`${field}\` contains ${invalid.length} unusable address(es)`,
      { provider, details: { field, invalid } },
    )
  }

  // De-duplicate: two order confirmations to the same address is a bug, not a feature.
  return [...new Set(accepted)]
}

/**
 * Validate an optional single address such as `from` or `replyTo`.
 *
 * @param {unknown} value Candidate address.
 * @param {string} field Field name used in errors.
 * @param {string} provider Provider name attached to any error raised.
 * @returns {(string|undefined)} The normalised address, or `undefined` when absent.
 * @throws {ProviderError} `INVALID_RECIPIENT` when present but unusable.
 */
function parseOptionalAddress(value, field, provider) {
  if (value === undefined || value === null) return undefined
  const result = emailSchema.safeParse(value)
  if (!result.success) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_RECIPIENT,
      `Expected \`${field}\` to be a valid email address`,
      { provider, details: { field, received: value } },
    )
  }
  return /** @type {string} */ (result.data)
}

/**
 * @typedef {object} InMemoryEmailProviderOptions
 * @property {string} [name] Adapter name.
 * @property {string} [from] Default sender for messages that omit `from`.
 * @property {string} [idPrefix] Prefix for generated message ids.
 * @property {string} [bounceAddress] Address that always fails; defaults to {@link EMAIL_BOUNCE_ADDRESS}.
 * @property {(Date|number|string|function(): (Date|number|string))} [now] Fixed instant or clock function.
 */

/**
 * Create an in-memory {@link EmailProvider}.
 *
 * @param {InMemoryEmailProviderOptions} [options] Construction options.
 * @returns {EmailProvider} A provider with `send`, the `sent` record array, plus `lastSent()` and `reset()` for tests.
 * @throws {ProviderError} `INVALID_OPTIONS` when `now` is not a usable instant; `INVALID_RECIPIENT` when the default `from` is not an address.
 */
export function createInMemoryEmailProvider(options = {}) {
  const {
    name = 'in-memory-email',
    from: defaultFrom = DEFAULT_EMAIL_FROM,
    idPrefix = 'email',
    bounceAddress = EMAIL_BOUNCE_ADDRESS,
    now,
  } = options

  const normalisedFrom = /** @type {string} */ (parseOptionalAddress(defaultFrom, 'from', name))
  const normalisedBounce = /** @type {string} */ (
    parseOptionalAddress(bounceAddress, 'bounceAddress', name)
  )
  const clock = createClock(now)
  const nextId = createIdFactory(idPrefix)

  /**
   * Every message this provider accepted, oldest first.
   *
   * The array identity is stable across `reset()` so a test may capture it
   * once in a `beforeEach` and keep asserting against the same reference.
   *
   * @type {object[]}
   */
  const sent = []

  /**
   * Deliver one message.
   *
   * @param {EmailMessage} message The message to send.
   * @returns {EmailReceipt} A receipt carrying the provider message id.
   * @throws {ProviderError} `INVALID_MESSAGE` when the message, subject or body is malformed; `INVALID_RECIPIENT` for an unusable address; `SEND_FAILED` when `forceFailure` is set or a recipient is the bounce address.
   */
  function send(message) {
    if (!isPlainObject(message)) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.INVALID_MESSAGE,
        'send expects a message object with `to`, `subject` and a body',
        { provider: name, details: { received: message === null ? 'null' : typeof message } },
      )
    }

    const to = parseRecipients(message.to, 'to', name, true)
    const cc = parseRecipients(message.cc, 'cc', name, false)
    const bcc = parseRecipients(message.bcc, 'bcc', name, false)
    const sender = parseOptionalAddress(message.from, 'from', name) ?? normalisedFrom
    const replyTo = parseOptionalAddress(message.replyTo, 'replyTo', name)

    const subject = requireText(message.subject, 'subject', {
      code: PROVIDER_ERROR_CODES.INVALID_MESSAGE,
      provider: name,
      maxLength: MAX_SUBJECT_LENGTH,
    })

    const hasText = typeof message.text === 'string' && message.text.trim() !== ''
    const hasHtml = typeof message.html === 'string' && message.html.trim() !== ''
    if (!hasText && !hasHtml) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.INVALID_MESSAGE,
        'Expected the message to carry a non-empty `text` or `html` body',
        { provider: name, details: { subject } },
      )
    }

    const text = hasText
      ? requireText(message.text, 'text', {
          code: PROVIDER_ERROR_CODES.INVALID_MESSAGE,
          provider: name,
          maxLength: MAX_BODY_LENGTH,
        })
      : null
    const html = hasHtml
      ? requireText(message.html, 'html', {
          code: PROVIDER_ERROR_CODES.INVALID_MESSAGE,
          provider: name,
          maxLength: MAX_BODY_LENGTH,
        })
      : null

    const metadata = normaliseMetadata(message.metadata, PROVIDER_ERROR_CODES.INVALID_MESSAGE, name)
    const bounced = [...to, ...cc, ...bcc].filter((address) => address === normalisedBounce)

    if (message.forceFailure === true || bounced.length > 0) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.SEND_FAILED,
        bounced.length > 0
          ? `Delivery to ${bounced.join(', ')} failed`
          : 'Delivery failed (forceFailure)',
        { provider: name, details: { to, subject, bounced } },
      )
    }

    const id = nextId()
    const sentAt = clock().toISOString()
    const record = freezeRecord({
      id,
      from: sender,
      to,
      cc,
      bcc,
      replyTo,
      subject,
      text,
      html,
      metadata,
      sentAt,
    })
    sent.push(record)

    return /** @type {EmailReceipt} */ (
      freezeRecord({ id, providerRef: id, accepted: [...to], status: 'SENT', sentAt })
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

  return /** @type {EmailProvider} */ ({ name, from: normalisedFrom, send, sent, lastSent, reset })
}
