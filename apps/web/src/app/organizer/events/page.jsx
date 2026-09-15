/**
 * Every event this organiser can work on, and whose turn each one is.
 *
 * Sorted newest first, because the thing somebody just created is the thing
 * they came back for. Grouped by nothing: a list of twelve events wants a
 * status word per row, not four accordions.
 *
 * The status column says whose move it is rather than only what the state is
 * called. "Waiting for review" and "Changes requested" are both amber; only one
 * of them is something to do this afternoon.
 *
 * `@file` rather than `@module`: `events` is fine, but the sibling pages use
 * `@file` for the same reason and consistency is worth more than the two
 * characters.
 *
 * @file app/organizer/events/page
 */

import Link from 'next/link'

import { Badge, Button, EmptyState } from '../../../components/ui.jsx'
import { listOrganizerEvents } from '../../../lib/organizer-api.js'
import { statusReading } from '../../../lib/event-status.js'
import { formatEventDate } from '../../../lib/format.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Your events',
  robots: { index: false, follow: false },
}

/**
 * The list.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function OrganizerEventsPage() {
  let events = []
  let failure = null

  try {
    const result = await listOrganizerEvents()
    events = result.events
  } catch (error) {
    // Organiser screens never fall back to the sample catalogue. Showing
    // somebody a list that is not their list would invite them to act on
    // fiction.
    failure = error instanceof Error ? error.message : String(error)
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold text-indigo-night-900">Your events</h1>
        <Link
          href="/organizer/events/new"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-marigold-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Create an event
        </Link>
      </div>

      {failure ? (
        <p
          role="alert"
          className="mt-6 rounded-card border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
        >
          Your events could not be loaded: {failure}. Nothing has been guessed at — reload, and if
          it keeps happening the service is down.
        </p>
      ) : null}

      {!failure && events.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No events yet"
            description="An event starts as a draft that only your team can see. Nothing is public until a moderator has approved it and you have chosen to publish."
          >
            <Button as={Link} href="/organizer/events/new">
              Create your first event
            </Button>
          </EmptyState>
        </div>
      ) : null}

      {events.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {events.map((event) => {
            const reading = statusReading(event.status)

            return (
              <li
                key={event.id}
                className="rounded-card border border-slate-200 bg-white p-4 focus-within:ring-2 focus-within:ring-marigold-500"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold text-indigo-night-900">
                      <Link
                        href={`/organizer/events/${event.id}`}
                        className="rounded-sm underline underline-offset-4 hover:text-marigold-700 focus-visible:outline-none"
                      >
                        {event.title}
                      </Link>
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatEventDate(event.startsAt, event.timezone)}
                      {event.venueName ? ` · ${event.venueName}` : ''}
                      {event.city ? `, ${event.city}` : ''}
                    </p>
                  </div>

                  <div className="text-right">
                    <Badge variant={reading.tone} srLabel="State:">
                      {reading.label}
                    </Badge>
                    <p className="mt-1 text-sm text-slate-600">
                      {reading.whose === 'nobody' ? 'Nothing to do' : `Waiting on ${reading.whose}`}
                    </p>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
