/**
 * Every organisation's events, for the platform editors at The Desi Events.
 *
 * Platform administrators and super administrators edit a posted event in an
 * editing session opened with a reason, delete any event and restore a
 * deleted one (SPEC2-XI X-7, X-12). This is where they find it: a search, a
 * status, an organisation, the events taken off the site (deleted) on their
 * own filter, the imported events on theirs, and three orders. Each
 * row opens the event's own page, where every one of those actions is.
 *
 * Deleting erases nothing, so the page says so: a deleted event is listed
 * under "Taken off the site (deleted)", each row offering "Restore…", which
 * puts it back (ADR 0014 §6). A published event comes back published at the
 * same web address; what any other comes back as is said on its row.
 *
 * Each row also says the event's booking fee (the platform fee) — the site
 * default, none, or its own terms — and whether it can be paid for at the
 * venue, with its limit (SPEC3 §7.3). Both are set on the event's own page.
 *
 * The filters are links and a GET form, so they work without JavaScript and
 * can be bookmarked. The administration layout admits a platform administrator
 * on `organizer:invite` too; this page asks its own question again, and the
 * API refuses the list to anybody without the platform editing capability.
 *
 * @module app/admin/events/page
 */

import Link from 'next/link'
import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'

import { ReadRefusal, RefusalNotice } from '../../../components/read-refusal.jsx'
import { Badge, EmptyState } from '../../../components/ui.jsx'
import { TABLE_FRAME, TEXT_LINK } from '../../../components/workspace-kit.jsx'
import { sessionCan } from '../../../lib/capabilities.js'
import { feeListText, venueListText } from '../../../lib/event-control.js'
import { statusReading } from '../../../lib/event-status.js'
import { listPlatformEvents } from '../../../lib/organizer-api.js'
import { readSession } from '../../../lib/session.js'
import {
  LIST_PAGE_SIZE,
  PAGER_LINK_CLASSES,
  formatInstant,
  isPastTheEnd,
  listHref,
  readPage,
} from '../../../lib/workspace-api.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'All events', robots: { index: false, follow: false } }

/** The path of this page. */
const PATH = '/admin/events'

/** What a session without the capability is told. */
export const NOT_FOR_THIS_ACCOUNT =
  'Every organisation’s events are edited, deleted and restored by the platform administrators at The Desi Events. Nothing on this page can grant it.'

/** What the page says about itself. */
export const INTRODUCTION =
  'Every organisation’s events. Open one to edit it once it is published, in an editing session you open with a reason; to delete it, which takes it off the site; or, once it is deleted, to restore it, which puts it back. Deleting erases nothing, so a deleted event can be restored at any time. The organiser sees each change and its reason.'

/** What the list of deleted events says above its rows. */
export const RESTORE_NOTE =
  'These events were taken off the site. Nothing about them was erased: choose “Restore…” on a row to put that event back, at any time, with a reason. A published event comes back published, at the same web address; each row says what its event comes back as.'

/** What the page says once an event has been deleted from it. */
export const DELETED_STATUS =
  'Event deleted: it is off the site. It can be put back at any time from “Taken off the site (deleted)”, with “Restore…”.'

/** Which events the list holds: the ones on the site, or the deleted ones. */
export const SHOWING = Object.freeze([
  { value: 'exclude', label: 'Current events' },
  { value: 'only', label: 'Taken off the site (deleted)' },
  { value: 'include', label: 'Both' },
])

/** Whether the list holds every event, or only those imported from a source listing. */
export const SOURCES = Object.freeze([
  { value: undefined, label: 'From every source' },
  { value: 'only', label: 'Imported from listings' },
])

/** The orders the list can take, the API's default first. */
export const SORTS = Object.freeze([
  { value: 'updatedAt:desc', label: 'Recently changed' },
  { value: 'startsAt:asc', label: 'Soonest' },
  { value: 'createdAt:desc', label: 'Newest' },
])

/** The statuses the status filter offers, in the lifecycle's order. */
const STATUSES = Object.freeze([
  'DRAFT',
  'REVIEW_PENDING',
  'CHANGES_REQUIRED',
  'APPROVED',
  'REJECTED',
  'PUBLISHED',
  'ON_SALE',
  'SALES_PAUSED',
  'SOLD_OUT',
  'POSTPONED',
  'CANCELLED',
  'COMPLETED',
  'ARCHIVED',
])

/** The longest search the API takes. */
const SEARCH_MAX = 120

