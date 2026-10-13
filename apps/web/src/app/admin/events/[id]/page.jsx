/**
 * One event, for the Desi-Event team: edit it once it is posted, delete it, or
 * restore it once deleted (SPEC2-XI X-7, X-9, X-12).
 *
 * Editing somebody else's event happens in an editing session the
 * administrator opens here with a reason and a second factor; it lasts an
 * hour, works in this browser only, and every write in it needs a second
 * factor from the last 10 minutes. Until one is open, the page offers to open
 * one; while one is open, it shows the same editor the organiser uses, under
 * the Desi-Event team's authority, without the organiser's lifecycle moves
 * (publishing, sales and postponement are theirs).
 *
 * Deleting needs no session: the dialog reads what deleting would do, the
 * server decides it again at the moment it is sent, and asks for a second
 * factor. A deleted event shows its record, and the restore.
 *
 * Which controls are offered is worked out here, on the server, and handed to
 * the client components as booleans. The API decides every one again.
 *
 * The event's booking fee (the platform fee) and whether it can be paid for at
 * the venue are set here too (SPEC3 §12.3), in every status and in both
 * branches of the page — an event never published included, and read-only for
 * a deleted one — by a session holding `payment_terms:manage`. An
 * administrator who belongs to the event's organisation reads them and cannot
 * change them.
 *
 * @file app/admin/events/id/page.jsx
 */

import Link from 'next/link'
import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { DeleteEventDialog } from '../../../../components/delete-event-dialog.jsx'
import { DeletedEventSummary } from '../../../../components/deleted-event-summary.jsx'
import { EventEditor } from '../../../../components/event-editor.jsx'
import { OpenPlatformEditForm } from '../../../../components/open-platform-edit-form.jsx'
import { PaymentTermsPanel } from '../../../../components/payment-terms-panel.jsx'
import { PlatformChangesPanel } from '../../../../components/platform-changes-panel.jsx'
import { ReadRefusal, RefusalNotice } from '../../../../components/read-refusal.jsx'
import { ReassignEventDialog } from '../../../../components/reassign-event-dialog.jsx'
import { Badge } from '../../../../components/ui.jsx'
import { TEXT_LINK } from '../../../../components/workspace-kit.jsx'
import { sessionCan } from '../../../../lib/capabilities.js'
import { NOT_POSTED_SENTENCE } from '../../../../lib/event-control.js'
import { statusReading } from '../../../../lib/event-status.js'
import { mediaReadFailure } from '../../../../lib/media.js'
import {
  getDeletionPreview,
  getEventMedia,
  getEventReadiness,
  getEventSessions,
  getEventTicketTypes,
  getOrganizerEvent,
  getPlatformEdits,
  getPricePreview,
  listMaps,
  listVenues,
} from '../../../../lib/organizer-api.js'
import { readSession } from '../../../../lib/session.js'
import { getPaymentTerms } from '../../../../lib/workspace-api.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Event', robots: { index: false, follow: false } }

/** What a session without the capability is told. */
export const NOT_FOR_THIS_ACCOUNT =
  'Editing, deleting and restoring an organisation’s event is for the Desi-Event team’s platform administrators. Nothing on this page can grant it.'

/**
 * Published map versions for a venue, flattened across its maps.
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
    return []
  }
}

/**
 * The cheapest paid ticket on public sale, for the booking fee's example.
 *
 * @param {object|null} tiers The tiers read (`{ data }`), or null.
 * @returns {{priceCents: number, currency: string}|null} The ticket, or null.
 */
export function cheapestPaidTier(tiers) {
  const paid = (tiers?.data ?? []).filter(
    (tier) =>
      tier?.visibility !== 'HIDDEN' && Number.isInteger(tier?.priceCents) && tier.priceCents > 0,
  )

  if (paid.length === 0) return null

  const cheapest = paid.reduce((low, tier) => (tier.priceCents < low.priceCents ? tier : low))

  return { priceCents: cheapest.priceCents, currency: cheapest.currency ?? 'USD' }
}

/**
 * The instant "Show older changes" asked for, when it is one.
 *
 * @param {unknown} value The `changesBefore` parameter.
 * @returns {string|null} An ISO instant, or null.
 */
function readChangesBefore(value) {
  if (typeof value !== 'string' || value.length > 40) return null

  const at = Date.parse(value)

  return Number.isNaN(at) ? null : new Date(at).toISOString()
}

