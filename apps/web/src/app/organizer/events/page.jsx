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
 * ## Only this organiser's events
 *
 * Asked per organisation. `GET /v1/events` without an organisation answers
 * with the public catalogue *plus* the caller's own drafts, which is right for
 * a listing and wrong here: "Your events" used to list every public event on
 * the platform, other organisations' included, each one a link into an editor
 * that would then refuse. Each organisation the session may see drafts in is
 * asked for by id, and the API scopes the answer to it. A platform
 * administrator with no membership is the one reader for whom the whole
 * platform is the list, and the page says that is what it is showing.
 *
 * `@file` rather than `@module`: `events` is fine, but the sibling pages use
 * `@file` for the same reason and consistency is worth more than the two
 * characters.
 *
 * @file app/organizer/events/page
 */

import Link from 'next/link'

import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { Badge, EmptyState } from '../../../components/ui.jsx'
import { listOrganizerEvents } from '../../../lib/organizer-api.js'
import { membershipsWith, readSession, sessionCan } from '../../../lib/session.js'
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
  const session = await readSession()
  const organizations = membershipsWith(session, 'event:view_draft')
  const platformWide = organizations.length === 0 && sessionCan(session, 'platform:admin')

  let events = []
  let truncated = false
  let failure = null

  try {
    const results = platformWide
      ? [await listOrganizerEvents()]
      : await Promise.all(
          organizations.map(({ organizationId }) => listOrganizerEvents({ organizationId })),
        )

    // Each organisation's events newest first, one organisation after the
    // next: a summary carries no creation time to interleave them by.
    events = results.flatMap((result) => result.events)
    truncated = results.some((result) => result.pagination?.hasNextPage)
  } catch (error) {
    // Organiser screens never fall back to the sample catalogue. Showing
    // somebody a list that is not their list would invite them to act on
    // fiction.
    failure = error
  }

  // Which organisation an event belongs to is worth a word only when there is
  // more than one it could be.
  const showOrganization = platformWide || organizations.length > 1

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">Your events</h1>
        <Link
          href="/organizer/events/new"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-action-primary px-4 text-sm font-medium text-action-primary-ink shadow-sm hover:bg-action-primary-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Create an event
        </Link>
      </div>

      {platformWide ? (
        <p className="mt-2 max-w-3xl text-ink-muted">
          This account runs the platform and belongs to no organisation, so this is every
          organisation&rsquo;s events, not a list of its own.
        </p>
      ) : null}

      {failure ? <ReadRefusal error={failure} what="Your events" action="see your events" /> : null}

      {!failure && !platformWide && organizations.length === 0 ? (
        <p className="mt-6 max-w-3xl rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink">
          This account can see no organisation&rsquo;s drafts, so there is no list of events to show
          here.
        </p>
      ) : null}

      {truncated ? (
        <p className="mt-4 text-sm text-ink-muted">
          The most recently created events are listed; older ones are not shown here.
        </p>
      ) : null}

      {!failure && (platformWide || organizations.length > 0) && events.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No events"
            description="An event starts as a draft that only your team can see. Nothing is public until a moderator has approved it and you have chosen to publish."
          >
            {/*
              A link, styled like a button, rather than `Button as={Link}`.
              `Button` renders a real `<button>` and always has; handing it a
              component through an `as` prop passes a *function* from a Server
              Component to a Client Component, which React refuses outright —
              and the refusal is the whole page, not the button.
            */}
            <Link
              href="/organizer/events/new"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-action-primary px-4 text-sm font-medium text-action-primary-ink shadow-sm hover:bg-action-primary-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              Create your first event
            </Link>
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
                className="rounded-card border border-line bg-surface-raised p-4 focus-within:ring-2 focus-within:ring-focus"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold text-ink">
                      <Link
                        href={`/organizer/events/${event.id}`}
                        className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:outline-none"
                      >
                        {event.title}
                      </Link>
                    </h2>
                    {showOrganization && event.organizationName ? (
                      <p className="mt-1 text-sm text-ink-muted">{event.organizationName}</p>
                    ) : null}
                    <p className="mt-1 text-sm text-ink-muted">
                      {formatEventDate(event.startsAt, event.timezone)}
                      {event.venueName ? ` · ${event.venueName}` : ''}
                      {event.city ? `, ${event.city}` : ''}
                    </p>
                  </div>

                  <div className="text-right">
                    <Badge variant={reading.tone} srLabel="State:">
                      {reading.label}
                    </Badge>
                    <p className="mt-1 text-sm text-ink-muted">
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
