/**
 * The review queue.
 *
 * Oldest submission first, and that is the whole ordering policy: an organiser
 * who submitted on Monday should not still be waiting because somebody more
 * recent looked more interesting. The server sorts it; this renders it.
 *
 * The filter is over the states a moderator actually works in. It is a set of
 * links rather than a form, so it works with no JavaScript, is bookmarkable,
 * and a screen reader announces the current one through `aria-current`.
 *
 * @module app/moderation/events/page
 */

import Link from 'next/link'

import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { Badge, EmptyState } from '../../../components/ui.jsx'
import { getModerationQueue } from '../../../lib/organizer-api.js'
import { statusReading } from '../../../lib/event-status.js'
import { formatEventDate } from '../../../lib/format.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Review queue', robots: { index: false, follow: false } }

/**
 * The states a moderator filters by, and how each reads.
 *
 * @type {ReadonlyArray<{value: string|null, label: string}>}
 */
const FILTERS = Object.freeze([
  { value: null, label: 'Waiting for review' },
  { value: 'CHANGES_REQUIRED', label: 'Changes requested' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
])

/**
 * @typedef {object} ModerationQueuePageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The queue.
 *
 * @param {ModerationQueuePageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function ModerationQueuePage({ searchParams }) {
  const query = await searchParams
  const status = FILTERS.some((filter) => filter.value === query?.status) ? query.status : undefined

  let events = []
  let failure = null

  try {
    const result = await getModerationQueue({ status })
    events = result.events
  } catch (error) {
    failure = error
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">Review queue</h1>
      <p className="mt-2 text-ink-muted">
        Oldest submission first. Somebody who submitted on Monday should not still be waiting
        because a Thursday listing looked more interesting.
      </p>

      <nav aria-label="Filter by state" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => {
            const current = (status ?? null) === filter.value
            const href = filter.value
              ? `/moderation/events?status=${filter.value}`
              : '/moderation/events'

            return (
              <li key={filter.label}>
                <Link
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={`inline-flex rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
                    current
                      ? 'bg-action-primary font-semibold text-action-primary-ink'
                      : 'bg-surface-subtle text-ink-muted hover:bg-line'
                  }`}
                >
                  {filter.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {failure ? (
        <ReadRefusal error={failure} what="The review queue" action="see the review queue" />
      ) : null}

      {!failure && events.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing waiting"
            description="No event is in this state. Organisers submit for review from their own editor."
          />
        </div>
      ) : null}

      {events.length > 0 ? (
        <ol className="mt-6 space-y-3">
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
                        href={`/moderation/events/${event.id}`}
                        className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:outline-none"
                      >
                        {event.title}
                      </Link>
                    </h2>
                    <p className="mt-1 text-sm text-ink-muted">
                      {event.organizationName ?? 'Unnamed organisation'} ·{' '}
                      {formatEventDate(event.startsAt, event.timezone)}
                      {event.city ? ` · ${event.city}` : ''}
                    </p>
                  </div>

                  <Badge variant={reading.tone} srLabel="State:">
                    {reading.label}
                  </Badge>
                </div>
              </li>
            )
          })}
        </ol>
      ) : null}
    </div>
  )
}
