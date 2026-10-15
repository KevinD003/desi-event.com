/**
 * Referral codes, for the platform administrators at The Desi Events (SPEC3
 * §12.5, SPEC3-XI §12.5).
 *
 * What each administrator's codes came to, then the codes, 50 a page, newest
 * first: the code (with "Copy code"), its label, which events it works for, its
 * uses (and, once any were given back, how many were placed and given back),
 * the booking fees it waived, its expiry, its status, who made it, and a link
 * to its own page. "Make a referral code" opens the form.
 *
 * The filters — status, who made it, an event it works for — are a GET form,
 * so they work without JavaScript and can be bookmarked. A code's text is never
 * one of them: it would sit in the address bar and the access logs. Finding a
 * code by its text is "Find on this page", in the browser.
 *
 * The administration layout admits finance administrators too, for the
 * booking-fee refunds; this page asks its own question again
 * (`referral_code:manage`), and the API refuses every read and write to
 * anybody else.
 *
 * @module app/admin/referral-codes/page
 */

import Link from 'next/link'

import { ReadRefusal, RefusalNotice } from '../../../components/read-refusal.jsx'
import { EmptyState } from '../../../components/ui.jsx'
import { PRIMARY_LINK } from '../../../components/workspace-kit.jsx'
import { sessionCan } from '../../../lib/capabilities.js'
import { readSession } from '../../../lib/session.js'
import {
  PAGER_LINK_CLASSES,
  isPastTheEnd,
  listHref,
  listReferralCodes,
  referralCodesByAdministrator,
} from '../../../lib/workspace-api.js'
import { ReferralCodeList } from './referral-code-list.jsx'
import { EventFilterField } from './referral-event-picker.jsx'
import {
  EMPTY_FILTERED,
  EMPTY_LIST,
  INTRODUCTION,
  LIST_NOTE,
  NOT_FOR_THIS_ACCOUNT,
  REFERRAL_CODES_PATH,
  STACKED,
  STATUS_FILTERS,
  makerName,
  readListFilters,
  waivedText,
} from './referral-vocabulary.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Referral codes', robots: { index: false, follow: false } }

/** The classes of the filter form's selects. */
const SELECT =
  'min-h-11 rounded-control border border-line-strong bg-surface-raised px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/**
 * The heading every state of the page shares.
 *
 * @returns {JSX.Element} The eyebrow and the heading.
 */
function Heading() {
  return (
    <>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Platform administration
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Referral codes</h1>
    </>
  )
}

/** The columns of "By administrator", after the administrator's own. */
const BY_ADMINISTRATOR_COLUMNS = Object.freeze([
  ['Codes', (row) => row.codes.toLocaleString('en-US')],
  ['Uses placed', (row) => row.usesPlaced.toLocaleString('en-US')],
  ['Given back', (row) => row.usesReturned.toLocaleString('en-US')],
  ['Uses now', (row) => row.currentUses.toLocaleString('en-US')],
  ['Booking fees waived', (row) => waivedText(row.waived)],
])

/**
 * What each administrator's codes came to.
 *
 * Like the codes below it, the table becomes stacked cards below 640 px, so
 * nothing scrolls sideways at 320 px (SPEC3 §12.12): each card is headed by
 * the administrator, and each figure keeps its column's name, hidden from
 * screen readers, which read the table's own headers.
 *
 * @param {object} props Component props.
 * @param {object[]} props.rows The rows of `referralCodes.byAdministrator`.
 * @returns {JSX.Element|null} The table, or nothing when no code was made.
 */
