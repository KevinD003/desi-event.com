/**
 * The words the notification screens use, and the rule for what an operator may do.
 *
 * Pure and import-free, because the list, the detail page and the client
 * action panel all need it, and a module shipped to the browser must not pull
 * the schemas barrel in behind it (see `lib/browser-bundle.js`).
 *
 * ## The words are the operations board's
 *
 * The board names a status by its code, spaced and lowered: "dead letter",
 * "retry scheduled". These are the same words, capitalised, each with the
 * sentence that says what it means for somebody on shift.
 *
 * ## "Sent" means handed over, and no more
 *
 * `SENT` is written by the worker when the provider accepted the message. In
 * this build that provider is the in-memory one, so "sent" means handed to the
 * (simulated) mail service. It says nothing about an inbox, and nothing on
 * these screens claims more.
 *
 * ## What may be retried or withdrawn
 *
 * From `apps/api/src/lib/notification-operations.js`, which puts each rule in
 * the `UPDATE`'s own `WHERE` clause:
 *
 * | Operation | Accepted from                                                           |
 * | --------- | ----------------------------------------------------------------------- |
 * | retry     | `DEAD_LETTER`, `FAILED`, `RETRY_SCHEDULED`                              |
 * | cancel    | `QUEUED`, `RETRY_SCHEDULED`, `DEAD_LETTER`, `FAILED`, and `CLAIMED` once its lease has lapsed |
 *
 * Retry is refused for `CLAIMED` whether its lease is live or lapsed (the next
 * worker re-claims a lapsed one on its own), and for a message redacted for
 * privacy, which this screen cannot see and the API refuses with its own words.
 * These lists decide only what is offered; the API decides again.
 *
 * @module app/operations/notifications/notification-vocabulary
 */

/** Statuses a message may be put back in the queue from. */
export const RETRYABLE_STATUSES = Object.freeze(['DEAD_LETTER', 'FAILED', 'RETRY_SCHEDULED'])

/** Statuses a message may be withdrawn from without a lease in the way. */
export const CANCELLABLE_STATUSES = Object.freeze([
  'QUEUED',
  'RETRY_SCHEDULED',
  'DEAD_LETTER',
  'FAILED',
])

/** The shortest reason the API accepts for either action. */
export const REASON_MIN = 4

/** The longest reason the API accepts for either action. */
export const REASON_MAX = 500

/**
 * Each outbox status: its word, its tone, and what it means.
 *
 * @type {Readonly<Record<string, {label: string, tone: string, meaning: string}>>}
 */
export const NOTIFICATION_STATUSES_IN_WORDS = Object.freeze({
  DEAD_LETTER: {
    label: 'Dead letter',
    tone: 'danger',
    meaning: 'Out of attempts. It waits for a person to retry it or withdraw it.',
  },
  FAILED: {
    label: 'Failed',
    tone: 'danger',
    meaning:
      'A failure that will happen the same way again. It waits here until somebody retries it or withdraws it.',
  },
  RETRY_SCHEDULED: {
    label: 'Retry scheduled',
    tone: 'warning',
    meaning: 'A failure that may clear on its own. A worker will try again at the scheduled time.',
  },
  QUEUED: {
    label: 'Queued',
    tone: 'pending',
    meaning: 'Waiting for a worker to pick it up.',
  },
  CLAIMED: {
    label: 'Claimed',
    tone: 'info',
    meaning:
      'A worker holds it. The worker hands it over, retries it or dead-letters it without anybody here.',
  },
  SENDING: {
    label: 'Sending',
    tone: 'info',
    meaning: 'An older spelling of claimed, kept so old records stay readable.',
  },
  SENT: {
    label: 'Sent',
    tone: 'success',
    meaning:
      'Handed to the (simulated) mail service. That is as far as this system can see; it says nothing about an inbox.',
  },
  CANCELLED: {
    label: 'Cancelled',
    tone: 'neutral',
    meaning: 'Withdrawn before it was handed over. It will not be sent.',
  },
  SUPPRESSED: {
    label: 'Suppressed',
    tone: 'neutral',
    meaning: 'Not sent: the recipient’s preferences turn this kind of message down.',
  },
})

/**
 * A status in words, or its code for one this screen has not met.
 *
 * @param {string} status An outbox status.
 * @returns {{label: string, tone: string, meaning: string}} The words.
 */
export function notificationStatusInWords(status) {
  return (
    NOTIFICATION_STATUSES_IN_WORDS[status] ?? {
      label: status,
      tone: 'neutral',
      meaning: 'A status this screen has no words for.',
    }
  )
}

/**
 * What a message is handed to when it is sent.
 *
 * One answer whatever the row's channel: the worker hands every outbox row to
 * the email provider (`sendOutsideTransaction` in
 * `apps/worker/src/outbox/dispatcher.js`), and the only email provider in this
 * build is the in-memory one.
 *
 * @type {string}
 */
export const HANDED_TO = 'the (simulated) mail service'

/**
 * Each channel in words.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CHANNELS_IN_WORDS = Object.freeze({
  EMAIL: 'Email',
  SMS: 'Text message',
  PUSH: 'Push',
})

/**
 * Each failure category in words.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const FAILURE_CATEGORIES_IN_WORDS = Object.freeze({
  PERMANENT: 'Permanent: it will fail the same way again',
  TRANSIENT: 'Transient: it may clear on its own',
})

/**
 * Whether the API would accept a retry of a message in this status.
 *
 * @param {string} status An outbox status.
 * @returns {boolean} True when a retry is offered.
 */
export function mayRetry(status) {
  return RETRYABLE_STATUSES.includes(status)
}

/**
 * Whether the API would accept withdrawing a message in this status.
 *
 * @param {string} status An outbox status.
 * @param {boolean} leaseLapsed For `CLAIMED`, whether the worker's hold has lapsed.
 * @returns {boolean} True when withdrawing is offered.
 */
export function mayCancel(status, leaseLapsed) {
  return CANCELLABLE_STATUSES.includes(status) || (status === 'CLAIMED' && leaseLapsed === true)
}
