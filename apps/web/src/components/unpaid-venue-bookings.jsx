'use client'

/**
 * Bookings waiting to be paid at the door, each with its "Cancel unpaid
 * tickets…" button when this reader may cancel them (SPEC3-XI §12.9, §12.13).
 *
 * Shared by the organiser's "Payments at the venue" page (a table: booking,
 * buyer, unpaid tickets, amount) and the Desi-Event team's "Bookings waiting
 * to be paid at the door" (a list with no names: booking, when it was placed,
 * unpaid tickets and amount). Whether this reader may cancel is a boolean the
 * server page was given by the API (`canCancelUnpaid`) or worked out from the
 * session; this component asks nothing about capabilities.
 *
 * Each button's accessible name begins with its visible words and names its
 * booking, "Cancel unpaid tickets in booking {reference}", so a screen
 * reader's list of buttons tells the bookings apart (WCAG 2.5.3, 2.4.6). It
 * opens the cancel dialog; once tickets are cancelled the dialog closes, the
 * outcome is said once in this section's polite live region, focus moves to
 * the section's heading, and the page is read again from the server so its
 * figures and tables follow.
 *
 * Tables become stacked cards below the small breakpoint: every cell carries
 * its column's name, hidden from assistive technology, which reads the
 * column header instead; nothing scrolls sideways at 320 px.
 *
 * @module components/unpaid-venue-bookings
 */

import { useRouter } from 'next/navigation'
import { useId, useRef, useState } from 'react'

import { CancelUnpaidTicketsDialog, cancellationOutcome } from './cancel-unpaid-tickets-dialog.jsx'
import { useFocusAfterRender } from './focus-after-render.jsx'
import { Button } from './ui.jsx'
import { formatDateIn } from '../lib/format.js'
import { formatAmount } from '../lib/pricing.js'

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

/**
 * A booking's placing date, in words: the day it was in the event's zone, as
 * the event keeps time (the buyer pages write the event's times the same way).
 *
 * @param {string|null|undefined} value An ISO timestamp.
 * @param {string} timeZone The event's IANA zone.
 * @returns {string} "Oct 12, 2026", or an empty string.
 */
function placedWords(value, timeZone) {
  return formatDateIn(value, timeZone) ?? ''
}

/**
 * The name a booking's cancel button is known by.
 *
 * @param {string} reference The booking.
 * @returns {string} "Cancel unpaid tickets in booking {reference}".
 */
export function cancelButtonName(reference) {
  return `Cancel unpaid tickets in booking ${reference}`
}

/**
 * @typedef {object} UnpaidVenueBookingsProps
 * @property {string} eventId The event.
 * @property {string} currency The event's currency.
 * @property {Array<{orderReference: string, placedAt?: string, buyerName?: string|null, unpaidTickets: number, unpaidCents: number}>} bookings The bookings.
 * @property {boolean} canCancel Whether this reader may cancel unpaid tickets (the server's answer).
 * @property {'table'|'list'} [layout] The organiser's table, or the Desi-Event team's list with no names.
 * @property {string} [heading] The section's heading.
 * @property {string} [empty] What an empty list says.
 * @property {string|null} [note] A note under the list.
 * @property {string} [timeZone] The event's IANA zone, which dates and times are written in; UTC (named) when unknown.
 */

/**
 * The section.
 *
 * @param {UnpaidVenueBookingsProps} props Component props.
 * @returns {JSX.Element} The section.
 */
