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
 * platform is the list, and the page says that is what it is showing. Each of
 * its rows opens the Desi-Event team's editor, where such a reader edits in a
 * session opened with a reason (SPEC2-XI O9), not the organiser's.
 *
 * `@file` rather than `@module`: `events` is fine, but the sibling pages use
 * `@file` for the same reason and consistency is worth more than the two
 * characters.
 *
 * ## Deleted events
 *
 * Left out of the list, as the API leaves them out of every list that does
 * not ask for them; the "Deleted" filter asks for them by name. Each keeps its
 * page here, with its record. After a deletion the dialog comes back to
 * `?deleted=1`, and the page says so in a polite status, without naming the
 * event in the address.
 *
 * @file app/organizer/events/page
 */

import Link from 'next/link'

import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { Badge, EmptyState } from '../../../components/ui.jsx'
import {
  CountTile,
  CountTiles,
  PageHeader,
  PANEL,
  PosterThumb,
  PRIMARY_LINK,
  TEXT_LINK,
} from '../../../components/workspace-kit.jsx'
import { listOrganizerEvents } from '../../../lib/organizer-api.js'
import { platformEditorRedirect } from '../../../lib/platform-editor.js'
import { membershipsWith, readSession, sessionCan } from '../../../lib/session.js'
import { statusReading } from '../../../lib/event-status.js'
import { formatEventDate } from '../../../lib/format.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Your events',
  robots: { index: false, follow: false },
}

/**
 * How many of the listed events are at each kind of turn.
 *
 * Counted from the rows this page has just read and nothing else, so each
 * figure is exactly what a reader could count in the list below it. "Waiting
 * on you" and "with a moderator" come from the same reading that writes the
 * words beside each event, so the tiles and the rows cannot disagree.
 *
 * @param {Array<{status: string}>} events The listed events.
 * @returns {{listed: number, yours: number, moderator: number, onSale: number}} The counts.
 */
export function eventCounts(events) {
  const counts = { listed: events.length, yours: 0, moderator: 0, onSale: 0 }

  for (const event of events) {
    const { whose } = statusReading(event.status)

    if (whose === 'you') counts.yours += 1
    if (whose === 'a moderator') counts.moderator += 1
    if (event.status === 'ON_SALE') counts.onSale += 1
  }

  return counts
}

