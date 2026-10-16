/**
 * The visit tables of the analytics pages: where page views came from, where
 * an event's card was clicked, every day of the period, and each event's
 * figures.
 *
 * Server components and plain tables: a caption a screen reader announces on
 * entering, real column and row headers, and counts right-aligned in tabular
 * figures. Each sits in a `ScrollableTable`, so a narrow screen scrolls the
 * table rather than the page and a keyboard can reach the far columns.
 *
 * Nothing is computed here beyond a share of a whole and the sum of ticket and
 * seat clicks the API keeps apart; the API adds the visits up.
 *
 * @module components/traffic-tables
 */

import {
  CARD_PLACEMENT_LABELS,
  TRAFFIC_SOURCE_DESCRIPTIONS,
  TRAFFIC_SOURCE_LABELS,
} from '@desi-event/schemas/traffic-vocabulary'
import Link from 'next/link'

import { TABLE_SUMMARY } from '../lib/traffic-chart.js'
import {
  ORDERS_PAID_ON_DAYS_LABEL,
  dayNamer,
  formatCount,
  formatShare,
  trafficStatusLabel,
} from '../lib/traffic.js'
import { ScrollableTable } from './money-figure.jsx'
import { CAPTION, NUM, ROW_TH, TABLE, TD, TH, TH_NUM } from './report-table.js'
import { TEXT_LINK } from './workspace-kit.jsx'

/**
 * Ticket and seat clicks together, as the screens show them.
 *
 * @param {{ticketClicks: number, seatClicks: number}} row A row of counts.
 * @returns {number} The two added.
 */
export function ticketAndSeatClicks(row) {
  return (Number(row.ticketClicks) || 0) + (Number(row.seatClicks) || 0)
}

/**
 * @typedef {object} TrafficSourcesProps
 * @property {Array<{source: string, views: number}>} sources Page views per source.
 * @property {number} total Every page view in the period.
 */

/**
 * Where page views came from: a category per row, never a referring address.
 *
 * @param {TrafficSourcesProps} props Component props.
 * @returns {JSX.Element} The table.
 */
