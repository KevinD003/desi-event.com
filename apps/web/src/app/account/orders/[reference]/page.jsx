/**
 * One order: what it was for, what it cost, and the tickets it gave.
 *
 * ## "Not yours" and "does not exist" read the same
 *
 * The API answers 404 for a reference nobody has used and 403 for somebody
 * else's order (unless the reader's organisation may view it). Drawn
 * differently, those two would let anybody find out which references are real
 * by guessing. So both — and a malformed reference, which the API refuses as a
 * validation error — get one sentence: there is no order with that reference
 * on this account. An order the API did return, but to an organiser rather
 * than to its buyer (no buyer address in the payload), is not one of "your
 * orders" either and reads the same way. Every other refusal is drawn by
 * `ReadRefusal`: the step-up, two-step set-up, signing in again, a wait.
 *
 * ## No names that are not in the payload
 *
 * An order line carries `ticketTypeId`, a quantity, prices and the ticket
 * type's name as the API read it (`ticketTypeName`). So a line reads
 * "General admission, 2 × ₹500.00", and "Tickets, 2 × ₹500.00" only when the
 * payload names no type — never a name fetched from somewhere else or made up.
 *
 * ## The tickets, but never their codes
 *
 * Each ticket is a link to its own page, which is where a pass is shown and
 * only on request. The order payload does carry each ticket's `code`; this
 * page never renders it, because a list of every code on an order is one
 * screenshot away from being every pass on it.
 *
 * A ticket handed on and handed back leaves two of the buyer's rows for one
 * purchase; the earlier is marked superseded and is not listed. A ticket
 * handed on for good is superseded by the recipient's row, so it is not listed
 * either — and the page says how many went that way instead of leaving the
 * count short without a word.
 *
 * A ticket is linked only when this account holds it. The API returns an order
 * to the account that placed it and also to anybody signed in with the address
 * it was placed with, and checkout issues the tickets to the placing account —
 * or to no account, for a guest order. So the page compares the order's account
 * with the signed-in one before linking, and says why when they differ, rather
 * than linking to a ticket page that would answer "no such ticket". What the
 * page says a ticket's page is for follows the tickets' states: a refunded or
 * used ticket has no pass to show and cannot be handed on.
 *
 * ## The group pass
 *
 * An order whose buyer still holds two to fifty tickets that admit has a group
 * pass: one QR that lets in all of them, for arriving together. The order
 * payload says only whether there is one and how many it admits
 * (`order.groupPass`, present for the account that bought it and nobody else);
 * the pass itself is drawn by `GroupPass`, which fetches it from its own
 * buyer-only, `no-store` endpoint when asked and never before. It is offered
 * only when this account holds the tickets, like the ticket links above it. An
 * order with more than fifty such tickets says so instead of drawing a pass the
 * API would refuse. A ticket on offer to somebody is still let in by the group
 * pass until the offer is accepted, and the page says so, because letting it in
 * first means the offer can no longer be accepted.
 *
 * ## Money
 *
 * Every payment is simulated, and the page says so under the total. Refunds
 * are not requested here; a refunded order says it was refunded and nothing
 * else about refunds is claimed.
 *
 * ## Booked to pay at the venue (SPEC3 §12.7, SPEC3-XI §12.7)
 *
 * Only the booking fee is paid online, so the total gives way to what was paid
 * online (simulated) and what is still to pay at the door. Where the order
 * stands comes from the server (`venuePayment`, `venuePaymentStateOf`): the
 * buyer's own tickets to pay or paid, the tickets passed on to people who pay
 * with their own, what those people paid at the door, and the tickets cancelled
 * because nobody paid for them — each cancellation in a block of its own, with
 * who cancelled, what is no longer owed, the booking fee Desi-Event kept, and
 * the reason given. Money paid at the door is the organiser's: when the order
 * is refunded or cancelled the page says it is with the organiser, never that
 * it came back.
 *
 * @module app/account/orders/reference/page
 */

import Link from 'next/link'

