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
 * ## Money taken at the door
 *
 * A ticket booked to pay at the venue owes its price at the door (SPEC3 §9.3).
 * The preview says what to take; the steward takes it and admits in one step,
 * and the confirmation records the payment with the admission. The sentences
 * for that, and for what the cancellation and deletion screens say about money
 * taken at the door (the organiser holds it, never The Desi Events, SPEC3 §9.7),
 * are here too, so every screen says it the same way. Amounts arrive in cents
 * and are written with `formatAmount`, in the order's or event's currency.
 *
 * @module lib/door
 */

import { formatAmount } from './pricing.js'

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
  EVENT_DELETED: 'This event was taken off The Desi Events. Nobody is admitted to it.',
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
 * Refusals the door names in a heading of their own, rather than the plain
 * "Do not admit" (SPEC3-XI §12.8).
 *
 * @type {Readonly<Record<string, string>>}
 */
export const REFUSAL_HEADINGS = Object.freeze({
  UNPAID_CANCELLED: 'Cancelled — not paid',
})

/**
 * The heading for a refusal, or null when it has none of its own.
 *
 * @param {string|null|undefined} code A refusal code.
 * @returns {string|null} The heading.
 */
export function refusalHeading(code) {
  return REFUSAL_HEADINGS[code] ?? null
}

/**
 * The API's refusals of a payment taken at the door (SPEC3 §9.3). Not
 * admission refusals: an amount due is a state of the ticket, not a reason it
 * may never be let in. Each is answered by looking the ticket up again.
 *
 * @type {ReadonlyArray<string>}
 */
export const PAYMENT_REFUSALS = Object.freeze([
  'PAYMENT_DUE',
  'PAYMENT_AMOUNT_MISMATCH',
  'PAYMENT_NOT_RECORDED',
])

/**
 * What to say for a payment refusal whose answer carried no sentence. The API
 * always sends its own; these keep the screen honest when it did not arrive.
 *
 * @type {Readonly<Record<string, string>>}
 */
const PAYMENT_FALLBACKS = Object.freeze({
  PAYMENT_DUE: 'Take the payment for this ticket before letting it in.',
  PAYMENT_AMOUNT_MISMATCH:
    "The amount doesn't match what this ticket owes. Look the ticket up again.",
  PAYMENT_NOT_RECORDED:
    'The payment was not recorded because the booking changed at the same moment. Look the ticket up again; nothing was recorded and nobody was let in.',
})

/**
 * A confirmation that took a payment and got no answer (SPEC3 §12.8): urgent,
 * because the steward is holding somebody's money.
 *
 * @type {string}
 */
export const PAYMENT_NO_ANSWER =
  'No answer from the server. The payment may or may not have been recorded, and the ticket may or may not be in. Keep the money in hand and press Retry: it cannot record the payment twice.'

/**
 * A ticket that owed a payment, found admitted by somebody else on retry or
 * on confirmation (SPEC3 §12.8).
 *
 * @type {string}
 */
export const ANOTHER_STEWARD_PAID =
  'Already admitted by another steward. Their payment record covers this ticket; do not take the money again.'

/** A ticket paid at the door on an earlier night, which admits as usual. */
export const PAID_EARLIER = 'Paid at the door earlier'

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
 * What a steward is told when the door was busy (503) and the API sent no
 * sentence of its own.
 *
 * @type {string}
 */
export const DOOR_BUSY =
  'Another change to this booking was being saved at the same moment, so nobody was let in and no payment was recorded. Look it up again in a moment.'

/**
 * What to tell a steward when a confirmation is not answered with a result.
 *
 * A refusal of the payment (`PAYMENT_DUE`, `PAYMENT_AMOUNT_MISMATCH`,
 * `PAYMENT_NOT_RECORDED`) is said in the API's own sentence, which names the
 * amount, and is answered by looking the ticket up again. No answer at all,
 * when a payment was being taken, is said as the money it is (SPEC3 §12.8).
 *
 * @param {number} status The HTTP status, or 0 for no answer.
 * @param {string|null} [reason] The admission refusal code, for a 409.
 * @param {object} [refusal] More of the answer.
 * @param {string|null} [refusal.code] The error code.
 * @param {string|null} [refusal.message] The API's sentence.
 * @param {boolean} [refusal.payment] Whether the confirmation was taking a payment.
 * @returns {{sentence: string, lookAgain: boolean, uncertain: boolean, reason: string|null}} What to say and what to offer.
 */