/** The shape of an id the API takes as an organisation filter. */
const ID_PATTERN = /^[a-z][a-z0-9]{7,31}$/u

/**
 * The filters from the address bar, each dropped when the API would refuse it.
 *
 * @param {Record<string, string|string[]>} query The query string.
 * @returns {{q?: string, status?: string, organizationId?: string, deleted: string, imported?: string, sort: string, page: number, searchDropped: boolean}} The filters.
 */
export function readFilters(query = {}) {
  const raw = typeof query.q === 'string' ? query.q.trim() : ''
  const q = raw && raw.length <= SEARCH_MAX && !/\p{Cc}/u.test(raw) ? raw : undefined

  return {
    q,
    searchDropped: Boolean(raw) && !q,
    status: STATUSES.includes(query.status) ? query.status : undefined,
    organizationId:
      typeof query.organizationId === 'string' && ID_PATTERN.test(query.organizationId)
        ? query.organizationId
        : undefined,
    deleted: SHOWING.some((each) => each.value === query.deleted) ? query.deleted : 'exclude',
    imported: query.imported === 'only' ? 'only' : undefined,
    sort: SORTS.some((each) => each.value === query.sort) ? query.sort : SORTS[0].value,
    page: readPage(query.page),
  }
}

/**
 * The filters as the page's own address carries them, defaults left out.
 *
 * @param {object} filters What `readFilters` read.
 * @param {object} [changes] What to change.
 * @returns {Record<string, string|number|null>} The query values.
 */
function hrefParams(filters, changes = {}) {
  const next = { ...filters, ...changes }

  return {
    q: next.q ?? null,
    status: next.status ?? null,
    organizationId: next.organizationId ?? null,
    deleted: next.deleted === 'exclude' ? null : next.deleted,
    imported: next.imported ?? null,
    sort: next.sort === SORTS[0].value ? null : next.sort,
    page: next.page ?? 1,
  }
}

/**
 * One event's row.
 *
 * @param {object} props Component props.
 * @param {object} props.row The API's row.
 * @param {object} props.filters The list's filters, for the organisation link.
 * @returns {JSX.Element} The table row.
 */
function EventRow({ row, filters }) {
  const reading = statusReading(row.status)
  const deleted = row.status === 'DELETED'
  const href = `${PATH}/${encodeURIComponent(row.id)}`
  const updated = formatInstant(row.updatedAt)

  return (
    <tr className="border-b border-line align-top text-sm">
      <th scope="row" className="pr-4 text-left font-medium text-ink">
        <span className="break-words">{row.title}</span>
        {PUBLICLY_VISIBLE_STATUSES.has(row.status) ? (
          <span className="block text-xs font-normal">
            <Link href={`/events/${encodeURIComponent(row.slug)}`} className={TEXT_LINK}>
              Public page<span className="sr-only">: {row.title}</span>
            </Link>
          </span>
        ) : null}
        {row.imported ? (
          <span className="mt-1 block">
            <Badge variant="neutral">Imported</Badge>
          </span>
        ) : null}
      </th>
      <td className="pr-4 text-ink">
        <Link
          href={listHref(
            PATH,
            hrefParams(filters, { organizationId: row.organization.id, page: 1 }),
          )}
          className={TEXT_LINK}
        >
          {row.organization.name}
          <span className="sr-only">: only this organisation’s events</span>
        </Link>
      </td>
      <td className="pr-4">
        <Badge variant={reading.tone} srLabel="State:">
          {reading.label}
        </Badge>
        {deleted && row.deletion ? (
          <span className="mt-1 block text-xs text-ink-muted">
            Restores as {statusReading(row.deletion.restoreTo).label.toLowerCase()}
          </span>
        ) : null}
      </td>
      <td className="pr-4 text-ink">
        <time dateTime={row.startsAt}>{formatInstant(row.startsAt)}</time>
      </td>
      <td className="pr-4 text-right text-ink tabular-nums">
        {row.paidOrders.toLocaleString('en-US')}
      </td>
      <td className="pr-4 text-right text-ink tabular-nums">
        {row.picturesWaiting.toLocaleString('en-US')}
      </td>
      <td className="pr-4 text-ink">{feeListText(row)}</td>
      <td className="pr-4 text-ink">{venueListText(row)}</td>
      <td className="pr-4 text-ink-muted">
        {updated ? <time dateTime={row.updatedAt}>{updated}</time> : null}
      </td>
      <td>
        <ul className="flex flex-col gap-1">
          <li>
            <Link href={href} className={TEXT_LINK}>
              {deleted ? 'Open its record' : 'Open in the editor'}
              <span className="sr-only">: {row.title}</span>
            </Link>
          </li>
          <li>
            <Link
              href={`${href}#${deleted ? 'restore-event' : 'delete-event'}`}
              className={TEXT_LINK}
            >
              {deleted ? 'Restore…' : 'Delete…'}
              <span className="sr-only"> {row.title}</span>
            </Link>
          </li>
        </ul>
      </td>
    </tr>
  )
}

