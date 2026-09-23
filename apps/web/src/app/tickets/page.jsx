/**
 * The tickets somebody holds.
 *
 * ## What this page could not say before
 *
 * `GET /v1/tickets` returned the ticket's own columns and nothing else, so a
 * row could show a status and a reference code: "Ready to use — DE-8F3K2Q".
 * Not which event. Not when, not where, not which tier, not which seat. Every
 * one of those was two or three relations away and none of it was being read.
 * The response carries them now, and this page is what they were for.
 *
 * ## The pass is not on this page
 *
 * A credential is a bearer secret: whoever shows it gets in. It is drawn as a
 * QR code on one ticket's own page, on request, by `TicketPass`, from the
 * holder-only endpoint — and never on a list, where every ticket's pass would
 * be one screenshot. This page does not call that endpoint.
 *
 * The reference code is on the card and is what a steward types when a pass
 * will not scan. It is looked up only by somebody the server lets admit to that
 * event, and it is not the credential.
 *
 * ## Four sections, and no ticket in two of them
 *
 * Coming up, given to you, handed on, past. They are disjoint by construction —
 * `sectionFor` returns exactly one — because a wallet that listed a transferred-in
 * ticket under both "coming up" and "given to you" would tell somebody they hold
 * more tickets than they do, and the arithmetic on a page about admission has to
 * be right. The figure above the sections counts what still admits, across all
 * of them, which is the number somebody actually came here for.
 *
 * @module app/tickets/page
 */

import Link from 'next/link'

import { Empty } from '../../components/page-state.jsx'
import { ReadRefusal } from '../../components/read-refusal.jsx'
import { getMyTickets } from '../../lib/organizer-api.js'
import {
  REACHABLE_STATUSES,
  TICKET_STATUS_WORDS,
  groupTickets,
  usableCount,
  seatText,
  whenText,
  whereText,
} from '../../lib/wallet.js'

export const dynamic = 'force-dynamic'

/**
 * As many tickets as the API gives in one page. The wallet used to read the
 * default twenty and say nothing about the rest; somebody with more than that
 * lost sight of their oldest tickets without being told.
 */
const WALLET_PAGE_SIZE = 100

export const metadata = { title: 'My tickets', robots: { index: false, follow: false } }

/*
 * How each reachable status reads is `TICKET_STATUS_WORDS` in `lib/wallet.js`,
 * shared with the ticket's and the order's pages. Six entries, not nine:
 * `VOID`, `SUPERSEDED` and `CANCELLED` are declared by the database enum and
 * written by no application code anywhere — see {@link REACHABLE_STATUSES} for
 * the audit — so anything not in that table renders as its raw value, which is
 * what a demo database's seeded `VOID` gets.
 */

/** Chip classes per tone, from the semantic token layer. */
const TONE = Object.freeze({
  success: 'bg-status-success-soft text-status-success',
  pending: 'bg-status-pending-soft text-status-pending',
  info: 'bg-status-info-soft text-status-info',
  danger: 'bg-status-danger-soft text-status-danger',
})

/**
 * A status chip.
 *
 * The word carries the meaning; the colour only repeats it. Somebody who cannot
 * tell the two greens apart reads the same sentence as everybody else.
 *
 * @param {object} props Component props.
 * @param {string} props.status The ticket status.
 * @returns {JSX.Element} The chip.
 */
