/**
 * The organiser area.
 *
 * Everything under `/organizer` requires a session, and the check happens here
 * rather than in each page: a page that forgets is a page that leaks, and there
 * is no way to forget a layout.
 *
 * The check is a real one. `readSession` asks the API who the caller is, so a
 * forged cookie gets the same answer as no cookie. What this layout decides is
 * only whether to render; every action inside is authorised again by the API.
 *
 * Until Phase 4 a session was all it asked for, so an attendee who typed this
 * address was shown "Your events" listing the whole public catalogue. It now
 * admits a session holding any organiser capability in any organisation (see
 * `lib/areas.js`), and refuses everybody else with a sentence that says who
 * can help.
 *
 * @module app/organizer/layout
 */

import { redirect } from 'next/navigation'

import { AreaRefusal, WorkspaceShell } from '../../components/shells.jsx'
import { enterArea } from '../../lib/area-gate.js'
import { getOrganizerEvent } from '../../lib/organizer-api.js'
import {
  editsAsPlatform,
  organizerEventIdFromPath,
  platformEditorRedirect,
} from '../../lib/platform-editor.js'
import { requestPath } from '../../lib/request-path.js'

export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

/**
 * @typedef {object} OrganizerLayoutProps
 * @property {object} children The page.
 */

/**
 * The organizer shell: the workspace rail around the page, or the area's refusal.
 *
 * @param {OrganizerLayoutProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered shell.
 */
export default async function OrganizerLayout({ children }) {
  const { session, admitted } = await enterArea('organizer')

  // The Desi-Event team edits an organisation's event in its own editor, in an
  // editing session opened with a reason, never in the organiser's (SPEC2-XI
  // O9). Here, in the area's own layout, so the redirect is a real one: no
  // page under the loading boundary may call `redirect()`. A layout does not
  // run again when somebody moves between the area's pages in the browser, so
  // the events list links such a reader to the platform's editor and the
  // organiser's editor page shows them the way there itself.
  const eventId = editsAsPlatform(session) ? organizerEventIdFromPath(await requestPath()) : null

  if (eventId) {
    const event = await getOrganizerEvent(eventId).catch(() => null)
    const elsewhere = platformEditorRedirect(session, event)

    if (elsewhere) redirect(elsewhere)
  }

  if (!admitted) return <AreaRefusal area="organizer" />

  return (
    <WorkspaceShell session={session} area="organizer">
      {children}
    </WorkspaceShell>
  )
}
