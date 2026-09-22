/**
 * Check-in: the door.
 *
 * The list of events comes from `GET /v1/tickets/admission/events`, which
 * answers from the database on every request with the events this account may
 * admit to and the authority each rests on. The page does not decide any of
 * that: an account the server gives no events to is shown that it has none,
 * and everything after — lookup, admission — is the server's answer too.
 *
 * Rendered without anything about any ticket. Nothing on this page is cached
 * and nothing from it is indexed.
 *
 * @file app/organizer/check-in/page
 */

import { DoorWorkspace } from '../../../components/door-workspace.jsx'
import { Empty, Failure } from '../../../components/page-state.jsx'
import { getAdmissionEvents } from '../../../lib/organizer-api.js'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Check-in',
  robots: { index: false, follow: false },
}

/**
 * The door page.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function CheckInPage() {
  let events = null
  let failure = null

  try {
    events = await getAdmissionEvents()
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-indigo-night-900">Check-in</h1>
      <p className="mt-2 max-w-2xl text-slate-700">
        Look each ticket up, check the name, then admit. Looking up changes nothing; only{' '}
        <strong>Admit</strong> does, and a ticket admits once.
      </p>

      {failure ? <Failure what="The events you can admit to" detail={failure} /> : null}

      {events && events.length === 0 ? (
        <Empty
          title="You are not assigned to any event's door"
          description="An owner or admin of the organisation can assign you to an event in its team settings. Until then there is nobody this account can admit."
        />
      ) : null}

      {events && events.length > 0 ? (
        <div className="mt-8">
          <DoorWorkspace events={events} />
        </div>
      ) : null}
    </div>
  )
}