/**
 * What the "Booking fee and payment" section needs, read on the server: null
 * for a session that may not manage it (`payment_terms:manage`).
 *
 * @param {object} event The event.
 * @param {object|null} session The session.
 * @param {string|null} changesBefore The older page of changes asked for.
 * @param {object|null} [tiers] The tiers, when the page already read them.
 * @returns {Promise<object|null>} The section's props, or null.
 */
async function loadPaymentTerms(event, session, changesBefore, tiers = undefined) {
  if (!sessionCan(session, 'payment_terms:manage')) return null

  const [terms, tierRead] = await Promise.all([
    getPaymentTerms(event.id, changesBefore ? { before: changesBefore } : {}).catch((error) => ({
      failure: error,
    })),
    tiers === undefined ? getEventTicketTypes(event.id).catch(() => null) : tiers,
  ])

  if (!terms || terms.failure) return { failure: terms?.failure ?? null }

  // A member of the event's own organisation reads them and cannot change
  // them: another administrator has to (the API refuses CONFLICT_OF_INTEREST).
  const member = (session?.memberships ?? []).some(
    (membership) => membership.organizationId === event.organizationId,
  )

  return {
    terms,
    readOnly:
      event.status === 'DELETED'
        ? 'deleted'
        : terms.soldOnSource
          ? 'source'
          : member
            ? 'member'
            : null,
    canCancelUnpaid: sessionCan(session, 'venue_booking:cancel'),
    example: cheapestPaidTier(tierRead),
    changesBefore,
  }
}

/**
 * The "Booking fee and payment" section, from what {@link loadPaymentTerms} read.
 *
 * @param {object} props Component props.
 * @param {object} props.event The event.
 * @param {object|null} props.loaded What was read, or null for nothing to show.
 * @returns {JSX.Element|null} The section.
 */
function PaymentTermsSection({ event, loaded }) {
  if (!loaded) return null

  if (!loaded.terms) {
    return (
      <section
        id="payment-terms"
        aria-labelledby="payment-terms-heading"
        className="mt-8 max-w-3xl"
      >
        <h2 id="payment-terms-heading" className="text-xl font-semibold text-ink">
          Booking fee and payment
        </h2>
        <ReadRefusal
          error={loaded.failure}
          what="This event’s booking fee and payment settings"
          action="see this event’s booking fee and payment settings"
        />
      </section>
    )
  }

  const { terms, changesBefore } = loaded

  return (
    <PaymentTermsPanel
      // Drawn afresh whenever the server's answer changes.
      key={`${terms.fee.sequence}:${terms.venuePayment.enabled}:${terms.venuePayment.limit}:${terms.history[0]?.at ?? ''}:${changesBefore ?? ''}`}
      eventId={event.id}
      terms={terms}
      readOnly={loaded.readOnly}
      canCancelUnpaid={loaded.canCancelUnpaid}
      example={loaded.example}
      timeZone={event.timezone ?? 'UTC'}
      showingOlder={Boolean(changesBefore)}
    />
  )
}

/**
 * The page's breadcrumb and heading.
 *
 * @param {object} props Component props.
 * @param {object|null} props.event The event, when it was read.
 * @returns {JSX.Element} The header.
 */