function StatusChip({ status }) {
  // A status the application cannot produce keeps its own name. The reachable
  // set is asserted against this table in `wallet.test.js`, so the two cannot
  // drift apart without something going red.
  const known = REACHABLE_STATUSES.includes(status)
  const meaning = known ? TICKET_STATUS_WORDS[status] : { label: status, tone: 'info' }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        TONE[meaning.tone]
      }`}
    >
      {meaning.label}
    </span>
  )
}

/**
 * One line of a card's detail list, omitted entirely when there is nothing to say.
 *
 * An empty definition list row is worse than a missing one: it reads as a fact
 * the system failed to look up rather than one that does not apply.
 *
 * @param {object} props Component props.
 * @param {string} props.term What it is.
 * @param {string} props.children The value.
 * @returns {JSX.Element|null} The row, or nothing.
 */
function Detail({ term, children }) {
  if (!children) return null

  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-ink-subtle">{term}</dt>
      <dd className="font-medium text-ink">{children}</dd>
    </div>
  )
}

/**
 * One ticket.
 *
 * The event's title is the link and the heading, because the thing somebody is
 * looking for is the night out, not the reference code. The code is still here,
 * in a monospace run, because it is what a steward asks for.
 *
 * @param {object} props Component props.
 * @param {object} props.ticket A row from `GET /v1/tickets`.
 * @returns {JSX.Element} The card.
 */
function TicketCard({ ticket }) {
  const when = whenText(ticket)
  const where = whereText(ticket)
  const seat = seatText(ticket)

  return (
    <li className="rounded-card border border-line bg-surface p-4 transition-shadow duration-(--duration-base) focus-within:ring-2 focus-within:ring-focus sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h3 className="text-base font-semibold text-ink sm:text-lg">
          <Link
            href={`/tickets/${ticket.id}`}
            className="rounded-sm underline decoration-accent-line underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          >
            {ticket.event.title}
          </Link>
        </h3>
        <StatusChip status={ticket.status} />
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Detail term="When">{when}</Detail>
        <Detail term="Where">{where}</Detail>
        <Detail term="Ticket">{ticket.tier?.name ?? ''}</Detail>
        <Detail term="Seat">{seat}</Detail>
        <Detail term="Attendee">{ticket.attendeeName ?? ''}</Detail>
        <Detail term="Reference">
          <span className="font-mono">{ticket.code}</span>
        </Detail>
        <Detail term="Order">{ticket.orderReference ?? ''}</Detail>
      </dl>

      {ticket.pendingTransfer ? (
        <p className="mt-3 text-sm text-ink-muted">
          Offered to{' '}
          <span className="font-medium text-ink">{ticket.pendingTransfer.toEmailMasked}</span>. It
          is still yours until they accept.
        </p>
      ) : null}

      {ticket.admissionRefusal ? (
        <p className="mt-3 text-sm text-ink-muted">{ticket.admissionRefusal}</p>
      ) : null}

      {ticket.revokedReason ? (
        <p className="mt-1 text-sm text-ink-muted">Reason given: {ticket.revokedReason}</p>
      ) : null}
    </li>
  )
}

/**
 * The list.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function MyTicketsPage() {
  let tickets = []
  let pagination = null
  let failure = null

  try {
    ;({ tickets, pagination } = await getMyTickets({ perPage: WALLET_PAGE_SIZE }))
  } catch (error) {
    // A privileged account with no second factor is refused even its own
    // wallet; `ReadRefusal` sends it to set one up rather than printing the
    // API's endpoint-naming message.
    failure = error
  }

  const groups = groupTickets(tickets)
  const usable = usableCount(groups)

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">My tickets</h1>
      <p className="mt-2 text-ink-muted">
        Everything issued to this account. Open one to show it at the door, hand it on, or see where
        it has been.
      </p>

      {failure ? (
        <ReadRefusal error={failure} what="Your tickets" action="see your tickets" />
      ) : null}

      {!failure && tickets.length === 0 ? (
        <Empty
          title="No tickets on this account"
          description="Anything you buy, or anything somebody hands to you, appears here."
        />
      ) : null}

      {pagination?.hasNextPage ? (
        <p className="mt-4 rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink">
          This page shows the {tickets.length} most recently issued of the {pagination.total}{' '}
          tickets on this account. Older ones are not listed here.
        </p>
      ) : null}

      {tickets.length > 0 ? (
        <p className="mt-4 text-sm text-ink-muted">
          {usable === 1 ? 'One ticket still gets you in.' : `${usable} tickets still get you in.`}
        </p>
      ) : null}

      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`wallet-${group.id}`} className="mt-8">
          <h2 id={`wallet-${group.id}`} className="text-lg font-semibold text-ink">
            {group.label}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{group.description}</p>
          <ul className="mt-4 grid gap-3">
            {group.tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
