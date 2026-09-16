/**
 * The notification outbox: what a message may become, and when.
 *
 * Pure decisions only. Nothing here opens a transaction or calls a provider —
 * the worker does that, and the operator routes do it differently, and both
 * have to agree about the rules. Keeping the rules in one importable place is
 * how they agree.
 *
 * @module @desi-event/notifications
 */

export {
  BASE_RETRY_DELAY_MS,
  CLAIMABLE_STATES,
  DEFAULT_LEASE_MS,
  FAILURE_CATEGORIES,
  MAX_RETRY_DELAY_MS,
  OUTBOX_STATES,
  OUTBOX_TRANSITIONS,
  TERMINAL_STATES,
  afterFailure,
  canTransition,
  claimableWhere,
  dedupeKeyFor,
  leaseHasLapsed,
  retryDelayMs,
} from './outbox.js'

export {
  OUTBOX_TEMPLATES,
  UNSUPPRESSIBLE_TEMPLATES,
  isOutboxTemplate,
  isSuppressible,
} from './templates.js'
