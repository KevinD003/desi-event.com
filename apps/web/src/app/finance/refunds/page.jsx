/**
 * Every refund of one organisation, in every status.
 *
 * The operations board lists the refunds somebody still has to act on. This
 * lists all of them — settled, declined and cancelled as well — so that every
 * refund's own page is reachable from somewhere other than a pasted address.
 *
 * ## Mode first
 *
 * The banner says what produced these figures before any of them is read: the
 * demonstration provider, or the sandbox. The refund list carries no mode, so
 * the page asks the finance summary for it with `getFinanceSummary`, as
 * `/finance` does — the one response that says, under the same capability and
 * step-up window as the list. If that one read fails and the list does not,
 * the page still says the one thing true of every mode this build can run in:
 * no real money moved.
 *
 * ## Scoped by organisation, and only one of yours
 *
 * `GET /v1/refunds` asserts `finance:view` *in* the organisation named, behind
 * the `FINANCE_VIEW` step-up. The picker offers only memberships holding it.
 * A platform finance administrator who belongs to no organisation has no list
 * to see here, and is told so rather than shown an empty table.
 *
 * ## What a row carries, and what it leaves out
 *
 * The order, the amount, the status in words, why, and when it was asked for
 * and last changed. Not the provider's refund reference or the payment's id —
 * the payload carries both; the detail page shows the provider reference to
 * somebody deciding about one refund, and a list has no use for them.
 *
 * ## The order
 *
 * Refunds still in flight first — asked for, approved, sent, timed out or
 * waiting on reconciliation — then the settled, declined and cancelled ones,
 * newest first within each. The API used to sort by the status column, which
 * PostgreSQL orders by the enum's declaration order and which put a timed-out
 * refund after the settled ones; it now reads the two tiers separately
 * (`apps/api/src/lib/ranked-page.js`), and the page says what it does.
 *
 * ## A page past the end is not an empty list
 *
 * A page number from the address can outlive the list. When a page has no rows
 * but the list has some, the page says so, says how many there are, and links
 * to the first page; "no refunds" is kept for a list that has none.
 *
 * @module app/finance/refunds/page
 */

import Link from 'next/link'
import { REFUND_STATUSES } from '@desi-event/schemas'

import { ModeBanner, ScrollableTable } from '../../../components/money-figure.jsx'
import { AsOf, Breadcrumbs, Empty } from '../../../components/page-state.jsx'
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { getFinanceSummary } from '../../../lib/organizer-api.js'
import { formatPrice } from '../../../lib/pricing.js'
import { membershipsWith, readSession } from '../../../lib/session.js'
import {
  LIST_PAGE_SIZE,
  PAGER_LINK_CLASSES,
  STATUS_TONE_CLASSES,
  formatInstant,
  isPastTheEnd,
  listHref,
  listRefunds,
  readPage,
} from '../../../lib/workspace-api.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Refunds', robots: { index: false, follow: false } }

/** Where this page lives. */
const PATH = '/finance/refunds'

/** The API's order reference shape, after trimming and upper-casing. */
const ORDER_REFERENCE = /^[A-Z0-9-]{4,32}$/u

/**
 * Each refund status in words, with its tone.
 *
 * The board's words — the code, spaced and lowered — capitalised, and the two
 * retained spellings from the Phase 2 schema marked as such. Every member of
 * `REFUND_STATUSES` is here, because the filter below offers every one.
 *
 * @type {Readonly<Record<string, {label: string, tone: string}>>}
 */
