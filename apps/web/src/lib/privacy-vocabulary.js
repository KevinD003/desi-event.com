/**
 * What the privacy screens are allowed to say, written once.
 *
 * The API answers in closed vocabularies — states, reasons, outcome codes, hold
 * decisions, audit results — and every one of them has to be turned into a
 * sentence an operator can act on. Doing that inside each screen would be five
 * chances to phrase the same refusal five ways, and on this surface the wording
 * is load-bearing: "nothing happened" and "we were told not to" are different
 * answers, and an operator who cannot tell them apart will do the wrong thing
 * next.
 *
 * ## The rule every string here obeys
 *
 * No personal data, ever — not a name, not an address, not a value that was or
 * will be redacted. The payloads these labels describe carry opaque ids, enum
 * members, counts and timestamps, and that is exactly what makes the timeline
 * safe to show to somebody investigating an incident about a person who has
 * already been erased. A label that reintroduced a value would undo that in the
 * one place nobody would think to look.
 *
 * ## Why unknown codes fall through rather than throw
 *
 * The server owns these vocabularies and may extend one before the browser is
 * redeployed. A screen that threw on an unrecognised code would turn a new
 * outcome into a blank page; a screen that shows the raw code shows something
 * true but ugly, which is the right way round. Every lookup here is total.
 *
 * @module lib/privacy-vocabulary
 */

/**
 * Turn an unrecognised server code into something readable.
 *
 * `REFUSED_LEGAL_HOLD` becomes "Refused legal hold" — true, plain, and obviously
 * a fallback rather than curated text.
 *
 * @param {string} code The code.
 * @returns {string} A humane rendering.
 */
