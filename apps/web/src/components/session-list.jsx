/**
 * An event's nights, as its schedule.
 *
 * Each night is labelled truthfully — the organiser's name for it beside its
 * own date, or its date alone — with its doors, start and end as `<time>`
 * elements in the venue's zone, and its state in words. A night with a seat
 * map that is selling links to its seats. The zone is stated once, for all of
 * them, because a buyer reading a time in their own zone is how people turn up
 * an hour late.
 *
 * A Server Component: nothing here has state.
 *
 * @module components/session-list
 */

import Link from 'next/link'

import { formatTimeZoneLabel, toDateTimeAttribute } from '../lib/format.js'
import {
  formatNightTime,
  sessionDisplayLabel,
  sessionSellsSeats,
  sessionStatusBadge,
} from '../lib/sessions.js'
import { TEXT_LINK } from './link-classes.js'
import { Badge } from './ui.jsx'

/**
 * One fact of a night: a term and a time.
 *
 * @param {object} props Component props.
 * @param {string} props.term What the time is.
 * @param {string} props.value An ISO instant.
 * @param {string} props.timezone The night's zone.
 * @returns {JSX.Element} The fact.
 */
function NightTime({ term, value, timezone }) {
  return (
    <div className="flex gap-2">
      <dt className="font-semibold text-ink">{term}</dt>
      <dd className="text-ink-muted">
        <time dateTime={toDateTimeAttribute(value)}>{formatNightTime(value, timezone)}</time>
      </dd>
    </div>
  )
}

/**
 * @typedef {object} SessionListProps
 * @property {object[]} sessions The event's public nights, soonest first.
 * @property {string} eventSlug The event's slug, for the seat links.
 * @property {boolean} [buyable] Whether the event itself is selling.
 * @property {object[]} [ticketTypes] The event's tiers, to tell a sold-out seated night from one not selling now.
 * @property {Date} [now] The moment in question.
 */

/**
 * The nights, as an ordered list.
 *
 * @param {SessionListProps} props Component props.
 * @returns {JSX.Element} The list.
 */
export function SessionList({
  sessions,
  eventSlug,
  buyable = true,
  ticketTypes = [],
  now = new Date(),
}) {
  const zone = sessions[0]
    ? formatTimeZoneLabel({ startsAt: sessions[0].startsAt, timezone: sessions[0].timezone })
    : null

  return (
    <div>
      <p className="text-sm text-ink-muted">
        All times are {zone ? `${zone} — ` : ''}the local time at the venue
        {sessions[0]?.timezone ? ` (${sessions[0].timezone})` : ''}, not your own.
      </p>
      <ol aria-label="Nights" className="mt-4 space-y-4">
        {sessions.map((session) => {
          const badge = sessionStatusBadge(session, now, ticketTypes)
          const seats = buyable && sessionSellsSeats(session, now)

          return (
            <li
              key={session.id}
              className="rounded-card border border-line bg-surface-raised p-4 shadow-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-base font-bold text-ink">{sessionDisplayLabel(session)}</h3>
                <Badge variant={badge.variant} srLabel="Sales:">
                  {badge.text}
                </Badge>
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-3">
                {session.doorsOpenAt ? (
                  <NightTime term="Doors" value={session.doorsOpenAt} timezone={session.timezone} />
                ) : null}
                <NightTime term="Starts" value={session.startsAt} timezone={session.timezone} />
                <NightTime term="Ends" value={session.endsAt} timezone={session.timezone} />
              </dl>
              {seats ? (
                <p className="mt-3 text-sm">
                  <Link
                    href={`/events/${encodeURIComponent(eventSlug)}/seats/${encodeURIComponent(session.id)}`}
                    className={TEXT_LINK}
                  >
                    Choose seats for {sessionDisplayLabel(session)}
                  </Link>
                </p>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
