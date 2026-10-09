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
  EVENT_DELETED: 'This event was taken off Desi-Event. Nobody is admitted to it.',
  SESSION_CANCELLED: 'This night was cancelled. Nobody is admitted to it.',
  WRONG_EVENT: 'This ticket is for a different event.',
  WRONG_NIGHT: 'This ticket is for a different night. Do not admit.',
  NIGHT_REQUIRED:
    'This event has more than one night. Choose the night you are admitting to, then look the ticket up again.',
  PREVIEW_EXPIRED: 'That lookup took too long to confirm. Look the ticket up again.',
  PREVIEW_INVALID: 'That lookup could not be confirmed. Look the ticket up again.',
  PREVIEW_MISMATCH: 'The pass confirmed is not the one looked up. Look it up again.',
  GROUP_CHANGED:
    'Some tickets in this group changed after it was looked up. Look it up again before admitting anyone.',
  // SPEC3-XI §12.8: a ticket booked to pay at the venue, cancelled unpaid.
  UNPAID_CANCELLED: "This ticket was cancelled because it had not been paid for. Don't let it in.",
})

/**
 * Refusal codes after which looking the same ticket up again is the fix.
 *
 * @type {ReadonlyArray<string>}
 */
export const LOOK_AGAIN = Object.freeze([
  'PREVIEW_EXPIRED',
  'PREVIEW_INVALID',
  'PREVIEW_MISMATCH',
  'GROUP_CHANGED',
])

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
  if (entry.authority === 'PLATFORM_ROLE') {
    return 'Any event on the platform (platform administrator)'
  }

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
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toISOString()
  }
}

/**
 * How an event is named in the door's event picker.
 *
 * The organisation is named too when the list spans more than one — the
 * platform super administrator's list does — so two events with one title are
 * never confused.
 *
 * @param {object} entry An admission-events entry: its `event` and, when known, its `organization`.
 * @param {object} [options] Options.
 * @param {boolean} [options.withOrganization] Whether to name the organisation.
 * @returns {string} The label.
 */
export function doorEventLabel(entry, { withOrganization = false } = {}) {
  const when = doorTime(entry.event.startsAt, entry.event.timezone)

  return withOrganization && entry.organization?.name
    ? `${entry.event.title} — ${entry.organization.name} — ${when}`
    : `${entry.event.title} — ${when}`
}

/**
 * The night a door is most likely admitting to: the first night that has not
 * ended — tonight's while it runs, else the next — or the last one when
 * all are over. Only the starting choice: the steward can pick another, and
 * the server checks every ticket against the night that was picked.
 *
 * @param {Array<{id: string, startsAt: string, endsAt: string, status?: string}>} nights The event's nights, soonest first.
 * @param {Date} [now] The moment in question.
 * @returns {string} The night's id, or an empty string when there are none.
 */
export function tonightOf(nights = [], now = new Date()) {
  const open = nights.filter((night) => night.status !== 'CANCELLED')
  const candidates = open.length > 0 ? open : nights
  const current = candidates.find((night) => new Date(night.endsAt).getTime() > now.getTime())

  return (current ?? candidates.at(-1))?.id ?? ''
}

/**
 * A number of tickets in words.
 *
 * @param {number} count How many.
 * @returns {string} "1 ticket" or "3 tickets".
 */
function tickets(count) {
  return `${count} ${count === 1 ? 'ticket' : 'tickets'}`
}

/**
 * What a group lookup found, in one sentence.
 *
 * @param {{counts: {admissible: number, alreadyIn: number, refused: number}, handedOn: number}} preview A group preview.
 * @returns {string} The sentence.
 */
export function groupLookupSentence(preview) {
  const { admissible, alreadyIn, refused } = preview.counts
  const parts = [`${tickets(admissible)} can be admitted`]

  if (alreadyIn > 0) parts.push(`${alreadyIn} already in`)
  if (refused > 0) parts.push(`${refused} refused`)

  const found = `${parts.join(', ')}.`

  if (!preview.handedOn) return found

  return `${found} ${handedOnSentence(preview.handedOn)}`
}

/**
 * Tickets from the order that were handed to other people.
 *
 * @param {number} count How many.
 * @returns {string} The sentence.
 */
export function handedOnSentence(count) {
  return count === 1
    ? '1 ticket from this order was handed to somebody else; they have their own pass.'
    : `${count} tickets from this order were handed to other people; they have their own passes.`
}

/**
 * What a group admission did, in one sentence.
 *
 * @param {{admitted: number, alreadyIn: number}} result A group check-in result.
 * @returns {string} The sentence.
 */
export function groupResultSentence(result) {
  const admitted = `Admitted ${result.admitted}.`

  if (!result.alreadyIn) return admitted

  return `${admitted} ${result.alreadyIn} ${result.alreadyIn === 1 ? 'was' : 'were'} already in.`
}

/**
 * Who a group was, for the door's session list.
 *
 * The first name on the group's tickets and how many more, so the steward
 * reading the list back sees people rather than a ticket with no name. When no
 * ticket carries a name, it says it was a group pass.
 *
 * @param {Array<{attendeeName: string|null}>} tickets The tickets the entry is about.
 * @returns {string} The name for the list.
 */
export function groupSessionName(tickets) {
  const named = tickets.find((ticket) => ticket.attendeeName)?.attendeeName

  if (!named) return 'Group pass'

  const others = tickets.length - 1

  return others > 0 ? `${named} and ${others} more` : named
}
