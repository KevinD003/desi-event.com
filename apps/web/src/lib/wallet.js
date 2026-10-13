/**
 * Arranging somebody's tickets into the order a person would look for them.
 *
 * ## Why this is a module and not a few lines in the page
 *
 * Every rule here is a claim about what a ticket *is* — whether it still gets
 * you in, whether the night has been and gone, whether you still hold it — and
 * each one has a plausible wrong version. A ticket for an event that started an
 * hour ago is not "past" to somebody standing outside the venue. A handed-on
 * ticket is not "past" at all; it is still on the order that bought it and it
 * belongs in a different part of the page from the one you are about to use.
 *
 * Pure functions over the payload, so those claims can be tested without a
 * browser, a database or a session.
 *
 * ## What is not decided here
 *
 * Whether a ticket admits anybody. The server said so — `admits` and
 * `admissionRefusal` come from the same function the door runs — and a second
 * opinion computed in a browser is how a wallet and a scanner start disagreeing
 * in front of a queue.
 *
 * ## Tickets booked to pay at the door (SPEC3 §12.7, SPEC3-XI §12.7)
 *
 * A ticket that still owes its price reads "Pay at the door: {amount}" instead
 * of "Ready to use", whoever holds it: what is due stays with the ticket when it
 * is passed on, and it is offered on like any other ticket. One cancelled
 * because nobody paid for it reads "Cancelled — not paid", with who cancelled
 * it, when and the reason they gave. A holder who paid at the door for a ticket later refunded or
 * withdrawn is told that money is with the organiser. Every figure comes from
 * the ticket's own `venuePayment`, which the server writes.
 *
 * @module lib/wallet
 */

import { formatEventDate } from './format.js'
import { formatAmount } from './pricing.js'

/**
 * @typedef {object} WalletTicket
 * @property {string} id The ticket id.
 * @property {string} status Its state.
 * @property {boolean} admits Whether it would open a door now.
 * @property {string} holderRelationship `PURCHASED` or `RECEIVED`.
 * @property {{startsAt: string, endsAt: string}} event When it is for.
 */

/**
 * @typedef {object} WalletGroup
 * @property {string} id A stable key, also used as the heading's id.
 * @property {string} label The section heading.
 * @property {string} description One sentence saying what is in it.
 * @property {WalletTicket[]} tickets Its rows.
 */

/** Handed to somebody else. Still the buyer's purchase; no longer their ticket. */
const TRANSFERRED = 'TRANSFERRED'

/**
 * The ticket states this application can actually put a ticket into.
 *
 * ## Why this is a shorter list than the enum
 *
 * `TicketStatus` declares nine values. An audit of every writer in
 * `apps/api/src`, `apps/worker/src` and `packages/*` found application code for
 * seven of them:
 *
 * | State              | Written by                                                   |
 * | ------------------ | ------------------------------------------------------------ |
 * | `VALID`            | checkout issuance, the worker's bulk issuance, a minted transfer, and a returned invitation |
 * | `TRANSFER_PENDING` | `startTransfer`                                              |
 * | `CHECKED_IN`       | `admit`                                                      |
 * | `TRANSFERRED`      | `acceptTransfer`, on the sender's row                        |
 * | `REVOKED`          | `revokeTicket`                                               |
 * | `REFUNDED`         | the refund service, by its own conditional update            |
 * | `CANCELLED`        | `withdrawTickets`, when a night is cancelled or an event deleted (`apps/api/src/lib/tickets.js`) |
 *
 * `VOID` and `SUPERSEDED` have **no writer at all**; there is no reissue
 * endpoint. A wallet that offered a polished sentence for either would be
 * describing a product that does not exist.
 *
 * ## What happens to a state that is not here
 *
 * It renders as its raw value. That is deliberate rather than defensive: the
 * demo seed writes `VOID` directly, so a demo database really can contain one,
 * and showing `VOID` unadorned is honest where "This ticket is void." would
 * imply the application can produce it and knows what it means. If a later
 * phase implements event cancellation against tickets, the test beside this
 * constant is what will ask for the label.
 *
 * @type {ReadonlyArray<string>}
 */
export const REACHABLE_STATUSES = Object.freeze([
  'VALID',
  'TRANSFER_PENDING',
  'CHECKED_IN',
  'TRANSFERRED',
  'REVOKED',
  'REFUNDED',
  'CANCELLED',
])

/**
 * How each reachable ticket status reads, in one place.
 *
 * The wallet, a ticket's page and an order's page all name a ticket's state,
 * and they used to keep their own copies of these words; a copy is a word that
 * changes in one place and not the other. Keyed by {@link REACHABLE_STATUSES},
 * and a test holds the two sets equal.
 *
 * The sentence is the words only. Whether a ticket admits anybody comes from
 * the server, on the row, from the same function the door runs.
 *
 * @type {Readonly<Record<string, {label: string, tone: string}>>}
 */
