/**
 * Dispatch one transactional email through the injected provider.
 *
 * The processor knows nothing about SMTP. It renders a body from the template
 * named in the payload and hands it to whatever satisfies the `EmailProvider`
 * interface — the in-memory fake in development and tests, a real adapter in
 * production. The provider is validated at *factory* time rather than on the
 * first job, so a wiring mistake fails at boot instead of silently dropping the
 * first order confirmation of the day.
 *
 * ## Which failures are worth retrying
 *
 * A bounced address will bounce again forever; a provider timeout will not.
 * `ProviderError.code` tells the two apart, so the mapping below is the whole
 * of the retry policy for email.
 *
 * @module @desi-event/worker/processors/send-email
 */

import { JOB_NAMES, sendEmailJobSchema } from '@desi-event/schemas/jobs'
import { PROVIDER_ERROR_CODES, ProviderError, assertEmailProvider } from '@desi-event/providers'
import { withoutAddresses } from '@desi-event/schemas'

import {
  PermanentJobError,
  RetryableJobError,
  WORKER_ERROR_CODES,
  parseJobPayload,
} from '../errors.js'
import { renderEmail } from '../email/templates.js'

/**
 * Provider failures that will recur identically on every attempt.
 *
 * A malformed message or an unusable address is a bug in the producer, not a
 * transient condition — retrying it five times just delays the alert.
 *
 * @type {string[]}
 */
export const PERMANENT_PROVIDER_ERROR_CODES = Object.freeze([
  PROVIDER_ERROR_CODES.INVALID_MESSAGE,
  PROVIDER_ERROR_CODES.INVALID_RECIPIENT,
  PROVIDER_ERROR_CODES.INVALID_PROVIDER,
  PROVIDER_ERROR_CODES.INCOMPLETE_REGISTRY,
  PROVIDER_ERROR_CODES.INVALID_OPTIONS,
])

/**
 * @typedef {object} SendEmailResult
 * @property {string} template The template that was rendered.
 * @property {string} to The recipient.
 * @property {string} subject The subject line actually sent.
 * @property {(string|undefined)} providerRef The provider's message reference, for support lookups.
 * @property {string} provider The adapter that accepted the message.
 * @property {(string|undefined)} orderId Correlation id from the payload.
 * @property {(string|undefined)} eventId Correlation id from the payload.
 */

/**
 * Build the `send-email` processor.
 *
 * @param {object} deps Injected dependencies.
 * @param {object} deps.email An `EmailProvider`, or a provider registry to take `email` from.
 * @param {object} [deps.logger] Logger for the per-message summary.
 * @param {string} [deps.from] Sender address; defaults to the provider's own.
 * @param {string} [deps.replyTo] Reply-to address applied to every message.
 * @returns {function(object): Promise<SendEmailResult>} An async BullMQ processor.
 * @throws {ProviderError} `INVALID_PROVIDER` when `email` does not implement the email interface.
 */
export function createSendEmailProcessor({ email, logger, from, replyTo }) {
  // Validate at wiring time: an adapter missing `send()` should fail the
  // deploy, not the first job.
  const provider = assertEmailProvider(email?.email ?? email)

  /**
   * Render and dispatch one message.
   *
   * @param {object} job The BullMQ job; only `job.data` is read.
   * @returns {Promise<SendEmailResult>} The provider receipt, flattened.
   * @throws {PermanentJobError} When the payload is invalid, the template is unknown, or the provider rejected the message permanently.
   * @throws {RetryableJobError} When the provider failed in a way that may clear on its own.
   */
  return async function sendEmail(job) {
    const payload = parseJobPayload(sendEmailJobSchema, job?.data ?? {}, JOB_NAMES.SEND_EMAIL)

    /** @type {{subject: string, text: string, html: string}} */
    let rendered
    try {
      rendered = renderEmail(payload)
    } catch (error) {
      // An unknown template is a producer bug; no number of retries invents
      // a renderer for it.
      throw new PermanentJobError(/** @type {Error} */ (error).message, {
        code: WORKER_ERROR_CODES.INVALID_JOB_PAYLOAD,
        jobName: JOB_NAMES.SEND_EMAIL,
        details: { template: payload.template },
        cause: error,
      })
    }

    const message = {
      to: payload.to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      metadata: {
        template: payload.template,
        locale: payload.locale,
        orderId: payload.orderId ?? null,
        eventId: payload.eventId ?? null,
      },
    }

    if (from) message.from = from
    if (replyTo) message.replyTo = replyTo

    let receipt
    try {
      receipt = await provider.send(message)
    } catch (error) {
      // Nothing that leaves here names the recipient. These errors are logged,
      // and BullMQ keeps a failed job's reason in Redis, so the address is left
      // out of the message and the details, and taken out of the provider's own
      // message, which may quote it ("Delivery to …").
      const code = /** @type {{code?: string}} */ (error)?.code
      const cause = withoutRecipient(error)
      const shared = {
        jobName: JOB_NAMES.SEND_EMAIL,
        details: { template: payload.template, providerCode: code ?? null },
        cause,
      }

      if (PERMANENT_PROVIDER_ERROR_CODES.includes(code)) {
        throw new PermanentJobError(
          `Email provider rejected "${payload.template}": ${cause?.message ?? ''}`,
          { ...shared, code: WORKER_ERROR_CODES.PROVIDER_REJECTED },
        )
      }

      throw new RetryableJobError(
        `Email provider failed to send "${payload.template}": ${cause?.message ?? ''}`,
        { ...shared, code: WORKER_ERROR_CODES.PROVIDER_UNAVAILABLE },
      )
    }

    // No recipient in the log line or the job's result: both outlive the send,
    // and BullMQ keeps a completed job's result in Redis.
    logger?.info?.(
      {
        template: payload.template,
        providerRef: receipt?.providerRef ?? receipt?.id,
        orderId: payload.orderId,
      },
      'transactional email sent',
    )

    return {
      template: payload.template,
      subject: rendered.subject,
      providerRef: receipt?.providerRef ?? receipt?.id,
      provider: provider.name,
      orderId: payload.orderId,
      eventId: payload.eventId,
    }
  }
}

/**
 * A provider's error, with every address taken out of it.
 *
 * Kept a `ProviderError` when it was one, so what it was survives; only the
 * message and the stack are rewritten, and the provider's `details`, which can
 * hold the recipient, are not carried over.
 *
 * @param {unknown} error What the provider threw.
 * @returns {unknown} The same kind of error, without addresses; anything that is not an error, unchanged.
 */
function withoutRecipient(error) {
  if (!(error instanceof Error)) return error

  const message = withoutAddresses(error.message, '[address]')
  const clean =
    error instanceof ProviderError
      ? new ProviderError(error.code, message, {
          statusCode: error.statusCode,
          provider: error.provider,
        })
      : new Error(message)

  clean.stack = withoutAddresses(error.stack, '[address]')

  return clean
}
