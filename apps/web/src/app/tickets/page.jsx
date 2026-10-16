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

import { Icon } from '@desi-event/ui/icons'
import Link from 'next/link'

import { Empty } from '../../components/page-state.jsx'
import { ReadRefusal } from '../../components/read-refusal.jsx'
import { TicketObject } from '../../components/ticket-object.jsx'
import { PageHeader, SECONDARY_LINK, Section, TEXT_LINK } from '../../components/workspace-kit.jsx'
import { getMyTickets } from '../../lib/organizer-api.js'
import { joinLinkHost, sessionDisplayLabel } from '../../lib/sessions.js'
import { StatusChip } from '../account/orders/status-chip.jsx'
import { formatAmount } from '../../lib/pricing.js'
import {
  groupPassSummaries,
  groupTickets,
  isEventDay,
  stubDate,
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
 * One line of a ticket's detail list, omitted entirely when there is nothing to say.
 *
 * An empty definition list row is worse than a missing one: it reads as a fact
 * the system failed to look up rather than one that does not apply.
 *
 * @param {object} props Component props.
 * @param {string} props.term What it is.
 * @param {string} [props.className] Classes for the row (a wide row spans two columns).
 * @param {ReactNode} props.children The value.
 * @returns {JSX.Element|null} The row, or nothing.
 */
function Detail({ term, className = '', children }) {
  if (!children) return null

  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-caption font-medium text-ink-muted">{term}</dt>
      <dd className="mt-0.5 text-label font-semibold break-words">{children}</dd>
    </div>
  )
}

/**
 * The orange "Today" plate, on the day a ticket is for. The word, not only the
 * gold keyline around the ticket.
 *
 * @returns {JSX.Element} The plate.
 */
function TodayPlate() {
  return (
    <span className="inline-flex min-h-6 items-center rounded-plate bg-celebration px-2 text-micro font-bold text-highlight-ink uppercase">
      Today
    </span>
  )
}

/**
 * The date printed on a stub: the month, the day in large figures, the weekday
 * and the time. The face says the same in words, so this is hidden from
 * assistive technology rather than read twice.
 *
 * @param {object} props Component props.
 * @param {string|null|undefined} props.startsAt When the night starts.
 * @param {string} [props.timeZone] The venue's zone.
 * @returns {JSX.Element|null} The date, or nothing for an unreadable one.
 */
function StubDate({ startsAt, timeZone }) {
  const date = stubDate(startsAt, timeZone)

  if (!date) return null

  return (
    <p aria-hidden="true" className="flex items-end gap-3 font-display leading-none">
      <span className="text-[3.5rem] leading-[0.85] font-bold tabular-nums">{date.day}</span>
      <span className="flex flex-col gap-1 pb-0.5">
        <span className="text-label font-bold uppercase">{date.month}</span>
        <span className="font-sans text-caption text-ink-muted">
          {date.weekday} · {date.time}
        </span>
      </span>
    </p>
  )
}

/**
 * One ticket, drawn as a ticket.
 *
 * The event's title is the link and the heading, because the thing somebody is
 * looking for is the night out, not the reference code. The code is still
 * here, in a monospace run, because it is what a steward asks for.
 *
 * The face says what it is: the night, where, the tier, the seat, whose name
 * is on it, and the references. The stub carries the date in large figures
 * and, for a ticket that still admits, the way straight to its pass. The pass
 * is not drawn here (see the module comment): the link goes to the ticket's
 * own page, to the section where the holder asks for it.
 *
 * On the night's own day the ticket says "Today" and a gold keyline is drawn
 * round it once.
 *
 * @param {object} props Component props.
 * @param {object} props.ticket A row from `GET /v1/tickets`.
 * @param {Date} props.now The instant the page was drawn.
 * @returns {JSX.Element} The ticket.
 */
