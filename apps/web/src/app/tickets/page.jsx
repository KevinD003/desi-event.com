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
 * The same goes for a group pass, which lets in every ticket on an order at
 * once. This page lists the orders that have one — two to fifty tickets this
 * account bought and still holds, that admit — and links to the order's page,
 * where the pass is drawn on request. When the list is cut short, how many a
 * group pass admits is left to the order's page rather than counted from part
 * of the tickets.
 *
 * ## Tickets booked to pay at the door
 *
 * A ticket that still owes its price says so in its chip — "Pay at the door:
 * $40.00" in place of "Ready to use" — and how; one cancelled because nobody
 * paid for it says who cancelled it and when; one paid at the door and later
 * refunded or withdrawn says that money is with the organiser. A group pass
 * card says what the buyer's own tickets on it still owe at the door. The
 * words come from `lib/wallet.js`, shared with the ticket's page.
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
import {
  PageHeader,
  PosterThumb,
  SECONDARY_LINK,
  Section,
  TEXT_LINK,
} from '../../components/workspace-kit.jsx'
import { getMyTickets } from '../../lib/organizer-api.js'
import { joinLinkHost, sessionDisplayLabel } from '../../lib/sessions.js'
import { StatusChip } from '../account/orders/status-chip.jsx'
import { formatAmount } from '../../lib/pricing.js'
import {
  groupPassSummaries,
  groupTickets,
  ticketChip,
  usableCount,
  seatText,
  venuePaymentNotes,
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
 * shared with the ticket's and the order's pages. Seven entries, not nine:
 * `VOID` and `SUPERSEDED` are declared by the database enum and written by no
 * application code anywhere — see `REACHABLE_STATUSES` for the audit — so
 * anything not in that table renders as its raw value, which is what a demo
 * database's seeded `VOID` gets. A ticket withdrawn because its night was
 * cancelled or its event deleted (`CANCELLED`) reads "Withdrawn — this ticket
 * no longer works at the door". `ticketChip` reads that table,
 * and puts a ticket's door payment first when it says more (SPEC3 §12.7).
 *
 * The word carries the meaning; the colour and the glyph only repeat it.
 * Somebody who cannot tell the two greens apart reads the same sentence as
 * everybody else.
 */

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
    <div className="min-w-0">
      <dt className="text-xs font-medium text-ink-subtle">{term}</dt>
      <dd className="mt-0.5 font-medium break-words text-ink">{children}</dd>
    </div>
  )
}

/**
 * One ticket, as a wallet card.
 *
 * The event's title is the link and the heading, because the thing somebody is
 * looking for is the night out, not the reference code. The code is still here,
 * in a monospace run, because it is what a steward asks for.
 *
 * The event's poster runs down the card's edge — across its top on a phone —
 * so a wallet of several nights can be scanned by picture before it is read.
 *
 * A ticket that still admits carries a way straight to its pass. The pass is
 * not drawn here — see the module comment — the link goes to the ticket's own
 * page, to the section where the holder asks for it.
 *
 * @param {object} props Component props.
 * @param {object} props.ticket A row from `GET /v1/tickets`.
 * @returns {JSX.Element} The card.
 */
