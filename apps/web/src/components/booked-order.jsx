/**
 * The booking, once the order has been placed.
 *
 * A polite status, not an assertive alert: it replaces the form the buyer just
 * pressed, and nothing about it is urgent. Shared by both checkouts.
 *
 * A booking to pay at the venue is booked, not paid (SPEC3 §12.1, SPEC3-XI
 * §12.1): its heading says so, it names what is paid at the door, what was paid
 * online (the booking fee, simulated) or that nothing was, and that unpaid
 * tickets can be cancelled by the organiser or Desi-Event until they are paid
 * for. It never reads "Paid".
 *
 * @module components/booked-order
 */

import Link from 'next/link'

import { formatAmount } from '../lib/pricing.js'
import { EventArt } from './event-art.jsx'
import { CheckIcon } from './icons.jsx'
import { OUTLINE_LINK, PRIMARY_LINK } from './link-classes.js'

/** What a booking to pay at the venue says about the door, once booked. */
export const AT_THE_DOOR_SENTENCE =
  'Show your tickets at the door. The steward takes the payment before letting you in.'

/**
 * What a booking to pay at the venue says about cancelling unpaid tickets
 * (SPEC3-XI §12.1): the booking fee is not refunded if they are cancelled, or,
 * when a referral code removed it, nothing was paid online for them.
 *
 * @param {boolean} waived Whether a referral code removed the booking fee.
 * @returns {string} The sentence.
 */
export function unpaidCancellationSentence(waived) {
  return waived
    ? 'Until you pay at the door, the organiser or Desi-Event can cancel unpaid tickets, and nothing was paid online for them.'
    : 'Until you pay at the door, the organiser or Desi-Event can cancel unpaid tickets, and the booking fee is not refunded if they do.'
}

/**
 * The confirmation.
 *
 * @param {object} props Component props.
 * @param {object} props.order The order as the API returned it.
 * @param {object} [props.event] The event, for its poster and title.
 * @param {boolean} [props.named] Whether the buyer gave any ticket a name.
 * @param {number|null} [props.venueDueCents] What the quote said is paid at the door, when the order does not say.
 * @returns {JSX.Element} The confirmation.
 */
export function BookedOrder({ order, event = null, named = false, venueDueCents = null }) {
  const tickets = (order.tickets ?? []).length
  const atVenue = order.paymentMethod === 'AT_VENUE'
  const due = order.venuePayment?.dueCents ?? venueDueCents ?? 0
  const waived = Boolean(order.referralApplied) || (order.feeWaivedCents ?? 0) > 0
  const online = order.totalCents ?? 0

  return (
    <section
      aria-labelledby="booked-heading"
      role="status"
      className="overflow-hidden rounded-card bg-surface-raised shadow-card"
    >
      <div aria-hidden="true" className="h-1 bg-status-success" />
      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-start sm:p-8">
        <span
          aria-hidden="true"
          className="flex h-13 w-13 shrink-0 items-center justify-center rounded-full bg-status-success-soft text-status-success"
        >
          <CheckIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="booked-heading" className="text-h2 font-semibold text-status-success">
            {atVenue ? 'Booked — pay at the door' : 'Booked'}
          </h2>
          {event?.title ? <p className="mt-1 font-bold text-ink">{event.title}</p> : null}
          {atVenue ? (
            <p className="mt-3 font-semibold text-ink">
              Booked. Pay {formatAmount(due, order.currency)} at the door.
            </p>
          ) : null}
          <p className="mt-3 text-ink">
            Order <span className="font-mono font-semibold tracking-wide">{order.reference}</span>
            {tickets > 0 ? ` · ${tickets} ${tickets === 1 ? 'ticket' : 'tickets'}` : ''} ·{' '}
            {atVenue
              ? online > 0
                ? `Paid online (simulated) ${formatAmount(online, order.currency)}`
                : 'Nothing paid online'
              : formatAmount(order.totalCents, order.currency)}
          </p>
          {order.discountCents > 0 ? (
            <p className="mt-1 text-sm text-ink-muted">
              Including a discount of {formatAmount(order.discountCents, order.currency)}.
            </p>
          ) : null}
          {named ? (
            <p className="mt-1 text-sm text-ink-muted">
              Each ticket carries the name you gave it; a ticket you left blank carries yours.
            </p>
          ) : null}
          {atVenue ? (
            <>
              <p className="mt-2 max-w-prose text-sm text-ink">{AT_THE_DOOR_SENTENCE}</p>
              <p className="mt-2 max-w-prose text-sm text-ink-muted">
                {unpaidCancellationSentence(waived)}
              </p>
              <p className="mt-2 max-w-prose text-sm text-ink-muted">
                {online > 0
                  ? 'The booking fee payment was simulated: no card was asked for and no money moved. The tickets are in your account now.'
                  : 'The tickets are in your account now.'}
              </p>
            </>
          ) : (
            <p className="mt-2 max-w-prose text-sm text-ink-muted">
              The payment was simulated: no card was asked for and no money moved. The tickets are
              in your account now.
            </p>
          )}
          <p className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/tickets" className={PRIMARY_LINK}>
              Your tickets
            </Link>
            <Link
              href={`/account/orders/${encodeURIComponent(order.reference)}`}
              className={OUTLINE_LINK}
            >
              This order
            </Link>
          </p>
        </div>
        {event?.slug ? (
          <div
            aria-hidden="true"
            className="hidden h-20 w-30 shrink-0 overflow-hidden rounded-control sm:block"
          >
            <EventArt event={event} className="h-full" decorative sizes="120px" />
          </div>
        ) : null}
      </div>
    </section>
  )
}
