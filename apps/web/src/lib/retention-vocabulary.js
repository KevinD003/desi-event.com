/**
 * What the retention screen is allowed to say about a rehearsal.
 *
 * The distinction this module exists to preserve is the one an operator most
 * easily gets wrong: **"nothing was found" and "nothing was looked at" are
 * different answers**, and a third — "nothing has ever run here" — looks like
 * both. A screen that rendered all three as an empty table would send somebody
 * to debug a worker that is behaving exactly as designed.
 *
 * ## Every number here is a proposal
 *
 * The durations behind these counts are `PROPOSED — REQUIRES LEGAL/PRIVACY
 * REVIEW`. Nobody has approved them. The API attaches that status to each row
 * rather than storing it, and this module renders it beside every figure rather
 * than once at the top of the page, because a number that travels without its
 * status is a number somebody eventually treats as settled.
 *
 * ## Why nothing here can describe a deletion
 *
 * Because nothing ever deletes. `affectedCount` is 0 on every dry run, which a
 * database CHECK constraint enforces rather than any writer promising, and
 * there is no vocabulary entry for a row that removed something — a screen
 * cannot phrase what the system cannot do.
 *
 * ## Unknown codes fall through rather than throw
 *
 * The same rule as `privacy-vocabulary.js`, for the same reason: the server
 * owns these vocabularies and may extend one before the browser is redeployed.
 * Every lookup here is total.
 *
 * @module lib/retention-vocabulary
 */

import { RETENTION_APPROVAL } from '@desi-event/schemas'

export { RETENTION_APPROVAL }

/**
 * Turn an unrecognised server code into something readable.
 *
 * @param {string} code The code.
 * @returns {string} A humane rendering, obviously a fallback rather than
 *   curated text.
 */
function humanise(code) {
  if (typeof code !== 'string' || code === '') return 'Unknown'

  const lower = code.replaceAll('_', ' ').toLowerCase()

  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * What each `RetentionSweepState` means, in words an operator can act on.
 *
 * `SKIPPED_DISABLED` gets the longest entry because it is the state this
 * deployment is expected to be in, and the one most likely to be mistaken for a
 * fault.
 *
 * @type {Readonly<Record<string, {label: string, description: string}>>}
 */
export const SWEEP_STATES = Object.freeze({
  SCHEDULED: Object.freeze({
    label: 'Scheduled',
    description: 'Queued. Nothing has been counted yet.',
  }),
  CLAIMED: Object.freeze({
    label: 'Running',
    description: 'A worker has taken this rehearsal and is counting.',
  }),
  COMPLETED: Object.freeze({
    label: 'Counted',
    description:
      'The rehearsal finished. It counted what the proposal would reach and changed nothing.',
  }),
  FAILED: Object.freeze({
    label: 'Failed',
    description: 'The rehearsal could not finish. Nothing was changed by the attempt either.',
  }),
  SKIPPED_DISABLED: Object.freeze({
    label: 'Declined',
    description:
      'Retention enforcement is not activated in the environment that ran this, so nothing was examined. This is a refusal, not a failure, and it is the expected state: it is recorded rather than passed over silently so that “we were told not to” cannot be mistaken for “nothing happened”.',
  }),
})

/**
 * What each evaluated class covers, and on what basis it is proposed.
 *
 * The basis matters as much as the number. "30 days" alone invites an argument
 * about whether 30 is right; "it exists for rate limiting, not history" is the
 * claim that argument should actually be about.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CLASS_DESCRIPTIONS = Object.freeze({
  login_attempt: 'Sign-in attempts, kept for rate limiting rather than for history.',
  session: 'Sessions that have already expired. A spent token is useful to nobody.',
  session_metadata:
    'The security metadata on a session — a hashed address and a user agent. Presence is counted; the values are never read.',
  notification_recipient:
    'Delivered notifications. The evidence worth keeping is that a message went, not who it went to.',
  export_artifact: 'Generated export files.',
})

/**
 * Label for a sweep state.
 *
 * @param {string} state One of `RetentionSweepState`.
 * @returns {string} The label.
 */
export function sweepStateLabel(state) {
  return SWEEP_STATES[state]?.label ?? humanise(state)
}

/**
 * The sentence explaining a sweep state.
 *
 * @param {string} state One of `RetentionSweepState`.
 * @returns {string} The description, or an empty string when there is no
 *   curated one — a blank is better than a guess at what an unknown state meant.
 */
export function sweepStateDescription(state) {
  return SWEEP_STATES[state]?.description ?? ''
}

/**
 * A readable name for a retention class.
 *
 * @param {string} retentionClass The class name.
 * @returns {string} The label.
 */
export function retentionClassLabel(retentionClass) {
  return humanise(retentionClass)
}

/**
 * What a retention class covers.
 *
 * @param {string} retentionClass The class name.
 * @returns {string} The description, or an empty string for a class this
 *   browser build does not know about.
 */
export function retentionClassDescription(retentionClass) {
  return CLASS_DESCRIPTIONS[retentionClass] ?? ''
}

/**
 * Whether a sweep reached a state in which it examined nothing.
 *
 * @param {object} sweep A sweep row.
 * @returns {boolean} Whether it declined rather than counted.
 */
export function isDeclined(sweep) {
  return sweep?.state === 'SKIPPED_DISABLED'
}

/**
 * How to read a page of sweeps, as one sentence.
 *
 * Three answers, kept apart on purpose:
 *
 *   - no rows at all — nothing has ever run here;
 *   - rows, all of them declined — it ran and was told not to;
 *   - rows that counted — here is what the proposal would reach.
 *
 * A screen that collapsed the first two would send somebody looking for a
 * broken worker when the system is doing exactly what it was configured to do.
 *
 * @param {Array<object>} sweeps The rows on this page.
 * @returns {{kind: string, sentence: string}} How to read them.
 */
export function summariseSweeps(sweeps) {
  const rows = Array.isArray(sweeps) ? sweeps : []

  if (rows.length === 0) {
    return {
      kind: 'NONE_RECORDED',
      sentence:
        'No retention rehearsal has been recorded. Nothing has run here — which is not the same as having run and found nothing.',
    }
  }

  if (rows.every(isDeclined)) {
    return {
      kind: 'ALL_DECLINED',
      sentence:
        'Every rehearsal here declined to run: retention enforcement is not activated in the environment that answered. Nothing was examined and nothing was changed.',
    }
  }

  return {
    kind: 'COUNTED',
    sentence:
      'These are counts of what the proposed durations would reach. Nothing was deleted, and no rehearsal can delete anything.',
  }
}