/**
 * The list.
 *
 * @param {object} props Route props.
 * @param {Promise<Record<string, string|string[]>>} [props.searchParams] The query.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function OrganizerEventsPage({ searchParams } = {}) {
  const query = (await searchParams) ?? {}
  const showDeleted = query.status === 'DELETED'
  const justDeleted = query.deleted === '1'
  const session = await readSession()
  const organizations = membershipsWith(session, 'event:view_draft')
  const platformWide = organizations.length === 0 && sessionCan(session, 'platform:admin')

  let events = []
  let truncated = false
  let failure = null

  try {
    // Deleted events are listed only when asked for by name.
    const filter = showDeleted ? { status: 'DELETED' } : null
    const results = platformWide
      ? [await (filter ? listOrganizerEvents(filter) : listOrganizerEvents())]
      : await Promise.all(
          organizations.map(({ organizationId }) =>
            listOrganizerEvents({ organizationId, ...filter }),
          ),
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

  const counts = eventCounts(events)

  return (
    <div>
      <PageHeader
        eyebrow="Workspace · Events"
        title="Your events"
        actions={
          <Link href="/organizer/events/new" className={PRIMARY_LINK}>
            Create an event
          </Link>
        }
      >
        {platformWide ? (
          <p className="mt-2 max-w-3xl text-ink-muted">
            This account runs the platform and belongs to no organisation, so this is every
            organisation&rsquo;s events, not a list of its own.
          </p>
        ) : null}
      </PageHeader>

      <p role="status" aria-live="polite" className="mt-2 text-sm font-medium text-ink">
        {justDeleted ? 'Event deleted.' : ''}
      </p>

      <nav aria-label="Which events" className="mt-4">
        <ul className="flex flex-wrap gap-2 text-sm">
          <li>
            <Link
              href="/organizer/events"
              aria-current={showDeleted ? undefined : 'page'}
              className={`inline-flex min-h-11 items-center rounded-control border px-3 font-medium ${
                showDeleted
                  ? 'border-line bg-surface-raised text-ink-muted hover:text-ink'
                  : 'border-action-primary bg-action-primary text-action-primary-ink'
              }`}
            >
              Current events
            </Link>
          </li>
          <li>
            <Link
              href="/organizer/events?status=DELETED"
              aria-current={showDeleted ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-control border px-3 font-medium ${
                showDeleted
                  ? 'border-action-primary bg-action-primary text-action-primary-ink'
                  : 'border-line bg-surface-raised text-ink-muted hover:text-ink'
              }`}
            >
              Deleted
            </Link>
          </li>
        </ul>
      </nav>

      {showDeleted ? (
        <p className="mt-3 max-w-3xl text-sm text-ink-muted">
          Deleted events are off the site and nothing can be bought for them. Each keeps its record,
          its orders and its history; only the Desi-Event team can restore one.
        </p>
      ) : null}

      {failure ? <ReadRefusal error={failure} what="Your events" action="see your events" /> : null}

      {!failure && !platformWide && organizations.length === 0 ? (
        <p className="mt-6 max-w-3xl rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink">
          This account can see no organisation&rsquo;s drafts, so there is no list of events to show
          here.
        </p>
      ) : null}

      {/* Counts of the rows below and nothing else — no heading, so the only
          second-level headings on this page are the events themselves. */}
      {events.length > 0 ? (
        <CountTiles>
          <CountTile
            label="Listed here"
            value={counts.listed}
            hint={truncated ? 'The most recent; older events are not counted.' : undefined}
          />
          <CountTile label="Waiting on you" value={counts.yours} />
          <CountTile label="With a moderator" value={counts.moderator} />
          <CountTile label="On sale" value={counts.onSale} />
        </CountTiles>
      ) : null}

      {truncated ? (
        <p className="mt-4 text-sm text-ink-muted">
          The most recently created events are listed; older ones are not shown here.
        </p>
      ) : null}

      {!failure &&
      showDeleted &&
      (platformWide || organizations.length > 0) &&
      events.length === 0 ? (
        <p className="mt-6 text-sm text-ink">No event has been deleted.</p>
      ) : null}

      {!failure &&
      !showDeleted &&
      (platformWide || organizations.length > 0) &&
      events.length === 0 ? (
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
            <Link href="/organizer/events/new" className={PRIMARY_LINK}>
              Create your first event
            </Link>
          </EmptyState>
        </div>
      ) : null}

      {events.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {events.map((event) => {
            const reading = statusReading(event.status)
            // The Desi-Event team's own editor for an event this reader is not
            // a member for; the organiser's for everybody else.
            const href =
              platformEditorRedirect(session, event) ??
              `/organizer/events/${encodeURIComponent(event.id)}`

            return (
              <li
                key={event.id}
                className={`flex overflow-hidden transition-shadow duration-(--duration-base) ease-standard focus-within:ring-2 focus-within:ring-focus focus-within:ring-offset-2 hover:shadow-card-hover ${PANEL}`}
              >
                {/* The same poster the public card will wear, as a thumbnail. */}
                <PosterThumb event={event} className="hidden w-32 sm:block" />

                <div className="grid min-w-0 flex-1 gap-3 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-6">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-ink">
                      <Link href={href} className={TEXT_LINK}>
                        {event.title}
                      </Link>
                    </h2>
                    {showOrganization && event.organizationName ? (
                      <p className="mt-1 text-sm font-medium text-ink-muted">
                        {event.organizationName}
                      </p>
                    ) : null}
                    <p className="mt-1 text-sm text-ink-muted">
                      {formatEventDate(event.startsAt, event.timezone)}
                      {event.venueName ? ` · ${event.venueName}` : ''}
                      {event.city ? `, ${event.city}` : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:flex-col lg:items-end">
                    <Badge variant={reading.tone} size="lg" srLabel="State:">
                      {reading.label}
                    </Badge>
                    <p className="text-sm text-ink-muted">
                      {event.status === 'DELETED'
                        ? 'Off the site; only the Desi-Event team can restore it'
                        : reading.whose === 'nobody'
                          ? 'Nothing to do'
                          : `Waiting on ${reading.whose}`}
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
