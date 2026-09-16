/**
 * How an event's lifecycle state reads to the person who owns it.
 *
 * The public page has its own vocabulary in `lib/event-jsonld.js`, and the two
 * are deliberately different: a visitor needs to know whether they can buy a
 * ticket, and an organiser needs to know whose turn it is. "Approved" means
 * nothing to a visitor and is the whole answer for an organiser — somebody said
 * yes, and publishing is now a button they have to press.
 *
 * Every state says what happens next. A status word on its own leaves somebody
 * staring at "Changes required" with no idea whether they are waiting or
 * working.
 *
 * Nothing here decides anything. The API owns the transition table, the
 * entitlements and the gates; this is the reading of its answer.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath, so a path segment spelled exactly that fails `jsdoc/valid-types`.
 *
 * @file lib/event-status
 */

/**
 * @typedef {object} StatusReading
 * @property {string} label The state's name, in words a person uses.
 * @property {string} tone A `Badge` variant. Never the only signal — the label carries the fact.
 * @property {string} whose Whose move it is: the organiser's, a moderator's, or nobody's.
 * @property {string} next What happens next, in one sentence.
 */

/** @type {Readonly<Record<string, StatusReading>>} */
const READINGS = Object.freeze({
  DRAFT: {
    label: 'Draft',
    tone: 'neutral',
    whose: 'you',
    next: 'Nobody can see this but your team. Send it for review when it is ready.',
  },
  REVIEW_PENDING: {
    label: 'Waiting for review',
    tone: 'info',
    whose: 'a moderator',
    next: 'A moderator has it. You can withdraw it to keep editing, which sends it back to draft.',
  },
  CHANGES_REQUIRED: {
    label: 'Changes requested',
    tone: 'warning',
    whose: 'you',
    next: 'A moderator has asked for something specific. Make the changes and send it back.',
  },
  APPROVED: {
    label: 'Approved, not yet public',
    tone: 'success',
    whose: 'you',
    next: 'A moderator said yes. Nothing is public until you publish it, which is your decision and your timing.',
  },
  PUBLISHED: {
    label: 'Published',
    tone: 'success',
    whose: 'you',
    next: 'The page is live. Open sales when you want people to be able to buy.',
  },
  ON_SALE: {
    label: 'On sale',
    tone: 'success',
    whose: 'nobody',
    next: 'People can buy. Pausing stops sales without taking the page down.',
  },
  SALES_PAUSED: {
    label: 'Sales paused',
    tone: 'warning',
    whose: 'you',
    next: 'The page is still up and says sales are paused. Resume when you are ready.',
  },
  SOLD_OUT: {
    label: 'Sold out',
    tone: 'info',
    whose: 'nobody',
    next: 'Every ticket has gone. Returned holds can put stock back.',
  },
  COMPLETED: {
    label: 'Finished',
    tone: 'neutral',
    whose: 'nobody',
    next: 'The event has happened. The page stays up for the people who went.',
  },
  POSTPONED: {
    label: 'Postponed',
    tone: 'warning',
    whose: 'you',
    next: 'Ticket holders have been told. Set a new date to bring it back.',
  },
  CANCELLED: {
    label: 'Cancelled',
    tone: 'danger',
    whose: 'nobody',
    next: 'Refunds have been requested for every paid order. This cannot be undone.',
  },
  REJECTED: {
    label: 'Rejected',
    tone: 'danger',
    whose: 'you',
    next: 'A moderator said no and gave a reason. A rejected event can be reworked as a new draft.',
  },
  ARCHIVED: {
    label: 'Archived',
    tone: 'neutral',
    whose: 'nobody',
    next: 'Kept for the record. Orders and tickets still point at it.',
  },
})

/** The reading used when the API sends a status this build has never heard of. */
const UNKNOWN = Object.freeze({
  label: 'Unknown state',
  tone: 'neutral',
  whose: 'nobody',
  next: 'This build does not recognise the state the server reported. Reload before acting on it.',
})

