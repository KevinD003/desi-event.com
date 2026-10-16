/**
 * Check-in: the door.
 *
 * The list of events comes from `GET /v1/tickets/admission/events`, which
 * answers from the database on every request with the events this account may
 * admit to and the authority each rests on. The page does not decide any of
 * that: an account the server gives no events to is shown that it has none,
 * and everything after — lookup, admission — is the server's answer too.
 *
 * A platform administrator or super administrator is given every
 * organisation's current door events, on its own authority (ADR 0007,
 * ADR 0018). For that list the page offers a
 * filter — an organisation and a search, as a plain `GET` form, since neither
 * is a secret — says when the list was cut at its limit, and tells the
 * administrator, persistently, that every lookup and admission is recorded on
 * the event's record.
 *
 * Beside the event, "Payments at the venue" (SPEC3 §12.9) for a reader who may
 * read the organisation's finance, on an event that takes or has taken
 * bookings to pay at the door — the condition of the organiser's event panel
 * (§12.4), read from the event's own `paymentTerms`. Only the events' ids are
 * handed to the door; at most {@link VENUE_LINK_READS} events are asked about,
 * so a platform list of a hundred events does not cost a hundred reads.
 *
 * Rendered without anything about any ticket. Nothing on this page is cached
 * and nothing from it is indexed.
 *
 * @file app/organizer/check-in/page
 */

import { DoorEventFilter } from '../../../components/door-event-filter.jsx'
import { DoorWorkspace } from '../../../components/door-workspace.jsx'
import { Empty } from '../../../components/page-state.jsx'
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { sessionCan } from '../../../lib/capabilities.js'
import { getAdmissionEvents, getOrganizerEvent } from '../../../lib/organizer-api.js'
import { readSession } from '../../../lib/session.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Check-in',
  robots: { index: false, follow: false },
}

/** The most events whose payments at the venue are looked into for the link. */
export const VENUE_LINK_READS = 25

/**
 * The events, among those the door lists, whose "Payments at the venue" page
 * this reader is offered: finance in the event's organisation, and the event
 * takes or has taken bookings to pay at the door.
 *
 * @param {object|null} session The session.
 * @param {Array<object>} entries The door's events.
 * @returns {Promise<string[]>} Their ids; none when a read fails.
 */
async function venuePaymentEvents(session, entries) {
  const candidates = entries
    .filter((entry) => sessionCan(session, 'finance:view', entry.organization?.id))
    .slice(0, VENUE_LINK_READS)

  const found = await Promise.all(
    candidates.map(async (entry) => {
      const detail = await getOrganizerEvent(entry.event.id).catch(() => null)
      const venuePayment = detail?.paymentTerms?.venuePayment

      return venuePayment && (venuePayment.enabled || venuePayment.hasOrders)
        ? entry.event.id
        : null
    }),
  )

  return found.filter(Boolean)
}

/** The shape of an organisation id the API accepts; anything else is not sent. */
const ORGANIZATION_ID = /^[a-z][a-z0-9]{7,31}$/u

/**
 * One query-string value, or nothing.
 *
 * @param {string|string[]|undefined} value What the address carried.
 * @returns {string} The first value, trimmed, or an empty string.
 */
function one(value) {
  return (Array.isArray(value) ? (value[0] ?? '') : (value ?? '')).trim()
}

/**
 * The door page.
 *
 * @param {object} props Page props.
 * @param {Promise<Record<string, string|string[]|undefined>>} props.searchParams The query string.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function CheckInPage({ searchParams }) {
  const params = (await searchParams) ?? {}
  const organizationId = ORGANIZATION_ID.test(one(params.organizationId))
    ? one(params.organizationId)
    : ''
  const q = one(params.q).slice(0, 100)
  const filtered = Boolean(organizationId || q)

  let events = null
  let meta = null
  let failure = null

  try {
    const list = await getAdmissionEvents({
      organizationId: organizationId || undefined,
      q: q || undefined,
    })

    events = list.entries
    meta = list.meta
  } catch (error) {
    failure = error
  }

  const platform = meta?.scope === 'PLATFORM'
  const venuePaymentsFor =
    events && events.length > 0 ? await venuePaymentEvents(await readSession(), events) : []

  return (
    <div>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Events and venues
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Check-in</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">
        Look each ticket up, check the name, then admit. Looking up changes nothing; only{' '}
        <strong>Admit</strong> does, and a ticket admits once — or, on an event of several nights,
        once on its own night, or once each night when it is good for every night.
      </p>

      {failure ? (
        <ReadRefusal
          error={failure}
          what="The events you can admit to"
          action="see the doors you can admit at"
        />
      ) : null}

      {platform ? (
        <DoorEventFilter organizations={meta.organizations} organizationId={organizationId} q={q} />
      ) : null}

      {platform && meta.truncated ? (
        <p className="mt-4 text-sm text-ink-muted">
          Showing the 100 events that start soonest. Narrow by organisation or search to see others.
        </p>
      ) : null}

      {events && events.length === 0 && platform ? (
        <Empty
          title={
            filtered
              ? 'No event with its door open now matches that'
              : 'No event on the platform has its door open now'
          }
          description={
            filtered
              ? 'Try another organisation or other words, or clear the filter.'
              : 'An event appears here from when it is published until a day after it ends.'
          }
        />
      ) : null}

      {events && events.length === 0 && !platform ? (
        <Empty
          title="You are not assigned to any event's door"
          description="An owner or admin of the organisation can assign you to an event in its team settings. Until then there is nobody this account can admit."
        />
      ) : null}

      {events && events.length > 0 ? (
        <div className="mt-8">
          {/* Keyed on the filter, so a new list starts with nothing chosen. */}
          <DoorWorkspace
            key={`${organizationId}|${q}`}
            events={events}
            platform={platform}
            venuePaymentsFor={venuePaymentsFor}
          />
        </div>
      ) : null}
    </div>
  )
}
