/**
 * Every event's visits: the platform list, for the platform administrators
 * and super administrators at The Desi Events.
 *
 * Counted the same way organisers see their own events, in whole UTC days,
 * with robots, organisers' teams and staff left out. It shows counts and paid
 * orders, never money and never a buyer: the API sends neither. Each event
 * links to its own figures on the analytics page, keeping the period.
 *
 * A deleted event is listed and says "Deleted", because it was seen and sold
 * before it was taken down.
 *
 * The page refuses a session without the platform list's capability before
 * asking for anything, and the API refuses it anyway. The period, the search
 * and the scope are links and a GET form, so they work without JavaScript and
 * can be bookmarked. The list is bounded to the last 30 days by default.
 *
 * @module app/analytics/events/page
 */

import Link from 'next/link'

import { ScrollableTable } from '../../../components/money-figure.jsx'
import { Breadcrumbs } from '../../../components/page-state.jsx'
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { CAPTION, NUM, ROW_TH, TABLE, TD, TH, TH_NUM } from '../../../components/report-table.js'
import { ticketAndSeatClicks } from '../../../components/traffic-tables.jsx'
import { Alert } from '../../../components/ui.jsx'
import { TEXT_LINK } from '../../../components/workspace-kit.jsx'
import { getPlatformTraffic } from '../../../lib/organizer-api.js'
import { readSession, sessionCan } from '../../../lib/session.js'
import {
  DEFAULT_PLATFORM_PERIOD,
  DEMONSTRATION_NOTICE,
  ORDERS_PAID_ON_DAYS_LABEL,
  PERIODS,
  REFUNDED_ORDERS_NOTE,
  formatCount,
  freshness,
  periodFor,
  periodFrom,
  trafficStatusLabel,
} from '../../../lib/traffic.js'
import {
  LIST_PAGE_SIZE,
  PAGER_LINK_CLASSES,
  isPastTheEnd,
  listHref,
  readPage,
} from '../../../lib/workspace-api.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Every event’s visits', robots: { index: false, follow: false } }

/** The path of this page. */
const PATH = '/analytics/events'

/** What a session without the platform list's capability is told. */
export const NOT_FOR_YOU =
  'Every event’s visits are shown to platform administrators at The Desi Events. Your own organisations’ figures are under Analytics. Nothing on this page can grant it.'

/** What the page says it shows. */
export const INTRODUCTION =
  'Visits to every event page on The Desi Events, counted the same way organisers see their own: without cookies, in whole UTC days, with robots, organisers’ teams and staff left out. Sales are shown as paid orders; money is not shown here.'

/** The longest search the API takes. */
const SEARCH_MAX = 100

/**
 * The search from the address bar, when it is one the API would take.
 *
 * @param {unknown} value The raw `q` parameter.
 * @returns {string|undefined} The search, trimmed, or nothing.
 */
export function readTrafficSearch(value) {
  if (typeof value !== 'string') return undefined

  const text = value.trim()

  if (text.length < 1 || text.length > SEARCH_MAX || /\p{Cc}/u.test(text)) return undefined

  return text
}

const CHIP =
  'inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'
const CHIP_CURRENT = `${CHIP} bg-action-primary font-semibold text-action-primary-ink shadow-control`
const CHIP_OTHER = `${CHIP} border border-line bg-surface-raised font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink`

/**
 * One event's own figures, on the analytics page, keeping the period.
 *
 * @param {object} row A row of the platform list.
 * @param {string} range The period's key.
 * @returns {string} The address.
 */
export function drillDownHref(row, range) {
  const query = new URLSearchParams({
    organizationId: row.organization.id,
    eventId: row.eventId,
    range,
  })

  return `/analytics?${query.toString()}`
}

/**
 * The ten most viewed events in the period.
 *
 * @param {object} props Component props.
 * @param {Array<object>} props.rows The API's `top`.
 * @param {string} props.range The period's key.
 * @returns {JSX.Element} The table, or a sentence when nothing was viewed.
 */
