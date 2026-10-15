/**
 * What the team at The Desi Events changed on an event, sitting by sitting.
 *
 * Each sitting carries its date, the reason the administrator gave and what it
 * changed, in the editor's own words ("description, FAQ, added a night"). The
 * administrator's name is shown only when the server sent it, which it does to
 * the team at The Desi Events alone; an organiser reads "an administrator at
 * The Desi Events".
 *
 * Renders on the server or the client; it holds no state.
 *
 * @module components/platform-changes-panel
 */

import { Badge } from './ui.jsx'
import { clockTime, platformEditChanges } from '../lib/event-control.js'
import { formatEventDate } from '../lib/format.js'

/** How each way a sitting can end reads. */
const ENDINGS = Object.freeze({
  CLOSED: 'Closed by the administrator',
  SUPERSEDED: 'Replaced by a newer editing session',
  EVENT_DELETED: 'Ended when the event was deleted',
  EXPIRED: 'Ran out after its hour',
})

/**
 * @typedef {object} PlatformChangesPanelProps
 * @property {object[]} edits The sittings, newest first, from `GET /v1/events/:id/platform-edits`.
 * @property {string} [timeZone] The zone to read dates and times in: the event's own.
 */

/**
 * The panel, or nothing when the team at The Desi Events has never edited the
 * event.
 *
 * @param {PlatformChangesPanelProps} props Component props.
 * @returns {JSX.Element|null} The section.
 */
export function PlatformChangesPanel({ edits = [], timeZone }) {
  if (!Array.isArray(edits) || edits.length === 0) return null

  // The date and the time in one named zone, the event's, so neither is read
  // in whatever zone the server happens to run in.
  const zone = timeZone || 'UTC'

  return (
    <section
      aria-labelledby="platform-changes-heading"
      className="mt-6 space-y-3 rounded-card border border-line bg-surface-raised p-4"
    >
      <h2 id="platform-changes-heading" className="text-lg font-semibold text-ink">
        Changes made by the team at The Desi Events
      </h2>
      <p className="text-sm text-ink-muted">
        The Desi Events team edits a published event only in a session opened with a reason. Each
        session is listed with what it changed.
      </p>
      <ul className="space-y-3">
        {edits.map((edit) => {
          const changed = platformEditChanges(edit.changes ?? [])

          return (
            <li key={edit.id} className="rounded-card border border-line p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                <span>
                  {formatEventDate(edit.openedAt, zone)}, {clockTime(edit.openedAt, zone)}
                </span>
                {edit.open ? (
                  <Badge variant="info">Open until {clockTime(edit.expiresAt, zone)}</Badge>
                ) : (
                  <Badge variant="neutral">{ENDINGS[edit.endedBy] ?? 'Ended'}</Badge>
                )}
              </p>
              <p className="mt-1 text-ink">
                By{' '}
                {edit.administratorName
                  ? `${edit.administratorName}, of the team at The Desi Events`
                  : 'an administrator at The Desi Events'}
                .
              </p>
              <p className="mt-1 text-ink">
                <span className="font-semibold">Reason: </span>
                {edit.reason}
              </p>
              <p className="mt-1 text-ink">
                <span className="font-semibold">Changed: </span>
                {changed.length > 0 ? changed.join(', ') : 'nothing'}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
