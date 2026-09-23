/**
 * Everything somebody is handing on, has handed on, or has been handed.
 *
 * ## Built from the wallet, because there is no transfers list
 *
 * The API has no endpoint that lists a person's transfers. What it has is the
 * wallet, `GET /v1/tickets`, whose rows carry the one outstanding offer against
 * each ticket (`pendingTransfer`) and whose sections — from `lib/wallet.js`,
 * the same function the wallet page uses — already separate "given to you"
 * and "handed on". This page arranges those; it asks for nothing else, so it
 * cannot disagree with the wallet about which ticket is where.
 *
 * One ticket is one card. A ticket on offer is shown under "Offers you have
 * made" and is left out of the wallet's sections here, or a ticket somebody
 * gave you and you are now offering on would be counted twice. "Handed on"
 * keeps the wallet's grouping but not its description, which says "you bought
 * these": on this page a ticket you were given and then passed on is the case
 * that turns up, and it was not bought.
 *
 * The wallet read is one page, the most recently issued tickets first. When
 * there are more, the page says so, and "nothing here" is worded as nothing
 * among the tickets it read rather than nothing at all.
 *
 * ## The recipient, as the API gave it
 *
 * An offer's recipient is shown exactly as `toEmailMasked` arrives —
 * `••••@example.com`, or `Hidden email` — and never anything more. The server
 * decides how much of the address this page gets, and it gives the domain
 * alone; nothing here holds the rest to hide.
 *
 * ## Actions live on the ticket
 *
 * Withdrawing an offer, or making one, happens on the ticket's own page, which
 * knows the ticket's state and asks the server before it offers anything. This
 * page links there rather than repeating it. Accepting has its own page too,
 * because the code for it is typed in and never carried in a link. The code
 * goes from the server to the recipient's address and never to the sender, and
 * this build delivers no email, so the page does not claim anybody sent one.
 *
 * ## One clock
 *
 * Every time on a card — when the event is, when an offer lapses — is written
 * by the same formatter, in the event's own timezone with the zone named, the
 * one the order pages use.
 *
 * ## What cannot be done, said plainly
 *
 * A ticket for a reserved seat cannot be handed on: the API refuses the offer
 * and the ticket stays where it is. That is stated as it is.
 *
 * @module app/account/transfers/page
 */

import Link from 'next/link'

import { Empty } from '../../../components/page-state.jsx'
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { getMyTickets } from '../../../lib/organizer-api.js'
import { groupTickets } from '../../../lib/wallet.js'
import { eventWhenText, instantText, ticketStatusMeaning } from '../orders/order-status.js'
import { StatusChip } from '../orders/status-chip.jsx'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Transfers', robots: { index: false, follow: false } }

/** Classes for a text link. */
const LINK =
  'rounded-sm font-medium text-accent-strong underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'

/** Classes for the one action on an offer card. */
const ACTION =
  'inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface-raised px-4 text-sm font-medium text-ink hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2'

/** What "Handed on" holds, in words true for a ticket bought or received. */
const HANDED_ON_DESCRIPTION =
  'Tickets you handed to somebody else, who accepted them. They no longer admit you.'

/**
 * The timezone a ticket's times are written in.
 *
 * @param {object} ticket A wallet row.
 * @returns {string} The event's IANA zone, or UTC when it has none.
 */
function zoneOf(ticket) {
  return ticket.event?.timezone || 'UTC'
}

/**
 * When the ticket's event runs, on the same clock as every other time here.
 *
 * @param {object} ticket A wallet row.
 * @returns {string} Something like `Thu, 10 Oct 2030 · 7:00 pm – 11:30 pm IST`, or an empty string.
 */
function ticketWhen(ticket) {
  return eventWhenText({ ...ticket.event, timezone: zoneOf(ticket) })
}

/**
 * One line of a card's detail list, omitted when there is nothing to say.
 *
 * @param {object} props Component props.
 * @param {string} props.term What it is.
 * @param {ReactNode} props.children The value.
 * @returns {JSX.Element|null} The row, or nothing.
 */
function Detail({ term, children }) {
  if (children === '' || children === null || children === undefined) return null

  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-ink-subtle">{term}</dt>
      <dd className="font-medium text-ink">{children}</dd>
    </div>
  )
}

/**
 * A titled part of the page.
 *
 * @param {object} props Component props.
 * @param {string} props.id The heading id.
 * @param {string} props.title The heading.
 * @param {string} [props.description] One sentence under it.
 * @param {ReactNode} props.children The body.
 * @returns {JSX.Element} The section.
 */
function Section({ id, title, description, children }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      {children}
    </section>
  )
}

/**
 * An offer this person has made and nobody has answered.
 *
 * The recipient is the string the API sent, unaltered. When the offer's
 * deadline has passed it can no longer be accepted — the API refuses a lapsed
 * invitation — but nothing sweeps it away either, so it stands until the
 * sender withdraws it; the card says that rather than "waiting".
 *
 * @param {object} props Component props.
 * @param {object} props.ticket A wallet row with a `pendingTransfer`.
 * @param {Date} props.now The instant the page was drawn.
 * @returns {JSX.Element} The card.
 */