/**
 * @typedef {object} AdminEventsPageProps
 * @property {Promise<Record<string, string>>} [searchParams] The resolved query string.
 */

/**
 * The page.
 *
 * @param {AdminEventsPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function AdminEventsPage({ searchParams } = {}) {
  const query = (await searchParams) ?? {}
  const filters = readFilters(query)
  const session = await readSession()

  const heading = (
    <>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Platform administration
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">All events</h1>
    </>
  )

  if (!sessionCan(session, 'event:platform_edit')) {
    return (
      <div>
        {heading}
        <RefusalNotice tone="neutral" title="Not for this account" detail={NOT_FOR_THIS_ACCOUNT} />
      </div>
    )
  }

  let events = []
  let pagination = null
  let failure = null

  try {
    const result = await listPlatformEvents({
      q: filters.q,
      status: filters.status,
      organizationId: filters.organizationId,
      deleted: filters.deleted,
      ...(filters.imported ? { imported: filters.imported } : {}),
      sort: filters.sort,
      page: filters.page,
      perPage: LIST_PAGE_SIZE,
    })

    events = result.events
    pagination = result.pagination
  } catch (error) {
    failure = error
  }

  const beyond = !failure && isPastTheEnd(events.length, pagination, filters.page)
  const organizationName = filters.organizationId
    ? (events.find((row) => row.organization.id === filters.organizationId)?.organization.name ??
      null)
    : null

  return (
    <div>
      {heading}
      <p className="mt-2 max-w-3xl text-ink-muted">{INTRODUCTION}</p>

      <p role="status" aria-live="polite" className="mt-2 text-sm font-medium text-ink">
        {query.deleted === '1' ? DELETED_STATUS : ''}
      </p>

      <nav aria-label="Which events" className="mt-4">
        <ul className="flex flex-wrap gap-2">
          {SHOWING.map((each) => {
            const current = each.value === filters.deleted

            return (
              <li key={each.value}>
                <Link
                  href={listHref(PATH, hrefParams(filters, { deleted: each.value, page: 1 }))}
                  aria-current={current ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus ${
                    current
                      ? 'bg-action-primary font-semibold text-action-primary-ink shadow-control'
                      : 'border border-line bg-surface-raised font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink'
                  }`}
                >
                  {each.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <nav aria-label="Where events come from" className="mt-2">
        <ul className="flex flex-wrap gap-2">
          {SOURCES.map((each) => {
            const current = each.value === filters.imported

            return (
              <li key={each.label}>
                <Link
                  href={listHref(PATH, hrefParams(filters, { imported: each.value, page: 1 }))}
                  aria-current={current ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus ${
                    current
                      ? 'bg-action-primary font-semibold text-action-primary-ink shadow-control'
                      : 'border border-line bg-surface-raised font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink'
                  }`}
                >
                  {each.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {filters.deleted !== 'exclude' ? (
        <p className="mt-4 max-w-3xl rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink">
          {RESTORE_NOTE}
        </p>
      ) : null}

      <form
        method="get"
        action={PATH}
        role="search"
        className="mt-4 flex flex-wrap items-end gap-3"
      >
        {filters.deleted !== 'exclude' ? (
          <input type="hidden" name="deleted" value={filters.deleted} />
        ) : null}
        {filters.organizationId ? (
          <input type="hidden" name="organizationId" value={filters.organizationId} />
        ) : null}
        {filters.imported ? <input type="hidden" name="imported" value={filters.imported} /> : null}
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="admin-events-search" className="text-sm font-medium text-ink">
            Search by title, web address or organisation
          </label>
          <input
            id="admin-events-search"
            type="search"
            name="q"
            defaultValue={filters.q ?? ''}
            maxLength={SEARCH_MAX}
            autoComplete="off"
            aria-describedby={filters.searchDropped ? 'admin-events-search-note' : undefined}
            className="min-h-11 w-72 max-w-full rounded-control border border-line-strong bg-surface-raised px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="admin-events-status" className="text-sm font-medium text-ink">
            Status
          </label>
          <select
            id="admin-events-status"
            name="status"
            defaultValue={filters.status ?? ''}
            className="min-h-11 rounded-control border border-line-strong bg-surface-raised px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
          >
            <option value="">Any status</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {statusReading(status).label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="admin-events-sort" className="text-sm font-medium text-ink">
            Order
          </label>
          <select
            id="admin-events-sort"
            name="sort"
            defaultValue={filters.sort}
            className="min-h-11 rounded-control border border-line-strong bg-surface-raised px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
          >
            {SORTS.map((each) => (
              <option key={each.value} value={each.value}>
                {each.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={PAGER_LINK_CLASSES}>
          Show
        </button>
        {filters.q || filters.status || filters.organizationId ? (
          <Link
            href={listHref(
              PATH,
              hrefParams({
                deleted: filters.deleted,
                imported: filters.imported,
                sort: filters.sort,
              }),
            )}
            className={PAGER_LINK_CLASSES}
          >
            Clear the filters
          </Link>
        ) : null}
      </form>
      {filters.searchDropped ? (
        <p id="admin-events-search-note" className="mt-2 text-sm text-ink-muted">
          A search is at most {SEARCH_MAX} characters, with no control characters, so this list is
          not filtered by it.
        </p>
      ) : null}
      {filters.organizationId ? (
        <p className="mt-2 text-sm text-ink">
          <span>
            Showing {organizationName ? `${organizationName}’s` : 'one organisation’s'} events only.
          </span>{' '}
          <Link
            href={listHref(PATH, hrefParams(filters, { organizationId: undefined, page: 1 }))}
            className={TEXT_LINK}
          >
            Every organisation’s events
          </Link>
        </p>
      ) : null}

      {failure ? (
        <ReadRefusal error={failure} what="The list of events" action="see every event" />
      ) : null}

      {beyond ? (
        <div className="mt-6 rounded-card border border-line bg-surface-subtle p-6">
          <p className="font-medium text-ink">Page {filters.page} is past the end of this list</p>
          <p className="mt-3">
            <Link
              href={listHref(PATH, hrefParams(filters, { page: 1 }))}
              className={PAGER_LINK_CLASSES}
            >
              Go to the first page
            </Link>
          </p>
        </div>
      ) : null}

      {!failure && !beyond && events.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing here"
            description={
              filters.q
                ? `No event matches “${filters.q}”.`
                : filters.deleted === 'only'
                  ? filters.imported
                    ? 'No imported event has been taken off the site.'
                    : 'No event has been taken off the site.'
                  : 'No event matches these filters.'
            }
          />
        </div>
      ) : null}

      {events.length > 0 ? (
        <div className={`mt-6 ${TABLE_FRAME}`}>
          <table className="w-full min-w-[68rem] border-collapse">
            <caption className="sr-only">
              Events
              {Number.isInteger(pagination?.total)
                ? `: ${pagination.total.toLocaleString('en-US')} in this list`
                : ''}
              , {SORTS.find((each) => each.value === filters.sort)?.label.toLowerCase()} first
            </caption>
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold tracking-wide text-ink-muted uppercase">
                <th scope="col">Event</th>
                <th scope="col">Organisation</th>
                <th scope="col">State</th>
                <th scope="col">Starts (UTC)</th>
                <th scope="col" className="text-right">
                  Paid orders
                </th>
                <th scope="col" className="text-right">
                  Pictures waiting
                </th>
                <th scope="col">Booking fee</th>
                <th scope="col">Pay at the venue</th>
                <th scope="col">Last changed</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((row) => (
                <EventRow key={row.id} row={row} filters={filters} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pagination && (pagination.hasPreviousPage || pagination.hasNextPage) ? (
        <nav aria-label="Pages" className="mt-6 flex flex-wrap gap-2">
          {pagination.hasPreviousPage ? (
            <Link
              href={listHref(PATH, hrefParams(filters, { page: filters.page - 1 }))}
              className={PAGER_LINK_CLASSES}
            >
              Previous page
            </Link>
          ) : null}
          {pagination.hasNextPage ? (
            <Link
              href={listHref(PATH, hrefParams(filters, { page: filters.page + 1 }))}
              className={PAGER_LINK_CLASSES}
            >
              Next page
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
