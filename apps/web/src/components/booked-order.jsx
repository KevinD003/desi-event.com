/**
 * The booking, once the order has been placed.
 *
 * A polite status, not an assertive alert: it replaces the form the buyer just
 * pressed, and nothing about it is urgent. Shared by both checkouts.
 *
 * @module components/booked-order
 */

import Link from 'next/link'

import { formatAmount } from '../lib/pricing.js'
import { EventArt } from './event-art.jsx'
import { CheckIcon } from './icons.jsx'
import { OUTLINE_LINK, PRIMARY_LINK } from './link-classes.js'

/**
 * The confirmation.
 *
 * @param {object} props Component props.
 * @param {object} props.order The order as the API returned it.
 * @param {object} [props.event] The event, for its poster and title.
 * @param {boolean} [props.named] Whether the buyer gave any ticket a name.
 * @returns {JSX.Element} The confirmation.
 */
export function BookedOrder({ order, event = null, named = false }) {
  const tickets = (order.tickets ?? []).length

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
            Booked
          </h2>
          {event?.title ? <p className="mt-1 font-bold text-ink">{event.title}</p> : null}
          <p className="mt-3 text-ink">
            Order <span className="font-mono font-semibold tracking-wide">{order.reference}</span>
            {tickets > 0 ? ` · ${tickets} ${tickets === 1 ? 'ticket' : 'tickets'}` : ''} ·{' '}
            {formatAmount(order.totalCents, order.currency)}
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
          <p className="mt-2 max-w-prose text-sm text-ink-muted">
            The payment was simulated: no card was asked for and no money moved. The tickets are in
            your account now.
          </p>
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