export const TICKET_STATUS_WORDS = Object.freeze({
  VALID: { label: 'Ready to use', tone: 'success' },
  TRANSFER_PENDING: { label: 'Offered — still yours until they accept', tone: 'pending' },
  TRANSFERRED: { label: 'Handed on', tone: 'info' },
  CHECKED_IN: { label: 'Used — you went in', tone: 'info' },
  REVOKED: { label: 'Withdrawn by the organiser', tone: 'danger' },
  REFUNDED: { label: 'Refunded', tone: 'info' },
  CANCELLED: { label: 'Withdrawn — this ticket no longer works at the door', tone: 'danger' },
})

/** The states in which a ticket that owes its price can still be paid for at the door. */
const OWING_STATUSES = new Set(['VALID', 'TRANSFER_PENDING'])

/**
 * Whether a ticket still owes its price at the door: booked to pay there, not
 * paid, not cancelled, and still one that admits.
 *
 * @param {object} ticket A ticket with `status` and `venuePayment`.
 * @returns {boolean} True when its holder pays at the door.
 */
export function owesAtDoor(ticket) {
  const venue = ticket?.venuePayment ?? null

  return Boolean(venue) && !venue.paid && !venue.cancelled && OWING_STATUSES.has(ticket.status)
}

/**
 * The chip for a ticket booked to pay at the door, when it says more than the
 * ticket's status: "Pay at the door: {amount}" in place of "Ready to use", and
 * "Cancelled — not paid" for one cancelled because it was not paid for.
 *
 * @param {object} ticket A ticket with `status` and `venuePayment`.
 * @returns {{label: string, tone: string}|null} The chip, or null when the status word stands.
 */
export function venuePaymentChip(ticket) {
  const venue = ticket?.venuePayment ?? null

  if (!venue) return null
  if (venue.cancelled) return { label: 'Cancelled — not paid', tone: 'neutral' }

  if (owesAtDoor(ticket)) {
    return {
      label: `Pay at the door: ${formatAmount(venue.dueCents, venue.currency)}`,
      tone: 'pending',
    }
  }

  return null
}

/**
 * What a ticket's chip says: its door payment when that says more, else its
 * status in the words every page shares.
 *
 * @param {object} ticket A ticket with `status` and, when booked to pay at the door, `venuePayment`.
 * @returns {{label: string, tone: string}} The chip's words and tone.
 */
export function ticketChip(ticket) {
  const venue = venuePaymentChip(ticket)

  if (venue) return venue

  return REACHABLE_STATUSES.includes(ticket?.status)
    ? TICKET_STATUS_WORDS[ticket.status]
    : { label: String(ticket?.status ?? 'Unknown'), tone: 'info' }
}

/**
 * Statuses after which money paid at the door has to come back from the
 * organiser: refunded, withdrawn (`tickets.revoke`), and withdrawn because its
 * night was cancelled or its event deleted, which the API writes as CANCELLED
 * (`withdrawTickets`) until a refund, if there is one, settles it as REFUNDED.
 * A ticket cancelled because it was not paid for carries `venuePayment.cancelled`
 * and is never paid, so it cannot reach this rule.
 */
const ENDED_STATUSES = new Set(['REFUNDED', 'REVOKED', 'CANCELLED'])

/**
 * The sentences a ticket booked to pay at the door carries, on its wallet card
 * and its page (SPEC3 §12.7, SPEC3-XI §12.7): for one cancelled because it was
 * not paid for, who cancelled it and when, then the reason given.
 *
 * @param {object} ticket A ticket with `status`, `venuePayment` and its `event` (for the timezone).
 * @param {string} [timeZone] The event's timezone, when the ticket does not carry its event.
 * @returns {string[]} The sentences, in order; empty for a ticket with nothing owed at the door.
 */
export function venuePaymentNotes(ticket, timeZone = ticket?.event?.timezone || 'UTC') {
  const venue = ticket?.venuePayment ?? null

  if (!venue) return []

  const due = formatAmount(venue.dueCents, venue.currency)

  if (venue.cancelled) {
    const by = venue.cancelled.by === 'DESI_EVENT' ? 'The Desi-Event team' : 'The organiser'
    const reason = typeof venue.cancelled.reason === 'string' ? venue.cancelled.reason.trim() : ''

    // The reason given, as the buyer's order page words it: whoever holds the
    // ticket reads it here, and somebody it was passed to has nowhere else to
    // read it (SPEC3-XI XU10).
    return [
      `${by} cancelled this ticket on ${formatEventDate(venue.cancelled.at, timeZone)} because it had not been paid for. You no longer owe ${due} for it.`,
      ...(reason ? [`Reason given: “${reason}”`] : []),
    ]
  }

  if (owesAtDoor(ticket))
    return ['Pay this at the door. The steward records it before letting you in.']

  if (venue.paid && venue.paidAtDoorByYou && ENDED_STATUSES.has(ticket.status)) {
    return [
      `The ${due} you paid at the door for this ticket is with the organiser, not with Desi-Event. Ask the organiser to return it.`,
    ]
  }

  if (venue.paid) return ['Paid at the door.']

  return []
}

