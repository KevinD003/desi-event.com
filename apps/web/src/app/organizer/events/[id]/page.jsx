/**
 * One event's editor.
 *
 * Keyed by id rather than slug, because the slug is one of the things being
 * edited and a URL built from it breaks the moment somebody renames their
 * event.
 *
 * Everything is read here, on the server, and handed down. That is not only a
 * performance choice: the editor's steps have to agree about the revision they
 * are editing, and five client components each fetching their own copy would
 * disagree the first time two of them raced.
 *
 * A read that fails throws rather than falling back. Organiser screens never
 * show the sample catalogue — an editor over a draft that is not the real one
 * would invite somebody to overwrite work they cannot see.
 *
 * @file app/organizer/events/id/page.jsx
 */

import Link from 'next/link'

import { ReadRefusal } from '../../../../components/read-refusal.jsx'
import { EventEditor } from '../../../../components/event-editor.jsx'
import {
  getEventReadiness,
  getEventSessions,
  getEventTransitions,
  getModerationHistory,
  getOrganizerEvent,
  getPricePreview,
  listMaps,
  listVenues,
} from '../../../../lib/organizer-api.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Edit event', robots: { index: false, follow: false } }

/**
 * Published map versions for a venue, flattened across its maps.
 *
 * Only published ones. A version somebody is still editing cannot back a
 * session — the seats would move underneath the tickets — and offering it in a
 * select would produce a refusal the organiser could not have predicted.
 *
 * @param {string|null} venueId The venue.
 * @returns {Promise<object[]>} One entry per published version.
 */
async function publishedMapVersions(venueId) {
  if (!venueId) return []

  try {
    const maps = await listMaps(venueId)

    return maps.flatMap((map) =>
      (map.versions ?? [])
        .filter((version) => version.state === 'PUBLISHED' || version.publishedAt)
        .map((version) => ({
          id: version.id,
          mapName: map.name,
          version: version.version,
          seatCount: version.seatCount ?? 0,
        })),
    )
  } catch {
    // A venue whose maps cannot be read is a general-admission venue as far as
    // this screen is concerned. Guessing a version id would be worse.
    return []
  }
}

/**
 * @typedef {object} EditEventPageProps
 * @property {Promise<{id: string}>} params The resolved route parameters.
 */

/**
 * The editor page.
 *
 * @param {EditEventPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function EditEventPage({ params }) {
  const { id } = await params

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
        <h1 className="text-2xl font-bold text-ink">That event could not be opened</h1>
        {/* The same words for another organisation's draft and for an id
            nobody has used: the API answers both 404, and so does this. */}
        <ReadRefusal error={failure} what="This event" action="edit this event" />
        <p className="mt-4">
          <Link
            href="/organizer/events"
            className="underline underline-offset-4 hover:text-accent-strong"
          >
            Back to your events
          </Link>
        </p>
      </div>
    )
  }

  // Read together rather than in sequence: five round trips one after another
  // is five times the latency for no benefit, and they do not depend on each
  // other.
  const [sessions, readiness, transitions, history, venues, mapVersions] = await Promise.all([
    getEventSessions(id).catch(() => ({ data: [], meta: { revision: event.revision } })),
    getEventReadiness(id).catch(() => ({
      ready: false,
      status: event.status,
      publishable: ['Readiness could not be read.'],
      sellable: [],
      inventory: [],
      organizerVerified: false,
    })),
    getEventTransitions(id).catch(() => ({ status: event.status, transitions: [] })),
    getModerationHistory(id).catch(() => []),
    listVenues(event.organizationId).catch(() => []),
    publishedMapVersions(event.venueId),
  ])

  const preview = await getPricePreview(id).catch(() => [])

  return (
    <div>
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link
              href="/organizer/events"
              className="rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              Your events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-ink-muted">
            {event.title}
          </li>
        </ol>
      </nav>

      <h1 className="mt-4 text-2xl font-bold text-ink">{event.title}</h1>

      <div className="mt-6">
        <EventEditor
          event={event}
          venues={venues}
          sessions={sessions.data ?? []}
          mapVersions={mapVersions}
          preview={preview}
          readiness={readiness}
          transitions={transitions}
          history={history}
        />
      </div>
    </div>
  )
}
