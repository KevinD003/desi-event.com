/**
 * The door screen's vocabulary: what each server answer means to a steward.
 *
 * Kept apart from the component so the mapping can be checked against the
 * server's closed lists without a browser — `door.test.js` asserts that every
 * refusal code the API can send has a sentence here. The browser cannot import
 * `@desi-event/schemas` (its barrel is on the browser-bundle guard's list), so
 * this is a mirror, and the test is what keeps it honest.
 *
 * Nothing here decides anything. Whether a ticket admits is the server's
 * answer; this module only puts it into words.
 *
 * @module lib/door
 */

/**
 * A steward-facing sentence for each admission refusal code.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const REFUSAL_SENTENCES = Object.freeze({
  REFUNDED: 'This ticket was refunded. Do not admit.',
  REVOKED: 'This ticket was withdrawn by the organiser. Do not admit.',
  TRANSFERRED: 'This ticket was handed to somebody else. Ask for their current pass.',
  CANCELLED: 'This ticket was cancelled. Do not admit.',
  SUPERSEDED: 'This pass was replaced by a newer one. Ask for the current pass.',
  VOID: 'This ticket is void. Do not admit.',
  NOT_ADMISSIBLE: 'This ticket cannot be admitted.',
  ORDER_NOT_PAID: 'The order for this ticket is not paid. Do not admit.',
  EVENT_CANCELLED: 'This event was cancelled. Nobody is admitted to it.',
  WRONG_EVENT: 'This ticket is for a different event.',
  PREVIEW_EXPIRED: 'That lookup took too long to confirm. Look the ticket up again.',
  PREVIEW_INVALID: 'That lookup could not be confirmed. Look the ticket up again.',
  PREVIEW_MISMATCH: 'The pass confirmed is not the one looked up. Look it up again.',
})

/**
 * Refusal codes after which looking the same ticket up again is the fix.
 *
 * @type {ReadonlyArray<string>}
 */
export const LOOK_AGAIN = Object.freeze(['PREVIEW_EXPIRED', 'PREVIEW_INVALID', 'PREVIEW_MISMATCH'])

/**
 * The sentence for a refusal code, with a safe fallback for one this build
 * has not heard of.
 *
 * @param {string|null|undefined} code A refusal code.
 * @returns {string} The sentence.
 */
export function refusalSentence(code) {
  return REFUSAL_SENTENCES[code] ?? 'This ticket cannot be admitted.'
}

/**
 * How a steward is told what their door authority rests on.
 *
 * @param {{authority: string, role: string}} entry An admission-events entry.
 * @returns {string} The label.
 */
export function authorityLabel(entry) {
  if (entry.authority === 'ORGANIZATION_ROLE') {
    return `Every event of ${entry.organization?.name ?? 'your organisation'} (${roleWord(entry.role)})`
  }

  return `Assigned to this event (${roleWord(entry.role)})`
}

/**
 * A role in words.
 *
 * @param {string} role An organisation role.
 * @returns {string} Lower case, spaced.
 */
function roleWord(role) {
  return String(role ?? '')
    .toLowerCase()
    .replaceAll('_', ' ')
}

/**
 * What to tell a steward when a lookup is not answered with a preview.
 *
 * The 404 wording covers both "no such pass" and "not an event you may admit
 * to" on purpose: the server answers both the same way, and the screen does
 * not try to tell them apart.
 *
 * @param {number} status The HTTP status, or 0 for no answer.
 * @returns {string} The sentence.
 */
export function lookupFailure(status) {
  switch (status) {
    case 0:
      return 'No answer from the server. Nothing was admitted. Check the connection and try again.'
    case 400:
      return 'That is not a ticket pass or a printed ticket code.'
    case 401:
      return 'You have been signed out. Sign in again to keep checking tickets.'
    case 403:
      return 'This account cannot admit people. Ask an owner or admin to assign you to this event.'
    case 404:
      return 'No ticket matches that for any event you are assigned to. Do not admit; check the code or ask a supervisor.'
    case 429:
      return 'Too many lookups in a short time. Wait a moment, then try again.'
    default:
      return 'The lookup failed. Nothing was admitted. Try again.'
  }
}

/**
 * What to tell a steward when a confirmation is not answered with a result.
 *
 * @param {number} status The HTTP status, or 0 for no answer.
 * @param {string|null} [reason] The refusal code, for a 409.
 * @returns {{sentence: string, lookAgain: boolean, uncertain: boolean}} What to say and what to offer.
 */
export function confirmFailure(status, reason = null) {
  if (status === 0) {
    return {
      sentence:
        'No answer from the server, so this may or may not have admitted them. Retry — a ticket cannot be admitted twice, and the answer will say which it was.',
      lookAgain: false,
      uncertain: true,
    }
  }

  if (status === 409) {
    return {
      sentence: refusalSentence(reason),
      lookAgain: LOOK_AGAIN.includes(reason),
      uncertain: false,
    }
  }

  if (status === 403) {
    return {
      sentence: 'You are no longer assigned to this event. Nothing was admitted.',
      lookAgain: false,
      uncertain: false,
    }
  }

  if (status === 404) {
    return {
      sentence: 'That ticket no longer matches. Nothing was admitted. Look it up again.',
      lookAgain: true,
      uncertain: false,
    }
  }

  return { sentence: lookupFailure(status), lookAgain: false, uncertain: false }
}

/**
 * A seat in words, or null for general admission.
 *
 * @param {{section: string|null, row: string|null, label: string}|null} seat The seat.
 * @returns {string|null} The words.
 */
export function seatWords(seat) {
  if (!seat) return null

  return [seat.section, seat.row ? `row ${seat.row}` : null, `seat ${seat.label}`]
    .filter(Boolean)
    .join(', ')
}

/**
 * An instant in the event's own timezone, for a steward standing in it.
 *
 * @param {string|null} iso An ISO timestamp.
 * @param {string} timezone An IANA zone.
 * @returns {string} The formatted time, or an empty string.
 */
export function doorTime(iso, timezone) {
  if (!iso) return ''

  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toISOString()
  }
}