function ByAdministrator({ rows }) {
  if (rows.length === 0) return null

  return (
    <section aria-labelledby="by-administrator-heading" className="mt-8">
      <h2 id="by-administrator-heading" className="text-lg font-semibold text-ink">
        By administrator
      </h2>
      <div className="mt-3">
        <table className={STACKED.table}>
          <caption className="sr-only">Referral codes by the administrator who made them</caption>
          <thead className={STACKED.thead}>
            <tr>
              <th scope="col" className={STACKED.th}>
                Administrator
              </th>
              {BY_ADMINISTRATOR_COLUMNS.map(([name]) => (
                <th key={name} scope="col" className={STACKED.th}>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={STACKED.tbody}>
            {rows.map((row) => (
              <tr key={row.administrator?.id ?? 'former'} className={STACKED.row}>
                <th
                  scope="row"
                  className={`${STACKED.cell} text-left font-semibold break-words sm:font-medium`}
                >
                  {makerName(row.administrator)}
                </th>
                {BY_ADMINISTRATOR_COLUMNS.map(([name, value]) => (
                  <td key={name} className={STACKED.cell}>
                    <span aria-hidden="true" className={STACKED.label}>
                      {name}
                    </span>
                    <span className="min-w-0 tabular-nums">{value(row)}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * @typedef {object} ReferralCodesPageProps
 * @property {Promise<Record<string, string>>} [searchParams] The resolved query string.
 */

/**
 * The page.
 *
 * @param {ReferralCodesPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function ReferralCodesPage({ searchParams } = {}) {
  const query = (await searchParams) ?? {}
  const filters = readListFilters(query)
  const session = await readSession()

  if (!sessionCan(session, 'referral_code:manage')) {
    return (
      <div>
        <Heading />
        <RefusalNotice tone="neutral" title="Not for this account" detail={NOT_FOR_THIS_ACCOUNT} />
      </div>
    )
  }

  const [listed, makers] = await Promise.allSettled([
    listReferralCodes({
      status: filters.status,
      creatorId: filters.creatorId,
      eventId: filters.eventId,
      page: filters.page,
    }),
    referralCodesByAdministrator(),
  ])

  const failure = listed.status === 'rejected' ? listed.reason : null
  const codes = listed.status === 'fulfilled' ? listed.value.codes : []
  const pagination = listed.status === 'fulfilled' ? listed.value.pagination : null
  const rows = makers.status === 'fulfilled' ? makers.value : []
  const filtered = Boolean(filters.status || filters.creatorId || filters.eventId)
  const beyond = !failure && isPastTheEnd(codes.length, pagination, filters.page)
  const administrators = rows.filter((row) => row.administrator)
  const filterEvent = filters.eventId
    ? (codes.flatMap((code) => code.events ?? []).find((event) => event.id === filters.eventId) ?? {
        id: filters.eventId,
        title: 'The chosen event',
      })
    : null
  const params = (page) => ({
    status: filters.status,
    creatorId: filters.creatorId,
    eventId: filters.eventId,
    page,
  })

  return (
    <div>
      <Heading />
      <p className="mt-2 max-w-3xl text-ink-muted">{INTRODUCTION}</p>
      <p className="mt-4">
        <Link href={`${REFERRAL_CODES_PATH}/new`} className={PRIMARY_LINK}>
          Make a referral code
        </Link>
      </p>

      {makers.status === 'rejected' ? (
        <ReadRefusal
          error={makers.reason}
          what="What each administrator’s codes came to"
          action="see the referral codes"
        />
      ) : (
        <ByAdministrator rows={rows} />
      )}

      <section aria-labelledby="codes-heading" className="mt-10">
        <h2 id="codes-heading" className="text-lg font-semibold text-ink">
          Codes
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">{LIST_NOTE}</p>

        <form
          method="get"
          action={REFERRAL_CODES_PATH}
          role="search"
          aria-label="Filter the referral codes"
          className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="referral-status" className="text-sm font-medium text-ink">
              Status
            </label>
            <select
              id="referral-status"
              name="status"
              defaultValue={filters.status ?? ''}
              className={SELECT}
            >
              {STATUS_FILTERS.map((each) => (
                <option key={each.value} value={each.value}>
                  {each.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="referral-maker" className="text-sm font-medium text-ink">
              Made by
            </label>
            <select
              id="referral-maker"
              name="creatorId"
              defaultValue={filters.creatorId ?? ''}
              className={SELECT}
            >
              <option value="">Anybody</option>
              {administrators.map((row) => (
                <option key={row.administrator.id} value={row.administrator.id}>
                  {row.administrator.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0 sm:col-span-2 lg:col-span-3">
            <EventFilterField initial={filterEvent} />
          </div>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3">
            <button type="submit" className={PAGER_LINK_CLASSES}>
              Show
            </button>
            {filtered ? (
              <Link href={REFERRAL_CODES_PATH} className={PAGER_LINK_CLASSES}>
                Clear the filters
              </Link>
            ) : null}
          </div>
        </form>

        {failure ? (
          <ReadRefusal
            error={failure}
            what="The list of referral codes"
            action="see the referral codes"
          />
        ) : null}

        {beyond ? (
          <div className="mt-6 rounded-card border border-line bg-surface-subtle p-6">
            <p className="font-medium text-ink">Page {filters.page} is past the end of this list</p>
            <p className="mt-1 text-sm text-ink-muted">
              There is nothing on this page. The list may have shrunk since the link was made.
            </p>
            <p className="mt-3">
              <Link href={listHref(REFERRAL_CODES_PATH, params(1))} className={PAGER_LINK_CLASSES}>
                Go to the first page
              </Link>
            </p>
          </div>
        ) : null}

        {!failure && !beyond && codes.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title={filtered ? EMPTY_FILTERED : EMPTY_LIST}
              action={
                filtered ? null : (
                  <Link href={`${REFERRAL_CODES_PATH}/new`} className={PRIMARY_LINK}>
                    Make a referral code
                  </Link>
                )
              }
            />
          </div>
        ) : null}

        {codes.length > 0 ? <ReferralCodeList codes={codes} caption="Referral codes" /> : null}

        {pagination && (pagination.hasPreviousPage || pagination.hasNextPage) ? (
          <nav aria-label="Pages" className="mt-6 flex flex-wrap gap-2">
            {pagination.hasPreviousPage ? (
              <Link
                href={listHref(REFERRAL_CODES_PATH, params(filters.page - 1))}
                className={PAGER_LINK_CLASSES}
              >
                Previous page
              </Link>
            ) : null}
            {pagination.hasNextPage ? (
              <Link
                href={listHref(REFERRAL_CODES_PATH, params(filters.page + 1))}
                className={PAGER_LINK_CLASSES}
              >
                Next page
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  )
}