function MostVisited({ rows, range }) {
  const caption = 'Most visited in this period'

  if (rows.length === 0) {
    return <p className="mt-3 text-sm text-ink-muted">No page views were counted in this period.</p>
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
              Organiser
            </th>
            <th scope="col" className={TH_NUM}>
              Page views
            </th>
            <th scope="col" className={TH_NUM}>
              Visitors
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
                <Link href={drillDownHref(row, range)} className={TEXT_LINK}>
                  {row.title}
                </Link>
                {row.deleted ? <span className="ml-2 text-xs text-ink-muted">Deleted</span> : null}
              </th>
              <td className={TD}>{row.organization.name}</td>
              <td className={NUM}>{formatCount(row.views)}</td>
              <td className={NUM}>{formatCount(row.visitors)}</td>
              <td className={NUM}>{formatCount(row.ordersPaid)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollableTable>
  )
}

/**
 * Every event, newest start first, one page of them.
 *
 * @param {object} props Component props.
 * @param {Array<object>} props.rows The API's `events`.
 * @param {string} props.range The period's key.
 * @param {boolean} props.decidesLinks Whether the reader turns website links on or off.
 * @returns {JSX.Element} The table.
 */
function EventRows({ rows, range, decidesLinks }) {
  const caption = 'Events, newest start first'

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
              Organiser
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
              Event card clicks
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
                <Link href={drillDownHref(row, range)} className={TEXT_LINK}>
                  {row.title}
                </Link>
              </th>
              <td className={TD}>{row.organization.name}</td>
              <td className={TD}>{trafficStatusLabel(row)}</td>
              <td className={NUM}>{formatCount(row.views)}</td>
              <td className={NUM}>{formatCount(row.visitors)}</td>
              <td className={NUM}>{formatCount(row.cardClicks)}</td>
              <td className={NUM} title={`${row.ticketClicks} ticket, ${row.seatClicks} seat`}>
                {formatCount(ticketAndSeatClicks(row))}
              </td>
              <td className={NUM}>{formatCount(row.websiteRedirects)}</td>
              <td className={TD}>
                {decidesLinks ? (
                  <Link
                    href={`/moderation/events/${encodeURIComponent(row.eventId)}#website-link`}
                    className={TEXT_LINK}
                  >
                    {row.websiteLinkOn ? 'On' : 'Off'}
                  </Link>
                ) : row.websiteLinkOn ? (
                  'On'
                ) : (
                  'Off'
                )}
              </td>
              <td className={NUM}>{formatCount(row.ordersPaid)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollableTable>
  )
}

/**
 * @typedef {object} PlatformTrafficPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The page.
 *
 * @param {PlatformTrafficPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function PlatformTrafficPage({ searchParams }) {
  const query = (await searchParams) ?? {}
  const session = await readSession()

  if (!sessionCan(session, 'analytics:view_all')) {
    return (
      <div>
        <h1 className="text-h2 font-semibold text-ink">Not for you</h1>
        <p className="mt-2 max-w-3xl text-ink-muted">{NOT_FOR_YOU}</p>
        <p className="mt-4">
          <Link href="/analytics" className={TEXT_LINK}>
            Analytics
          </Link>
        </p>
      </div>
    )
  }

  const period = periodFor(query.range, DEFAULT_PLATFORM_PERIOD)
  const q = readTrafficSearch(query.q)
  const scope = query.scope === 'all' ? 'all' : 'public'
  const page = readPage(query.page)
  const decidesLinks = sessionCan(session, 'website_redirect:manage')

  // The address keeps only what differs from the defaults.
  const filters = {
    range: period.key === DEFAULT_PLATFORM_PERIOD ? null : period.key,
    q,
    scope: scope === 'public' ? null : scope,
  }

  let data = null
  let pagination = null
  let failure = null

  try {
    const result = await getPlatformTraffic({
      q,
      scope,
      from: periodFrom(period.key) ?? undefined,
      page,
      perPage: LIST_PAGE_SIZE,
    })

    data = result.data
    pagination = result.pagination
  } catch (error) {
    failure = error
  }

  const events = data?.events ?? []
  const beyond = !failure && isPastTheEnd(events.length, pagination, page)
  const fresh = data ? freshness(data) : null

  return (
    <div>
      <Breadcrumbs
        trail={[
          { label: 'Workspace' },
          { href: '/analytics', label: 'Analytics' },
          { label: 'Every event' },
        ]}
      />
      <h1 className="mt-3 text-h2 font-semibold text-ink">Every event’s visits</h1>
      <p className="mt-2 max-w-3xl text-ink-muted">{INTRODUCTION}</p>

      {fresh ? (
        fresh.tone === 'stale' ? (
          <Alert variant="warning" className="mt-4">
            {fresh.sentence} Days are UTC days.
          </Alert>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">{fresh.sentence} Days are UTC days.</p>
        )
      ) : null}

      {data?.includesDemonstration ? (
        <Alert variant="warning" title={DEMONSTRATION_NOTICE.title} className="mt-4">
          {DEMONSTRATION_NOTICE.body}
        </Alert>
      ) : null}

      <nav aria-label="Choose a period" className="mt-6">
        <ul className="flex flex-wrap gap-2">
          {PERIODS.map((each) => {
            const current = each.key === period.key

            return (
              <li key={each.key}>
                <Link
                  href={listHref(PATH, {
                    ...filters,
                    range: each.key === DEFAULT_PLATFORM_PERIOD ? null : each.key,
                  })}
                  aria-current={current ? 'page' : undefined}
                  className={current ? CHIP_CURRENT : CHIP_OTHER}
                >
                  {each.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <form
        method="get"
        action={PATH}
        role="search"
        className="mt-4 flex flex-wrap items-end gap-4"
      >
        {filters.range ? <input type="hidden" name="range" value={filters.range} /> : null}
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="traffic-q" className="text-sm font-medium text-ink">
            Search by event, web address or organiser
          </label>
          <input
            id="traffic-q"
            type="search"
            name="q"
            defaultValue={q ?? ''}
            maxLength={SEARCH_MAX}
            autoComplete="off"
            className="min-h-11 w-72 max-w-full rounded-control border border-line-strong bg-surface-raised px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          />
        </div>
        <fieldset className="flex flex-wrap items-center gap-4">
          <legend className="text-sm font-medium text-ink">Which events</legend>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="scope"
              value="public"
              defaultChecked={scope === 'public'}
              className="h-5 w-5 accent-action-primary"
            />
            Public events
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="scope"
              value="all"
              defaultChecked={scope === 'all'}
              className="h-5 w-5 accent-action-primary"
            />
            All events
          </label>
        </fieldset>
        <button type="submit" className={PAGER_LINK_CLASSES}>
          Search
        </button>
      </form>

      {failure ? (
        <ReadRefusal
          error={failure}
          what="Every event’s visits"
          action="see every event’s visits"
        />
      ) : null}

      {data ? (
        <>
          <section aria-labelledby="top-heading" className="mt-8">
            <h2 id="top-heading" className="text-xl font-semibold text-ink">
              Most visited in this period
            </h2>
            <MostVisited rows={data.top ?? []} range={period.key} />
          </section>

          <section aria-labelledby="events-heading" className="mt-8">
            <h2 id="events-heading" className="text-xl font-semibold text-ink">
              Events
            </h2>
            {beyond ? (
              <div className="mt-4 rounded-card border border-line bg-surface-subtle p-6">
                <p className="font-medium text-ink">Page {page} is past the end of this list</p>
                <p className="mt-3">
                  <Link
                    href={listHref(PATH, { ...filters, page: 1 })}
                    className={PAGER_LINK_CLASSES}
                  >
                    Go to the first page
                  </Link>
                </p>
              </div>
            ) : events.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">No events match.</p>
            ) : (
              <EventRows rows={events} range={period.key} decidesLinks={decidesLinks} />
            )}
            <p className="mt-2 text-sm text-ink-muted">
              {ORDERS_PAID_ON_DAYS_LABEL} counts the orders paid in the period’s UTC days.{' '}
              {REFUNDED_ORDERS_NOTE}
            </p>

            {pagination && (pagination.hasPreviousPage || pagination.hasNextPage) ? (
              <nav aria-label="Pages" className="mt-6 flex flex-wrap gap-2">
                {pagination.hasPreviousPage ? (
                  <Link
                    href={listHref(PATH, { ...filters, page: page - 1 })}
                    className={PAGER_LINK_CLASSES}
                  >
                    Previous page
                  </Link>
                ) : null}
                {pagination.hasNextPage ? (
                  <Link
                    href={listHref(PATH, { ...filters, page: page + 1 })}
                    className={PAGER_LINK_CLASSES}
                  >
                    Next page
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  )
}