function TicketCard({ ticket, now }) {
  const when = whenText(ticket)
  const where = whereText(ticket)
  const seat = seatText(ticket)
  const doorNotes = venuePaymentNotes(ticket)
  const today = isEventDay(ticket, now)
  const startsAt = ticket.session?.startsAt ?? ticket.event.startsAt
  const zone = ticket.session?.timezone || ticket.event.timezone

  return (
    <li>
      <TicketObject
        as="div"
        eventDay={today}
        muted={!ticket.admits}
        face={
          <>
            <div className="flex flex-wrap items-center gap-2">
              {today ? <TodayPlate /> : null}
              <StatusChip meaning={ticketChip(ticket)} />
            </div>
            <h3 className="mt-3 font-display text-h3 font-bold text-balance text-ticket-ink">
              <Link href={`/tickets/${ticket.id}`} className={TEXT_LINK}>
                {ticket.event.title}
              </Link>
            </h3>

            <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <Detail term="When" className="sm:col-span-2 lg:col-span-1">
                {when ? <time dateTime={ticket.event.startsAt}>{when}</time> : ''}
              </Detail>
              <Detail term="Night">
                {ticket.session ? sessionDisplayLabel(ticket.session) : ''}
              </Detail>
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
              <p key={note} className="mt-4 text-sm text-ticket-ink">
                {note}
              </p>
            ))}

            {ticket.pendingTransfer ? (
              <p className="mt-4 text-sm text-ink-muted">
                Offered to{' '}
                <span className="font-medium text-ticket-ink">
                  {ticket.pendingTransfer.toEmailMasked}
                </span>
                . It is still yours until they accept.
              </p>
            ) : null}

            {ticket.admissionRefusal ? (
              <p className="mt-4 text-sm text-ink-muted">{ticket.admissionRefusal}</p>
            ) : null}

            {ticket.revokedReason ? (
              <p className="mt-1 text-sm text-ink-muted">Reason given: {ticket.revokedReason}</p>
            ) : null}
          </>
        }
        stub={
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 md:h-full md:flex-col md:flex-nowrap md:items-stretch md:justify-start md:gap-5 md:pt-0 md:pl-2">
            <StubDate startsAt={startsAt} timeZone={zone} />
            <div className="flex flex-col gap-3 md:mt-auto">
              {/* The joining link of an online event, given by the server
                  only while this ticket admits. Named by its host; no
                  referrer goes with it. */}
              {ticket.onlineJoinUrl && joinLinkHost(ticket.onlineJoinUrl) ? (
                <a
                  href={ticket.onlineJoinUrl}
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className={SECONDARY_LINK}
                >
                  Join online at {joinLinkHost(ticket.onlineJoinUrl)}
                  <span className="sr-only"> for {ticket.event.title}</span>
                </a>
              ) : null}

              {/* Whether it admits is the server's word, from the same
                  function the door runs; the page does not work it out. */}
              {ticket.admits ? (
                <Link href={`/tickets/${ticket.id}#entry-pass`} className={SECONDARY_LINK}>
                  <Icon name="qr" className="size-5" />
                  Show my entry pass
                  <span className="sr-only"> for {ticket.event.title}</span>
                </Link>
              ) : null}
            </div>
          </div>
        }
      />
    </li>
  )
}

/**
 * One order's group pass, as a ticket: a way to it, never the pass.
 *
 * @param {object} props Component props.
 * @param {object} props.summary The order and what it admits, from `groupPassSummaries`.
 * @param {boolean} props.partial Whether the page lists only some of this account's tickets.
 * @returns {JSX.Element} The ticket.
 */
function GroupPassCard({ summary, partial }) {
  const title = summary.event?.title ?? `Order ${summary.orderReference}`
  const when = whenText(summary)

  return (
    <li>
      <TicketObject
        as="div"
        face={
          <>
            <h3 className="font-display text-h3 font-bold text-balance text-ticket-ink">{title}</h3>
            <p className="mt-1 text-sm text-ink-muted">
              {[when, `Order ${summary.orderReference}`].filter(Boolean).join(' · ')}
            </p>
            <p className="mt-4 text-label font-semibold">
              {partial ? 'Group pass' : `Group pass (admits ${summary.admits})`}
            </p>
            {partial ? (
              <p className="mt-1 text-sm text-ink-muted">
                Not every ticket on this account is listed here, so how many it admits is on the
                order’s page.
              </p>
            ) : null}
            {summary.unpaidCents > 0 && !partial ? (
              <p className="mt-1 text-sm text-ticket-ink">
                Pay {formatAmount(summary.unpaidCents, summary.currency)} at the door for the
                tickets still unpaid.
              </p>
            ) : null}
          </>
        }
        stub={
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 md:h-full md:flex-col md:flex-nowrap md:items-stretch md:justify-start md:gap-5 md:pt-0 md:pl-2">
            {partial ? null : (
              <p aria-hidden="true" className="flex items-end gap-3 font-display leading-none">
                <span className="text-[3.5rem] leading-[0.85] font-bold tabular-nums">
                  {summary.admits}
                </span>
                <span className="pb-0.5 text-label font-bold uppercase">Admits</span>
              </p>
            )}
            <Link
              href={`/account/orders/${encodeURIComponent(summary.orderReference)}#group-pass`}
              className={`${SECONDARY_LINK} md:mt-auto`}
            >
              <Icon name="users" className="size-5" />
              Show group pass
              <span className="sr-only"> for {title}</span>
            </Link>
          </div>
        }
      />
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

  const now = new Date()
  const groups = groupTickets(tickets, now)
  const usable = usableCount(groups)
  const groupPasses = groupPassSummaries(tickets)
  const partial = Boolean(pagination?.hasNextPage)

  return (
    <div>
      <PageHeader
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

      {tickets.length > 0 ? (
        <p className="mt-6 flex items-center gap-2 text-title font-semibold text-ink">
          <Icon name="ticket" className="size-6 text-accent-strong" />
          {usable === 1 ? 'One ticket still gets you in.' : `${usable} tickets still get you in.`}
        </p>
      ) : null}

      {pagination?.hasNextPage ? (
        <p className="mt-4 max-w-3xl text-sm text-ink-muted">
          This page shows the {tickets.length} most recently issued of the {pagination.total}{' '}
          tickets on this account. Older ones are not listed here.
        </p>
      ) : null}

      {groupPasses.length > 0 ? (
        <Section
          id="wallet-group-passes"
          title="Group passes"
          description="One QR for each order below that lets in every ticket on it you still hold, for arriving together. Each ticket keeps its own pass as well."
          className="mt-10"
        >
          <ul className="mt-5 flex flex-col gap-5">
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
          className={index === 0 && groupPasses.length === 0 ? 'mt-10' : 'mt-14'}
        >
          <ul className="mt-5 flex flex-col gap-5">
            {group.tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} now={now} />
            ))}
          </ul>
        </Section>
      ))}
    </div>
  )
}