function Header({ event }) {
  const reading = event ? statusReading(event.status) : null

  return (
    <div>
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link href="/admin/events" className={TEXT_LINK}>
              All events
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-ink-muted">
            {event?.title ?? 'Event'}
          </li>
        </ol>
      </nav>
      <h1 className="mt-4 text-h2 font-semibold text-ink">{event?.title ?? 'Event'}</h1>
      {event ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span>{event.organization?.name ?? 'Its organisation'}</span>
          <Badge variant={reading.tone} srLabel="State:">
            {reading.label}
          </Badge>
          {PUBLICLY_VISIBLE_STATUSES.has(event.status) && event.slug ? (
            <Link href={`/events/${encodeURIComponent(event.slug)}`} className={TEXT_LINK}>
              Public page
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The danger zone: deleting, which needs no editing session.
 *
 * @param {object} props Component props.
 * @param {object} props.event The event.
 * @returns {JSX.Element} The section.
 */
function DangerZone({ event }) {
  return (
    <section
      id="delete-event"
      aria-labelledby="admin-danger-zone-heading"
      className="mt-8 max-w-3xl space-y-3 rounded-card border border-status-danger/30 bg-surface-raised p-4"
    >
      <h2 id="admin-danger-zone-heading" className="text-lg font-semibold text-ink">
        Danger zone
      </h2>
      <p className="text-sm text-ink">
        Deleting takes the event off the site straight away. What else it does depends on its sales,
        and is shown before anything is deleted. The organiser sees that the Desi-Event team deleted
        it, and the reason you give.
      </p>
      <DeleteEventDialog
        event={{ id: event.id, title: event.title, slug: event.slug }}
        listHref="/admin/events"
        listLabel="Back to all events"
      />
    </section>
  )
}

/**
 * Moving an imported event to an organiser's own organisation (SPEC2-XI I-F):
 * offered only for an event still held for an import, to a session that may
 * import.
 *
 * @param {object} props Component props.
 * @param {object} props.event The event.
 * @returns {JSX.Element} The section.
 */
function ImportedEventSection({ event }) {
  return (
    <section
      id="move-event"
      aria-labelledby="admin-imported-heading"
      className="mt-8 max-w-3xl space-y-3 rounded-card border border-line bg-surface-subtle p-4"
    >
      <h2 id="admin-imported-heading" className="text-lg font-semibold text-ink">
        Copied from Sulekha
      </h2>
      <p className="text-sm text-ink">
        {event.importedFrom.presentedBy
          ? `This event was copied from its Sulekha listing and is presented by ${event.importedFrom.presentedBy}. Its tickets are sold on Sulekha. Once its organiser has an organisation here, move it there.`
          : 'This event was copied from its Sulekha listing, which names no organiser. Its tickets are sold on Sulekha. Once its organiser has an organisation here, move it there.'}
      </p>
      <ReassignEventDialog event={{ id: event.id, title: event.title, revision: event.revision }} />
    </section>
  )
}

/**
 * What the page says once an event has been restored from it: the restore
 * dialog sends the administrator back here with `?restored=1`, and the event,
 * no longer deleted, is drawn in the dialog's place.
 *
 * @param {object} props Component props.
 * @param {object} props.event The event, as it stands now.
 * @returns {JSX.Element|null} The status, or nothing for an event still deleted.
 */
function RestoredStatus({ event }) {
  if (event.status === 'DELETED') return null

  return (
    <p role="status" aria-live="polite" className="mt-4 text-sm font-medium text-ink">
      Event restored: {statusReading(event.status).label}.
    </p>
  )
}

/**
 * What the page says once an imported event has been moved to an organisation
 * (SPEC2-XI I-F): the move dialog sends the administrator back here with
 * `?moved=1`, and the event, no longer held for an import, is drawn without
 * the dialog that moved it.
 *
 * @param {object} props Component props.
 * @param {object} props.event The event, as it stands now.
 * @returns {JSX.Element|null} The status, or nothing for an event still held for an import.
 */
function MovedStatus({ event }) {
  if (event.importedFrom) return null

  return (
    <p role="status" aria-live="polite" className="mt-4 text-sm font-medium text-ink">
      {`Moved to ${event.organization?.name ?? 'its organisation'}. Its Sulekha ticket link is off until an administrator approves the organiser’s own address.`}
    </p>
  )
}

/**
 * @typedef {object} AdminEventPageProps
 * @property {Promise<{id: string}>} params The resolved route parameters.
 * @property {Promise<Record<string, string>>} [searchParams] The query: `restored=1` after a
 *   restore, `moved=1` after a move.
 */

/**
 * The page.
 *
 * @param {AdminEventPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function AdminEventPage({ params, searchParams }) {
  const { id } = await params
  const query = (await searchParams) ?? {}
  const justRestored = query.restored === '1'
  const justMoved = query.moved === '1'
  const changesBefore = readChangesBefore(query.changesBefore)
  const session = await readSession()

  if (!sessionCan(session, 'event:platform_edit')) {
    return (
      <div>
        <Header event={null} />
        <RefusalNotice tone="neutral" title="Not for this account" detail={NOT_FOR_THIS_ACCOUNT} />
      </div>
    )
  }

  let event = null
  let failure = null

  try {
    event = await getOrganizerEvent(id)
  } catch (error) {
    failure = error
  }

  if (!event) {
    return (
      <div>
        <Header event={null} />
        <ReadRefusal error={failure} what="This event" action="open this event" />
        <p className="mt-4">
          <Link href="/admin/events" className={TEXT_LINK}>
            Back to all events
          </Link>
        </p>
      </div>
    )
  }

  const mayDelete = sessionCan(session, 'event:platform_delete')

  if (event.status === 'DELETED') {
    // Where its refunds stand, when deleting it refunded its orders.
    const refundCounts =
      event.deletion?.outcome === 'CANCEL_AND_REFUND'
        ? ((await getDeletionPreview(id).catch(() => null))?.counts ?? null)
        : null

    return (
      <div>
        <Header event={event} />
        <div id="restore-event" className="mt-6">
          <DeletedEventSummary
            event={event}
            mayRestore={mayDelete}
            mayFinishRefunds={mayDelete}
            refundCounts={refundCounts}
            refundsHref={
              sessionCan(session, 'finance:view', event.organizationId)
                ? `/finance/refunds?${new URLSearchParams({ organizationId: event.organizationId }).toString()}`
                : null
            }
          />
        </div>
        <PaymentTermsSection
          event={event}
          loaded={await loadPaymentTerms(event, session, changesBefore)}
        />
      </div>
    )
  }

  const platformEdits = await getPlatformEdits(id).catch(() => [])
  const sitting = platformEdits.find((edit) => edit.open && edit.mine) ?? null
  const posted = PUBLICLY_VISIBLE_STATUSES.has(event.status)
  const movable = Boolean(event.importedFrom) && sessionCan(session, 'event:import')

  if (!posted || !sitting) {
    return (
      <div>
        <Header event={event} />
        {justRestored ? <RestoredStatus event={event} /> : null}
        {justMoved ? <MovedStatus event={event} /> : null}

        {posted ? (
          <div className="mt-6">
            <OpenPlatformEditForm eventId={event.id} />
          </div>
        ) : (
          <div className="mt-6 max-w-2xl space-y-2 rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink">
            <p>{NOT_POSTED_SENTENCE}</p>
            <p>
              <Link
                href={`/moderation/events/${encodeURIComponent(event.id)}`}
                className={TEXT_LINK}
              >
                Its review page
              </Link>
            </p>
          </div>
        )}

        <PlatformChangesPanel edits={platformEdits} timeZone={event.timezone} />

        <PaymentTermsSection
          event={event}
          loaded={await loadPaymentTerms(event, session, changesBefore)}
        />

        {movable ? <ImportedEventSection event={event} /> : null}

        {mayDelete ? <DangerZone event={event} /> : null}
      </div>
    )
  }

  const [sessions, tiers, readiness, venues, mapVersions, media] = await Promise.all([
    getEventSessions(id).catch(() => ({ data: [], meta: { revision: event.revision } })),
    getEventTicketTypes(id).catch(() => null),
    getEventReadiness(id).catch(() => null),
    listVenues(event.organizationId).catch(() => []),
    publishedMapVersions(event.venueId),
    getEventMedia(id).catch((error) => ({ data: null, failure: mediaReadFailure(error) })),
  ])
  const preview = await getPricePreview(id).catch(() => [])

  return (
    <div>
      <Header event={event} />
      {justRestored ? <RestoredStatus event={event} /> : null}
      {justMoved ? <MovedStatus event={event} /> : null}

      <div className="mt-6">
        <EventEditor
          event={event}
          venues={venues}
          sessions={sessions.data ?? []}
          tiers={tiers?.data ?? null}
          mapVersions={mapVersions}
          preview={preview}
          readiness={readiness}
          media={media.data ?? []}
          mediaFailure={media.failure ?? null}
          authority={{
            kind: 'platform',
            editId: sitting.id,
            reason: sitting.reason,
            expiresAt: sitting.expiresAt,
            organizationName: event.organization?.name ?? null,
          }}
          mayCancelNights={mayDelete}
          platformEdits={platformEdits}
          listHref="/admin/events"
        />
      </div>

      <PaymentTermsSection
        event={event}
        loaded={await loadPaymentTerms(event, session, changesBefore, tiers)}
      />

      {movable ? <ImportedEventSection event={event} /> : null}

      {mayDelete ? <DangerZone event={event} /> : null}
    </div>
  )
}