function humanise(code) {
  if (typeof code !== 'string' || code === '') return 'Unknown'

  const lower = code.replaceAll('_', ' ').toLowerCase()

  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * Look a code up, falling back to a humanised form.
 *
 * @param {Record<string, string>} table The lookup.
 * @param {string} code The code.
 * @returns {string} The label.
 */
function label(table, code) {
  return table[code] ?? humanise(code)
}

/** What each `PrivacyRequestState` means to somebody reading a queue. */
const REQUEST_STATE_LABELS = Object.freeze({
  REQUESTED: 'Awaiting confirmation',
  QUEUED: 'Confirmed, queued',
  PROCESSING: 'Running',
  COMPLETED: 'Completed',
  HELD: 'Held',
  FAILED_SAFE: 'Stopped safely',
  CANCELLED: 'Cancelled',
})

/**
 * A one-line explanation of a request state.
 *
 * `FAILED_SAFE` gets the longest sentence because it is the one most likely to
 * be misread as "it half happened". It did not: the engine stops before it
 * writes rather than leaving a person partly erased.
 */
const REQUEST_STATE_DESCRIPTIONS = Object.freeze({
  REQUESTED:
    'Raised, with a confirmation phrase issued. Nothing has been changed and nothing will be until the phrase is typed back.',
  QUEUED: 'Confirmed and waiting to run. No data has been changed yet.',
  PROCESSING: 'Running now. Do not raise another request for this subject until it settles.',
  COMPLETED: 'Finished. See the outcome code for what was actually done.',
  HELD: 'Refused because a hold was active. Nothing was changed.',
  FAILED_SAFE:
    'Stopped before writing anything. This is not a partial erasure — the engine refuses to leave somebody half-redacted, so the subject is exactly as they were.',
  CANCELLED: 'Withdrawn before it ran. Nothing was changed.',
})

/** Which states are terminal, so a screen knows whether to offer an action. */
const TERMINAL_REQUEST_STATES = Object.freeze(['COMPLETED', 'HELD', 'FAILED_SAFE', 'CANCELLED'])

/** What each `PrivacyRequestReason` means. */
const REQUEST_REASON_LABELS = Object.freeze({
  SUBJECT_REQUEST: 'The person asked',
  ORGANIZER_REQUEST: 'The organiser asked',
  RETENTION_POLICY: 'Retention policy',
  DATA_MINIMISATION: 'Data minimisation',
})

/** What each outcome code means once a request is terminal. */
const OUTCOME_LABELS = Object.freeze({
  REDACTED: 'Redacted',
  ALREADY_REDACTED: 'Already redacted — nothing left to do',
  WITHDRAWN_BY_OPERATOR: 'Withdrawn by an operator',
  REFUSED_LEGAL_HOLD: 'Refused — a legal hold was active',
  REFUSED_FRAUD_HOLD: 'Refused — a fraud investigation hold was active',
  REFUSED_OPEN_PROCESS: 'Refused — an open process still needs the data',
  CONFIRMATION_LAPSED: 'The confirmation expired before it was used',
  STOPPED_SAFELY: 'Stopped safely without writing anything',
  REDACTION_WRITE_FAILED: 'A write failed, so the run stopped without completing',
  HOLD_APPEARED_DURING_EXECUTION: 'A hold appeared while it was running, so it stopped',
})

/** What each `PrivacyHoldDecision` means. */
const HOLD_DECISION_LABELS = Object.freeze({
  NOT_EVALUATED: 'Not yet evaluated',
  NONE_ACTIVE: 'No hold active',
  LEGAL_HOLD_ACTIVE: 'A legal hold is active',
  FRAUD_HOLD_ACTIVE: 'A fraud investigation hold is active',
  OPEN_PROCESS: 'An open process still needs the data',
})

/** What each `PrivacyHoldKind` is. */
const HOLD_KIND_LABELS = Object.freeze({
  LEGAL: 'Legal',
  FRAUD_INVESTIGATION: 'Fraud investigation',
})

/** What each `PrivacyHoldState` is. */
const HOLD_STATE_LABELS = Object.freeze({
  ACTIVE: 'Active',
  RELEASED: 'Released',
})

/** The four release reasons the API accepts, for a select. */
export const HOLD_RELEASE_REASONS = Object.freeze([
  { value: 'MATTER_CLOSED', label: 'The matter is closed' },
  { value: 'COUNSEL_INSTRUCTION', label: 'Counsel instructed release' },
  { value: 'INVESTIGATION_CLOSED', label: 'The investigation is closed' },
  { value: 'PLACED_IN_ERROR', label: 'It was placed in error' },
])

/** The three cancellation reasons the API accepts, for a select. */
export const REQUEST_CANCEL_REASONS = Object.freeze([
  { value: 'NO_LONGER_REQUIRED', label: 'No longer required' },
  { value: 'RAISED_IN_ERROR', label: 'Raised in error' },
  { value: 'SUPERSEDED', label: 'Superseded by another request' },
])

/** The two hold kinds, for a select. */
export const HOLD_KINDS = Object.freeze([
  { value: 'LEGAL', label: 'Legal' },
  { value: 'FRAUD_INVESTIGATION', label: 'Fraud investigation' },
])

/** The four reasons a request may be raised, for a select. */
export const REQUEST_REASONS = Object.freeze([
  { value: 'SUBJECT_REQUEST', label: 'The person asked' },
  { value: 'ORGANIZER_REQUEST', label: 'The organiser asked' },
  { value: 'RETENTION_POLICY', label: 'Retention policy' },
  { value: 'DATA_MINIMISATION', label: 'Data minimisation' },
])

/**
 * What each personal-data category covers, in an operator's words.
 *
 * Categories, never column names. A preview an operator reads must not double
 * as a map of where the personal data lives.
 */
const CATEGORY_LABELS = Object.freeze({
  ACCOUNT_IDENTITY: 'Account identity',
  BUYER_IDENTITY: 'Buyer identity',
  TICKET_HOLDER_IDENTITY: 'Ticket holder identity',
  NOTIFICATION_DELIVERY: 'Notification delivery',
  SECURITY_METADATA: 'Security metadata',
  EXPORTS: 'Exports',
})

/**
 * What a scope entry's status means.
 *
 * The distinction this table exists for: a count of zero cannot tell you
 * whether there was nothing of this kind or whether this organisation may not
 * touch it, and somebody confirming an irreversible action is owed that
 * difference.
 */
const SCOPE_STATUS_LABELS = Object.freeze({
  REDACTED: 'Will be redacted',
  NOTHING_TO_DO: 'Nothing of this kind',
  ALREADY_REDACTED: 'Already redacted',
  OUT_OF_SCOPE: 'Out of scope for this organisation',
  DEFERRED: 'Not implemented yet',
})

/** The longer form, for the categories whose status is easy to misread. */
const SCOPE_STATUS_DESCRIPTIONS = Object.freeze({
  OUT_OF_SCOPE:
    'This organisation may not change these rows. Most often the person is also known to another organisation, and erasing the shared account here would reach beyond this organisation.',
  DEFERRED: 'The engine does not implement this category yet, so it will be left untouched.',
  ALREADY_REDACTED: 'These rows already carry placeholders, so a second run would change nothing.',
})

/** What each `PrivacyAuditResult` means on a timeline. */
const AUDIT_RESULT_LABELS = Object.freeze({
  REQUESTED: 'Raised',
  CONFIRMED: 'Confirmed',
  REFUSED_HOLD: 'Refused — hold active',
  REFUSED_AUTHORIZATION: 'Refused — not authorised',
  REFUSED_CONFLICT: 'Refused — conflicting state',
  STARTED: 'Started',
  COMPLETED: 'Completed',
  FAILED_SAFE: 'Stopped safely',
  CANCELLED: 'Cancelled',
})

/**
 * The refusal an HTTP status and error code together mean.
 *
 * The privacy surface collapses several genuinely different refusals onto the
 * same status. A 403 is a missing capability **or** a lapsed step-up window; a
 * 409 is a legal hold **or** a request already in flight **or** a confirmation
 * that expired. Only `error.code` separates them, so this is where the codes
 * are read — not in each screen, and never by string-matching a message.
 *
 * @param {{status?: number, code?: string|null}} error The thrown API error.
 * @returns {{title: string, detail: string, recoverable: boolean}} What to show.
 */
export function describeRefusal(error) {
  const status = error?.status ?? 0
  const code = error?.code ?? null

  if (code === 'STEP_UP_REQUIRED') {
    return {
      title: 'Confirm it is you',
      detail:
        'This action needs a fresh step-up. The window is deliberately short, so it lapses quickly and has to be reopened.',
      recoverable: true,
    }
  }

  if (code === 'MFA_ENROLMENT_REQUIRED') {
    return {
      title: 'A second factor is required',
      detail:
        'This account has to enrol a second factor before it can run an irreversible privacy action.',
      recoverable: true,
    }
  }

  if (code === 'REFUSED_LEGAL_HOLD' || code === 'REFUSED_FRAUD_HOLD') {
    return {
      title: 'Refused — a hold is active',
      detail:
        'Nothing was changed. A hold has to be released before this subject can be redacted, and releasing one is its own recorded decision.',
      recoverable: false,
    }
  }

  if (code === 'REFUSED_OPEN_PROCESS') {
    return {
      title: 'Refused — an open process needs the data',
      detail: 'Nothing was changed. This resolves itself when the process closes.',
      recoverable: false,
    }
  }

  if (code === 'ALREADY_IN_FLIGHT') {
    return {
      title: 'Already in flight',
      detail:
        'This subject already has a request that has not settled. One at a time is deliberate — two concurrent redactions of one person cannot be reasoned about.',
      recoverable: false,
    }
  }

  if (code === 'CONFIRMATION_LAPSED') {
    return {
      title: 'The confirmation expired',
      detail: 'Raise the request again to be issued a fresh phrase. Nothing was changed.',
      recoverable: true,
    }
  }

  if (status === 401) {
    return {
      title: 'Signed out',
      detail: 'This session is no longer valid. Sign in again to continue.',
      recoverable: true,
    }
  }

  if (status === 403) {
    return {
      title: 'Not for this account',
      detail:
        'This account does not carry the capability this action needs. Nothing on this page can grant it.',
      recoverable: false,
    }
  }

  if (status === 404) {
    return {
      title: 'Not found',
      detail:
        'There is nothing here to show. This answer is deliberately the same whether the item does not exist or is not yours.',
      recoverable: false,
    }
  }

  if (status === 409) {
    return {
      title: 'The state moved',
      detail:
        'Something changed between reading this page and acting on it. Reload to see where it stands now; nothing was changed by the attempt.',
      recoverable: true,
    }
  }

  if (status === 422) {
    return {
      title: 'That did not match',
      detail:
        'The confirmation phrase has to be typed back exactly as it was issued. Nothing was changed.',
      recoverable: true,
    }
  }

  return {
    title: 'The service could not answer',
    detail:
      'Nothing here is stale — it is absent. Nothing was changed by the attempt; try again, and if it persists this is worth escalating.',
    recoverable: true,
  }
}

/**
 * Whether a request has reached a state nothing will move it out of.
 *
 * @param {string} state The request state.
 * @returns {boolean} True when terminal.
 */
export function isTerminalRequestState(state) {
  return TERMINAL_REQUEST_STATES.includes(state)
}

/**
 * Whether the API will accept a cancellation in this state.
 *
 * Mirrors the service's own rule rather than guessing: only a request that has
 * not begun executing may be withdrawn. The button is hidden otherwise, and the
 * API refuses anyway — the UI is the courtesy, not the control.
 *
 * @param {string} state The request state.
 * @returns {boolean} True when cancellation is worth offering.
 */
export function isCancellable(state) {
  return state === 'REQUESTED' || state === 'QUEUED'
}

/**
 * Whether a request is still waiting for its confirmation phrase.
 *
 * @param {string} state The request state.
 * @returns {boolean} True when confirmation is the next step.
 */
export function isAwaitingConfirmation(state) {
  return state === 'REQUESTED'
}

/** @param {string} state A `PrivacyRequestState`. @returns {string} Its label. */
export function requestStateLabel(state) {
  return label(REQUEST_STATE_LABELS, state)
}

/** @param {string} state A `PrivacyRequestState`. @returns {string} What it means. */
export function requestStateDescription(state) {
  return REQUEST_STATE_DESCRIPTIONS[state] ?? 'This state has no description yet.'
}

/** @param {string} reason A `PrivacyRequestReason`. @returns {string} Its label. */
export function requestReasonLabel(reason) {
  return label(REQUEST_REASON_LABELS, reason)
}

/** @param {string|null} code An outcome or failure code. @returns {string|null} Its label. */
export function outcomeLabel(code) {
  if (!code) return null

  return label(OUTCOME_LABELS, code)
}

/** @param {string} decision A `PrivacyHoldDecision`. @returns {string} Its label. */
export function holdDecisionLabel(decision) {
  return label(HOLD_DECISION_LABELS, decision)
}

/** @param {string} kind A `PrivacyHoldKind`. @returns {string} Its label. */
export function holdKindLabel(kind) {
  return label(HOLD_KIND_LABELS, kind)
}

/** @param {string} state A `PrivacyHoldState`. @returns {string} Its label. */
export function holdStateLabel(state) {
  return label(HOLD_STATE_LABELS, state)
}

/** @param {string} category A `PRIVACY_DATA_CATEGORIES` member. @returns {string} Its label. */
export function categoryLabel(category) {
  return label(CATEGORY_LABELS, category)
}

/** @param {string} status A scope entry status. @returns {string} Its label. */
export function scopeStatusLabel(status) {
  return label(SCOPE_STATUS_LABELS, status)
}

/** @param {string} status A scope entry status. @returns {string|null} The longer form. */
export function scopeStatusDescription(status) {
  return SCOPE_STATUS_DESCRIPTIONS[status] ?? null
}

/** @param {string} result A `PrivacyAuditResult`. @returns {string} Its label. */
export function auditResultLabel(result) {
  return label(AUDIT_RESULT_LABELS, result)
}

/** @param {string} action An audit action constant. @returns {string} Its label. */
export function auditActionLabel(action) {
  if (typeof action !== 'string') return 'Unknown'

  return humanise(action.replace(/^privacy\./u, '').replaceAll('.', ' '))
}