import { EventChangesList } from '../../../../components/event-changes-list.jsx'
import { GroupPass } from '../../../../components/group-pass.jsx'
import { Breadcrumbs } from '../../../../components/page-state.jsx'
import { ReadRefusal } from '../../../../components/read-refusal.jsx'
import { getMyOrder } from '../../../../lib/account-api.js'
import { formatEventDate, formatEventLocation } from '../../../../lib/format.js'
import { formatAmount } from '../../../../lib/pricing.js'
import { deletedForHolder } from '../../../../lib/event-control.js'
import { describeApiRefusal } from '../../../../lib/refusal.js'
import { readSession } from '../../../../lib/session.js'
import { joinLinkHost, sessionDisplayLabel } from '../../../../lib/sessions.js'
import { eventIsOver } from '../../../../lib/wallet.js'
import {
  currentTickets,
  eventWhenText,
  handedAnyOn,
  instantText,
  openTicketHint,
  orderStatusFor,
  orderTitle,
  owingPassedOnTickets,
  paidAtVenue,
  readAsBuyer,
  ticketCount,
  ticketHolder,
  ticketStatusMeaning,
  tookPayment,
  venueTicketMeaning,
} from '../order-status.js'
import { StatusChip } from '../status-chip.jsx'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Order', robots: { index: false, follow: false } }

/** Classes for a text link. */
const LINK =
  'rounded-sm font-medium text-accent-strong underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'

/** Refusal states that all mean "there is no such order on this account". */
const NOT_ON_THIS_ACCOUNT = new Set(['not-found', 'permission-denied', 'validation'])

/**
 * The one answer for a reference this account has no order under.
 *
 * Takes nothing from the request, so it cannot differ between an order that
 * belongs to somebody else and one that was never placed.
 *
 * @returns {JSX.Element} The page.
 */
function NoSuchOrder() {
  return (
    <div>
      <Breadcrumbs
        trail={[
          { href: '/account/orders', label: 'Your orders' },
          { href: null, label: 'Order' },
        ]}
      />
      <h1 className="mt-3 text-h2 font-semibold text-ink">Order not found</h1>
      <p className="mt-2 max-w-prose text-ink">
        There is no order with that reference on this account.
      </p>
      <p className="mt-4">
        <Link href="/account/orders" className={LINK}>
          Back to your orders
        </Link>
      </p>
    </div>
  )
}

/**
 * One row of the order's facts, omitted when there is nothing to say.
 *
 * @param {object} props Component props.
 * @param {string} props.term What it is.
 * @param {ReactNode} props.children The value.
 * @returns {JSX.Element|null} The row, or nothing.
 */
function Fact({ term, children }) {
  if (children === '' || children === null || children === undefined) return null

  return (
    <div className="py-2 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-ink-muted">{term}</dt>
      <dd className="mt-1 text-sm break-words text-ink sm:col-span-2 sm:mt-0">{children}</dd>
    </div>
  )
}

/**
 * One line of the totals.
 *
 * @param {object} props Component props.
 * @param {string} props.term What it is.
 * @param {string} props.children The amount, formatted.
 * @param {boolean} [props.emphasised] Whether this is the total.
 * @returns {JSX.Element} The row.
 */