export function TrafficSources({ sources, total }) {
  const caption = 'Where page views came from'

  return (
    <ScrollableTable label={caption}>
      <table className={TABLE}>
        <caption className={CAPTION}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Source
            </th>
            <th scope="col" className={TH_NUM}>
              Page views
            </th>
            <th scope="col" className={TH_NUM}>
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {sources.map(({ source, views }) => (
            <tr key={source}>
              <th scope="row" className={ROW_TH}>
                <span className="block font-medium">{TRAFFIC_SOURCE_LABELS[source] ?? source}</span>
                {TRAFFIC_SOURCE_DESCRIPTIONS[source] ? (
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {TRAFFIC_SOURCE_DESCRIPTIONS[source]}
                  </span>
                ) : null}
              </th>
              <td className={NUM}>{formatCount(views)}</td>
              <td className={NUM}>{formatShare(views, total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollableTable>
  )
}

/**
 * @typedef {object} CardPlacementsProps
 * @property {Array<{placement: string, clicks: number}>} placements Card clicks per place.
 */

/**
 * Where the event's card was clicked: the home page, the events list or search.
 *
 * @param {CardPlacementsProps} props Component props.
 * @returns {JSX.Element} The table.
 */
export function CardPlacements({ placements }) {
  const caption = 'Where the event card was clicked'

  return (
    <ScrollableTable label={caption}>
      <table className={TABLE}>
        <caption className={CAPTION}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Place
            </th>
            <th scope="col" className={TH_NUM}>
              Clicks
            </th>
          </tr>
        </thead>
        <tbody>
          {placements.map(({ placement, clicks }) => (
            <tr key={placement}>
              <th scope="row" className={ROW_TH}>
                {CARD_PLACEMENT_LABELS[placement] ?? placement}
              </th>
              <td className={NUM}>{formatCount(clicks)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollableTable>
  )
}

/**
 * @typedef {object} TrafficByDayProps
 * @property {Array<object>} days The API's `byDay`, oldest first.
 * @property {boolean} open Whether the table starts open.
 */

/**
 * Every day of the period as a table: the chart's figures and the rest.
 *
 * Inside a disclosure so a year of rows does not push the page apart; open by
 * default for a short period. The summary always reads the same, so a reader
 * looking for the chart's table finds it by one name.
 *
 * @param {TrafficByDayProps} props Component props.
 * @returns {JSX.Element} The disclosure.
 */
export function TrafficByDay({ days, open }) {
  const caption = 'Visits per day (UTC)'
  // With the year once the period runs into a second one, so no two rows are
  // headed by the same day.
  const nameDay = dayNamer(days)

  return (
    <details open={open} className="mt-4">
      <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-sm text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus">
        {TABLE_SUMMARY}
      </summary>
      <ScrollableTable label={caption}>
        <table className={TABLE}>
          <caption className={CAPTION}>{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>
                Day
              </th>
              <th scope="col" className={TH_NUM}>
                Page views
              </th>
              <th scope="col" className={TH_NUM}>
                Visitors
              </th>
              <th scope="col" className={TH_NUM}>
                Event card clicks
              </th>
              <th scope="col" className={TH_NUM}>
                Ticket and seat clicks
              </th>
              <th scope="col" className={TH_NUM}>
                Website visits
              </th>
              <th scope="col" className={TH_NUM}>
                {ORDERS_PAID_ON_DAYS_LABEL}
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.day}>
                <th scope="row" className={ROW_TH}>
                  <time dateTime={day.day}>{nameDay(day.day)}</time>
                </th>
                <td className={NUM}>{formatCount(day.views)}</td>
                <td className={NUM}>{formatCount(day.visitors)}</td>
                <td className={NUM}>{formatCount(day.cardClicks)}</td>
                <td className={NUM}>{formatCount(ticketAndSeatClicks(day))}</td>
                <td className={NUM}>{formatCount(day.websiteRedirects)}</td>
                <td className={NUM}>{formatCount(day.ordersPaid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
    </details>
  )
}

/**
 * @typedef {object} EventsTrafficProps
 * @property {Array<object>} rows The API's `byEvent`.
 * @property {string} organizationId Whose events.
 * @property {Record<string, string>} [keep] Query values each event's link keeps (the period).
 * @property {string} [caption] The table's caption; the organisation's own reader is "you".
 */

/**
 * An organisation's events in the period, each linking to its own figures.
 *
 * A deleted event is listed and says so, because it was seen and sold before
 * it was taken down.
 *
 * @param {EventsTrafficProps} props Component props.
 * @returns {JSX.Element} The table, or a sentence when there are no events.
 */
export function EventsTraffic({
  rows,
  organizationId,
  keep = {},
  caption = 'Your events in this period',
}) {
  if (rows.length === 0) {
    return <p className="mt-3 text-sm text-ink-muted">This organisation has no events.</p>
  }

  /**
   * The event's own figures, keeping the period.
   *
   * @param {string} eventId The event.
   * @returns {string} The address.
   */
  const hrefFor = (eventId) => {
    const query = new URLSearchParams({ organizationId })

    for (const [key, value] of Object.entries(keep)) {
      if (value) query.set(key, value)
    }

    query.set('eventId', eventId)

    return `/analytics?${query.toString()}`
  }

  return (
    <ScrollableTable label={caption}>
      <table className={TABLE}>
        <caption className={CAPTION}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Event
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
            <th scope="col" className={TH_NUM}>
              Page views
            </th>
            <th scope="col" className={TH_NUM}>
              Visitors
            </th>
            <th scope="col" className={TH_NUM}>
              Ticket and seat clicks
            </th>
            <th scope="col" className={TH_NUM}>
              Website visits
            </th>
            <th scope="col" className={TH}>
              Website link
            </th>
            <th scope="col" className={TH_NUM}>
              {ORDERS_PAID_ON_DAYS_LABEL}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.eventId}>
              <th scope="row" className={ROW_TH}>
                <Link href={hrefFor(row.eventId)} className={TEXT_LINK}>
                  {row.title}
                </Link>
              </th>
              <td className={TD}>{trafficStatusLabel(row)}</td>
              <td className={NUM}>{formatCount(row.views)}</td>
              <td className={NUM}>{formatCount(row.visitors)}</td>
              <td className={NUM}>{formatCount(ticketAndSeatClicks(row))}</td>
              <td className={NUM}>{formatCount(row.websiteRedirects)}</td>
              <td className={TD}>{row.websiteLinkOn ? 'On' : 'Off'}</td>
              <td className={NUM}>{formatCount(row.ordersPaid)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollableTable>
  )
}
