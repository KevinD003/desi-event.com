/**
 * "Payments at the venue" for one event (SPEC3 §12.9, SPEC3-XI §12.9).
 *
 * The money taken at the door is the organiser's: Desi-Event records the
 * amounts to help count them, and none of it is in the ledger, in payouts or
 * in refunds. This page shows what the report (`venuePayments.report`) says —
 * the figures, the payments taken, the bookings still unpaid and the unpaid
 * tickets cancelled — and offers "Cancel unpaid tickets…" on each unpaid
 * booking when the report says this reader may (`canCancelUnpaid`: an
 * organisation owner or administrator, or a Desi-Event administrator). A
 * finance member sees the same figures and tables and no button.
 *
 * Gated here by `finance:view` in the event's organisation (or platform
 * finance), and by the API again on every read. The report needs a second
 * factor within the FINANCE_VIEW window: a lapsed one is offered in place,
 * and the page reads again once it is confirmed.
 *
 * Tables become stacked cards below the small breakpoint, so nothing scrolls
 * sideways at 320 px; each cell carries its column's name for sighted readers
 * and the column header for everybody else.
 *
 * @file app/organizer/events/id/venue-payments/page.jsx
 */

import Link from 'next/link'

import { Breadcrumbs, Forbidden } from '../../../../../components/page-state.jsx'
import { ReadRefusal } from '../../../../../components/read-refusal.jsx'
import { UnpaidVenueBookings } from '../../../../../components/unpaid-venue-bookings.jsx'
import { sessionCan } from '../../../../../lib/capabilities.js'
import { getOrganizerEvent, getVenuePayments } from '../../../../../lib/organizer-api.js'
import { formatAmount } from '../../../../../lib/pricing.js'
import { readSession } from '../../../../../lib/session.js'
import {
  PAGER_LINK_CLASSES,
  formatInstant,
  isPastTheEnd,
  listHref,
  readPage,
} from '../../../../../lib/workspace-api.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Payments at the venue',
  robots: { index: false, follow: false },
}

/** The stacked-table classes: cards below `sm`, a table from `sm` up. */
const STACKED = Object.freeze({
  table: 'block w-full border-collapse text-sm sm:table',
  thead: 'sr-only sm:not-sr-only sm:table-header-group',
  tbody: 'block space-y-3 sm:table-row-group sm:space-y-0',
  row: 'block rounded-card border border-line bg-surface-raised p-3 shadow-card sm:table-row sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none',
  th: 'border-b border-line-strong px-3 py-2 text-left font-semibold text-ink',
  cell: 'flex flex-wrap justify-between gap-x-3 gap-y-1 py-1 text-ink sm:table-cell sm:border-b sm:border-line sm:px-3 sm:py-2',
  label: 'font-medium text-ink-muted sm:hidden',
})

/** A link's classes: a 44px target, underlined, with a visible focus ring. */
const LINK =
  'inline-flex min-h-11 items-center rounded-sm font-medium underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/** How a payment was taken, in words. */
const VIA = Object.freeze({ DOOR_TICKET: 'One ticket', DOOR_GROUP: 'Group pass' })

/** What the note under the unpaid bookings says to a reader who may cancel. */
export const CANCEL_NOTE =
  'You can cancel tickets that have not been paid for until their night ends. Their places are freed and sell again while their sales are open; Desi-Event keeps any booking fee paid online for them.'

/** The note on whose money this is (SPEC3 §12.9). */
export const MONEY_NOTE =
  'Money taken at the door is yours. Desi-Event records the amounts to help you count them; they are not in your payouts or in the figures from the ledger. The site adds no sales tax to tickets paid at the venue; you may still owe sales tax on those sales.'

/**
 * "1 ticket" or "3 tickets".
 *
 * @param {number} count How many.
 * @returns {string} The words.
 */
function tickets(count) {
  return `${count} ${count === 1 ? 'ticket' : 'tickets'}`
}

/**
 * Who cancelled, as the organisation reads it (SPEC3-XI §12.9).
 *
 * @param {{by: string, byName: string|null}} cancellation A cancellation.
 * @returns {string} "{name}" or "{name} (Desi-Event)".
 */
export function cancelledByWords(cancellation) {
  if (cancellation.by === 'DESI_EVENT') {
    return cancellation.byName ? `${cancellation.byName} (Desi-Event)` : 'The Desi-Event team'
  }

  return cancellation.byName ?? 'The organiser'
}

/**
 * One cell of a stacked table, with its column's name for the stacked view.
 *
 * @param {object} props Component props.
 * @param {string} props.label The column's name.
 * @param {string} [props.className] More classes.
 * @param {object} props.children The value.
 * @returns {JSX.Element} The cell.
 */
function Cell({ label, className = '', children }) {
  return (
    <td className={`${STACKED.cell} ${className}`}>
      <span aria-hidden="true" className={STACKED.label}>
        {label}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </td>
  )
}