const STATUSES = Object.freeze({
  REQUESTED: { label: 'Requested', tone: 'pending' },
  APPROVED: { label: 'Approved', tone: 'pending' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  SUCCEEDED: { label: 'Succeeded (settled)', tone: 'success' },
  DECLINED: { label: 'Declined', tone: 'danger' },
  FAILED: { label: 'Failed', tone: 'danger' },
  TIMEOUT: { label: 'Timeout', tone: 'warning' },
  RECONCILIATION_REQUIRED: { label: 'Reconciliation required', tone: 'warning' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  PROCESSING: { label: 'Processing (older record)', tone: 'info' },
  REJECTED: { label: 'Rejected (older record)', tone: 'danger' },
})

/** A header cell. */
const TH = 'border-b border-line-strong px-3 py-2 text-left font-semibold text-ink'

/** A body cell. */
const TD = 'border-b border-line px-3 py-3 align-top text-ink'

/** A filter control. */
const CONTROL =
  'min-h-11 rounded-lg border border-line-strong bg-surface-raised px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/** A quiet text link. */
const LINK =
  'rounded-sm underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/** "Clear the filters": a quiet link, with a 44-pixel target. */
const CLEAR_LINK =
  'inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm text-ink underline underline-offset-4 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none'

/**
 * A count with its noun, singular or plural.
 *
 * @param {number} count How many.
 * @returns {string} "1 refund", "3 refunds".
 */
function refundsInWords(count) {
  return `${count} refund${count === 1 ? '' : 's'}`
}

/**
 * A status in words, or its code for one this page has not met.
 *
 * @param {string} status A refund status.
 * @returns {{label: string, tone: string}} The words.
 */
function statusInWords(status) {
  return STATUSES[status] ?? { label: status, tone: 'neutral' }
}

/**
 * Read one thing, reporting a failure rather than throwing it.
 *
 * @param {Function} load What to call.
 * @returns {Promise<{value: object|null, error: object|null}>} What came back.
 */
async function attempt(load) {
  try {
    return { value: await load(), error: null }
  } catch (error) {
    return { value: null, error }
  }
}

/**
 * Previous and next, keeping the filters.
 *
 * @param {object} props Component props.
 * @param {object|null} props.pagination The API's page counters.
 * @param {Record<string, string>} props.filters The filters in force.
 * @returns {JSX.Element|null} The navigation, or nothing for a single page.
 */
function Pager({ pagination, filters }) {
  if (!pagination || pagination.totalPages <= 1) return null

  return (
    <nav aria-label="Pages of refunds" className="mt-4 flex flex-wrap items-center gap-3 text-sm">
      <span className="text-ink-muted">
        Page {pagination.page} of {pagination.totalPages}
      </span>
      {pagination.hasPreviousPage ? (
        <Link
          href={listHref(PATH, { ...filters, page: pagination.page - 1 })}
          className={PAGER_LINK_CLASSES}
        >
          Previous page
        </Link>
      ) : null}
      {pagination.hasNextPage ? (
        <Link
          href={listHref(PATH, { ...filters, page: pagination.page + 1 })}
          className={PAGER_LINK_CLASSES}
        >
          Next page
        </Link>
      ) : null}
    </nav>
  )
}

/**
 * A page with no rows in a list that has some.
 *
 * @param {object} props Component props.
 * @param {number} props.page The page asked for.
 * @param {object|null} props.pagination The API's page counters.
 * @param {Record<string, string>} props.filters The filters in force.
 * @param {boolean} props.filtered Whether any filter narrows the list.
 * @returns {JSX.Element} The notice, with a way back.
 */
function PastTheEnd({ page, pagination, filters, filtered }) {
  const total = Number.isInteger(pagination?.total) ? pagination.total : null

  return (
    <div className="mt-6 rounded-card border border-line bg-surface-subtle p-6">
      <p className="font-medium text-ink">Page {page} is past the end of this list</p>
      <p className="mt-1 text-sm text-ink-muted">
        {total === null
          ? 'There is nothing on this page. The list may have shrunk since the link was made.'
          : `There ${total === 1 ? 'is' : 'are'} ${refundsInWords(total)} ${
              filtered ? 'matching these filters' : 'in all'
            }, on ${pagination.totalPages} page${pagination.totalPages === 1 ? '' : 's'}.`}
      </p>
      <p className="mt-3">
        <Link href={listHref(PATH, { ...filters, page: 1 })} className={PAGER_LINK_CLASSES}>
          Go to the first page
        </Link>
      </p>
    </div>
  )
}

/**
 * @typedef {object} RefundListPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The refund list.
 *
 * @param {RefundListPageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function RefundListPage({ searchParams }) {
  const query = (await searchParams) ?? {}
  const session = await readSession()
  // Memberships only. A platform role is not an organisation, and this list
  // is asked one organisation at a time.
  const organizations = membershipsWith(session, 'finance:view')

  const trail = (
    <Breadcrumbs
      trail={[
        { href: '/finance', label: 'Finance' },
        { href: null, label: 'Refunds' },
      ]}
    />
  )

  if (organizations.length === 0) {
    return (
      <div>
        {trail}
        <h1 className="mt-3 text-2xl font-bold text-ink">Refunds</h1>
        <p className="mt-4 max-w-3xl rounded-card border border-line bg-surface-subtle p-4 text-sm text-ink">
          Refunds are listed one organisation at a time, and this account holds finance access in no
          organisation, so there is no list to show here. If it should, ask whoever runs the
          organisation — nothing on this page can grant it.
        </p>
      </div>
    )
  }

  const selected =
    organizations.find((organization) => organization.organizationId === query.organizationId) ??
    organizations[0]
  const organizationId = selected.organizationId

  const status = REFUND_STATUSES.includes(query.status) ? query.status : ''
  const typedReference = typeof query.orderReference === 'string' ? query.orderReference : ''
  const normalisedReference = typedReference.trim().toUpperCase()
  const orderReference = ORDER_REFERENCE.test(normalisedReference) ? normalisedReference : ''
  const badReference = typedReference.trim() !== '' && !orderReference
  const page = readPage(query.page)
  const filters = { organizationId, status, orderReference }
  const filtered = Boolean(status || orderReference)

  const [list, mode] = await Promise.all([
    attempt(() =>
      listRefunds({ organizationId, status, orderReference, page, perPage: LIST_PAGE_SIZE }),
    ),
    attempt(() => getFinanceSummary({ organizationId, currency: 'INR' })),
  ])

  const refunds = list.value?.refunds ?? null
  const pagination = list.value?.pagination ?? null
  const beyond = refunds ? isPastTheEnd(refunds.length, pagination, page) : false

  return (
    <div>
      {trail}
      <h1 className="mt-3 text-2xl font-bold text-ink">Refunds</h1>
      <p className="mt-2 max-w-3xl text-ink-muted">
        Every refund in {selected.organizationName ?? 'this organisation'}: asked for, sent,
        settled, declined and cancelled alike, the ones still in flight first and the newest of
        those first. Each opens on its own page, where the decisions are made. To see the refunds in
        one status, filter by it.
      </p>

      {mode.value ? (
        <ModeBanner mode={mode.value.mode} notice={mode.value.modeNotice} />
      ) : refunds ? (
        <p className="mt-4 rounded-card border border-accent-line bg-accent-soft p-4 text-sm text-ink">
          <span className="font-semibold">Demonstration or sandbox data.</span> Which of the two
          could not be read just now; neither payment mode this build can run in moves real money.
        </p>
      ) : null}

      <form
        method="get"
        action={PATH}
        className="mt-6 flex flex-wrap items-end gap-4 rounded-card border border-line bg-surface-subtle p-4"
      >
        {organizations.length === 1 ? (
          <input type="hidden" name="organizationId" value={organizationId} />
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor="refund-organization" className="text-sm font-medium text-ink">
              Organisation
            </label>
            <select
              id="refund-organization"
              name="organizationId"
              defaultValue={organizationId}
              className={CONTROL}
            >
              {organizations.map((organization) => (
                <option key={organization.organizationId} value={organization.organizationId}>
                  {organization.organizationName ?? organization.organizationId}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="refund-status" className="text-sm font-medium text-ink">
            Status
          </label>
          <select id="refund-status" name="status" defaultValue={status} className={CONTROL}>
            <option value="">Every status</option>
            {REFUND_STATUSES.map((member) => (
              <option key={member} value={member}>
                {statusInWords(member).label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="refund-order" className="text-sm font-medium text-ink">
            Order reference
          </label>
          <input
            id="refund-order"
            name="orderReference"
            type="text"
            defaultValue={orderReference}
            autoComplete="off"
            spellCheck={false}
            maxLength={32}
            className={`${CONTROL} font-mono uppercase`}
          />
        </div>
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-ink hover:bg-action-primary-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Apply
        </button>
        {filtered ? (
          <Link href={listHref(PATH, { organizationId })} className={CLEAR_LINK}>
            Clear the filters
          </Link>
        ) : null}
      </form>

      {badReference ? (
        <p className="mt-3 text-sm text-ink-muted">
          That order reference is not in the form references take — letters, digits and dashes, 4 to
          32 of them — so the list is not narrowed by it.
        </p>
      ) : null}

      {list.error ? (
        <ReadRefusal
          error={list.error}
          what="The refund list"
          action="see this organisation’s refunds"
          backHref="/finance"
          backLabel="Back to finance"
        />
      ) : null}

      {refunds && beyond ? (
        <PastTheEnd page={page} pagination={pagination} filters={filters} filtered={filtered} />
      ) : null}

      {refunds && refunds.length === 0 && !beyond ? (
        <Empty
          title={filtered ? 'No refund matches these filters' : 'No refunds'}
          description={
            filtered
              ? 'Nothing in this organisation is in that state or on that order. Clear the filters to see every refund.'
              : 'This organisation has no refund on any of its orders, in any status.'
          }
        />
      ) : null}

      {refunds && refunds.length > 0 ? (
        <>
          <AsOf asOf={new Date().toISOString()} />
          <ScrollableTable label="Refunds">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <caption className="sr-only">
                Refunds in {selected.organizationName ?? 'this organisation'}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    Refund
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Amount
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                  <th scope="col" className={TH}>
                    Why
                  </th>
                  <th scope="col" className={TH}>
                    Asked for
                  </th>
                  <th scope="col" className={TH}>
                    Last changed
                  </th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((refund) => {
                  const words = statusInWords(refund.status)

                  return (
                    <tr key={refund.id}>
                      <th scope="row" className={`${TD} font-normal`}>
                        <Link
                          href={`/finance/refunds/${encodeURIComponent(refund.id)}`}
                          className={`${LINK} font-medium`}
                        >
                          Refund on{' '}
                          <span className="font-mono">{refund.orderReference ?? 'an order'}</span>
                        </Link>
                      </th>
                      <td className={`${TD} text-right tabular-nums`}>
                        {formatPrice(refund.amountCents, refund.currency)}
                      </td>
                      <td className={TD}>
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                            STATUS_TONE_CLASSES[words.tone] ?? STATUS_TONE_CLASSES.neutral
                          }`}
                        >
                          {words.label}
                        </span>
                      </td>
                      <td className={`${TD} text-ink-muted`}>
                        {String(refund.reason ?? '')
                          .replace(/_/gu, ' ')
                          .toLowerCase()}
                      </td>
                      <td className={`${TD} text-ink-muted`}>
                        <time dateTime={refund.createdAt}>
                          {formatInstant(refund.createdAt) ?? '—'}
                        </time>
                      </td>
                      <td className={`${TD} text-ink-muted`}>
                        {refund.updatedAt ? (
                          <time dateTime={refund.updatedAt}>{formatInstant(refund.updatedAt)}</time>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ScrollableTable>

          {pagination ? (
            <p className="mt-4 text-sm text-ink-muted">
              Showing {refunds.length} of {pagination.total}.
            </p>
          ) : null}
          <Pager pagination={pagination} filters={filters} />
        </>
      ) : null}
    </div>
  )
}