/**
 * Whether the event this ticket is for has finished.
 *
 * `endsAt` rather than `startsAt`, because a ticket does not become a souvenir
 * when the doors open. Somebody arriving late still needs to find it.
 *
 * @param {WalletTicket} ticket The row.
 * @param {Date} now The instant to judge against.
 * @returns {boolean} True once the event has ended.
 */
export function eventIsOver(ticket, now) {
  const endsAt = Date.parse(ticket.event?.endsAt ?? '')

  if (Number.isNaN(endsAt)) return false

  return endsAt < now.getTime()
}

/**
 * Which section a ticket belongs in.
 *
 * Four buckets, and they are **disjoint** — every ticket lands in exactly one.
 * That is the whole design constraint: a wallet that listed a ticket under both
 * "coming up" and "given to you" would tell somebody they hold more tickets
 * than they do, and the arithmetic on a page about admission has to be right.
 *
 * The order of the tests matters. A handed-on ticket is checked first: it is
 * the one case where the ticket's own state says more about who holds it than
 * about whether it is any good, and putting it under "past" would quietly tell
 * somebody the night is over when what happened is that they gave it away.
 * Then the past, then what is left splits on where it came from.
 *
 * @param {WalletTicket} ticket The row.
 * @param {Date} now The instant to judge against.
 * @returns {string} `handedOn`, `past`, `given` or `upcoming`.
 */
export function sectionFor(ticket, now) {
  if (ticket.status === TRANSFERRED) return 'handedOn'
  if (eventIsOver(ticket, now)) return 'past'
  if (!ticket.admits) return 'past'

  return ticket.holderRelationship === 'RECEIVED' ? 'given' : 'upcoming'
}

/**
 * The sections, in the order they are read, with the empty ones dropped.
 *
 * Upcoming first and sorted soonest-first, because the reason somebody opens
 * this page is almost always the next thing they are going to. Everything else
 * is sorted latest-first, because looking backwards you want the most recent.
 *
 * @param {WalletTicket[]} tickets Every row the API returned.
 * @param {Date} [now] The instant to judge against. Injected so the boundary is testable.
 * @returns {WalletGroup[]} The sections to render.
 */
export function groupTickets(tickets, now = new Date()) {
  const buckets = { upcoming: [], given: [], handedOn: [], past: [] }

  for (const ticket of tickets) buckets[sectionFor(ticket, now)].push(ticket)

  /**
   * When a ticket's night starts: its own night's start, else the event's.
   * A ticket for night 3 of a run sorts with night 3, not with night 1.
   *
   * @param {WalletTicket} row A ticket.
   * @returns {number} Milliseconds since the epoch, or NaN.
   */
  const startOf = (row) => Date.parse(row.session?.startsAt ?? row.event?.startsAt ?? '')

  /**
   * Sort by the night's start.
   *
   * @param {WalletTicket[]} rows The rows.
   * @param {number} direction 1 for soonest first, -1 for latest first.
   * @returns {WalletTicket[]} The same rows, ordered.
   */
  const byStart = (rows, direction) =>
    [...rows].sort((a, b) => direction * (startOf(a) - startOf(b)))

  return [
    {
      id: 'upcoming',
      label: 'Coming up',
      description: 'Tickets you bought. These still get you in.',
      tickets: byStart(buckets.upcoming, 1),
    },
    {
      id: 'given',
      label: 'Given to you',
      description: 'Somebody handed these over. They are yours now, and they still get you in.',
      tickets: byStart(buckets.given, 1),
    },
    {
      id: 'handedOn',
      label: 'Handed on',
      // Every handed-on ticket lands here, bought or received, so the sentence
      // cannot say "you bought these": for a ticket somebody gave you and you
      // passed on, it was false.
      description:
        'Tickets you handed to somebody else, who accepted them. They no longer admit you.',
      tickets: byStart(buckets.handedOn, -1),
    },
    {
      id: 'past',
      label: 'Past and finished',
      description: 'Used, refunded, withdrawn, or the night has been and gone.',
      tickets: byStart(buckets.past, -1),
    },
  ].filter((group) => group.tickets.length > 0)
}