/**
 * How one status reads.
 *
 * Falls back rather than throwing: a client that crashes because the server
 * grew a state is worse than one that says it does not recognise it.
 *
 * @param {string} status An `EventStatus`.
 * @returns {StatusReading} The reading.
 */
export function statusReading(status) {
  return READINGS[status] ?? UNKNOWN
}

/**
 * Statuses in which the generic editor may write.
 *
 * Mirrors `EDITABLE_STATUSES` in `@desi-event/schemas/lifecycle`, and the
 * server enforces it — this is only what decides whether the fields are drawn
 * as inputs or as text. Listed rather than imported so the browser does not
 * pull the schemas barrel in for two strings, which is the lesson NF-16 taught.
 *
 * @type {ReadonlySet<string>}
 */
export const EDITABLE = new Set(['DRAFT', 'CHANGES_REQUIRED'])

/**
 * The lifecycle commands, and how each one asks.
 *
 * `reason` says whether the command needs one, and `confirm` whether it is the
 * kind of thing somebody should have to mean. Cancelling an event requests a
 * refund against every paid order and cannot be undone, so it asks twice and
 * makes you type a reason; pausing sales does neither, because resuming is one
 * click away.
 *
 * @type {Readonly<Record<string, {path: string, label: string, verb: string, reason: 'required'|'optional'|'none', confirm: string|null, tone: string}>>}
 */
export const COMMANDS = Object.freeze({
  submitReview: {
    path: 'submit-review',
    label: 'Send for review',
    verb: 'Sending for review',
    reason: 'optional',
    confirm: null,
    tone: 'primary',
  },
  withdrawReview: {
    path: 'withdraw-review',
    label: 'Withdraw from review',
    verb: 'Withdrawing',
    reason: 'optional',
    confirm: null,
    tone: 'secondary',
  },
  publish: {
    path: 'publish',
    label: 'Publish',
    verb: 'Publishing',
    reason: 'none',
    confirm: 'Publishing makes this page public straight away. Ready?',
    tone: 'primary',
  },
  openSales: {
    path: 'open-sales',
    label: 'Open sales',
    verb: 'Opening sales',
    reason: 'none',
    confirm: 'Opening sales lets people buy. The seating map backing this event freezes now.',
    tone: 'primary',
  },
  pauseSales: {
    path: 'pause-sales',
    label: 'Pause sales',
    verb: 'Pausing sales',
    reason: 'optional',
    confirm: null,
    tone: 'secondary',
  },
  postpone: {
    path: 'postpone',
    label: 'Postpone',
    verb: 'Postponing',
    reason: 'required',
    confirm: 'Postponing tells every ticket holder the date is off. Continue?',
    tone: 'secondary',
  },
  cancel: {
    path: 'cancel',
    label: 'Cancel this event',
    verb: 'Cancelling',
    reason: 'required',
    confirm:
      'Cancelling requests a refund against every paid order and cannot be undone. Continue?',
    tone: 'danger',
  },
})

/**
 * Reason codes a cancellation or postponement can carry.
 *
 * A fixed list plus a free-text note, for the same reason accessibility claims
 * are a vocabulary: "weather" is countable across a hundred events and "it
 * rained and the generator died" is not. The note is where the second one goes.
 *
 * @type {Array<string[]>}
 */
export const REASON_CODES = Object.freeze([
  ['ARTIST_UNAVAILABLE', 'The artist cannot make it'],
  ['VENUE_UNAVAILABLE', 'The venue fell through'],
  ['WEATHER', 'Weather'],
  ['LOW_SALES', 'Not enough tickets sold'],
  ['PERMIT_OR_LICENCE', 'A permit or licence did not come through'],
  ['SAFETY', 'A safety concern'],
  ['ORGANIZER_DECISION', 'Our decision, for another reason'],
])