function Sum({ term, children, emphasised = false }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-2 ${
        emphasised ? 'border-t border-line-strong pt-3 text-lg font-bold text-ink' : 'text-sm'
      }`}
    >
      <dt className={emphasised ? '' : 'text-ink-muted'}>{term}</dt>
      <dd className="text-ink tabular-nums">{children}</dd>
    </div>
  )
}

/**
 * The sentence under the total about whether money was taken.
 *
 * @param {object} order The order.
 * @returns {string|null} The sentence, or nothing for a status this page does not know.
 */
function paymentSentence(order) {
  // A booking to pay at the venue with nothing paid online, booked and not
  // refunded: there was no payment to simulate.
  if (paidAtVenue(order) && order.status === 'PAID' && (order.totalCents ?? 0) === 0) {
    return 'Nothing was paid online for this order.'
  }

  if (tookPayment(order)) return 'Simulated payment — no card was charged and no money moved.'
  if (['PENDING', 'CANCELLED', 'EXPIRED'].includes(order.status)) return 'Not paid.'

  return null
}

/**
 * "ticket" or "tickets".
 *
 * @param {number} count How many.
 * @returns {string} The word.
 */
function ticketWord(count) {
  return count === 1 ? 'ticket' : 'tickets'
}

/**
 * What a refunded or cancelled booking to pay at the venue says about its
 * money (SPEC3 §12.7, SPEC3-XI §12.7): what went back online, what was kept
 * when unpaid tickets were cancelled, and that money paid at the door is with
 * the organiser.
 *
 * @param {object} order The order.
 * @returns {string[]} The sentences, in order.
 */
export function venueEndingSentences(order) {
  const venue = order.venuePayment ?? null
  const money = (cents) => formatAmount(cents, order.currency)
  const sentences = []
  const kept = venue?.feeKeptCents ?? 0

  if (order.status === 'CANCELLED' || (order.totalCents ?? 0) === 0) {
    sentences.push('Nothing was paid online for these tickets.')
  } else if (kept > 0) {
    sentences.push(
      `The rest of the booking fee you paid online was refunded (simulated); ${money(kept)} of it was kept when unpaid tickets were cancelled.`,
    )
  } else {
    sentences.push('The booking fee you paid online was refunded (simulated).')
  }

  if ((venue?.paidCents ?? 0) > 0) {
    sentences.push(
      `The ${money(venue.paidCents)} you paid at the door is with the organiser, not with Desi-Event. Ask the organiser to return it.`,
    )
  }

  if ((venue?.paidByOthersCents ?? 0) > 0) {
    sentences.push(
      `${money(venue.paidByOthersCents)} was paid at the door by people you passed tickets to; it is with the organiser.`,
    )
  }

  return sentences
}

/**
 * What one cancellation of unpaid tickets says to the buyer (SPEC3-XI §12.7).
 *
 * @param {object} cancellation One of `order.venueCancellations`.
 * @param {string} currency The order's currency.
 * @param {string} timeZone The event's timezone, for the date.
 * @returns {string[]} The sentences, in order.
 */
export function venueCancellationSentences(cancellation, currency, timeZone) {
  const one = cancellation.ticketCount === 1
  const them = one ? 'it' : 'them'
  const by = cancellation.by === 'DESI_EVENT' ? 'The Desi-Event team' : 'The organiser'
  const money = (cents) => formatAmount(cents, currency)

  return [
    `${by} cancelled ${cancellation.ticketCount} ${ticketWord(cancellation.ticketCount)} on ${formatEventDate(cancellation.at, timeZone)} because ${one ? 'it was' : 'they were'} not paid for. You no longer owe ${money(cancellation.basisCents)} for ${them}.`,
    cancellation.feeKeptCents > 0
      ? `The booking fee paid for ${them} online, ${money(cancellation.feeKeptCents)}, is kept by Desi-Event and is not refunded.`
      : `Nothing was paid online for ${them}.`,
    `Reason given: “${cancellation.reason}”`,
  ]
}

/**
 * The money rows of a booking to pay at the venue, in place of the total.
 *
 * @param {object} props Component props.
 * @param {object} props.order The order.
 * @returns {JSX.Element} The rows.
 */
function VenueSums({ order }) {
  const venue = order.venuePayment ?? null
  const money = (cents) => formatAmount(cents, order.currency)

  return (
    <>
      <Sum term="Paid online (simulated)" emphasised>
        {money(order.totalCents ?? 0)}
      </Sum>
      {(venue?.unpaidCents ?? 0) > 0 ? (
        <Sum term="To pay at the door">{money(venue.unpaidCents)}</Sum>
      ) : null}
      {(venue?.paidCents ?? 0) > 0 ? (
        <Sum term="Paid at the door">
          {money(venue.paidCents)} of {money(venue.dueCents)}
        </Sum>
      ) : null}
      {(venue?.paidByOthersCents ?? 0) > 0 ? (
        <Sum term="Paid at the door by people you passed tickets to">
          {money(venue.paidByOthersCents)}
        </Sum>
      ) : null}
    </>
  )
}

/**
 * The cancellations of the order's unpaid tickets, one block each.
 *
 * @param {object} props Component props.
 * @param {object} props.order The order.
 * @param {string} props.zone The event's timezone.
 * @returns {JSX.Element|null} The blocks, or nothing.
 */
function VenueCancellations({ order, zone }) {
  const cancellations = order.venueCancellations ?? []

  if (cancellations.length === 0) return null

  return cancellations.map((cancellation, index) => {
    const headingId = `order-venue-cancellation-${index}`

    return (
      <section
        key={`${cancellation.at}-${index}`}
        aria-labelledby={headingId}
        className="mt-6 max-w-prose rounded-card border border-line bg-surface-subtle p-4"
      >
        <h3 id={headingId} className="font-semibold text-ink">
          Unpaid tickets cancelled
        </h3>
        {venueCancellationSentences(cancellation, order.currency, zone).map((sentence) => (
          <p key={sentence} className="mt-2 text-sm break-words text-ink">
            {sentence}
          </p>
        ))}
      </section>
    )
  })
}

/**
 * The nights this page can name a cancelled one by: the event's, when the
 * order carries them, and each line's own night, once each. A night it cannot
 * name is named by the start its notice recorded (`EventChangesList`).
 *
 * @param {object} order The order.
 * @returns {object[]} The nights, each once.
 */
function orderNights(order) {
  const nights = new Map()

  for (const night of [
    ...(order?.event?.sessions ?? []),
    ...(order?.items ?? []).map((item) => item?.session),
  ]) {
    if (night?.id && !nights.has(night.id)) nights.set(night.id, night)
  }

  return [...nights.values()]
}

/**
 * What to say about tickets on the order that are not in the list.
 *
 * @param {number} bought How many tickets the order was for.
 * @param {number} listed How many are listed.
 * @param {boolean} handedOn Whether any of the buyer's rows was handed away.
 * @returns {string|null} The sentence, or nothing when the list is complete.
 */
function missingSentence(bought, listed, handedOn) {
  const missing = bought - listed

  if (missing <= 0) return null

  if (handedOn) {
    return missing === 1
      ? `${listed === 0 ? 'The ticket' : 'The other ticket'} on this order was handed on to somebody else, who holds it now.`
      : `${listed === 0 ? `All ${missing} tickets` : `The other ${missing} tickets`} on this order were handed on to somebody else, who holds them now.`
  }

  if (listed === 0) {
    return `This order is for ${bought === 1 ? '1 ticket' : `${bought} tickets`}, and none is listed on it.`
  }

  // `bought` is more than `listed`, which is at least one, so it is plural here.
  return `This order is for ${bought} tickets, and ${listed === 1 ? 'only one is' : `only ${listed} are`} listed on it.`
}

/**
 * Why the tickets are not links, when they are not.
 *
 * @param {string} holder What {@link ticketHolder} said.
 * @returns {ReactNode} The sentence, or nothing when this account holds them.
 */
function unlinkedSentence(holder) {
  if (holder === 'guest') {
    return 'This order was placed without signing in, so its tickets are not held by this account and their pages cannot be opened from it.'
  }

  if (holder === 'other-account') {
    return 'This order was placed from another account with your email address, so its tickets were issued to that account and their pages cannot be opened from this one.'
  }

  if (holder === 'unknown') {
    return (
      <>
        Which account holds these tickets could not be checked just now, so they are not linked. The
        tickets this account holds are in{' '}
        <Link href="/tickets" className={LINK}>
          My tickets
        </Link>
        .
      </>
    )
  }

  return null
}

/**
 * The tickets the order gave.
 *
 * @param {object} props Component props.
 * @param {object} props.order The order.
 * @param {string} props.holder Whose the tickets are, from {@link ticketHolder}.
 * @param {Date} props.now The instant the page was drawn.
 * @returns {JSX.Element} The section body.
 */
function Tickets({ order, holder, now }) {
  const atVenue = paidAtVenue(order)
  if (order.status === 'PENDING') {
    return (
      <p className="mt-3 text-sm text-ink">
        Tickets are issued when the payment goes through. None have been issued for this order.
      </p>
    )
  }

  if (!tookPayment(order)) {
    return (
      <p className="mt-3 text-sm text-ink">
        No tickets were issued, because this order was not paid.
      </p>
    )
  }

  const current = currentTickets(order)
  const bought = ticketCount(order)
  const handedOn = handedAnyOn(order)
  // A booking to pay at the venue lists the tickets it passed on that still
  // owe, so the buyer sees whose turn it is to pay: as many as the order says
  // still owe, and at most as many as are missing from the list, so a ticket
  // handed on and back is not counted twice (`owingPassedOnTickets`).
  const { tickets: passedOn, dueKnown } = atVenue
    ? owingPassedOnTickets(order, Math.max(0, bought - current.length))
    : { tickets: [], dueKnown: true }
  const missing = missingSentence(bought, current.length + passedOn.length, handedOn)
  // A ticket's page opens only for the account holding it, and checkout
  // issues the tickets to the account that placed the order.
  const openable = holder === 'this-account'
  const unlinked = openable ? null : unlinkedSentence(holder)

  const listed = [...current, ...passedOn]

  return (
    <>
      {listed.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {listed.map((ticket, index) => {
            const label = `Ticket ${index + 1} of ${listed.length}`
            const away = index >= current.length
            const meaning =
              (atVenue
                ? venueTicketMeaning(ticket, order.currency, { dueKnown: away ? dueKnown : true })
                : null) ?? ticketStatusMeaning(ticket.status)

            return (
              <li
                key={ticket.id}
                className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-card border border-line bg-surface shadow-card px-4 py-2"
              >
                {openable && !away ? (
                  <Link href={`/tickets/${encodeURIComponent(ticket.id)}`} className={LINK}>
                    {label}
                  </Link>
                ) : (
                  <span className="font-medium text-ink">{label}</span>
                )}
                <StatusChip meaning={meaning} />
              </li>
            )
          })}
        </ul>
      ) : null}

      {unlinked && current.length > 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{unlinked}</p>
      ) : null}

      {missing ? (
        <p className="mt-3 text-sm text-ink">
          {missing}
          {handedOn ? (
            <>
              {' '}
              Your side of each hand-over is under Handed on in{' '}
              <Link href="/account/transfers" className={LINK}>
                Transfers
              </Link>
              .
            </>
          ) : null}
        </p>
      ) : null}

      {current.length > 0 && openable ? (
        <p className="mt-3 text-sm text-ink-muted">
          {openTicketHint(current, { eventOver: eventIsOver({ event: order.event }, now) })}
        </p>
      ) : null}
    </>
  )
}

/**
 * The order's group pass, when this account holds its tickets and there is one.
 *
 * @param {object} props Component props.
 * @param {object} props.order The order.
 * @param {string} props.holder Whose the tickets are, from {@link ticketHolder}.
 * @returns {JSX.Element|null} The section, or nothing.
 */
function GroupPassSection({ order, holder }) {
  const summary = order.groupPass

  if (holder !== 'this-account' || !summary) return null

  if (!summary.available) {
    if (summary.unavailableReason !== 'TOO_MANY_TICKETS') return null

    return (
      <section id="group-pass" aria-labelledby="order-group-pass" className="mt-8">
        <h2 id="order-group-pass" className="text-xl font-semibold text-ink">
          Group pass
        </h2>
        <p className="mt-2 max-w-prose text-sm text-ink">
          This order has more than 50 tickets that admit, which is more than one group pass lets in.
          Use each ticket’s own pass at the door.
        </p>
      </section>
    )
  }

  const offered = currentTickets(order).some((ticket) => ticket.status === 'TRANSFER_PENDING')

  return (
    <section id="group-pass" aria-labelledby="order-group-pass" className="mt-8">
      <h2 id="order-group-pass" className="text-xl font-semibold text-ink">
        Group pass (admits {summary.admits})
      </h2>
      <p className="mt-2 max-w-prose text-sm text-ink">
        One QR that lets in every ticket on this order that you still hold. Each ticket keeps its
        own pass as well.
      </p>
      {offered ? (
        <p className="mt-2 max-w-prose text-sm text-ink-muted">
          A ticket you have offered to somebody is let in by the group pass until they accept. If it
          is let in first, the offer can no longer be accepted.
        </p>
      ) : null}
      <GroupPass reference={order.reference} admits={summary.admits} />
    </section>
  )
}

/**
 * @typedef {object} OrderPageProps
 * @property {Promise<{reference: string}>} params The route parameters.
 */

/**
 * The order page.
 *
 * @param {OrderPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function OrderPage({ params }) {
  const { reference } = await params
  // Asked alongside the order, and only to know which account is reading: the
  // layout has already sent anybody without a session to sign in. A read that
  // fails here is "could not check", never a guess.
  const sessionRead = readSession().catch(() => null)

  let order = null
  let failure = null

  try {
    order = await getMyOrder(reference)
  } catch (error) {
    if (NOT_ON_THIS_ACCOUNT.has(describeApiRefusal(error).state)) return <NoSuchOrder />

    failure = error
  }

  if (failure || !order) {
    return (
      <div>
        <Breadcrumbs
          trail={[
            { href: '/account/orders', label: 'Your orders' },
            { href: null, label: 'Order' },
          ]}
        />
        <h1 className="mt-3 text-h2 font-semibold text-ink">Order</h1>
        <ReadRefusal
          error={failure}
          what="This order"
          action="see this order"
          backHref="/account/orders"
          backLabel="Back to your orders"
        />
      </div>
    )
  }

  if (!readAsBuyer(order)) return <NoSuchOrder />

  const session = await sessionRead
  const holder = ticketHolder(order, session?.user?.id ?? null)
  const zone = order.event?.timezone || 'UTC'
  const payment = paymentSentence(order)
  const lines = order.items ?? []
  const atVenue = paidAtVenue(order)
  const venue = atVenue ? (order.venuePayment ?? null) : null
  const feeGross = Number.isInteger(order.feeGrossCents)
    ? order.feeGrossCents
    : (order.feesCents ?? 0)
  const waived = order.feeWaivedCents ?? 0

  return (
    <div>
      <Breadcrumbs
        trail={[
          { href: '/account/orders', label: 'Your orders' },
          { href: null, label: order.reference },
        ]}
      />

      <h1 className="mt-3 text-h2 font-semibold text-ink">{orderTitle(order)}</h1>
      {order.event ? (
        <p className="mt-1 text-ink-muted">
          {[eventWhenText(order.event), formatEventLocation(order.event)]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : (
        <p className="mt-1 text-ink-muted">The event this order was for is no longer listed.</p>
      )}

      {order.event?.status === 'DELETED' ? (
        <p className="mt-4 max-w-prose rounded-card border border-status-danger/25 bg-status-danger-soft p-4 text-sm text-ink">
          {deletedForHolder(
            (order.eventChanges ?? []).find((notice) => notice.kind === 'DELETED') ?? null,
          )}{' '}
          It is no longer on the site. What happened to this order, and any refund, is below.
        </p>
      ) : null}

      {(order.eventChanges ?? []).length > 0 ? (
        <div className="mt-8">
          <EventChangesList
            notices={order.eventChanges}
            timeZone={zone}
            sessions={orderNights(order)}
          />
        </div>
      ) : null}

      <section aria-labelledby="order-facts" className="mt-8">
        <h2 id="order-facts" className="text-xl font-semibold text-ink">
          The order
        </h2>
        <dl className="mt-2 divide-y divide-line rounded-card border border-line bg-surface-raised shadow-card px-4">
          <Fact term="Reference">
            <span className="font-mono">{order.reference}</span>
          </Fact>
          <Fact term="Status">
            <StatusChip meaning={orderStatusFor(order)} />
          </Fact>
          <Fact term="Placed">{instantText(order.createdAt, zone)}</Fact>
          {atVenue ? (
            // Only the booking fee is paid online, and only when there is one.
            <Fact term="Booking fee paid">
              {order.paidAt && (order.totalCents ?? 0) > 0 ? instantText(order.paidAt, zone) : ''}
            </Fact>
          ) : (
            <Fact term="Paid">{order.paidAt ? instantText(order.paidAt, zone) : ''}</Fact>
          )}
          <Fact term="Cancelled">
            {order.cancelledAt ? instantText(order.cancelledAt, zone) : ''}
          </Fact>
        </dl>
        <p className="mt-2 text-sm text-ink-muted">
          {order.event
            ? 'Times are in the event’s own timezone.'
            : 'Times are in UTC, because the event’s timezone is no longer known.'}
        </p>
      </section>

      <section aria-labelledby="order-money" className="mt-8">
        <h2 id="order-money" className="text-xl font-semibold text-ink">
          What it cost
        </h2>

        <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-surface shadow-card px-4">
          {lines.map((item) => (
            <li
              key={item.id ?? `${item.ticketTypeId}-${item.unitPriceCents}`}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm"
            >
              <span className="text-ink">
                <span className="font-medium">
                  {item.ticketTypeName ?? (item.quantity === 1 ? 'Ticket' : 'Tickets')}
                </span>
                <span className="text-ink-muted">
                  {', '}
                  {item.quantity} × {formatAmount(item.unitPriceCents, order.currency)}
                </span>
                {item.session ? (
                  <span className="block text-xs text-ink-muted">
                    {sessionDisplayLabel(item.session)}
                  </span>
                ) : null}
              </span>
              <span className="text-ink tabular-nums">
                {formatAmount(item.subtotalCents, order.currency)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 max-w-md">
          <Sum term="Subtotal">{formatAmount(order.subtotalCents, order.currency)}</Sum>
          {order.discountCents ? (
            <Sum term="Discount">−{formatAmount(order.discountCents, order.currency)}</Sum>
          ) : null}
          <Sum term="Booking fee">{formatAmount(feeGross, order.currency)}</Sum>
          {waived > 0 ? (
            <Sum term="Booking fee waived (referral code)">
              −{formatAmount(waived, order.currency)}
            </Sum>
          ) : null}
          {atVenue ? (
            <Sum term="Tax">{formatAmount(order.taxCents ?? 0, order.currency)}</Sum>
          ) : order.taxCents ? (
            <Sum term="Tax">{formatAmount(order.taxCents, order.currency)}</Sum>
          ) : null}
          {atVenue ? (
            <VenueSums order={order} />
          ) : (
            <Sum term="Total" emphasised>
              {formatAmount(order.totalCents, order.currency)}
            </Sum>
          )}
        </dl>

        {atVenue ? (
          <p className="mt-2 text-sm text-ink-muted">
            No tax is added to tickets paid at the venue.
          </p>
        ) : null}

        {atVenue && (venue?.passedOnUnpaidTickets ?? 0) > 0 ? (
          <p className="mt-2 text-sm text-ink">
            Passed on to other people: {venue.passedOnUnpaidTickets}{' '}
            {ticketWord(venue.passedOnUnpaidTickets)},{' '}
            {formatAmount(venue.passedOnUnpaidCents, order.currency)} to be paid at the door by
            whoever holds {venue.passedOnUnpaidTickets === 1 ? 'it' : 'them'}.
          </p>
        ) : null}

        {order.referralApplied ? (
          <p className="mt-2 text-sm text-ink">Booking fee waived with a referral code.</p>
        ) : null}

        {order.fee === null ? (
          <p className="mt-2 text-sm text-ink-muted">
            Booking fee terms were not recorded for orders placed before 9 October 2026.
          </p>
        ) : null}

        {payment ? <p className="mt-3 text-sm font-medium text-ink">{payment}</p> : null}

        {atVenue && order.status === 'PAID' && venue?.state === 'TO_PAY' ? (
          <p className="mt-2 max-w-prose text-sm text-ink">
            {(order.feesCents ?? 0) > 0
              ? 'Until a ticket is paid for at the door, the organiser or Desi-Event can cancel it; the booking fee is not refunded if they do.'
              : 'Until a ticket is paid for at the door, the organiser or Desi-Event can cancel it.'}
          </p>
        ) : null}

        {atVenue && (order.status === 'REFUNDED' || order.status === 'CANCELLED') ? (
          venueEndingSentences(order).map((sentence) => (
            <p key={sentence} className="mt-2 max-w-prose text-sm text-ink">
              {sentence}
            </p>
          ))
        ) : order.status === 'REFUNDED' ? (
          <p className="mt-2 text-sm text-ink">
            This order was refunded in full. Like the payment, the refund was simulated: no money
            went back to a card, because none was taken from one.
          </p>
        ) : null}

        {atVenue ? <VenueCancellations order={order} zone={zone} /> : null}
      </section>

      {/* The joining link of a paid online event, for the buyer, while one of
          the tickets they hold admits: the server decides, the page shows. */}
      {order.onlineJoinUrl && joinLinkHost(order.onlineJoinUrl) ? (
        <section aria-labelledby="order-join" className="mt-8">
          <h2 id="order-join" className="text-xl font-semibold text-ink">
            Join online
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            The organiser’s joining link. Anybody with it can use it, so keep it to the people
            holding these tickets.
          </p>
          <p className="mt-2">
            <a
              href={order.onlineJoinUrl}
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              className="rounded-sm font-bold text-accent-strong underline underline-offset-2 hover:decoration-2 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              Join online at {joinLinkHost(order.onlineJoinUrl)}
            </a>
          </p>
        </section>
      ) : null}

      <section aria-labelledby="order-tickets" className="mt-8">
        <h2 id="order-tickets" className="text-xl font-semibold text-ink">
          Tickets on this order
        </h2>
        <Tickets order={order} holder={holder} now={new Date()} />
      </section>

      <GroupPassSection order={order} holder={holder} />
    </div>
  )
}
