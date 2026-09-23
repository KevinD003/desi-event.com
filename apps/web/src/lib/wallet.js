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
 * @module lib/wallet
 */

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
 * six of them:
 *
 * | State              | Written by                                                   |
 * | ------------------ | ------------------------------------------------------------ |
 * | `VALID`            | checkout issuance, the worker's bulk issuance, a minted transfer, and a returned invitation |
 * | `TRANSFER_PENDING` | `startTransfer`                                              |
 * | `CHECKED_IN`       | `admit`                                                      |
 * | `TRANSFERRED`      | `acceptTransfer`, on the sender's row                        |
 * | `REVOKED`          | `revokeTicket`                                               |
 * | `REFUNDED`         | the refund service, by its own conditional update            |
 *
 * `VOID`, `SUPERSEDED` and `CANCELLED` have **no writer at all**. Two of them
 * are declared as legal targets in the transition table and one is not even
 * that; there is no reissue endpoint, and cancelling an event raises refunds
 * and notifications without touching a `Ticket` row. A wallet that offered a
 * polished sentence for each of them would be describing a product that does
 * not exist.
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
})

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
   * Sort by the event's start.
   *
   * @param {WalletTicket[]} rows The rows.
   * @param {number} direction 1 for soonest first, -1 for latest first.
   * @returns {WalletTicket[]} The same rows, ordered.
   */
  const byStart = (rows, direction) =>
    [...rows].sort(
      (a, b) =>
        direction * (Date.parse(a.event?.startsAt ?? '') - Date.parse(b.event?.startsAt ?? '')),
    )

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
