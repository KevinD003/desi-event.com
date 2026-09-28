/**
 * Check-in: the door.
 *
 * The list of events comes from `GET /v1/tickets/admission/events`, which
 * answers from the database on every request with the events this account may
 * admit to and the authority each rests on. The page does not decide any of
 * that: an account the server gives no events to is shown that it has none,
 * and everything after — lookup, admission — is the server's answer too.
 *
 * A platform super administrator is given every organisation's current door
 * events, on its own authority (ADR 0007). For that list the page offers a
 * filter — an organisation and a search, as a plain `GET` form, since neither
 * is a secret — says when the list was cut at its limit, and tells the
 * administrator, persistently, that every lookup and admission is recorded on
 * the event's record.
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
import { getAdmissionEvents } from '../../../lib/organizer-api.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Check-in',
  robots: { index: false, follow: false },
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

  return (
    <div>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Events and venues
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Check-in</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">
        Look each ticket up, check the name, then admit. Looking up changes nothing; only{' '}
        <strong>Admit</strong> does, and a ticket admits once.
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
          <DoorWorkspace key={`${organizationId}|${q}`} events={events} platform={platform} />
        </div>
      ) : null}
    </div>
  )
}