/**
 * One figure: a label and its value, as a definition-list group.
 *
 * @param {object} props Component props.
 * @param {string} props.label What it is.
 * @param {string} props.value What it says.
 * @returns {JSX.Element} The figure.
 */
function Fact({ label, value }) {
  return (
    <div className="rounded-card border border-line bg-surface-raised p-4 shadow-card">
      <dt className="text-sm font-medium text-ink-muted">{label}</dt>
      <dd className="mt-1 font-display text-xl font-semibold break-words text-ink tabular-nums">
        {value}
      </dd>
    </div>
  )
}

/**
 * @typedef {object} VenuePaymentsPageProps
 * @property {Promise<{id: string}>} params The route parameters.
 * @property {Promise<Record<string, string|string[]|undefined>>} [searchParams] The query string.
 */

/**
 * The page.
 *
 * @param {VenuePaymentsPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function VenuePaymentsPage({ params, searchParams }) {
  const { id } = await params
  const query = (await searchParams) ?? {}
  const page = readPage(Array.isArray(query.page) ? query.page[0] : query.page)
  const session = await readSession()
  const path = `/organizer/events/${encodeURIComponent(id)}/venue-payments`

  let event = null
  let failure = null

  try {
    event = await getOrganizerEvent(id)
  } catch (error) {
    failure = error
  }

  if (!event) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-h2 font-semibold text-ink">Payments at the venue</h1>
        <ReadRefusal error={failure} what="This event" action="see this event" />
        <p className="mt-4">
          <Link href="/organizer/events" className={LINK}>
            Back to your events
          </Link>
        </p>
      </div>
    )
  }

  const eventHref = `/organizer/events/${encodeURIComponent(event.id)}`

  if (!sessionCan(session, 'finance:view', event.organizationId)) {
    return (
      <Forbidden area="Payments at the venue" backHref={eventHref} backLabel="Back to the event" />
    )
  }

  let report = null
  let reportFailure = null

  try {
    report = await getVenuePayments(event.id, page > 1 ? { page } : {})
  } catch (error) {
    reportFailure = error
  }

  const trail = [
    { href: '/organizer/events', label: 'Your events' },
    { href: eventHref, label: event.title },
    { label: 'Payments at the venue' },
  ]

  if (!report) {
    return (
      <div>
        <Breadcrumbs trail={trail} />
        <h1 className="mt-3 text-h2 font-semibold break-words text-ink">
          Payments at the venue — {event.title}
        </h1>
        <ReadRefusal
          error={reportFailure}
          what="The payments at the venue"
          action="see the payments taken at the door"
        />
        <p className="mt-4">
          <Link href={eventHref} className={LINK}>
            Back to the event
          </Link>
        </p>
      </div>
    )
  }

  const { currency, summary, payments, unpaidOrders, cancellations, pagination } = report
  const money = (cents) => formatAmount(cents, currency)
  const beyond = isPastTheEnd(payments.length + unpaidOrders.length, pagination, page)

  return (
    <div>
      <Breadcrumbs trail={trail} />
      <h1 className="mt-3 text-h2 font-semibold break-words text-ink">
        Payments at the venue — {event.title}
      </h1>

      <section aria-labelledby="venue-figures-heading" className="mt-6">
        <h2 id="venue-figures-heading" className="text-xl font-semibold text-ink">
          Figures
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Fact
            label="Tickets booked to pay at the door, not paid"
            value={`${summary.unpaidTickets.toLocaleString('en-US')} (${money(summary.unpaidCents)})`}
          />
          <Fact
            label="Payments taken at the door"
            value={`${money(summary.paidAtDoorCents)} (${tickets(summary.paidAtDoorTickets)})`}
          />
          {summary.eventEnded ? (
            <Fact
              label="Not paid by the end of the event"
              value={`${summary.notPaidByEndTickets.toLocaleString('en-US')} (${money(summary.notPaidByEndCents)})`}
            />
          ) : null}
          <Fact
            label="Unpaid tickets cancelled"
            value={`${summary.cancelledUnpaidTickets.toLocaleString('en-US')} (${money(summary.cancelledUnpaidCents)} no longer owed)`}
          />
          <Fact
            label="Booking fees on them, kept by Desi-Event"
            value={money(summary.feeKeptCents)}
          />
        </dl>

        {summary.paidOnRefundedCents > 0 ? (
          <p className="mt-3 max-w-prose rounded-card border border-status-warning/30 bg-status-warning-soft p-4 text-sm text-ink">
            Payments taken at the door on bookings later refunded or cancelled:{' '}
            {money(summary.paidOnRefundedCents)}. If you return them, return them yourself;
            Desi-Event does not hold this money.
          </p>
        ) : null}

        <p className="mt-3 max-w-prose text-sm text-ink-muted">{MONEY_NOTE}</p>
      </section>

      {beyond ? (
        <p className="mt-6 text-sm text-ink">
          This page is past the end of the list.{' '}
          <Link href={listHref(path, { page: 1 })} className={LINK}>
            Go to the first page
          </Link>
        </p>
      ) : null}

      <section aria-labelledby="venue-payments-heading" className="mt-8">
        <h2 id="venue-payments-heading" className="text-xl font-semibold text-ink">
          Payments taken at the door
        </h2>
        {payments.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            No payment has been taken at the door for this event.
          </p>
        ) : (
          <div className="mt-3">
            <table className={STACKED.table}>
              <caption className="sr-only">Payments taken at the door</caption>
              <thead className={STACKED.thead}>
                <tr>
                  {['When', 'Night', 'Taken by', 'Booking', 'Tickets', 'Amount', 'How'].map(
                    (column) => (
                      <th
                        key={column}
                        scope="col"
                        className={`${STACKED.th} ${column === 'Amount' ? 'text-right' : ''}`}
                      >
                        {column}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className={STACKED.tbody}>
                {payments.map((payment) => (
                  <tr key={payment.id} className={STACKED.row}>
                    <Cell label="When">
                      <time dateTime={payment.recordedAt}>{formatInstant(payment.recordedAt)}</time>
                    </Cell>
                    <Cell label="Night">{payment.nightLabel ?? 'Every night'}</Cell>
                    <Cell label="Taken by">{payment.recordedByName ?? 'A former member'}</Cell>
                    <Cell label="Booking" className="font-mono">
                      {payment.orderReference}
                    </Cell>
                    <Cell label="Tickets">
                      {`${tickets(payment.ticketCount)}: ${payment.tickets
                        .map((ticket) => ticket.attendeeName ?? 'No name on the ticket')
                        .join(', ')}`}
                    </Cell>
                    <Cell label="Amount" className="tabular-nums sm:text-right">
                      {money(payment.amountCents)}
                    </Cell>
                    <Cell label="How">{VIA[payment.via] ?? 'At the door'}</Cell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <UnpaidVenueBookings
        eventId={event.id}
        currency={currency}
        bookings={unpaidOrders}
        canCancel={Boolean(report.canCancelUnpaid)}
        note={report.canCancelUnpaid ? CANCEL_NOTE : null}
      />

      <section aria-labelledby="venue-cancellations-heading" className="mt-8">
        <h2 id="venue-cancellations-heading" className="text-xl font-semibold text-ink">
          Cancelled unpaid tickets
        </h2>
        {cancellations.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No unpaid tickets have been cancelled.</p>
        ) : (
          <div className="mt-3">
            <table className={STACKED.table}>
              <caption className="sr-only">Cancelled unpaid tickets</caption>
              <thead className={STACKED.thead}>
                <tr>
                  {['When', 'By', 'Booking', 'Tickets', 'No longer owed', 'Reason'].map(
                    (column) => (
                      <th
                        key={column}
                        scope="col"
                        className={`${STACKED.th} ${column === 'No longer owed' ? 'text-right' : ''}`}
                      >
                        {column}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className={STACKED.tbody}>
                {cancellations.map((cancellation) => (
                  <tr key={cancellation.id} className={STACKED.row}>
                    <Cell label="When">
                      <time dateTime={cancellation.at}>{formatInstant(cancellation.at)}</time>
                    </Cell>
                    <Cell label="By">{cancelledByWords(cancellation)}</Cell>
                    <Cell label="Booking" className="font-mono">
                      {cancellation.orderReference}
                    </Cell>
                    <Cell label="Tickets" className="tabular-nums">
                      {cancellation.ticketCount}
                    </Cell>
                    <Cell label="No longer owed" className="tabular-nums sm:text-right">
                      {money(cancellation.basisCents)}
                    </Cell>
                    <Cell label="Reason">{cancellation.reason}</Cell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {report.cancellationsHasMore ? (
          <p className="mt-3 text-sm text-ink-muted">Showing the 50 newest cancellations.</p>
        ) : null}
      </section>

      {pagination && (pagination.hasPreviousPage || pagination.hasNextPage) ? (
        <nav aria-label="Pages" className="mt-6 flex flex-wrap gap-2">
          {pagination.hasPreviousPage ? (
            <Link href={listHref(path, { page: page - 1 })} className={PAGER_LINK_CLASSES}>
              Previous page
            </Link>
          ) : null}
          {pagination.hasNextPage ? (
            <Link href={listHref(path, { page: page + 1 })} className={PAGER_LINK_CLASSES}>
              Next page
            </Link>
          ) : null}
        </nav>
      ) : null}

      <p className="mt-8">
        <Link href={eventHref} className={LINK}>
          Back to the event
        </Link>
      </p>
    </div>
  )
}
