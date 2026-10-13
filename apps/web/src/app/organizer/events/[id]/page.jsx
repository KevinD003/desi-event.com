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
 * Everything this editor offers is the organisation's to do, so it asks the
 * session's membership (`membershipCan`), never a platform role: deleting,
 * cancelling a night. A Desi-Event administrator who is not a member is sent
 * to `/admin/events/[id]` by the area's layout on a full load (SPEC2-XI O9).
 * A layout does not run again when somebody moves between its pages in the
 * browser, so this page asks the same question and, for such a reader, shows
 * a link to the Desi-Event team's editor instead of an editor whose every save
 * would be refused. A deleted event shows its record instead of the editor.
 *
 * Above the editor, the read-only "Booking fee and payment" panel (SPEC3
 * §12.4): the Desi-Event team's decisions about the event, read from
 * `event.paymentTerms`, with a link to "Payments at the venue" for a reader
 * who may read the organisation's finance.
 *
 * @file app/organizer/events/id/page.jsx
 */

import Link from 'next/link'
import { BOOKABLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { DeletedEventSummary } from '../../../../components/deleted-event-summary.jsx'
import { ReadRefusal } from '../../../../components/read-refusal.jsx'
import { EventEditor } from '../../../../components/event-editor.jsx'
import { PaymentTermsSummary } from '../../../../components/payment-terms-summary.jsx'
import { membershipCan, sessionCan } from '../../../../lib/capabilities.js'
import { platformEditorRedirect } from '../../../../lib/platform-editor.js'
import { mediaReadFailure } from '../../../../lib/media.js'
import {
  getEventReadiness,
  getEventMedia,
  getEventSessions,
  getEventTicketTypes,
  getDeletionPreview,
  getEventTransitions,
  getModerationHistory,
  getOrganizerEvent,
  getPlatformEdits,
  getPricePreview,
  listMaps,
  listVenues,
} from '../../../../lib/organizer-api.js'
import { readSession } from '../../../../lib/session.js'
import { mayBookTeamTiers } from '../../../../lib/team-booking.js'

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
        <h1 className="text-h2 font-semibold text-ink">That event could not be opened</h1>
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

  const session = await readSession()
  const orgId = event.organizationId
  const breadcrumb = (
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
  )

  // The Desi-Event team edits an organisation's event in its own editor, in a
  // session opened with a reason (O9). Reached here by a link inside the area,
  // where the layout's redirect does not run again: say where to go, with the
  // link, rather than render an editor acting under an authority this reader
  // does not hold.
  const elsewhere = platformEditorRedirect(session, event)

  if (elsewhere) {
    return (
      <div>
        {breadcrumb}
        <h1 className="mt-4 text-h2 font-semibold text-ink">{event.title}</h1>
        <section
          aria-labelledby="platform-editor-heading"
          data-testid="platform-editor-elsewhere"
          className="mt-6 max-w-2xl space-y-2 rounded-card border border-status-info/25 bg-status-info-soft p-4 text-ink"
        >
          <h2 id="platform-editor-heading" className="text-lg font-semibold text-ink">
            Edited by the Desi-Event team elsewhere
          </h2>
          <p className="text-sm">
            This account is not a member of the organisation that runs this event. The Desi-Event
            team edits, deletes and restores an organisation&rsquo;s event in its own editor, in an
            editing session opened with a reason.
          </p>
          <p>
            <Link
              href={elsewhere}
              className="inline-flex min-h-11 items-center rounded-sm font-semibold underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              Open it in the Desi-Event team&rsquo;s editor
            </Link>
          </p>
        </section>
      </div>
    )
  }

  // A deleted event has no editor: its record, and what it still owes.
  if (event.status === 'DELETED') {
    // Where its refunds stand, when deleting it refunded its orders: the
    // deletion preview still answers for a deleted event, with what is owed.
    // Nothing is said about refunds when it cannot be read.
    const refundCounts =
      event.deletion?.outcome === 'CANCEL_AND_REFUND'
        ? ((await getDeletionPreview(id).catch(() => null))?.counts ?? null)
        : null

    return (
      <div>
        {breadcrumb}
        <h1 className="mt-4 text-h2 font-semibold text-ink">{event.title}</h1>
        <div className="mt-6">
          <DeletedEventSummary
            event={event}
            mayFinishRefunds={
              membershipCan(session, 'event:delete', orgId) &&
              membershipCan(session, 'event:cancel', orgId)
            }
            refundCounts={refundCounts}
            refundsHref={
              sessionCan(session, 'finance:view', orgId)
                ? `/finance/refunds?${new URLSearchParams({ organizationId: orgId }).toString()}`
                : null
            }
          />
        </div>
      </div>
    )
  }

  // Read together rather than in sequence: five round trips one after another
  // is five times the latency for no benefit, and they do not depend on each
  // other.
  const [
    sessions,
    tiers,
    readiness,
    transitions,
    history,
    venues,
    mapVersions,
    media,
    platformEdits,
  ] = await Promise.all([
    getEventSessions(id).catch(() => ({ data: [], meta: { revision: event.revision } })),
    // The organiser's own read of the ticket types: hidden and draft ones,
    // what is sold and held, and whether each can go. Null when it fails,
    // so the tickets step falls back to the event's own list rather than
    // showing none.
    getEventTicketTypes(id).catch(() => null),
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
    // A failed read stays a failure, never an empty list: the Media step
    // would otherwise say there is no cover and offer an upload that
    // replaces the one it could not show.
    getEventMedia(id).catch((error) => ({ data: null, failure: mediaReadFailure(error) })),
    // The Desi-Event team's editing sessions on this event, for the review
    // step; none shown when they cannot be read.
    getPlatformEdits(id).catch(() => []),
  ])

  const preview = await getPricePreview(id).catch(() => [])

  // A hidden or complimentary tier is booked by the team through the ordinary
  // checkout, which lists it for a member allowed to book it. Offered once the
  // event is on sale and has such a tier to book.
  const hiddenOnSale = (tiers?.data ?? []).some(
    (tier) => tier.visibility === 'HIDDEN' && tier.status !== 'DRAFT',
  )
  const teamBooking =
    hiddenOnSale && BOOKABLE_STATUSES.has(event.status) && event.slug
      ? mayBookTeamTiers(session, event)
      : false
  // The event's own visits and sales, offered to somebody who may read the
  // organisation's reports: its members from a viewer up, and the Desi-Event
  // team's platform administrators, as the API agrees.
  const reports = sessionCan(session, 'report:view', orgId)
  // The organisation's own decisions, asked of the membership alone. Who may
  // delete with which outcome is the server's answer in the dialog's preview;
  // `event:delete_unsold` is the least any outcome needs.
  const mayDelete = membershipCan(session, 'event:delete_unsold', orgId)
  const mayCancelNights = membershipCan(session, 'event:cancel', orgId)

  return (
    <div>
      {breadcrumb}

      {reports ? (
        <p className="mt-2 text-sm">
          <Link
            href={`/analytics?${new URLSearchParams({
              organizationId: event.organizationId,
              eventId: event.id,
            }).toString()}`}
            className="inline-flex min-h-11 items-center rounded-sm font-medium underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          >
            Visits and sales for this event
          </Link>
        </p>
      ) : null}

      <h1 className="mt-4 text-h2 font-semibold text-ink">{event.title}</h1>

      {teamBooking ? (
        <aside
          aria-labelledby="team-booking-heading"
          data-testid="team-booking-panel"
          className="mt-4 max-w-2xl rounded-card border border-status-info/25 bg-status-info-soft px-5 py-4 text-ink"
        >
          <h2 id="team-booking-heading" className="text-[1.0625rem] font-bold text-ink">
            Book from a hidden tier
          </h2>
          <p className="mt-1 text-[0.9375rem] text-ink">
            Hidden and complimentary tiers are booked through the event&rsquo;s own checkout, signed
            in as you: they are listed there for you and nobody outside the team. The tickets are
            kept in your account, and each can be handed on to a guest with a transfer code from
            your tickets.
          </p>
          <p className="mt-3">
            <Link
              href={`/events/${encodeURIComponent(event.slug)}/checkout`}
              className="font-semibold underline underline-offset-4 hover:text-accent-strong"
            >
              Book team tickets
            </Link>
          </p>
        </aside>
      ) : null}

      {event.paymentTerms ? (
        <div className="mt-4">
          <PaymentTermsSummary
            eventId={event.id}
            paymentTerms={event.paymentTerms}
            mayReadVenuePayments={sessionCan(session, 'finance:view', orgId)}
          />
        </div>
      ) : null}

      <div className="mt-6">
        <EventEditor
          event={event}
          venues={venues}
          sessions={sessions.data ?? []}
          tiers={tiers?.data ?? null}
          mapVersions={mapVersions}
          preview={preview}
          readiness={readiness}
          transitions={transitions}
          history={history}
          media={media.data ?? []}
          mediaFailure={media.failure ?? null}
          authority={{ kind: 'organization' }}
          mayDelete={mayDelete}
          mayCancelNights={mayCancelNights}
          platformEdits={platformEdits}
          listHref="/organizer/events"
        />
      </div>
    </div>
  )
}