export function UnpaidVenueBookings({
  eventId,
  currency,
  bookings,
  canCancel,
  layout = 'table',
  heading = 'Bookings with unpaid tickets',
  empty = 'No bookings are waiting to be paid at the door.',
  note = null,
  timeZone = 'UTC',
}) {
  const router = useRouter()
  const id = useId()
  const headingId = `${id}-heading`
  const headingRef = useRef(null)
  const focusAfterRender = useFocusAfterRender()
  const [open, setOpen] = useState(null)
  const [announcement, setAnnouncement] = useState('')

  /**
   * Tickets were cancelled: close, say what happened once, and read again.
   *
   * @param {object} result The cancellation.
   * @returns {void}
   */
  function cancelled(result) {
    setOpen(null)
    setAnnouncement(cancellationOutcome(result, timeZone))
    focusAfterRender(headingRef)
    router.refresh()
  }

  /**
   * The button for one booking.
   *
   * @param {string} reference The booking.
   * @returns {JSX.Element|null} The button, or nothing for a reader who may not cancel.
   */
  function opener(reference) {
    if (!canCancel) return null

    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-label={cancelButtonName(reference)}
        onClick={() => {
          setAnnouncement('')
          setOpen(reference)
        }}
      >
        Cancel unpaid tickets…
      </Button>
    )
  }

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="text-xl font-semibold text-ink focus-visible:outline-none"
      >
        {heading}
      </h2>

      <div
        role="status"
        aria-live="polite"
        className={
          announcement
            ? 'mt-3 rounded-card border border-status-success/25 bg-status-success-soft p-4 text-sm text-ink'
            : 'sr-only'
        }
      >
        {announcement}
      </div>

      {bookings.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{empty}</p>
      ) : layout === 'list' ? (
        <ul className="mt-3 space-y-3">
          {bookings.map((booking) => (
            <li
              key={booking.orderReference}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface-raised p-4 shadow-card"
            >
              <p className="min-w-0 text-sm break-words text-ink">
                {[
                  `Booking ${booking.orderReference}`,
                  booking.placedAt ? `placed ${placedWords(booking.placedAt, timeZone)}` : null,
                  `${booking.unpaidTickets} unpaid (${formatAmount(booking.unpaidCents, currency)})`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {opener(booking.orderReference)}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3">
          <table className={STACKED.table}>
            <caption className="sr-only">{heading}</caption>
            <thead className={STACKED.thead}>
              <tr>
                <th scope="col" className={STACKED.th}>
                  Booking
                </th>
                <th scope="col" className={STACKED.th}>
                  Buyer
                </th>
                <th scope="col" className={`${STACKED.th} text-right`}>
                  Unpaid tickets
                </th>
                <th scope="col" className={`${STACKED.th} text-right`}>
                  To pay at the door
                </th>
                {canCancel ? (
                  <th scope="col" className={STACKED.th}>
                    <span className="sr-only">Cancel</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className={STACKED.tbody}>
              {bookings.map((booking) => (
                <tr key={booking.orderReference} className={STACKED.row}>
                  <td className={`${STACKED.cell} font-mono`}>
                    <span aria-hidden="true" className={`${STACKED.label} font-sans`}>
                      Booking
                    </span>
                    {booking.orderReference}
                  </td>
                  <td className={`${STACKED.cell} break-words`}>
                    <span aria-hidden="true" className={STACKED.label}>
                      Buyer
                    </span>
                    {booking.buyerName || 'No name on the booking'}
                  </td>
                  <td className={`${STACKED.cell} tabular-nums sm:text-right`}>
                    <span aria-hidden="true" className={STACKED.label}>
                      Unpaid tickets
                    </span>
                    {booking.unpaidTickets}
                  </td>
                  <td className={`${STACKED.cell} tabular-nums sm:text-right`}>
                    <span aria-hidden="true" className={STACKED.label}>
                      To pay at the door
                    </span>
                    {formatAmount(booking.unpaidCents, currency)}
                  </td>
                  {canCancel ? (
                    <td className={STACKED.cell}>{opener(booking.orderReference)}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {note ? <p className="mt-3 max-w-prose text-sm text-ink-muted">{note}</p> : null}

      {open ? (
        <CancelUnpaidTicketsDialog
          eventId={eventId}
          orderReference={open}
          onClose={() => setOpen(null)}
          onCancelled={cancelled}
        />
      ) : null}
    </section>
  )
}