export function confirmFailure(status, reason = null, refusal = {}) {
  const { code = null, message = null, payment = false } = refusal ?? {}

  if (status === 0) {
    return {
      sentence: payment
        ? PAYMENT_NO_ANSWER
        : 'No answer from the server, so this may or may not have admitted them. Retry — a ticket cannot be admitted twice, and the answer will say which it was.',
      lookAgain: false,
      uncertain: true,
      reason: null,
    }
  }

  if (code && PAYMENT_REFUSALS.includes(code)) {
    const said = typeof message === 'string' ? message.trim() : ''

    return {
      sentence: said || PAYMENT_FALLBACKS[code],
      lookAgain: true,
      uncertain: false,
      reason: code,
    }
  }

  // Busy: the confirmation waited as long as the door may behind another
  // change to the booking or the night, and nothing of it was kept — nobody
  // let in, no payment recorded. Said in the API's own words, and answered by
  // looking the ticket up again; never logged as a refusal.
  if (status === 503) {
    const said = typeof message === 'string' ? message.trim() : ''

    return { sentence: said || DOOR_BUSY, lookAgain: true, uncertain: false, reason: null }
  }

  if (status === 409) {
    return {
      sentence: refusalSentence(reason),
      lookAgain: LOOK_AGAIN.includes(reason),
      uncertain: false,
      reason,
    }
  }

  if (status === 403) {
    return {
      sentence: 'You are no longer assigned to this event. Nothing was admitted.',
      lookAgain: false,
      uncertain: false,
      reason: null,
    }
  }

  if (status === 404) {
    return {
      sentence: 'That ticket no longer matches. Nothing was admitted. Look it up again.',
      lookAgain: true,
      uncertain: false,
      reason: null,
    }
  }

  return { sentence: lookupFailure(status), lookAgain: false, uncertain: false, reason: null }
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

/**
 * How many tickets, in words.
 *
 * @param {number} count How many.
 * @returns {string} "ticket" or "tickets".
 */
function ticketWord(count) {
  return count === 1 ? 'ticket' : 'tickets'
}

/**
 * What to take for one ticket at the door (SPEC3 §12.8).
 *
 * @param {number} dueCents What the ticket owes.
 * @param {string} currency The order's currency.
 * @returns {string} The sentence.
 */
export function takePaymentSentence(dueCents, currency) {
  return `Take ${formatAmount(dueCents, currency)} for this ticket before letting them in.`
}

/**
 * What else of the booking the same holder still owes at the door, for
 * information (SPEC3-XI §12.8): only the holder's own tickets are counted, and
 * the group pass is suggested only when it covers them, which it does when the
 * holder is the buyer.
 *
 * @param {{otherUnpaidTickets: number, otherUnpaidCents: number, groupPass?: boolean}|null|undefined} booking The preview's `payment.booking`.
 * @param {string} currency The order's currency.
 * @returns {string|null} The sentence, or null when nothing else is owed.
 */
export function bookingOwesSentence(booking, currency) {
  const count = booking?.otherUnpaidTickets ?? 0

  if (count < 1) return null

  const owes = `This booking has ${count} more ${ticketWord(count)} to pay at the door (${formatAmount(booking.otherUnpaidCents ?? 0, currency)}).`

  return booking.groupPass
    ? `${owes} Use the group pass to take payment for several at once.`
    : owes
}

/**
 * The booking's tickets now held by other people that still owe, who pay at
 * the door with their own tickets (SPEC3-XI §12.8).
 *
 * @param {number|null|undefined} count `payment.handedOnUnpaidTickets`.
 * @returns {string|null} The sentence, or null for none.
 */
export function handedOnUnpaidSentence(count) {
  if (!count || count < 1) return null

  return `${count} more ${ticketWord(count)} of this booking ${count === 1 ? 'was' : 'were'} passed on to other people, who pay at the door with their own ${ticketWord(count)}.`
}

/**
 * The button that records the payment and admits, in one step.
 *
 * @param {string} amount The amount, written.
 * @param {object} [options] Options.
 * @param {boolean} [options.retry] Whether this repeats a confirmation that got no answer.
 * @param {number|null} [options.count] For a group, how many are admitted.
 * @returns {string} The label.
 */
export function admitWithPaymentLabel(amount, { retry = false, count = null } = {}) {
  const admit = count === null ? 'admit' : `admit ${count}`

  return retry ? `Retry: payment taken ${amount} — ${admit}` : `Payment taken: ${amount} — ${admit}`
}

/**
 * What a group still owes for the tickets ticked, said as the ticks change.
 *
 * @param {string} amount The amount, written.
 * @returns {string} The line.
 */
export function groupPaymentLine(amount) {
  return `Payment to take for the ticked tickets: ${amount}`
}

/**
 * An admission that recorded a payment, or found it recorded on a retry by
 * this steward (SPEC3 §12.8).
 *
 * @param {string} amount The amount, written.
 * @param {object} [options] Options.
 * @param {boolean} [options.retried] Whether the retry found it already done.
 * @returns {string} The sentence.
 */
export function paymentRecordedSentence(amount, { retried = false } = {}) {
  return retried
    ? `Admitted (confirmed on retry). Payment recorded: ${amount}.`
    : `Admitted. Payment recorded: ${amount}.`
}

/**
 * What cancelling an event or a night, or deleting an event, means for
 * bookings made to pay at the venue (SPEC3 §9.7): only their booking fee paid
 * online is refunded to them, simulated, and money taken at the door stays
 * with the organiser, who holds it.
 *
 * The first sentence is about the refund, so it is left out where nothing is
 * refunded (`refunds: false`, a deletion that only takes down the page of an
 * event that took place); the second is true whatever happens.
 *
 * @param {{orders: number, ticketsPaidAtDoor: number, paidAtDoorCents: number}|null|undefined} atVenue The preview's facts.
 * @param {string} [currency] The event's currency.
 * @param {object} [options] Options.
 * @param {boolean} [options.refunds] Whether the step refunds the bookings' online part.
 * @returns {string[]} The sentences, none when no booking was made to pay at the venue.
 */
export function atVenueSentences(atVenue, currency = 'USD', { refunds = true } = {}) {
  if (!atVenue) return []

  const sentences = []

  if (refunds && (atVenue.orders ?? 0) > 0) {
    sentences.push(
      'For tickets paid at the venue, only the booking fee paid online is refunded (simulated).',
    )
  }

  if ((atVenue.ticketsPaidAtDoor ?? 0) > 0) {
    sentences.push(
      `Payment taken at the door for ${atVenue.ticketsPaidAtDoor} of these tickets (${formatAmount(atVenue.paidAtDoorCents ?? 0, currency)}) is held by the organiser. The Desi Events does not hold it and cannot refund it.`,
    )
  }

  return sentences
}