function OfferCard({ ticket, now }) {
  const offer = ticket.pendingTransfer
  const deadline = instantText(offer.expiresAt, zoneOf(ticket))
  const lapsed = Date.parse(offer.expiresAt ?? '') < now.getTime()

  return (
    <li className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h3 className="text-base font-semibold text-ink sm:text-lg">{ticket.event.title}</h3>
        <StatusChip meaning={ticketStatusMeaning(ticket.status)} />
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Detail term="When">{ticketWhen(ticket)}</Detail>
        <Detail term="Ticket">{ticket.tier?.name ?? ''}</Detail>
        <Detail term="Offered to">{offer.toEmailMasked}</Detail>
        <Detail term={lapsed ? 'Lapsed' : 'Open until'}>{deadline}</Detail>
      </dl>

      <p className="mt-3 text-sm text-ink-muted">
        {lapsed
          ? 'It lapsed without an answer and can no longer be accepted. Withdraw it from the ticket’s page to clear it; the ticket is yours throughout.'
          : ticket.admits
            ? 'The ticket is still yours, and still gets you in, until they accept.'
            : 'The ticket is still yours until they accept.'}
      </p>

      <p className="mt-3">
        <Link href={`/tickets/${encodeURIComponent(ticket.id)}`} className={ACTION}>
          Withdraw or view this offer
        </Link>
      </p>
    </li>
  )
}

/**
 * A ticket in one of the wallet's sections, as a link to its page.
 *
 * @param {object} props Component props.
 * @param {object} props.ticket A wallet row.
 * @returns {JSX.Element} The card.
 */
function TicketCard({ ticket }) {
  return (
    <li className="rounded-card border border-line bg-surface p-4 focus-within:ring-2 focus-within:ring-focus sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h3 className="text-base font-semibold text-ink sm:text-lg">
          <Link
            href={`/tickets/${encodeURIComponent(ticket.id)}`}
            className="rounded-sm underline decoration-accent-line underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          >
            {ticket.event.title}
          </Link>
        </h3>
        <StatusChip meaning={ticketStatusMeaning(ticket.status)} />
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Detail term="When">{ticketWhen(ticket)}</Detail>
        <Detail term="Ticket">{ticket.tier?.name ?? ''}</Detail>
      </dl>
    </li>
  )
}

/**
 * The transfers page.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function TransfersPage() {
  let tickets = []
  let pagination = null
  let failure = null

  try {
    ;({ tickets, pagination } = await getMyTickets({ perPage: 100 }))
  } catch (error) {
    failure = error
  }

  const now = new Date()

  // Soonest deadline first: the offer about to lapse is the one to look at.
  const offers = tickets
    .filter((ticket) => ticket.pendingTransfer)
    .sort(
      (a, b) =>
        Date.parse(a.pendingTransfer.expiresAt ?? '') -
        Date.parse(b.pendingTransfer.expiresAt ?? ''),
    )

  // A ticket on offer is shown once, as an offer: one somebody gave this
  // person and they are now offering on would otherwise be "given" as well.
  const groups = groupTickets(
    tickets.filter((ticket) => !ticket.pendingTransfer),
    now,
  )
  const given = groups.find((group) => group.id === 'given') ?? null
  const handedOn = groups.find((group) => group.id === 'handedOn') ?? null
  const nothing = offers.length === 0 && !given && !handedOn
  const partial = Boolean(pagination?.hasNextPage)

  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">Transfers</h1>
      <p className="mt-2 text-ink-muted">
        Tickets you are offering to somebody, tickets you have handed on, and tickets somebody
        handed to you. To offer a ticket, open it from{' '}
        <Link href="/tickets" className={LINK}>
          My tickets
        </Link>
        .
      </p>

      {failure ? (
        <ReadRefusal error={failure} what="Your transfers" action="see your transfers" />
      ) : null}

      {!failure && partial ? (
        <p className="mt-4 rounded-card border border-status-warning/30 bg-status-warning-soft p-4 text-sm text-ink">
          This page reads the {tickets.length} most recently issued of the {pagination.total}{' '}
          tickets on this account. Older tickets, and any transfer of theirs, are not shown here.
        </p>
      ) : null}

      {!failure && nothing && !partial ? (
        <Empty
          title="Nothing handed on or received"
          description="You have no offers waiting for an answer, you have not handed a ticket on, and nobody has handed you one that still gets you in."
        />
      ) : null}

      {!failure && nothing && partial ? (
        <Empty
          title="Nothing among your newest tickets"
          description={`None of the ${tickets.length} most recently issued tickets on this account is on offer, was handed on, or was given to you and still gets you in. Older tickets were not read.`}
        />
      ) : null}

      {offers.length > 0 ? (
        <Section
          id="transfers-offers"
          title="Offers you have made"
          description="Waiting for the person you offered them to. Each one can be withdrawn from the ticket’s page."
        >
          <ul className="mt-4 grid gap-3">
            {offers.map((ticket) => (
              <OfferCard key={ticket.id} ticket={ticket} now={now} />
            ))}
          </ul>
        </Section>
      ) : null}

      {!failure ? (
        <Section id="transfers-accept" title="Accept a ticket">
          <p className="mt-2 text-sm text-ink">
            An offer is accepted with the invitation code issued with it. The person who made the
            offer never sees that code, and this site delivers no email, so it does not arrive on
            its own. If you have one,{' '}
            <Link href="/tickets/accept" className={LINK}>
              enter the code to accept the ticket
            </Link>
            .
          </p>
        </Section>
      ) : null}

      {given ? (
        <Section id="transfers-given" title={given.label} description={given.description}>
          <ul className="mt-4 grid gap-3">
            {given.tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </ul>
        </Section>
      ) : null}

      {handedOn ? (
        <Section
          id="transfers-handed-on"
          title={handedOn.label}
          description={HANDED_ON_DESCRIPTION}
        >
          <ul className="mt-4 grid gap-3">
            {handedOn.tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </ul>
        </Section>
      ) : null}

      {!failure ? (
        <Section id="transfers-seats" title="Reserved seats">
          <p className="mt-2 text-sm text-ink">
            Tickets for reserved seats cannot be handed on. An offer for one is refused, and the
            ticket stays with you.
          </p>
        </Section>
      ) : null}
    </div>
  )
}
