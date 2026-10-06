/**
 * What changed about an event since somebody bought a ticket for it, as their
 * order and ticket pages show it ("Changes since you bought").
 *
 * One entry per notice the server recorded: when, what kind of change, which
 * details, a moved date shown before → after in the event's own zone, the
 * reason given, and whether the organiser or the Desi-Event team made it. A
 * cancelled night, a cancellation, a postponement or a deletion is set in a
 * box of its own. Nothing here says the holder was emailed: notices are not.
 *
 * Renders on the server or the client; it holds no state.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/event-changes-list
 */

import {
  CHANGE_KIND_LABELS,
  PLATFORM_EDIT_FIELD_LABELS,
  SERIOUS_CHANGE_KINDS,
  deletedForHolder,
  noticeBy,
  noticeMoves,
  noticeNightStart,
} from '../lib/event-control.js'
import { formatEventDate } from '../lib/format.js'
import { sessionDisplayLabel } from '../lib/sessions.js'

/**
 * A notice's changed fields in words.
 *
 * @param {string[]} changed The field names.
 * @returns {string} For example `start time, venue`.
 */
function changedWords(changed = []) {
  return [
    ...new Set(
      changed.map((field) =>
        String(PLATFORM_EDIT_FIELD_LABELS[field] ?? field)
          .replace(/([a-z])([A-Z])/gu, '$1 $2')
          .toLowerCase(),
      ),
    ),
  ].join(', ')
}

/**
 * @typedef {object} EventChangesListProps
 * @property {object[]} notices The notices, newest first (`eventChanges`).
 * @property {string} [timeZone] The event's zone.
 * @property {object[]} [sessions] The nights the page knows, to name a cancelled one by its label; one
 *   it does not know is named by the start its notice recorded.
 * @property {string} [headingLevel] `h2` or `h3`.
 */

/**
 * The list, or nothing when nothing has changed.
 *
 * @param {EventChangesListProps} props Component props.
 * @returns {JSX.Element|null} The section.
 */
export function EventChangesList({ notices = [], timeZone, sessions = [], headingLevel = 'h2' }) {
  if (!Array.isArray(notices) || notices.length === 0) return null

  const Heading = headingLevel === 'h3' ? 'h3' : 'h2'

  return (
    <section aria-labelledby="event-changes-heading" className="space-y-3">
      <Heading id="event-changes-heading" className="text-lg font-semibold text-ink">
        Changes since you bought
      </Heading>
      <p className="text-sm text-ink-muted">
        Each change to this event’s date, place, terms or nights is recorded here. These notices are
        not emailed.
      </p>
      <ul className="space-y-3">
        {notices.map((notice) => {
          const serious = SERIOUS_CHANGE_KINDS.has(notice.kind)
          const moves = noticeMoves(notice, timeZone)
          const night =
            notice.sessionId && sessions.length > 0
              ? (sessions.find((session) => session?.id === notice.sessionId) ?? null)
              : null
          // A night the page does not list (an order's other nights, a ticket
          // good for every night) is named by when it was to start.
          const nightStart = night ? null : noticeNightStart(notice, timeZone)
          const words = changedWords(notice.changed)

          return (
            <li
              key={notice.id}
              className={`rounded-card border p-4 text-sm ${
                serious
                  ? 'border-status-danger/25 bg-status-danger-soft'
                  : 'border-line bg-surface-raised'
              }`}
            >
              <p className="font-semibold text-ink">
                {CHANGE_KIND_LABELS[notice.kind] ?? 'The event changed'}
                <span className="font-normal text-ink-muted">
                  {' '}
                  · {formatEventDate(notice.at, timeZone)}
                </span>
              </p>
              {notice.kind === 'DELETED' ? (
                <p className="mt-1 text-ink">{deletedForHolder(notice)}</p>
              ) : null}
              {night ? (
                <p className="mt-1 text-ink">
                  The night of {sessionDisplayLabel(night, { timeZone })}.
                </p>
              ) : nightStart ? (
                <p className="mt-1 text-ink">The night of {nightStart}.</p>
              ) : null}
              {words && notice.kind !== 'DELETED' ? (
                <p className="mt-1 text-ink">What changed: {words}.</p>
              ) : null}
              {moves.length > 0 ? (
                <ul className="mt-1 space-y-1 text-ink">
                  {moves.map((move) => (
                    <li key={move.field}>
                      The {move.label}: {move.before} → {move.after}
                    </li>
                  ))}
                </ul>
              ) : null}
              {notice.reason ? (
                <p className="mt-1 text-ink">
                  <span className="font-semibold">Reason given: </span>
                  {notice.reason}
                </p>
              ) : null}
              <p className="mt-1 text-ink-muted">Changed {noticeBy(notice)}.</p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
