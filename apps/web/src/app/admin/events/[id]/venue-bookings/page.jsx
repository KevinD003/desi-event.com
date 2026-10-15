/**
 * "Bookings waiting to be paid at the door" for one event, for the team at
 * The Desi Events (SPEC3-XI §12.13).
 *
 * A platform administrator holding `venue_booking:cancel` (ADMIN, SUPER_ADMIN)
 * may cancel unpaid pay-at-the-venue tickets of any event; this page lists the
 * event's bookings that still owe at the door and offers "Cancel unpaid
 * tickets…" on each. It shows no buyer or attendee name: a platform reader is
 * sent none, and the tickets are labelled "Ticket 2 of 3".
 *
 * Gated here by the session's own `venue_booking:cancel` (anybody else gets
 * the administration area's refusal), and by the API again: the list
 * (`venueBookings.unpaid`) asks for a second factor within the FINANCE_VIEW
 * window before anything else, offered in place, and the page reads again
 * once it is confirmed. Only booleans cross to the client.
 *
 * @file app/admin/events/id/venue-bookings/page.jsx
 */

import Link from 'next/link'

import { Breadcrumbs } from '../../../../../components/page-state.jsx'
import { ReadRefusal } from '../../../../../components/read-refusal.jsx'
import { AreaRefusal } from '../../../../../components/shells.jsx'
import { UnpaidVenueBookings } from '../../../../../components/unpaid-venue-bookings.jsx'
import { sessionCan } from '../../../../../lib/capabilities.js'
import { getVenueBookings } from '../../../../../lib/organizer-api.js'
import { readSession } from '../../../../../lib/session.js'
import {
  PAGER_LINK_CLASSES,
  isPastTheEnd,
  listHref,
  readPage,
} from '../../../../../lib/workspace-api.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Bookings waiting to be paid at the door',
  robots: { index: false, follow: false },
}

/** The page's heading. */
export const HEADING = 'Bookings waiting to be paid at the door'

/** What the page is for (SPEC3-XI §12.13). */
export const INTRO =
  'Tickets booked to pay at the door and not paid for yet. Cancelling them frees their places; The Desi Events keeps any booking fee paid online for them.'

/** A link's classes: a 44px target, underlined, with a visible focus ring. */
const LINK =
  'inline-flex min-h-11 items-center rounded-sm font-medium underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/**
 * @typedef {object} AdminVenueBookingsPageProps
 * @property {Promise<{id: string}>} params The route parameters.
 * @property {Promise<Record<string, string|string[]|undefined>>} [searchParams] The query string.
 */

/**
 * The page.
 *
 * @param {AdminVenueBookingsPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function AdminVenueBookingsPage({ params, searchParams }) {
  const { id } = await params
  const query = (await searchParams) ?? {}
  const page = readPage(Array.isArray(query.page) ? query.page[0] : query.page)
  const session = await readSession()

  if (!sessionCan(session, 'venue_booking:cancel')) return <AreaRefusal area="admin" />

  const eventHref = `/admin/events/${encodeURIComponent(id)}`
  const path = `${eventHref}/venue-bookings`

  let list = null
  let failure = null

  try {
    list = await getVenueBookings(id, page > 1 ? { page } : {})
  } catch (error) {
    failure = error
  }

  const trail = [
    { href: '/admin/events', label: 'Events' },
    { href: eventHref, label: list?.eventTitle ?? 'Event' },
    { label: HEADING },
  ]

  if (!list) {
    return (
      <div>
        <Breadcrumbs trail={trail} />
        <h1 className="mt-3 text-h2 font-semibold text-ink">{HEADING}</h1>
        <ReadRefusal
          error={failure}
          what="The bookings waiting to be paid at the door"
          action="see the bookings waiting to be paid at the door"
        />
        <p className="mt-4">
          <Link href={eventHref} className={LINK}>
            Back to the event
          </Link>
        </p>
      </div>
    )
  }

  const { pagination } = list
  const beyond = isPastTheEnd(list.bookings.length, pagination, page)

  return (
    <div>
      <Breadcrumbs trail={trail} />
      <h1 className="mt-3 text-h2 font-semibold text-ink">{HEADING}</h1>
      <p className="mt-1 text-lg font-medium break-words text-ink">{list.eventTitle}</p>
      <p className="mt-3 max-w-prose text-ink-muted">{INTRO}</p>

      {beyond ? (
        <p className="mt-6 text-sm text-ink">
          This page is past the end of the list.{' '}
          <Link href={listHref(path, { page: 1 })} className={LINK}>
            Go to the first page
          </Link>
        </p>
      ) : (
        <UnpaidVenueBookings
          eventId={list.eventId}
          currency={list.currency}
          bookings={list.bookings}
          canCancel
          layout="list"
          empty="No bookings are waiting to be paid at the door."
          timeZone={list.timezone ?? 'UTC'}
        />
      )}

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