function TicketCard({ ticket }) {
  const when = whenText(ticket)
  const where = whereText(ticket)
  const seat = seatText(ticket)
  const doorNotes = venuePaymentNotes(ticket)

  return (
    <li className="flex flex-col overflow-hidden rounded-card border border-line bg-surface-raised shadow-card transition-shadow duration-(--duration-base) ease-standard focus-within:ring-2 focus-within:ring-focus focus-within:ring-offset-2 hover:shadow-card-hover sm:flex-row">
      {/* The same poster as the event's own page: the slug picks the colours
          and arrangement, the category the scene. */}
      <PosterThumb
        event={{
          slug: ticket.event.slug,
          title: ticket.event.title,
          category: ticket.event.category,
          coverImage: ticket.event.coverImage ?? null,
        }}
        className="h-28 sm:h-auto sm:w-44"
      />

      <div className="min-w-0 flex-1 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h3 className="text-lg font-semibold text-ink sm:text-xl">
            <Link href={`/tickets/${ticket.id}`} className={TEXT_LINK}>
              {ticket.event.title}
            </Link>
          </h3>
          <StatusChip meaning={ticketChip(ticket)} />
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Detail term="When">{when}</Detail>
          <Detail term="Night">{ticket.session ? sessionDisplayLabel(ticket.session) : ''}</Detail>
          <Detail term="Where">{where}</Detail>
          <Detail term="Ticket">{ticket.tier?.name ?? ''}</Detail>
          <Detail term="Seat">{seat}</Detail>
          <Detail term="Attendee">{ticket.attendeeName ?? ''}</Detail>
          <Detail term="Reference">
            <span className="font-mono">{ticket.code}</span>
          </Detail>
          <Detail term="Order">{ticket.orderReference ?? ''}</Detail>
        </dl>

        {doorNotes.map((note) => (
          <p key={note} className="mt-4 text-sm text-ink">
            {note}
          </p>
        ))}

        {ticket.pendingTransfer ? (
          <p className="mt-4 text-sm text-ink-muted">
            Offered to{' '}
            <span className="font-medium text-ink">{ticket.pendingTransfer.toEmailMasked}</span>. It
            is still yours until they accept.
          </p>
        ) : null}

        {ticket.admissionRefusal ? (
          <p className="mt-4 text-sm text-ink-muted">{ticket.admissionRefusal}</p>
        ) : null}

        {ticket.revokedReason ? (
          <p className="mt-1 text-sm text-ink-muted">Reason given: {ticket.revokedReason}</p>
        ) : null}

        {/* The joining link of an online event, given by the server only while
            this ticket admits. Named by its host; no referrer goes with it. */}
        {ticket.onlineJoinUrl && joinLinkHost(ticket.onlineJoinUrl) ? (
          <p className="mt-4">
            <a
              href={ticket.onlineJoinUrl}
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              className={SECONDARY_LINK}
            >
              Join online at {joinLinkHost(ticket.onlineJoinUrl)}
              <span className="sr-only"> for {ticket.event.title}</span>
            </a>
          </p>
        ) : null}

        {/* Whether it admits is the server's word, from the same function the
            door runs; the page does not work it out. */}
        {ticket.admits ? (
          <p className="mt-4">
            <Link href={`/tickets/${ticket.id}#entry-pass`} className={SECONDARY_LINK}>
              Show my entry pass
              <span className="sr-only"> for {ticket.event.title}</span>
            </Link>
          </p>
        ) : null}
      </div>
    </li>
  )
}

/**
 * One order's group pass, as a wallet card: a way to it, never the pass.
 *
 * @param {object} props Component props.
 * @param {object} props.summary The order and what it admits, from `groupPassSummaries`.
 * @param {boolean} props.partial Whether the page lists only some of this account's tickets.
 * @returns {JSX.Element} The card.
 */
function GroupPassCard({ summary, partial }) {
  const title = summary.event?.title ?? `Order ${summary.orderReference}`
  const when = whenText(summary)

  return (
    <li className="rounded-card border border-line bg-surface-raised p-4 shadow-card sm:p-5">
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-sm text-ink-muted">
        {[when, `Order ${summary.orderReference}`].filter(Boolean).join(' · ')}
      </p>
      <p className="mt-3 text-sm font-medium text-ink">
        {partial ? 'Group pass' : `Group pass (admits ${summary.admits})`}
      </p>
      {partial ? (
        <p className="mt-1 text-sm text-ink-muted">
          Not every ticket on this account is listed here, so how many it admits is on the order’s
          page.
        </p>
      ) : null}
      {summary.unpaidCents > 0 && !partial ? (
        <p className="mt-1 text-sm text-ink">
          Pay {formatAmount(summary.unpaidCents, summary.currency)} at the door for the tickets
          still unpaid.
        </p>
      ) : null}
      <p className="mt-4">
        <Link
          href={`/account/orders/${encodeURIComponent(summary.orderReference)}#group-pass`}
          className={SECONDARY_LINK}
        >
          Show group pass
          <span className="sr-only"> for {title}</span>
        </Link>
      </p>
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
  const groupPasses = groupPassSummaries(tickets)
  const partial = Boolean(pagination?.hasNextPage)

  return (
    <div>
      <PageHeader
        eyebrow="Your account"
        title="My tickets"
        description="Everything issued to this account. Open one to show it at the door, hand it on, or see where it has been."
      />

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
        <p className="mt-6 rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink">
          This page shows the {tickets.length} most recently issued of the {pagination.total}{' '}
          tickets on this account. Older ones are not listed here.
        </p>
      ) : null}

      {tickets.length > 0 ? (
        <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-ink">
          <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
          {usable === 1 ? 'One ticket still gets you in.' : `${usable} tickets still get you in.`}
        </p>
      ) : null}

      {groupPasses.length > 0 ? (
        <Section
          id="wallet-group-passes"
          title="Group passes"
          description="One QR for each order below that lets in every ticket on it you still hold, for arriving together. Each ticket keeps its own pass as well."
          className="mt-8"
        >
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {groupPasses.map((summary) => (
              <GroupPassCard key={summary.orderReference} summary={summary} partial={partial} />
            ))}
          </ul>
        </Section>
      ) : null}

      {groups.map((group, index) => (
        <Section
          key={group.id}
          id={`wallet-${group.id}`}
          title={group.label}
          description={group.description}
          className={index === 0 && groupPasses.length === 0 ? 'mt-8' : 'mt-12'}
        >
          <ul className="mt-4 grid gap-4">
            {group.tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </ul>
        </Section>
      ))}
    </div>
  )
}
