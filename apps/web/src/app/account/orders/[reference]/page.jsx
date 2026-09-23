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
 * An order line carries `ticketTypeId`, a quantity and prices — not the tier's
 * name, and the event summary carries no tiers. So a line reads "Tickets,
 * 2 × ₹500.00" rather than a name fetched from somewhere else or made up.
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
 * ## Money
 *
 * Every payment is simulated, and the page says so under the total. Refunds
 * are not requested here; a refunded order says it was refunded and nothing
 * else about refunds is claimed.
 *
 * @module app/account/orders/reference/page
 */

import Link from 'next/link'

import { Breadcrumbs } from '../../../../components/page-state.jsx'
import { ReadRefusal } from '../../../../components/read-refusal.jsx'
import { getMyOrder } from '../../../../lib/account-api.js'
import { formatEventLocation } from '../../../../lib/format.js'
import { formatAmount } from '../../../../lib/pricing.js'
import { describeApiRefusal } from '../../../../lib/refusal.js'
import { readSession } from '../../../../lib/session.js'
import { eventIsOver } from '../../../../lib/wallet.js'
import {
  currentTickets,
  eventWhenText,
  handedAnyOn,
  instantText,
  openTicketHint,
  orderStatusMeaning,
  orderTitle,
  readAsBuyer,
  ticketCount,
  ticketHolder,
  ticketStatusMeaning,
  tookPayment,
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
  if (tookPayment(order)) return 'Simulated payment — no card was charged and no money moved.'
  if (['PENDING', 'CANCELLED', 'EXPIRED'].includes(order.status)) return 'Not paid.'

  return null
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

  const tickets = currentTickets(order)
  const bought = ticketCount(order)
  const handedOn = handedAnyOn(order)
  const missing = missingSentence(bought, tickets.length, handedOn)
  // A ticket's page opens only for the account holding it, and checkout
  // issues the tickets to the account that placed the order.
  const openable = holder === 'this-account'
  const unlinked = openable ? null : unlinkedSentence(holder)

  return (
    <>
      {tickets.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {tickets.map((ticket, index) => {
            const label = `Ticket ${index + 1} of ${tickets.length}`

            return (
              <li
                key={ticket.id}
                className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-card border border-line bg-surface shadow-card px-4 py-2"
              >
                {openable ? (
                  <Link href={`/tickets/${encodeURIComponent(ticket.id)}`} className={LINK}>
                    {label}
                  </Link>
                ) : (
                  <span className="font-medium text-ink">{label}</span>
                )}
                <StatusChip meaning={ticketStatusMeaning(ticket.status)} />
              </li>
            )
          })}
        </ul>
      ) : null}

      {unlinked && tickets.length > 0 ? (
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

      {tickets.length > 0 && openable ? (
        <p className="mt-3 text-sm text-ink-muted">
          {openTicketHint(tickets, { eventOver: eventIsOver({ event: order.event }, now) })}
        </p>
      ) : null}
    </>
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

      <section aria-labelledby="order-facts" className="mt-8">
        <h2 id="order-facts" className="text-xl font-semibold text-ink">
          The order
        </h2>
        <dl className="mt-2 divide-y divide-line rounded-card border border-line bg-surface-raised shadow-card px-4">
          <Fact term="Reference">
            <span className="font-mono">{order.reference}</span>
          </Fact>
          <Fact term="Status">
            <StatusChip meaning={orderStatusMeaning(order.status)} />
          </Fact>
          <Fact term="Placed">{instantText(order.createdAt, zone)}</Fact>
          <Fact term="Paid">{order.paidAt ? instantText(order.paidAt, zone) : ''}</Fact>
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
                <span className="font-medium">{item.quantity === 1 ? 'Ticket' : 'Tickets'}</span>
                <span className="text-ink-muted">
                  {', '}
                  {item.quantity} × {formatAmount(item.unitPriceCents, order.currency)}
                </span>
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
          <Sum term="Booking fee">{formatAmount(order.feesCents ?? 0, order.currency)}</Sum>
          {order.taxCents ? (
            <Sum term="Tax">{formatAmount(order.taxCents, order.currency)}</Sum>
          ) : null}
          <Sum term="Total" emphasised>
            {formatAmount(order.totalCents, order.currency)}
          </Sum>
        </dl>

        {payment ? <p className="mt-3 text-sm font-medium text-ink">{payment}</p> : null}

        {order.status === 'REFUNDED' ? (
          <p className="mt-2 text-sm text-ink">
            This order was refunded in full. Like the payment, the refund was simulated: no money
            went back to a card, because none was taken from one.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="order-tickets" className="mt-8">
        <h2 id="order-tickets" className="text-xl font-semibold text-ink">
          Tickets on this order
        </h2>
        <Tickets order={order} holder={holder} now={new Date()} />
      </section>
    </div>
  )
}