/**
 * How many tickets in these sections still admit their holder.
 *
 * The figure somebody actually wants at the top of the page, and the one a
 * four-section layout makes hard to read at a glance once the sections are
 * disjoint: "coming up" and "given to you" both admit, and counting one without
 * the other understates what somebody holds.
 *
 * @param {WalletGroup[]} groups The sections, as {@link groupTickets} returns them.
 * @returns {number} How many rows across all sections have `admits: true`.
 */
export function usableCount(groups) {
  return groups.reduce(
    (total, group) => total + group.tickets.filter((ticket) => ticket.admits).length,
    0,
  )
}

/**
 * When and where, in one line, in the event's own timezone.
 *
 * The event's timezone rather than the reader's: a ticket for a night in Pune
 * says the time it will be in Pune, because that is the time written on the
 * door. A browser in another timezone rendering its own local time is how
 * somebody turns up on the wrong evening.
 *
 * @param {WalletTicket} ticket The row.
 * @returns {string} A formatted date and time, or an empty string when unparseable.
 */
export function whenText(ticket) {
  const startsAt = Date.parse(ticket.event?.startsAt ?? '')

  if (Number.isNaN(startsAt)) return ''

  // US English, like every other date on the site: "Sat, Oct 17, 2026, 7:30 PM
  // EDT". Still the venue's zone, whatever the reader's.
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: ticket.event.timezone || 'UTC',
    timeZoneName: 'short',
  }).format(new Date(startsAt))
}

/**
 * Where, in one line.
 *
 * @param {WalletTicket} ticket The row.
 * @returns {string} The venue and its city, `Online` for an online event, or an empty string.
 */
export function whereText(ticket) {
  if (ticket.isOnline) return 'Online'
  if (!ticket.venue) return ''

  return [ticket.venue.name, ticket.venue.city].filter(Boolean).join(', ')
}

/**
 * The seat, in one line.
 *
 * @param {WalletTicket} ticket The row.
 * @returns {string} Something like `Stalls, row G, seat 12`, or an empty string for general admission.
 */
export function seatText(ticket) {
  if (!ticket.seat) return ''

  const parts = [ticket.seat.section]

  if (ticket.seat.row) parts.push(`row ${ticket.seat.row}`)

  parts.push(`seat ${ticket.seat.label}`)

  return parts.join(', ')
}

/**
 * The fewest tickets a group pass covers: a mirror of `GROUP_PASS_MIN_TICKETS`
 * in `@desi-event/schemas`, which a browser module may not import. The test
 * beside this module keeps the two equal.
 *
 * @type {number}
 */
export const GROUP_PASS_MIN_TICKETS = 2

/**
 * The most tickets a group pass covers: a mirror of `GROUP_PASS_MAX_TICKETS`.
 *
 * @type {number}
 */
export const GROUP_PASS_MAX_TICKETS = 50

/**
 * @typedef {object} GroupPassSummary
 * @property {string} orderReference The order.
 * @property {object} event Its event, as the wallet row carries it.
 * @property {number} admits How many of its tickets this page lists as still admitting.
 * @property {number} unpaidCents What those tickets still owe at the door: the buyer's own only.
 * @property {string|null} currency The currency of that amount.
 */

/**
 * The orders on this page that have a group pass, and how many each admits.
 *
 * A group pass lets in every ticket on an order that its buyer still holds,
 * so only tickets this account bought (`PURCHASED`) and that would open a door
 * now (`admits`, the server's own answer) count. Nothing is fetched and no
 * pass is drawn here: the pass lives on the order's page, on request.
 *
 * @param {WalletTicket[]} tickets Every row the API returned, with `orderReference`.
 * @returns {GroupPassSummary[]} One entry per order with two to fifty such tickets, soonest first.
 */
export function groupPassSummaries(tickets) {
  const byOrder = new Map()

  for (const ticket of tickets) {
    if (ticket.holderRelationship !== 'PURCHASED' || !ticket.admits || !ticket.orderReference) {
      continue
    }

    const entry = byOrder.get(ticket.orderReference) ?? {
      orderReference: ticket.orderReference,
      event: ticket.event,
      admits: 0,
      unpaidCents: 0,
      currency: null,
    }

    entry.admits += 1

    // The group pass covers the buyer's own tickets only, so what it can take
    // payment for at the door is what those tickets owe.
    if (owesAtDoor(ticket)) {
      entry.unpaidCents += ticket.venuePayment.dueCents
      entry.currency = ticket.venuePayment.currency
    }
    byOrder.set(ticket.orderReference, entry)
  }

  return [...byOrder.values()]
    .filter(
      (entry) => entry.admits >= GROUP_PASS_MIN_TICKETS && entry.admits <= GROUP_PASS_MAX_TICKETS,
    )
    .sort(
      (left, right) =>
        Date.parse(left.event?.startsAt ?? '') - Date.parse(right.event?.startsAt ?? ''),
    )
}
